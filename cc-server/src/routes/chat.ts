import { Router } from "express";
import { query } from "@anthropic-ai/claude-agent-sdk";
import path from "path";
import fs from "fs/promises";
import os from "os";
import type { ChatRequest } from "../types.js";

const router = Router();
const DEFAULT_MODEL = "claude-opus-4-6";

// ── Session state (in-memory, lost on server restart) ──────────────
interface SessionState {
  model: string;
  totalCostUsd: number;
  messageCount: number;
  contextTokens: number;   // Last input_tokens (current context size)
  contextWindow: number;   // Max context window for the model
  lastInit?: {
    tools: string[];
    mcpServers: { name: string; status: string }[];
    slashCommands: string[];
    skills: string[];
    plugins: { name: string; path: string }[];
    claudeCodeVersion: string;
    cwd: string;
  };
}

const sessions = new Map<string, SessionState>();

function getSession(sessionId: string | undefined): SessionState {
  if (sessionId && sessions.has(sessionId)) return sessions.get(sessionId)!;
  return { model: DEFAULT_MODEL, totalCostUsd: 0, messageCount: 0, contextTokens: 0, contextWindow: 0 };
}

function saveSession(sessionId: string, state: SessionState) {
  sessions.set(sessionId, state);
}

// ── Expand custom .md slash commands ───────────────────────────────
async function expandSlashCommand(
  message: string,
  cwd: string
): Promise<string | null> {
  if (!message.startsWith("/")) return null;

  const match = message.match(/^\/(\S+)\s*(.*)/s);
  if (!match) return null;

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

  return null; // No custom command found
}

