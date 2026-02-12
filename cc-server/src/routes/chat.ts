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
        // Load all settings: project CLAUDE.md, user settings (~/.claude/),
        // and local settings (.claude/settings.local.json) for MCP servers + plugins
        settingSources: ["project", "user", "local"] as const,
        // Headless SSE mode can't prompt for permissions — auto-approve everything.
        // Personal tool behind Google OAuth + shared secret, same risk as local CLI.
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        model: "claude-opus-4-6",
      },
    });

    for await (const msg of response) {
      const m = msg as any;
      console.error(`[chat] msg.type=${msg.type}${m.subtype ? ` subtype=${m.subtype}` : ""}`);

      switch (msg.type) {
        case "system": {
          if (m.subtype === "init") {
            sendEvent("init", {
              sessionId: m.session_id,
              tools: m.tools,
              mcpServers: m.mcp_servers,
              model: m.model,
              permissionMode: m.permissionMode,
              slashCommands: m.slash_commands,
              skills: m.skills,
              plugins: m.plugins,
              agents: m.agents,
              claudeCodeVersion: m.claude_code_version,
              cwd: m.cwd,
            });
          } else if (m.subtype === "status") {
            sendEvent("status", { status: m.status });
          }
          break;
        }

        case "assistant": {
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
          break;
        }

        case "user": {
          // Tool results — extract from message.content blocks
          for (const block of m.message.content) {
            if (block.type === "tool_result") {
              let content = "";
              if (typeof block.content === "string") {
                content = block.content;
              } else if (Array.isArray(block.content)) {
                content = block.content
                  .map((b: any) => (b.type === "text" ? b.text : ""))
                  .join("\n");
              }
              sendEvent("tool_result", {
                toolUseId: block.tool_use_id,
                content,
              });
            }
          }
          break;
        }

        case "tool_progress": {
          sendEvent("tool_progress", {
            toolUseId: m.tool_use_id,
            toolName: m.tool_name,
            elapsedSeconds: m.elapsed_time_seconds,
          });
          break;
        }

        case "result": {
          sendEvent("result", {
            subtype: m.subtype,
            result: m.result,
            errors: m.errors,
            isError: m.is_error,
            numTurns: m.num_turns,
            totalCostUsd: m.total_cost_usd,
            durationMs: m.duration_ms,
            sessionId: m.session_id,
          });
          break;
        }
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
