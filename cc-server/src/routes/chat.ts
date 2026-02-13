import { Router } from "express";
import { query } from "@anthropic-ai/claude-agent-sdk";
import path from "path";
import fs from "fs/promises";
import os from "os";
import type { ChatRequest } from "../types.js";

const router = Router();

/**
 * CLI commands the SDK doesn't support that require Claude to do actual work.
 * Info commands (/context, /mcp, /model) are handled client-side from init data.
 * SDK-native commands (/compact, /clear) pass through as-is.
 * Client-side commands (/cost, /help) never reach the server.
 */
const CLI_COMMAND_EXPANSIONS: Record<string, string | ((args: string, cwd: string) => string)> = {
  doctor: (_args, cwd) =>
    `Run diagnostics on this project at ${cwd}. Check for common issues: missing dependencies (node_modules), config errors, TypeScript issues, lock file problems, etc. Report what you find.`,
  init: (_args, cwd) =>
    `Initialize or update a CLAUDE.md file for this project at ${cwd}. Read the codebase structure, key files, and conventions, then create or update CLAUDE.md with project architecture, instructions, and conventions.`,
  review: (args) =>
    args
      ? `Review this pull request or diff: ${args}. Provide a thorough code review with suggestions.`
      : "Run `git diff` and provide a thorough code review of the current changes with suggestions.",
};

/**
 * Expand slash commands:
 * 1. Custom .md files (project, user, BASE_DIR) — highest priority
 * 2. CLI command expansions for commands the SDK doesn't support
 * 3. Everything else passes through as-is (SDK-native like /compact, or unknown)
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
  const baseDir = process.env.BASE_DIR || "";

  // 1. Custom .md command files take priority
  const searchPaths = [
    path.join(cwd, ".claude", "commands", `${cmdName}.md`),
    path.join(os.homedir(), ".claude", "commands", `${cmdName}.md`),
    path.join(baseDir, "slash commands", `${cmdName}.md`),
  ];

  for (const cmdPath of searchPaths) {
    try {
      const content = await fs.readFile(cmdPath, "utf-8");

      // Strip YAML frontmatter (--- ... ---)
      const stripped = content.replace(/^---\n[\s\S]*?\n---\n*/, "");

      // Replace $ARGUMENTS placeholder with actual args
      const expanded = stripped.replace(/\$ARGUMENTS/g, args.trim());

      console.error(`[chat] expanded /${cmdName} from ${cmdPath} (${expanded.length} chars)`);
      return expanded;
    } catch {
      // File not found, try next location
    }
  }

  // 2. CLI commands the SDK doesn't support — expand to prompts
  const cliExpansion = CLI_COMMAND_EXPANSIONS[cmdName];
  if (cliExpansion) {
    const expanded = typeof cliExpansion === "function" ? cliExpansion(args.trim(), cwd) : cliExpansion;
    console.error(`[chat] expanded /${cmdName} via CLI expansion (${expanded.length} chars)`);
    return expanded;
  }

  // 3. Pass through as-is (SDK-native commands like /compact, or unknown)
  console.error(`[chat] passing /${cmdName} through to SDK as-is`);
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
        settingSources: ["project"] as const,
        mcpServers: {
          context7: {
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
          },
        },
        allowedTools: [
          "Read", "Edit", "Write", "Bash", "Glob", "Grep",
          "MultiEdit", "Skill", "Task", "WebFetch", "WebSearch",
          "NotebookEdit", "mcp__context7__*",
        ],
        permissionMode: "acceptEdits",
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
            // Forward all other system subtypes (compact_boundary, context info, etc.)
            sendEvent("system", { subtype: m.subtype, ...m });
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
          console.error(`[chat] RESULT: subtype=${m.subtype} is_error=${m.is_error} num_turns=${m.num_turns} duration_ms=${m.duration_ms} result=${JSON.stringify(m.result)?.slice(0, 500)}`);
          if (m.errors) console.error(`[chat] ERRORS: ${JSON.stringify(m.errors)}`);
          if (m.permission_denials?.length) console.error(`[chat] PERMISSION_DENIALS: ${JSON.stringify(m.permission_denials)}`);
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
