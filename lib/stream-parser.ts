export interface SSEMessage {
  type: "init" | "assistant" | "tool_call" | "tool_result" | "tool_progress" | "status" | "system" | "result" | "error" | "done" | "query_start" | "permission_request" | "compact_boundary" | "permission_warning" | "supported_models" | "mcp_status" | "stream_event" | "context_update" | "buffer_gap" | "reconnect_complete" | "command_start";
  data: Record<string, unknown>;
  index?: number;
}

export async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<SSEMessage> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const parsed = JSON.parse(line.slice(6));
          yield parsed as SSEMessage;
        } catch {
          // Skip malformed JSON
        }
      }
    }
  }
}
