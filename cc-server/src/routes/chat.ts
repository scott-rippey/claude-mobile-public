import { Router } from "express";
import { query } from "@anthropic-ai/claude-agent-sdk";
import path from "path";
import fs from "fs/promises";
import os from "os";
import type { ChatRequest } from "../types.js";

const router = Router();

/**
 * Expand slash commands by reading .md files from project or user command dirs.
 * Returns the expanded prompt, or the original message if no command matched.
 */
async function expandSlashCommand(
  message: string,
  cwd: string
): Promise<string> {
  if (!message.startsWith("/")) return message;

  // Parse: /cmdName arg1 arg2...
  const match = message.match(/^\/(\S+)\s*(.*)/s);
  if (!match) return message;

  const [, cmdName, args] = match;

  // Search locations in priority order: project-level, then user-level
  const searchPaths = [
    path.join(cwd, ".claude", "commands", `${cmdName}.md`),
    path.join(os.homedir(), ".claude", "commands", `${cmdName}.md`),
  ];

  for (const cmdPath of searchPaths) {
    try {
      const content = await fs.readFile(cmdPath, "utf-8");

      // Strip YAML frontmatter (--- ... ---)
      const stripped = content.replace(/^---\n[\s\S]*?\n---\n*/, "");

      // Replace $ARGUMENTS placeholder with actual args
      const expanded = stripped.replace(/\$ARGUMENTS/g, args.trim());

      return expanded;
    } catch {
      // File not found, try next location
    }
  }

  // No command file found — pass through as-is
  return message;
}

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
    // Expand slash commands (e.g. /catchup → full prompt from .md file)
    const prompt = await expandSlashCommand(message, cwd);

    const response = query({
      prompt,
      options: {
        cwd,
        ...(sessionId ? { resume: sessionId } : {}),
        systemPrompt: {
          type: "preset" as const,
          preset: "claude_code" as const,
        },
        // Only load project settings (CLAUDE.md) — "user" and "local" pull in
        // plugins, hooks, and MCP servers designed for interactive terminal use
        // that hang when run headlessly via the SDK.
        settingSources: ["project"] as const,
        mcpServers: {
          context7: {
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
          },
        },
        allowedTools: [
          "Read",
          "Edit",
          "Write",
          "Bash",
          "Glob",
          "Grep",
          "MultiEdit",
          "Skill",
          "Task",
          "WebFetch",
          "WebSearch",
          "NotebookEdit",
          "mcp__context7__*",
        ],
        permissionMode: "acceptEdits",
        model: "claude-opus-4-6",
      },
    });

    for await (const msg of response) {
      console.error(`[chat] msg.type=${msg.type}`);

      // Extract session_id from any message
      if ("session_id" in msg && msg.session_id) {
        sendEvent("init", { sessionId: msg.session_id });
      }

      if (msg.type === "assistant") {
        // Process content blocks
        for (const block of msg.message.content) {
          console.error(`[chat]   block.type=${block.type}`);
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
