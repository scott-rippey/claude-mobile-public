import { Router } from "express";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionResult, Query } from "@anthropic-ai/claude-agent-sdk";
import crypto from "crypto";
import path from "path";
import fs from "fs/promises";
import os from "os";
import type { ChatRequest } from "../types.js";
import {
  QueryRunner,
  registerRunner,
  updateRunnerSessionId,
  getRunnerByQueryId,
  getRunnerBySessionId,
  markRunnerCompleted,
  getRunnerStats,
  type IndexedEvent,
  type EventListener,
} from "../query-runner.js";

const router = Router();
const DEFAULT_MODEL = "claude-opus-4-6";

// ── Active query tracking (for abort + mode changes) ────────────────
const activeAborts = new Map<string, AbortController>();
const activeQueries = new Map<string, Query>(); // sessionId → active query (for setPermissionMode)

// ── Pending permission requests ─────────────────────────────────────
interface PendingPermission {
  resolve: (result: PermissionResult) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  input: Record<string, unknown>;
}
const pendingPermissions = new Map<string, PendingPermission>();

// ── Session state (in-memory, lost on server restart) ──────────────
interface SessionState {
  model: string;
  permissionMode: "default" | "acceptEdits" | "plan";
  totalCostUsd: number;
  messageCount: number;
  contextTokens: number;   // Last input_tokens (current context size)
  contextWindow: number;   // Max context window for the model
  lastActivity: number;    // timestamp for TTL cleanup
  supportedModels?: { id: string; name?: string }[];
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
  return { model: DEFAULT_MODEL, permissionMode: "default", totalCostUsd: 0, messageCount: 0, contextTokens: 0, contextWindow: 0, lastActivity: Date.now() };
}

function saveSession(sessionId: string, state: SessionState) {
  state.lastActivity = Date.now();
  sessions.set(sessionId, state);
}

// ── Session cleanup — evict sessions older than 24h ─────────────────
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, state] of sessions) {
    if (now - state.lastActivity > SESSION_TTL_MS) {
      sessions.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.error(`[chat] session cleanup: removed ${cleaned}, remaining ${sessions.size}`);
  }
}, 10 * 60 * 1000); // every 10 min

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
    let text = `Current model: **${ctx.session.model}**\n\nUsage: \`/model <model-name>\`\n`;
    if (ctx.session.supportedModels?.length) {
      text += "\n**Available models:**\n";
      for (const m of ctx.session.supportedModels) {
        const active = m.id === ctx.session.model ? " (active)" : "";
        text += `- \`${m.id}\`${m.name ? ` — ${m.name}` : ""}${active}\n`;
      }
    } else {
      text += "\nExamples:\n- \`/model claude-sonnet-4-5-20250929\`\n- \`/model claude-opus-4-6\`\n- \`/model claude-haiku-4-5-20251001\`";
    }
    ctx.sendEvent("assistant", { text });
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