// ── Find all custom .md commands on disk ───────────────────────────
async function findCustomCommands(cwd: string): Promise<{ name: string; source: string }[]> {
  const baseDir = process.env.BASE_DIR || "";
  const dirs = [
    { dir: path.join(cwd, ".claude", "commands"), source: "project" },
    { dir: path.join(os.homedir(), ".claude", "commands"), source: "user" },
    { dir: path.join(baseDir, "slash commands"), source: "global" },
  ];

  const commands: { name: string; source: string }[] = [];
  const seen = new Set<string>();

  for (const { dir, source } of dirs) {
    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        if (entry.endsWith(".md")) {
          const name = entry.replace(/\.md$/, "");
          if (!seen.has(name)) {
            seen.add(name);
            commands.push({ name, source });
          }
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  return commands;
}

// ── Read a file safely (returns null on error) ─────────────────────
async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

// ── Built-in command handlers ──────────────────────────────────────
type SendEvent = (type: string, data: unknown) => void;

interface CommandContext {
  sendEvent: SendEvent;
  cwd: string;
  sessionId: string | undefined;
  session: SessionState;
  args: string;
}

async function handleHelp(ctx: CommandContext) {
  const customCmds = await findCustomCommands(ctx.cwd);

  let text = "## Available Commands\n\n";
  text += "### Built-in\n";
  text += "| Command | Description |\n";
  text += "|---------|-------------|\n";
  text += "| `/clear` | Clear conversation and start fresh |\n";
  text += "| `/help` | Show this help |\n";
  text += "| `/context` | Context usage, loaded CLAUDE.md, MCP, tools |\n";
  text += "| `/model [name]` | Show or change the model |\n";
  text += "| `/mcp` | MCP server connection status |\n";
  text += "| `/status` | Full session overview |\n";
  text += "| `/compact` | Compact conversation (passes to SDK) |\n";

  if (customCmds.length > 0) {
    text += "\n### Custom Commands\n";
    text += "| Command | Source |\n";
    text += "|---------|--------|\n";
    for (const cmd of customCmds) {
      text += `| \`/${cmd.name}\` | ${cmd.source} |\n`;
    }
  }

  if (ctx.session.lastInit?.skills?.length) {
    text += "\n### Skills\n";
    text += "| Skill |\n";
    text += "|-------|\n";
    for (const skill of ctx.session.lastInit.skills) {
      text += `| \`/${skill}\` |\n`;
    }
  }

  ctx.sendEvent("assistant", { text });
}

async function handleContext(ctx: CommandContext) {
  const { contextTokens, contextWindow, model } = ctx.session;
  let text = "## Context\n\n";

  // Context usage (most important — show first)
  if (contextWindow > 0) {
    const used = (contextTokens / 1000).toFixed(1);
    const total = (contextWindow / 1000).toFixed(0);
    const pct = ((contextTokens / contextWindow) * 100).toFixed(0);
    const remaining = ((contextWindow - contextTokens) / 1000).toFixed(0);
    text += `**${pct}% used** — ${used}k / ${total}k tokens (${remaining}k remaining)\n\n`;
  } else {
    text += "*No context data yet — send a message first.*\n\n";
  }

  text += `**Model:** ${model}\n`;
  text += `**Working directory:** \`${ctx.cwd}\`\n\n`;

  // Read CLAUDE.md files
  const claudeMdPaths = [
    { path: path.join(ctx.cwd, "CLAUDE.md"), label: "Project CLAUDE.md" },
    { path: path.join(os.homedir(), ".claude", "CLAUDE.md"), label: "User CLAUDE.md" },
  ];

  for (const { path: p, label } of claudeMdPaths) {
    const content = await readFileSafe(p);
    if (content) {
      const preview = content.length > 500 ? content.slice(0, 500) + "\n...(truncated)" : content;
      text += `### ${label}\n\`${p}\`\n\n\`\`\`\n${preview}\n\`\`\`\n\n`;
    }
  }

  // Show init data if available
  const init = ctx.session.lastInit;
  if (init) {
    if (init.mcpServers?.length) {
      text += "### MCP Servers\n";
      for (const s of init.mcpServers) {
        const icon = s.status === "connected" ? "+" : "-";
        text += `- ${icon} **${s.name}** (${s.status})\n`;
      }
      text += "\n";
    }

    if (init.tools?.length) {
      text += `### Tools\n${init.tools.length} tools available: ${init.tools.slice(0, 10).join(", ")}${init.tools.length > 10 ? `, ... (+${init.tools.length - 10} more)` : ""}\n\n`;
    }

    if (init.plugins?.length) {
      text += "### Plugins\n";
      for (const p of init.plugins) {
        text += `- **${p.name}** (\`${p.path}\`)\n`;
      }
      text += "\n";
    }
  }

  ctx.sendEvent("assistant", { text });
}

async function handleModel(ctx: CommandContext) {
  const newModel = ctx.args.trim();

  if (newModel) {
    ctx.session.model = newModel;
    if (ctx.sessionId) saveSession(ctx.sessionId, ctx.session);
    ctx.sendEvent("assistant", { text: `Model changed to **${newModel}**. Next message will use this model.` });
  } else {
    ctx.sendEvent("assistant", { text: `Current model: **${ctx.session.model}**\n\nUsage: \`/model <model-name>\`\n\nExamples:\n- \`/model claude-sonnet-4-5-20250929\`\n- \`/model claude-opus-4-6\`\n- \`/model claude-haiku-4-5-20251001\`` });
  }
}

async function handleMcp(ctx: CommandContext) {
  const init = ctx.session.lastInit;
  if (!init?.mcpServers?.length) {
    ctx.sendEvent("assistant", {
      text: "No MCP server data available yet. Send a message first to initialize the SDK session.",
    });
    return;
  }

  let text = "## MCP Servers\n\n";
  for (const s of init.mcpServers) {
    const icon = s.status === "connected" ? "+" : s.status === "failed" ? "x" : "?";
    text += `- ${icon} **${s.name}** — ${s.status}\n`;
  }
  ctx.sendEvent("assistant", { text });
}

async function handleClear(ctx: CommandContext) {
  // Delete session state from memory
  if (ctx.sessionId) {
    sessions.delete(ctx.sessionId);
    console.error(`[chat] cleared session state for ${ctx.sessionId}`);
  }
  ctx.sendEvent("assistant", { text: "Session cleared." });
}

async function handleStatus(ctx: CommandContext) {
  const { model, messageCount, contextTokens, contextWindow } = ctx.session;
  const init = ctx.session.lastInit;
  const pct = contextWindow > 0 ? ((contextTokens / contextWindow) * 100).toFixed(0) : "?";
  const remaining = contextWindow > 0 ? ((contextWindow - contextTokens) / 1000).toFixed(0) : "?";

  let text = "## Session Status\n\n";
  text += `- **Context:** ${pct}% used (${remaining}k remaining)\n`;
  text += `- **Model:** ${model}\n`;
  text += `- **Messages:** ${messageCount}\n`;
  text += `- **Session ID:** ${ctx.sessionId || "none (new session)"}\n`;
  text += `- **Working directory:** \`${ctx.cwd}\`\n`;

  if (init) {
    text += `- **Claude Code version:** ${init.claudeCodeVersion}\n`;
    text += `- **Tools:** ${init.tools?.length || 0}\n`;
    text += `- **MCP Servers:** ${init.mcpServers?.length || 0}\n`;
    text += `- **Skills:** ${init.skills?.length || 0}\n`;
    text += `- **Plugins:** ${init.plugins?.length || 0}\n`;
  }

  ctx.sendEvent("assistant", { text });
}

const BUILTIN_COMMANDS: Record<string, (ctx: CommandContext) => Promise<void>> = {
  clear: handleClear,
  help: handleHelp,
  context: handleContext,
  model: handleModel,
  mcp: handleMcp,
  status: handleStatus,
};

// ── POST /api/chat — SSE streaming response ────────────────────────
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

  // ── Check for built-in commands first ──────────────────────────
  if (message.startsWith("/")) {
    const cmdMatch = message.match(/^\/(\S+)\s*(.*)/s);
    if (cmdMatch) {
      const [, cmdName, cmdArgs] = cmdMatch;
      const handler = BUILTIN_COMMANDS[cmdName.toLowerCase()];
      if (handler) {
        console.error(`[chat] built-in command: /${cmdName}`);
        const session = getSession(sessionId);
        try {
          await handler({ sendEvent, cwd, sessionId, session, args: cmdArgs });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          sendEvent("error", { error: errMsg });
        }
        sendEvent("done", {});
        res.end();
        return;
      }
    }
  }

  // ── Check for custom .md commands ──────────────────────────────
  let prompt = message;
  const expanded = await expandSlashCommand(message, cwd);
  if (expanded !== null) {
    prompt = expanded;
  }

  // ── Send to SDK ────────────────────────────────────────────────
  const session = getSession(sessionId);

  try {
    console.error(`[chat] prompt=${prompt.slice(0, 200)}${prompt.length > 200 ? "..." : ""}`);
    console.error(`[chat] cwd=${cwd} sessionId=${sessionId || "new"} model=${session.model}`);

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
        model: session.model,
        stderr: (data: string) => console.error(`[chat][stderr] ${data}`),
      },
    });

    let eventCount = 0;
    let resultSessionId = sessionId;

    for await (const msg of response) {
      const m = msg as any;
      console.error(`[chat] msg.type=${msg.type}${m.subtype ? ` subtype=${m.subtype}` : ""}`);
      eventCount++;

      switch (msg.type) {
        case "system": {
          if (m.subtype === "init") {
            resultSessionId = m.session_id;

            // Track init data in session state
            session.lastInit = {
              tools: m.tools,
              mcpServers: m.mcp_servers,
              slashCommands: m.slash_commands,
              skills: m.skills,
              plugins: m.plugins,
              claudeCodeVersion: m.claude_code_version,
              cwd: m.cwd,
            };
            saveSession(m.session_id, session);

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

          // Track cost, message count, and context usage
          if (m.total_cost_usd) session.totalCostUsd += m.total_cost_usd;
          session.messageCount++;
          if (m.usage) {
            // Context size = all input token types (fresh + cache write + cache read)
            session.contextTokens =
              (m.usage.input_tokens || 0) +
              (m.usage.cache_creation_input_tokens || 0) +
              (m.usage.cache_read_input_tokens || 0);
          }
          if (m.modelUsage) {
            const modelData = Object.values(m.modelUsage)[0] as { contextWindow?: number } | undefined;
            if (modelData?.contextWindow) session.contextWindow = modelData.contextWindow;
          }
          if (resultSessionId) saveSession(resultSessionId, session);

          sendEvent("result", {
            subtype: m.subtype,
            result: m.result,
            errors: m.errors,
            isError: m.is_error,
            numTurns: m.num_turns,
            totalCostUsd: m.total_cost_usd,
            durationMs: m.duration_ms,
            sessionId: m.session_id,
            contextTokens: session.contextTokens,
            contextWindow: session.contextWindow,
            sessionCostUsd: session.totalCostUsd,
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
