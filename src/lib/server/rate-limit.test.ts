// @vitest-environment node

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { POST as related } from "@/app/api/related/route";
import { POST as retrieve } from "@/app/api/retrieve/route";
import { POST as search } from "@/app/api/search/route";
import { concept } from "../../../tests/fixtures/exploration";
import { enforceRateLimit } from "./rate-limit";

const redisUrl = "https://test-db.upstash.io/";
const redisToken = "synthetic-redis-credential";
const identityHeader = "x-vercel-forwarded-for";
const identity = "192.0.2.25";
const query = { query: "React useState" };
const react = concept("React");
const routes = [
  { name: "search", post: search, body: query },
  { name: "retrieve", post: retrieve, body: query },
  {
    name: "related",
    post: related,
    body: {
      topic: "JavaScript",
      concept: {
        id: react.id,
        name: react.name,
        description: react.description,
      },
      neighbors: [],
      existingConceptIds: [react.id],
    },
  },
];

function request(
  path = "search",
  body: object = query,
  headers: Record<string, string> = { [identityHeader]: identity },
) {
  return new Request(`https://staging.example.test/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", redisUrl);
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", redisToken);
  vi.stubEnv("RATE_LIMIT_NAMESPACE", "staging-test");
  vi.stubEnv("RATE_LIMIT_REQUESTS_PER_MINUTE", "");
  vi.stubEnv("RATE_LIMIT_REQUESTS_PER_HOUR", "");
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Unexpected outbound request"),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

test.each(routes)(
  "$name rejects admissions over the shared budget before running providers",
  async ({ name, post, body }) => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ result: [0, 1_001] }),
    );
    const response = await post(request(name, body));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("2");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      error: { code: "rate_limited" },
    });
    expect(fetch).toHaveBeenCalledOnce();
    const [upstream, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(upstream)).toBe(redisUrl);
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: { Authorization: `Bearer ${redisToken}` },
    });
    const command = JSON.parse(String(init?.body));
    expect(command.slice(2)).toEqual([
      2,
      expect.stringMatching(
        /^knowledge-assistant:\{staging-test\}:client:[a-f0-9]{64}$/,
      ),
      "knowledge-assistant:{staging-test}:total",
      "12",
      "300",
      60_000,
      3_600_000,
    ]);
    expect(command[0]).toBe("EVAL");
    expect(String(init?.body)).not.toContain(identity);
    expect(String(init?.body)).not.toContain(redisToken);
    expect(String(init?.body)).not.toContain("React useState");
  },
);

test("shares counters across routes, groups IPv6 /64s, and normalizes mapped IPv4", async () => {
  const addresses = [
    "2001:0db8:1234:0000::1",
    "2001:db8:1234::ff",
    "2001:db8:1234:1::1",
    identity,
    `::ffff:${identity}`,
  ];
  vi.mocked(fetch).mockImplementation(async () =>
    Response.json({ result: [1, 0] }),
  );
  for (const [index, address] of addresses.entries()) {
    await expect(
      enforceRateLimit(
        request(routes[index % routes.length].name, query, {
          [identityHeader]: address,
        }),
      ),
    ).resolves.toBeUndefined();
  }
  const keys = vi
    .mocked(fetch)
    .mock.calls.map(([, init]) => JSON.parse(String(init?.body)).slice(3, 5));
  expect(keys[0]).toEqual(keys[1]);
  expect(keys[0][0]).not.toBe(keys[2][0]);
  expect(keys[0][1]).toBe(keys[2][1]);
  expect(keys[3]).toEqual(keys[4]);
});

test.each(["", "192.0.2.25, 198.51.100.25", "unknown", "fe80::1%eth0"])(
  "fails closed for a missing or invalid Vercel IP %j",
  async (value) => {
    const response = await search(
      request("search", query, {
        [identityHeader]: value,
        "x-forwarded-for": identity,
        "x-real-ip": identity,
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "rate_limit_unavailable" },
    });
    expect(fetch).not.toHaveBeenCalled();
  },
);

test.each([
  { name: "missing token", env: "UPSTASH_REDIS_REST_TOKEN", value: "" },
  { name: "missing namespace", env: "RATE_LIMIT_NAMESPACE", value: "" },
  {
    name: "unexpected host",
    env: "UPSTASH_REDIS_REST_URL",
    value: "https://elsewhere.example.test/",
  },
  {
    name: "non-HTTPS endpoint",
    env: "UPSTASH_REDIS_REST_URL",
    value: "http://test-db.upstash.io",
  },
  { name: "invalid limit", env: "RATE_LIMIT_REQUESTS_PER_MINUTE", value: "0" },
])(
  "returns a safe error for $name without sending credentials",
  async ({ env, value }) => {
    vi.stubEnv(env, value);
    const response = await search(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(await response.text()).not.toContain(redisToken);
    expect(fetch).not.toHaveBeenCalled();
  },
);

test.each([
  {
    name: "unreachable service",
    reply: () => Promise.reject(new Error(redisToken)),
  },
  {
    name: "upstream authentication error",
    reply: () => Response.json({ error: redisToken }, { status: 401 }),
  },
  {
    name: "upstream response with error",
    reply: () => Response.json({ error: redisToken, result: [1, 0] }),
  },
  {
    name: "invalid admission result",
    reply: () => Response.json({ result: [99, 0] }),
  },
  { name: "oversized response", reply: () => new Response(" ".repeat(4_097)) },
])("denies provider work after $name", async ({ reply }) => {
  vi.mocked(fetch).mockImplementationOnce(async () => reply());
  const response = await retrieve(request("retrieve"));
  expect(response.status).toBe(503);
  const body = await response.text();
  expect(body).toContain("rate_limit_unavailable");
  expect(body).not.toContain(redisToken);
  expect(fetch).toHaveBeenCalledOnce();
});

test("aborts a stalled limiter and never admits its reply", async () => {
  const timer = new AbortController();
  const deadline = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValueOnce(timer.signal);
  const cancel = vi.fn();
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(new ReadableStream({ cancel })),
  );
  const result = enforceRateLimit(request());
  await Promise.resolve();
  timer.abort();
  await expect(result).resolves.toMatchObject({ status: 503 });
  expect(deadline).toHaveBeenCalledWith(2_000);
  expect(cancel).toHaveBeenCalledOnce();
});

test("local development works without a limiter and production requires a Vercel-controlled identity", async () => {
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("NODE_ENV", "development");
  await expect(enforceRateLimit(request())).resolves.toBeUndefined();
  vi.stubEnv("NODE_ENV", "production");
  await expect(enforceRateLimit(request())).resolves.toMatchObject({
    status: 503,
  });
  expect(fetch).not.toHaveBeenCalled();
});

test("invalid payloads use neither shared budget nor providers", async () => {
  for (const { name, post } of routes) {
    expect((await post(request(name, {}))).status).toBe(400);
  }
  expect(fetch).not.toHaveBeenCalled();
});
