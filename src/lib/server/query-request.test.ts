// @vitest-environment node

import { expect, test, vi } from "vitest";
import { POST as related } from "@/app/api/related/route";
import { POST as retrieve } from "@/app/api/retrieve/route";
import { POST as search } from "@/app/api/search/route";
import { maxRelatedBodyBytes } from "@/lib/exploration/contracts";
import { concept } from "../../../tests/fixtures/exploration";
import { maxConcurrentApiRequests, withApiCapacity } from "./api-capacity";

const handlers = [
  { name: "search", post: search, limit: 4_096 },
  { name: "retrieve", post: retrieve, limit: 4_096 },
  { name: "related", post: related, limit: maxRelatedBodyBytes },
];

function request(
  name: string,
  body: BodyInit,
  contentType = "application/json",
) {
  const init = {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
    duplex: "half",
  };
  return new Request(`http://localhost/api/${name}`, init);
}

test.each(handlers)(
  "$name rejects large streamed bodies, invalid UTF-8, and non-JSON without outbound requests",
  async ({ name, post, limit }) => {
    const outbound = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected provider request"));
    try {
      const bytes = new TextEncoder().encode(" ".repeat(limit + 1));
      const cases = [
        {
          response: await post(request(name, bytes)),
          status: 413,
          code: "body_too_large",
        },
        {
          response: await post(request(name, new Uint8Array([0xff]))),
          status: 400,
          code: "invalid_json",
        },
        {
          response: await post(request(name, "{}", "text/plain")),
          status: 415,
          code: "unsupported_media_type",
        },
      ];
      for (const { response, status, code } of cases) {
        expect(response.status).toBe(status);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(await response.json()).toEqual({
          error: { code, message: expect.any(String) },
        });
      }
      expect(outbound).not.toHaveBeenCalled();
    } finally {
      outbound.mockRestore();
    }
  },
);

test("cancels an incomplete body at its deadline and omits internal abort details", async () => {
  const timer = new AbortController();
  const timeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValueOnce(timer.signal);
  const cancel = vi.fn();
  const input = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"query":'));
    },
    cancel,
  });
  try {
    const result = search(request("search", input));
    timer.abort(new Error("private abort details"));
    const response = await result;
    expect(response.status).toBe(408);
    const body = await response.text();
    expect(body).toContain("request_timeout");
    expect(body).not.toContain("private abort details");
    expect(cancel).toHaveBeenCalledOnce();
  } finally {
    timeout.mockRestore();
  }
});

test("all routes reject excess work and slots are available again after requests settle", async () => {
  const hold = Promise.withResolvers<Response>();
  const pending = Array.from({ length: maxConcurrentApiRequests }, () =>
    withApiCapacity(() => hold.promise),
  );
  const outbound = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected provider request"));
  const { id, name, description } = concept("React");
  try {
    const responses = await Promise.all([
      search(request("search", JSON.stringify({ query: "React" }))),
      retrieve(request("retrieve", JSON.stringify({ query: "React" }))),
      related(
        request(
          "related",
          JSON.stringify({
            topic: "JavaScript",
            concept: { id, name, description },
            neighbors: [],
            existingConceptIds: [id],
          }),
        ),
      ),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("2");
      expect(await response.json()).toMatchObject({
        error: { code: "service_busy" },
      });
    }
    expect(outbound).not.toHaveBeenCalled();
  } finally {
    hold.resolve(new Response(null, { status: 204 }));
    await Promise.all(pending);
    outbound.mockRestore();
  }
  await expect(
    withApiCapacity(() => Promise.reject(new Error("internal"))),
  ).rejects.toThrow("internal");
  expect(
    (await withApiCapacity(() => Promise.resolve(new Response()))).ok,
  ).toBe(true);
});
