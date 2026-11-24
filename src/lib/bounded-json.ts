export class BodyTooLargeError extends Error {}

export async function readBoundedJson(
  input: Request | Response,
  limit: number,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!input.body) throw new SyntaxError("Missing JSON body");
  const reader = input.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };

  try {
    signal?.throwIfAborted();
    signal?.addEventListener("abort", cancel, { once: true });
    if (Number(input.headers.get("content-length")) > limit)
      throw new BodyTooLargeError();
    for (;;) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new BodyTooLargeError();
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
