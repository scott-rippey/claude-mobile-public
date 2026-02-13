import { Router } from "express";
import { query } from "@anthropic-ai/claude-agent-sdk";
import path from "path";
import fs from "fs/promises";
import os from "os";
import type { ChatRequest } from "../types.js";

const router = Router();

// ── Session state ──────────────────────────────────────────────────
interface SessionState {
  initData: Record<string, unknown> | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    contextWindowSize: number;
  };
  cost: {
    totalCostUsd: number;
    totalDurationMs: number;
    totalTurns: number;
  };
}

const sessions = new Map<string, SessionState>();

function getSession(sessionId: string): SessionState {
  let s = sessions.get(sessionId);
  if (!s) {
    s = {
      initData: null,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, contextWindowSize: 0 },
      cost: { totalCostUsd: 0, totalDurationMs: 0, totalTurns: 0 },
    };
    sessions.set(sessionId, s);
  }
  return s;
}

// ── Custom .md command expansion ───────────────────────────────────
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

  // Not a custom command — pass through raw to SDK
  console.error(`[chat] passing /${cmdName} through to SDK`);
  return message;
}

// ── Built-in command handlers (server-side, no SDK round-trip) ─────
function handleBuiltinCommand(
  cmd: string,
  sessionId: string | null,
  sendEvent: (type: string, data: unknown) => void
): boolean {
  const session = sessionId ? sessions.get(sessionId) : null;

  switch (cmd) {
    case "/context": {
      if (!session?.initData) {
        sendEvent("assistant", { text: "No session data yet — send a message first." });
      } else {
        const { initData, usage, cost } = session;
        const model = initData.model as string | undefined;
        const version = initData.claudeCodeVersion as string | undefined;
        const cwd = initData.cwd as string | undefined;
        const tools = initData.tools as string[] | undefined;
        const mcpServers = initData.mcpServers as Record<string, unknown> | undefined;
        const builtinTools = (tools || []).filter((t: string) => !t.startsWith("mcp__"));
        const mcpNames = mcpServers ? Object.keys(mcpServers) : [];
        const mcpToolCount = (tools || []).filter((t: string) => t.startsWith("mcp__")).length;

        const { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, contextWindowSize } = usage;
        const totalTokens = inputTokens + cacheCreationTokens + cacheReadTokens;
        const percentUsed = contextWindowSize > 0 ? Math.round((totalTokens / contextWindowSize) * 100) : 0;

        const lines: string[] = [];
        // Context window usage — the main thing /context shows
        if (contextWindowSize > 0) {
          const sizeK = Math.round(contextWindowSize / 1000);
          lines.push(`**Context Window:** ${totalTokens.toLocaleString()} / ${sizeK}k tokens (**${percentUsed}%** used)`);
          lines.push(`- Input: ${inputTokens.toLocaleString()} | Output: ${outputTokens.toLocaleString()}`);
          if (cacheReadTokens > 0 || cacheCreationTokens > 0) {
            lines.push(`- Cache read: ${cacheReadTokens.toLocaleString()} | Cache write: ${cacheCreationTokens.toLocaleString()}`);
          }
        } else {
          lines.push(`**Tokens:** Input: ${inputTokens.toLocaleString()} | Output: ${outputTokens.toLocaleString()}`);
        }

        lines.push("");
        if (model) lines.push(`**Model:** ${model}`);
        if (version) lines.push(`**Claude Code:** v${version}`);
        if (cwd) lines.push(`**CWD:** \`${cwd}\``);
        lines.push(`**Cost:** $${cost.totalCostUsd.toFixed(4)} (${cost.totalTurns} turns)`);
        if (builtinTools.length) lines.push(`**Tools:** ${builtinTools.length} built-in + ${mcpToolCount} MCP (${mcpNames.length} servers)`);

        sendEvent("assistant", { text: lines.join("\n") });
      }
      sendEvent("done", {});
      return true;
    }

    case "/mcp": {
      if (!session?.initData) {
        sendEvent("assistant", { text: "No session data yet — send a message first." });
      } else {
        const tools = session.initData.tools as string[] | undefined;
        const mcpServers = session.initData.mcpServers as Record<string, unknown> | undefined;
        if (!mcpServers || Object.keys(mcpServers).length === 0) {
          sendEvent("assistant", { text: "No MCP servers configured." });
        } else {
          const lines = ["**MCP Servers**"];
          for (const name of Object.keys(mcpServers)) {
            const serverTools = (tools || []).filter((t: string) => t.startsWith(`mcp__${name}__`));
            lines.push(`\n**${name}**`);
            if (serverTools.length) {
              serverTools.forEach((t: string) => lines.push(`- \`${t.replace(`mcp__${name}__`, "")}\``));
            } else {
              lines.push("- (no tools registered)");
            }
          }
          sendEvent("assistant", { text: lines.join("\n") });
        }
      }
      sendEvent("done", {});
      return true;
    }

    case "/model": {
      const model = session?.initData?.model as string | undefined;
      sendEvent("assistant", { text: model ? `**Model:** ${model}` : "No session data yet — send a message first." });
      sendEvent("done", {});
      return true;
    }

    case "/cost": {
      if (!session || session.cost.totalTurns === 0) {
        sendEvent("assistant", { text: "No cost data yet — send a message first." });
      } else {
        const { totalCostUsd, totalDurationMs, totalTurns } = session.cost;
        const durationStr = totalDurationMs > 60000
          ? `${(totalDurationMs / 60000).toFixed(1)} min`
          : `${(totalDurationMs / 1000).toFixed(1)}s`;
        sendEvent("assistant", {
          text: `**Session Cost**\n- Total: $${totalCostUsd.toFixed(4)}\n- Duration: ${durationStr}\n- Turns: ${totalTurns}`,
        });
      }
      sendEvent("done", {});
      return true;
    }

    case "/help": {
      sendEvent("assistant", {
        text: [
          "**Built-in commands** (instant, real session data):",
          "- `/context` — Context window usage, model, cost",
          "- `/mcp` — MCP servers and their tools",
          "- `/model` — Current model",
          "- `/cost` — Session cost and duration",
          "- `/clear` — Start a new conversation",
          "- `/help` — This message",
          "",
          "**SDK commands** (sent to Claude):",
          "- `/compact [focus]` — Compress conversation history",
          "",
          "**Custom commands** (`/catchup`, `/log`, `/push`, etc.) — expanded from `.md` files.",
          "",
          "Anything else passes through to the SDK.",
        ].join("\n"),
      });
      sendEvent("done", {});
      return true;
    }

    default:
      return false;
  }
}

