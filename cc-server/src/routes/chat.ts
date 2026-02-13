import { Router } from "express";
import { query } from "@anthropic-ai/claude-agent-sdk";
import path from "path";
import fs from "fs/promises";
import os from "os";
import type { ChatRequest } from "../types.js";

const router = Router();

// Expand custom .md slash commands — everything else passes through raw
async function expandSlashCommand(
  message: string,
  cwd: string
): Promise<string> {
  if (!message.startsWith("/")) return message;

  const match = message.match(/^\/(\S+)\s*(.*)/s);
  if (!match) return message;

  const [, cmdName, args] = match;
  const baseDir = process.env.BASE_DIR || "";

  const searchPaths = [
    path.join(cwd, ".claude", "commands", `${cmdName}.md`),
    path.join(os.homedir(), ".claude", "commands", `${cmdName}.md`),
    path.join(baseDir, "slash commands", `${cmdName}.md`),
  ];

  for (const cmdPath of searchPaths) {
    try {
      const content = await fs.readFile(cmdPath, "utf-8");
      const stripped = content.replace(/^---\n[\s\S]*?\n---\n*/, "");
      const expanded = stripped.replace(/\$ARGUMENTS/g, args.trim());
      console.error(`[chat] expanded /${cmdName} from ${cmdPath} (${expanded.length} chars)`);
      return expanded;
    } catch {
      // File not found, try next location
    }
  }

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

  const cwd = path.resolve(baseDir, projectPath);
  if (!cwd.startsWith(path.resolve(baseDir))) {
    res.status(403).json({ error: "Path traversal not allowed" });
    return;
  }

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
    const prompt = await expandSlashCommand(message, cwd);
    console.error(`[chat] prompt=${prompt.slice(0, 200)}${prompt.length > 200 ? "..." : ""}`);
    console.error(`[chat] cwd=${cwd} sessionId=${sessionId || "new"}`);

    const response = query({
      prompt,
      options: {
        cwd,
        ...(sessionId ? { resume: sessionId } : {}),
        systemPrompt: {
          type: "preset" as const,
          preset: "claude_code" as const,
        },
        settingSources: ["project", "user"] as const,
        mcpServers: {
          context7: {
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
          },
        },
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        model: "claude-opus-4-6",
        stderr: (data: string) => console.error(`[chat][stderr] ${data}`),
      },
    });

    let eventCount = 0;
    for await (const msg of response) {
      const m = msg as any;
      console.error(`[chat] msg.type=${msg.type}${m.subtype ? ` subtype=${m.subtype}` : ""}`);
      eventCount++;

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
          } else {
            sendEvent("system", { subtype: m.subtype, ...m });
          }
          break;
        }

        case "assistant": {
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
          break;
        }

        case "user": {
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
          console.error(`[chat] RESULT: subtype=${m.subtype} is_error=${m.is_error} num_turns=${m.num_turns} duration_ms=${m.duration_ms}`);
          if (m.errors) console.error(`[chat] ERRORS: ${JSON.stringify(m.errors)}`);
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

        case "auth_status": {
          console.error(`[chat] AUTH_STATUS: error=${m.error}`);
          if (m.error) {
            sendEvent("error", { error: `Authentication failed: ${m.error}` });
          }
          break;
        }

        default: {
          console.error(`[chat] UNHANDLED msg type: ${msg.type}`);
          break;
        }
      }
    }

    console.error(`[chat] stream ended. ${eventCount} events`);
    if (eventCount === 0) {
      sendEvent("error", { error: "SDK returned no events" });
    }
    sendEvent("done", {});
    res.end();
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.stack || err.message : String(err);
    console.error(`[chat] ERROR: ${errMsg}`);
    sendEvent("error", { error: errMsg });
    res.end();
  }
});

export default router;
