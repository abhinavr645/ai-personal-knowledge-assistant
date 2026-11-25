import "server-only";

import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { readBoundedJson } from "@/lib/bounded-json";
import { queryJson } from "./query-request";

const minuteMs = 60_000;
const hourMs = 3_600_000;
const timeoutMs = 2_000;

// Redis runs the check and updates atomically. A rejected request consumes
// neither budget. SET with PX starts an expiring window on its first admission.
const admit = `
local total_wait = 0
local existing = {}
for i = 1, #KEYS do
  local count = redis.call('GET', KEYS[i])
  existing[i] = count ~= false
  if count then
    local number = tonumber(count)
    local ttl = redis.call('PTTL', KEYS[i])
    if not number or number < 1 or number % 1 ~= 0 or ttl < 0 then
      return redis.error_reply('invalid admission counter')
    end
    if number >= tonumber(ARGV[i]) then
      total_wait = math.max(total_wait, ttl, 1)
    end
  end
end
if total_wait > 0 then return {0, total_wait} end
for i = 1, #KEYS do
  if existing[i] then
    redis.call('INCR', KEYS[i])
  else
    redis.call('SET', KEYS[i], 1, 'PX', ARGV[#KEYS + i])
  end
end
return {1, 0}
`;

const resultSchema = z.object({
  result: z.union([
    z.tuple([z.literal(1), z.literal(0)]),
    z.tuple([z.literal(0), z.number().int().min(1).max(hourMs)]),
  ]),
  error: z.never().optional(),
});

function configuration() {
  const url = URL.parse(process.env.UPSTASH_REDIS_REST_URL?.trim() ?? "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const namespace = process.env.RATE_LIMIT_NAMESPACE?.trim() ?? "";
  const perMinute = process.env.RATE_LIMIT_REQUESTS_PER_MINUTE?.trim() || "12";
  const perHour = process.env.RATE_LIMIT_REQUESTS_PER_HOUR?.trim() || "300";
  if (
    !url ||
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".upstash.io") ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !token ||
    !/^[a-z0-9-]{1,48}$/.test(namespace) ||
    !/^[1-9][0-9]{0,2}$/.test(perMinute) ||
    !/^[1-9][0-9]{0,4}$/.test(perHour)
  )
    return;
  return { url, token, namespace, perMinute, perHour };
}

function clientIdentity(request: Request) {
  const address = request.headers.get("x-vercel-forwarded-for") ?? "";
  const version = isIP(address);
  if (version === 4) return address;
  if (version !== 6 || address.includes("%")) return;

  const canonical = new URL(`http://[${address}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (mapped) {
    const high = parseInt(mapped[1], 16);
    const low = parseInt(mapped[2], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
  }
  const [left, right] = canonical.split("::");
  const prefix = left ? left.split(":") : [];
  const host = right ? right.split(":") : [];
  const groups =
    right === undefined
      ? prefix
      : [
          ...prefix,
          ...Array<string>(8 - prefix.length - host.length).fill("0"),
          ...host,
        ];
  return `${groups.slice(0, 4).join(":")}/64`;
}

function unavailable() {
  return queryJson(
    {
      error: {
        code: "rate_limit_unavailable",
        message:
          "Search and retrieval are temporarily unavailable. Please try again shortly.",
      },
    },
    503,
    { "Retry-After": "5" },
  );
}

/** Returns a response when provider work must be blocked. */
export async function enforceRateLimit(
  request: Request,
): Promise<Response | undefined> {
  const vercel = process.env.VERCEL === "1";
  if (!vercel && process.env.NODE_ENV !== "production") return;
  // The platform controls this header on Vercel. Self-hosted production
  // requests have no trusted ingress identity and must fail closed.
  if (!vercel) return unavailable();
  const config = configuration();
  const identity = clientIdentity(request);
  if (!config || !identity) return unavailable();

  const prefix = `knowledge-assistant:{${config.namespace}}`;
  const client = createHmac("sha256", config.token)
    .update(identity)
    .digest("hex");
  const signal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(timeoutMs),
  ]);
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        "EVAL",
        admit,
        2,
        `${prefix}:client:${client}`,
        `${prefix}:total`,
        config.perMinute,
        config.perHour,
        minuteMs,
        hourMs,
      ]),
      cache: "no-store",
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      return unavailable();
    }
    const {
      result: [allowed, delay],
    } = resultSchema.parse(await readBoundedJson(response, 4_096, signal));
    signal.throwIfAborted();
    if (allowed) return;
    return queryJson(
      {
        error: {
          code: "rate_limited",
          message: "Too many requests. Please try again later.",
        },
      },
      429,
      { "Retry-After": String(Math.ceil(delay / 1_000)) },
    );
  } catch {
    return unavailable();
  }
}