// ── Helper: subscribe an SSE response to a QueryRunner ──────────────
function subscribeResponse(
  res: import("express").Response,
  runner: QueryRunner
): { listener: EventListener; heartbeat: ReturnType<typeof setInterval> } {
  const listener: EventListener = (event: IndexedEvent) => {
    try {
      res.write(`data: ${JSON.stringify({ type: event.type, data: event.data, index: event.index })}\n\n`);
    } catch {
      // Connection dead — remove listener
      runner.removeListener(listener);
    }
  };

  runner.addListener(listener);

  // SSE heartbeat — keep connection alive through proxies
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: keepalive\ndata: {}\n\n`);
    } catch {
      clearInterval(heartbeat);
      runner.removeListener(listener);
    }
  }, 15_000);

  return { listener, heartbeat };
}

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

  const sendEventDirect = (type: string, data: unknown) => {
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
          await handler({ sendEvent: sendEventDirect, cwd, sessionId, session, args: cmdArgs });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          sendEventDirect("error", { error: errMsg });
        }
        sendEventDirect("done", {});
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
  const queryId = crypto.randomUUID();
  const abortController = new AbortController();
  activeAborts.set(queryId, abortController);
  let resultSessionId = sessionId;

  // Create QueryRunner — decouples query lifecycle from SSE connection
  const runner = new QueryRunner(queryId, sessionId || queryId, abortController);
  registerRunner(runner);

  // Subscribe this SSE response as a listener on the runner
  const { listener, heartbeat } = subscribeResponse(res, runner);

  // Clean up abort + pending permissions for this query (called when query ends)
  const cleanupQuery = () => {
    activeAborts.delete(queryId);
    if (resultSessionId) activeQueries.delete(resultSessionId);
    // Deny all pending permissions for this query
    for (const [reqId, pending] of pendingPermissions) {
      if (reqId.startsWith(queryId)) {
        clearTimeout(pending.timeout);
        pending.resolve({ behavior: "deny", message: "Query aborted", interrupt: true });
        pendingPermissions.delete(reqId);
      }
    }
  };

  // Client disconnect: remove listener but do NOT abort the query
  res.on("close", () => {
    console.error(`[chat] client disconnected from query ${queryId} (query continues running)`);
    clearInterval(heartbeat);
    runner.removeListener(listener);
  });

  // Use runner.bufferEvent as the sendEvent for the SDK loop
  const sendEvent = (type: string, data: unknown) => {
    runner.bufferEvent(type, data);
  };

  try {
    console.error(`[chat] prompt=${prompt.slice(0, 200)}${prompt.length > 200 ? "..." : ""}`);
    console.error(`[chat] cwd=${cwd} sessionId=${sessionId || "new"} model=${session.model} mode=${session.permissionMode}`);

    sendEvent("query_start", { queryId });

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
        permissionMode: session.permissionMode,
        model: session.model,
        includePartialMessages: true,
        abortController,
        canUseTool: (toolName, input, options) => {
          return new Promise<PermissionResult>((resolve, reject) => {
            const requestId = `${queryId}:${crypto.randomUUID()}`;

            // Warn at 45s that permission is expiring
            const warning = setTimeout(() => {
              sendEvent("permission_warning", {
                requestId,
                message: "Permission request expiring soon...",
              });
            }, 45_000);

            // Auto-deny after 60s (mobile users respond quickly or not at all)
            const timeout = setTimeout(() => {
              console.error(`[chat] permission timeout for ${requestId}`);
              clearTimeout(warning);
              pendingPermissions.delete(requestId);
              resolve({ behavior: "deny", message: "Permission request timed out" });
            }, 60_000);

            pendingPermissions.set(requestId, { resolve, reject, timeout, input });

            // Check if already aborted before registering listener
            if (options.signal.aborted) {
              clearTimeout(timeout);
              clearTimeout(warning);
              pendingPermissions.delete(requestId);
              resolve({ behavior: "deny", message: "Query aborted", interrupt: true });
              return;
            }

            // Listen for abort to auto-deny
            options.signal.addEventListener("abort", () => {
              if (pendingPermissions.has(requestId)) {
                clearTimeout(timeout);
                clearTimeout(warning);
                pendingPermissions.delete(requestId);
                resolve({ behavior: "deny", message: "Query aborted", interrupt: true });
              }
            }, { once: true });

            sendEvent("permission_request", {
              requestId,
              queryId,
              toolName,
              input,
              decisionReason: options.decisionReason,
            });
          });
        },
        stderr: (data: string) => console.error(`[chat][stderr] ${data}`),
      },
    });

    let eventCount = 0;

    // Fetch SDK metadata after init (non-blocking)
    const fetchSdkMetadata = async () => {
      try {
        const [models, mcpStatus] = await Promise.all([
          response.supportedModels().catch(() => null),
          response.mcpServerStatus().catch(() => null),
        ]);
        if (models) {
          session.supportedModels = (models as any[]).map((m: any) => ({
            id: m.id || m.model || String(m),
            name: m.name || m.displayName,
          }));
          if (resultSessionId) saveSession(resultSessionId, session);
          sendEvent("supported_models", { models: session.supportedModels });
        }
        if (mcpStatus) {
          sendEvent("mcp_status", { servers: mcpStatus });
        }
      } catch {
        // Non-critical — metadata fetch failed
      }
    };

    for await (const msg of response) {
      const m = msg as any;
      console.error(`[chat] msg.type=${msg.type}${m.subtype ? ` subtype=${m.subtype}` : ""}`);
      eventCount++;

      switch (msg.type) {
        case "system": {
          if (m.subtype === "init") {
            resultSessionId = m.session_id;
            activeQueries.set(m.session_id, response);

            // Update runner's sessionId mapping now that we have the real one
            if (m.session_id && m.session_id !== runner.sessionId) {
              updateRunnerSessionId(queryId, runner.sessionId, m.session_id);
            }

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

            // Fetch supported models + live MCP status (non-blocking)
            fetchSdkMetadata();
          } else if (m.subtype === "compact_boundary") {
            sendEvent("compact_boundary", {
              preTokens: m.pre_context_tokens,
              postTokens: m.post_context_tokens,
              summary: m.summary,
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

          // Track cost, message count, and context window size
          if (m.total_cost_usd) session.totalCostUsd += m.total_cost_usd;
          session.messageCount++;
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

        case "stream_event": {
          const event = m.event;
          if (!event) break;
          const eventType = event.type as string;

          if (eventType === "message_start") {
            const usage = event.message?.usage;
            if (usage) {
              session.contextTokens =
                (usage.input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0) +
                (usage.cache_read_input_tokens || 0);
              console.error(`[chat] context: ${session.contextTokens} tokens (input=${usage.input_tokens} cache_read=${usage.cache_read_input_tokens || 0} cache_create=${usage.cache_creation_input_tokens || 0})`);
              sendEvent("context_update", {
                contextTokens: session.contextTokens,
                contextWindow: session.contextWindow,
              });
            }
          } else if (eventType === "content_block_start") {
            const block = event.content_block;
            sendEvent("stream_event", {
              eventType,
              blockType: block?.type,
              index: event.index,
              ...(block?.type === "tool_use" ? { toolName: block.name } : {}),
            });
          } else if (eventType === "content_block_delta") {
            const delta = event.delta;
            if (delta?.type === "text_delta") {
              sendEvent("stream_event", {
                eventType,
                deltaType: delta.type,
                text: delta.text,
              });
            }
          } else if (eventType === "content_block_stop") {
            sendEvent("stream_event", {
              eventType,
              index: event.index,
            });
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
    runner.setStatus("completed");
    markRunnerCompleted(queryId);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.stack || err.message : String(err);
    console.error(`[chat] ERROR: ${errMsg}`);
    sendEvent("error", { error: errMsg });
    runner.setStatus("error");
    markRunnerCompleted(queryId);
  } finally {
    cleanupQuery();
    // End any still-connected responses
    try { res.end(); } catch { /* already closed */ }
  }
});

// ── GET /api/chat/status — lightweight query status check ──────────
router.get("/status", (req, res) => {
  const sessionId = req.query.sessionId as string | undefined;
  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  const runner = getRunnerBySessionId(sessionId);
  if (!runner) {
    res.json({ queryActive: false, queryId: null, eventCount: 0, status: "none" });
    return;
  }

  res.json({
    queryActive: runner.status === "running",
    queryId: runner.queryId,
    eventCount: runner.eventCount,
    status: runner.status,
  });
});

// ── POST /api/chat/reconnect — replay + subscribe to running query ──
router.post("/reconnect", (req, res) => {
  const { sessionId, fromIndex } = req.body as { sessionId?: string; fromIndex?: number };

  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  const runner = getRunnerBySessionId(sessionId);
  if (!runner) {
    res.status(404).json({ error: "No active or recent query for this session" });
    return;
  }

  // Set up SSE response
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const writeEvent = (type: string, data: unknown, index?: number) => {
    res.write(`data: ${JSON.stringify({ type, data, index })}\n\n`);
  };

  // Replay buffered events from the requested index
  const startIndex = typeof fromIndex === "number" ? fromIndex + 1 : 0; // fromIndex is last received, so start at +1
  const { events, gap } = runner.replayFrom(startIndex);

  if (gap) {
    writeEvent("buffer_gap", {
      message: "Some events were lost due to buffer overflow",
      firstAvailable: runner.firstBufferedIndex,
      requested: startIndex,
    });
  }

  // Replay all buffered events
  for (const event of events) {
    writeEvent(event.type, event.data, event.index);
  }

  // If query is done, send completion and close
  if (runner.status !== "running") {
    writeEvent("reconnect_complete", { status: runner.status, eventCount: runner.eventCount });
    res.end();
    return;
  }

  // Query still running — subscribe as live listener
  const { listener, heartbeat } = subscribeResponse(res, runner);

  res.on("close", () => {
    console.error(`[chat] reconnect client disconnected from query ${runner.queryId}`);
    clearInterval(heartbeat);
    runner.removeListener(listener);
  });
});

// ── POST /api/chat/abort — abort an active query ────────────────────
router.post("/abort", (req, res) => {
  const { queryId } = req.body as { queryId?: string };
  if (!queryId) {
    res.status(400).json({ error: "queryId is required" });
    return;
  }

  const controller = activeAborts.get(queryId);
  if (!controller) {
    // Also check the runner registry
    const runner = getRunnerByQueryId(queryId);
    if (runner && runner.status === "running") {
      runner.abort();
      res.json({ ok: true });
      return;
    }
    res.status(404).json({ error: "Query not found or already finished" });
    return;
  }

  console.error(`[chat] aborting query ${queryId}`);
  controller.abort();
  res.json({ ok: true });
});

// ── POST /api/chat/permission — respond to a permission request ─────
router.post("/permission", (req, res) => {
  const { requestId, behavior } = req.body as {
    requestId?: string;
    behavior?: "allow" | "deny";
  };

  if (!requestId || !behavior) {
    res.status(400).json({ error: "requestId and behavior are required" });
    return;
  }

  const pending = pendingPermissions.get(requestId);
  if (!pending) {
    res.status(404).json({ error: "Permission request not found or already resolved" });
    return;
  }

  clearTimeout(pending.timeout);
  pendingPermissions.delete(requestId);

  if (behavior === "allow") {
    pending.resolve({ behavior: "allow", updatedInput: pending.input });
  } else {
    pending.resolve({ behavior: "deny", message: "User denied permission" });
  }

  console.error(`[chat] permission ${requestId} → ${behavior}`);
  res.json({ ok: true });
});

// ── POST /api/chat/mode — change permission mode mid-session ─────────
const VALID_MODES = new Set(["default", "acceptEdits", "plan"]);

router.post("/mode", async (req, res) => {
  const { sessionId, mode } = req.body as { sessionId?: string; mode?: string };

  if (!mode || !VALID_MODES.has(mode)) {
    res.status(400).json({ error: "mode must be one of: default, acceptEdits, plan" });
    return;
  }

  const sdkMode = mode as "default" | "acceptEdits" | "plan";
  const session = getSession(sessionId);
  session.permissionMode = sdkMode;
  if (sessionId) saveSession(sessionId, session);

  // If there's an active query, change mode immediately
  if (sessionId && activeQueries.has(sessionId)) {
    try {
      await activeQueries.get(sessionId)!.setPermissionMode(sdkMode);
      console.error(`[chat] mode changed to ${sdkMode} (live, sessionId=${sessionId})`);
    } catch (err) {
      console.error(`[chat] setPermissionMode failed: ${err}`);
    }
  } else {
    console.error(`[chat] mode changed to ${sdkMode} (next query, sessionId=${sessionId || "none"})`);
  }

  res.json({ ok: true, mode: sdkMode });
});

// ── Stats for observability ──────────────────────────────────────────
export function getChatStats() {
  return {
    sessions: sessions.size,
    activeAborts: activeAborts.size,
    activeQueries: activeQueries.size,
    pendingPermissions: pendingPermissions.size,
    ...getRunnerStats(),
  };
}

export default router;