// ── POST /api/chat — SSE streaming response ────────────────────────
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

  // Handle built-in commands server-side (no SDK round-trip)
  const cmd = message.trim().split(" ")[0].toLowerCase();
  if (handleBuiltinCommand(cmd, sessionId || null, sendEvent)) {
    res.end();
    return;
  }

  try {
    // Expand custom .md slash commands
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

    let currentSessionId = sessionId;
    let eventCount = 0;
    for await (const msg of response) {
      const m = msg as any;
      console.error(`[chat] msg.type=${msg.type}${m.subtype ? ` subtype=${m.subtype}` : ""}`);
      eventCount++;

      switch (msg.type) {
        case "system": {
          if (m.subtype === "init") {
            currentSessionId = m.session_id;
            const initData = {
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
            };
            // Store in session state
            const session = getSession(m.session_id);
            session.initData = initData;
            sendEvent("init", initData);
          } else if (m.subtype === "status") {
            sendEvent("status", { status: m.status });
          } else {
            sendEvent("system", { subtype: m.subtype, ...m });
          }
          break;
        }

        case "assistant": {
          // Track usage (context window consumption)
          if (m.message.usage && currentSessionId) {
            const session = getSession(currentSessionId);
            const u = m.message.usage;
            session.usage.inputTokens = u.input_tokens ?? session.usage.inputTokens;
            session.usage.outputTokens = u.output_tokens ?? session.usage.outputTokens;
            session.usage.cacheReadTokens = u.cache_read_input_tokens ?? session.usage.cacheReadTokens;
            session.usage.cacheCreationTokens = u.cache_creation_input_tokens ?? session.usage.cacheCreationTokens;
          }
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
          console.error(`[chat] RESULT: subtype=${m.subtype} is_error=${m.is_error} num_turns=${m.num_turns} duration_ms=${m.duration_ms} result=${JSON.stringify(m.result)?.slice(0, 500)}`);
          if (m.errors) console.error(`[chat] ERRORS: ${JSON.stringify(m.errors)}`);
          if (m.permission_denials?.length) console.error(`[chat] PERMISSION_DENIALS: ${JSON.stringify(m.permission_denials)}`);

          // Update session cost + context window size
          const sid = m.session_id || currentSessionId;
          if (sid) {
            const session = getSession(sid);
            if (m.total_cost_usd !== undefined) {
              session.cost.totalCostUsd += m.total_cost_usd;
              session.cost.totalDurationMs += m.duration_ms || 0;
              session.cost.totalTurns += m.num_turns || 0;
            }
            // Extract context window size from model_usage
            if (m.model_usage) {
              const firstModel = Object.values(m.model_usage)[0] as { contextWindow?: number } | undefined;
              if (firstModel?.contextWindow) {
                session.usage.contextWindowSize = firstModel.contextWindow;
              }
            }
          }

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
          console.error(`[chat] AUTH_STATUS: isAuthenticating=${m.isAuthenticating} error=${m.error} output=${JSON.stringify(m.output)}`);
          if (m.error) {
            sendEvent("error", { error: `Authentication failed: ${m.error}` });
          }
          break;
        }

        default: {
          console.error(`[chat] UNHANDLED msg type: ${msg.type} full: ${JSON.stringify(m).slice(0, 500)}`);
          break;
        }
      }
    }

    console.error(`[chat] stream ended. ${eventCount} events received`);
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
