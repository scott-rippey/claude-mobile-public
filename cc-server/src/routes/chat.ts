import { Router } from "express";
import { query } from "@anthropic-ai/claude-agent-sdk";
import path from "path";
import type { ChatRequest } from "../types.js";

const router = Router();

// POST /api/chat — SSE streaming response
router.post("/", async (req, res) => {
  const baseDir = process.env.BASE_DIR!;
  const { message, sessionId, projectPath } = req.body as ChatRequest;

  if (!message || !projectPath) {
    res.status(400).json({ error: "message and projectPath are required" });
    return;
  }

  // Validate projectPath doesn't escape BASE_DIR
  const cwd = path.resolve(baseDir, projectPath);
  if (!cwd.startsWith(path.resolve(baseDir))) {
    res.status(403).json({ error: "Path traversal not allowed" });
    return;
  }

  // Set up SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const sendEvent = (type: string, data: unknown) => {
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  };

  try {
    const response = query({
      prompt: message,
      options: {
        cwd,
        ...(sessionId ? { resume: sessionId } : {}),
        allowedTools: [
          "Read",
          "Edit",
          "Write",
          "Bash",
          "Glob",
          "Grep",
          "MultiEdit",
        ],
        permissionMode: "acceptEdits",
        model: "claude-opus-4-6",
      },
    });

    for await (const msg of response) {
      // Extract session_id from any message
      if ("session_id" in msg && msg.session_id) {
        sendEvent("init", { sessionId: msg.session_id });
      }

      if (msg.type === "assistant") {
        // Process content blocks
        for (const block of msg.message.content) {
          if (block.type === "text") {
            sendEvent("assistant", { text: block.text });
          } else if (block.type === "tool_use") {
            sendEvent("tool_call", {
              name: block.name,
              input: block.input,
              id: block.id,
            });
          }
        }
      }

      if (msg.type === "result") {
        sendEvent("result", {
          result: (msg as any).result,
          totalCostUsd: (msg as any).total_cost_usd,
          durationMs: (msg as any).duration_ms,
          sessionId: (msg as any).session_id,
        });
      }
    }

    sendEvent("done", {});
    res.end();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    sendEvent("error", { error: message });
    res.end();
  }
});

export default router;
