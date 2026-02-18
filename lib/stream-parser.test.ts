import { describe, it, expect } from "vitest";
import { parseSSEStream, type SSEMessage } from "./stream-parser";

/** Helper: create a ReadableStream from an array of string chunks */
function chunksToReader(
  chunks: string[]
): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return stream.getReader();
}

/** Collect all messages from the async generator */
async function collectMessages(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<SSEMessage[]> {
  const messages: SSEMessage[] = [];
  for await (const msg of parseSSEStream(reader)) {
    messages.push(msg);
  }
  return messages;
}

describe("parseSSEStream", () => {
  it("parses a single complete SSE message", async () => {
    const reader = chunksToReader([
      'data: {"type":"assistant","data":{"text":"hello"}}\n',
    ]);

    const messages = await collectMessages(reader);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      type: "assistant",
      data: { text: "hello" },
    });
  });

  it("parses multiple messages in one chunk", async () => {
    const reader = chunksToReader([
      'data: {"type":"assistant","data":{"text":"a"}}\ndata: {"type":"done","data":{}}\n',
    ]);

    const messages = await collectMessages(reader);

    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe("assistant");
    expect(messages[1].type).toBe("done");
  });

  it("handles messages split across chunks", async () => {
    const reader = chunksToReader([
      'data: {"type":"assis',
      'tant","data":{"text":"split"}}\n',
    ]);

    const messages = await collectMessages(reader);

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("assistant");
    expect(messages[0].data).toEqual({ text: "split" });
  });

  it("skips malformed JSON silently", async () => {
    const reader = chunksToReader([
      "data: {not valid json}\n",
      'data: {"type":"assistant","data":{}}\n',
    ]);

    const messages = await collectMessages(reader);

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("assistant");
  });

  it("ignores non-data lines", async () => {
    const reader = chunksToReader([
      "event: message\n",
      'data: {"type":"assistant","data":{}}\n',
      ": heartbeat\n",
      "id: 123\n",
    ]);

    const messages = await collectMessages(reader);

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("assistant");
  });

  it("handles empty stream", async () => {
    const reader = chunksToReader([]);

    const messages = await collectMessages(reader);

    expect(messages).toHaveLength(0);
  });

  it("handles chunk boundary right at newline", async () => {
    const reader = chunksToReader([
      'data: {"type":"init","data":{"sid":"abc"}}',
      "\n",
      'data: {"type":"done","data":{}}\n',
    ]);

    const messages = await collectMessages(reader);

    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe("init");
    expect(messages[1].type).toBe("done");
  });

  it("preserves index field when present", async () => {
    const reader = chunksToReader([
      'data: {"type":"assistant","data":{"text":"hi"},"index":5}\n',
    ]);

    const messages = await collectMessages(reader);

    expect(messages).toHaveLength(1);
    expect(messages[0].index).toBe(5);
  });
});
