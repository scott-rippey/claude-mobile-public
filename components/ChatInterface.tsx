"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Plus, Loader2 } from "lucide-react";
import { StreamingMessage } from "./StreamingMessage";
import { ToolCallIndicator } from "./ToolCallIndicator";
import { parseSSEStream } from "@/lib/stream-parser";

interface MessageBlock {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: { name: string; input: Record<string, unknown>; id: string; result?: string; elapsedSeconds?: number }[];
}

interface ChatInterfaceProps {
  projectPath: string;
  projectName: string;
  embedded?: boolean;
}

export function ChatInterface({
  projectPath,
  projectName,
  embedded = false,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<MessageBlock[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(`cc-session-${projectPath}`) || null;
    }
    return null;
  });
  const [sessionCost, setSessionCost] = useState({ totalCostUsd: 0, totalDurationMs: 0, totalTurns: 0 });
  const [initData, setInitData] = useState<Record<string, unknown> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    // Handle client-side slash commands
    if (trimmed.startsWith("/")) {
      const cmd = trimmed.split(" ")[0].toLowerCase();
      if (cmd === "/clear") {
        setInput("");
        startNewConversation();
        return;
      }
      if (cmd === "/help") {
        setInput("");
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "user", content: trimmed },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "**Instant commands** (real SDK data, no round-trip):\n- `/context` — Session info (model, tools, MCP servers, commands)\n- `/mcp` — MCP servers and their tools\n- `/model` — Current model\n- `/cost` — Accumulated session cost\n- `/clear` — Start a new conversation\n- `/help` — This message\n\n**SDK commands** (sent to Claude):\n- `/compact [focus]` — Compress conversation history\n\n**Custom commands** (`/catchup`, `/log`, `/push`, etc.) — expanded from `.md` files.\n\nAnything else passes through to the SDK as-is.",
          },
        ]);
        return;
      }
      if (cmd === "/cost") {
        setInput("");
        const cost = sessionCost.totalCostUsd;
        const duration = sessionCost.totalDurationMs;
        const turns = sessionCost.totalTurns;
        const durationStr = duration > 60000
          ? `${(duration / 60000).toFixed(1)} min`
          : `${(duration / 1000).toFixed(1)}s`;
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "user", content: trimmed },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: turns === 0
              ? "No cost data yet — send a message first."
              : `**Session Cost**\n- Total: $${cost.toFixed(4)}\n- Duration: ${durationStr}\n- Turns: ${turns}`,
          },
        ]);
        return;
      }
      // SDK doesn't support /context, /mcp, /model — handle client-side from real init data
      if (cmd === "/context" || cmd === "/mcp" || cmd === "/model") {
        setInput("");
        let content: string;
        if (!initData) {
          content = "No session data yet — send a message first to initialize.";
        } else if (cmd === "/context") {
          const model = initData.model as string | undefined;
          const version = initData.claudeCodeVersion as string | undefined;
          const cwd = initData.cwd as string | undefined;
          const tools = initData.tools as string[] | undefined;
          const mcpServers = initData.mcpServers as Record<string, unknown> | undefined;
          const slashCmds = initData.slashCommands as { name: string; description?: string }[] | undefined;
          const lines = ["**Session Context**"];
          if (model) lines.push(`**Model:** ${model}`);
          if (version) lines.push(`**Claude Code:** v${version}`);
          if (cwd) lines.push(`**CWD:** ${cwd}`);
          if (tools?.length) lines.push(`\n**Tools (${tools.length}):** ${tools.join(", ")}`);
          if (mcpServers) {
            const names = Object.keys(mcpServers);
            if (names.length) lines.push(`\n**MCP Servers:** ${names.join(", ")}`);
          }
          if (slashCmds?.length) {
            lines.push(`\n**Slash Commands (${slashCmds.length}):**`);
            slashCmds.forEach((c) => lines.push(`- \`${c.name}\`${c.description ? ` — ${c.description}` : ""}`));
          }
          content = lines.join("\n");
        } else if (cmd === "/mcp") {
          const mcpServers = initData.mcpServers as Record<string, unknown> | undefined;
          const tools = initData.tools as string[] | undefined;
          if (!mcpServers || Object.keys(mcpServers).length === 0) {
            content = "No MCP servers configured.";
          } else {
            const lines = ["**MCP Servers**"];
            for (const name of Object.keys(mcpServers)) {
              const serverTools = (tools || []).filter((t) => t.startsWith(`mcp__${name}__`));
              lines.push(`\n**${name}**`);
              if (serverTools.length) {
                serverTools.forEach((t) => lines.push(`- \`${t.replace(`mcp__${name}__`, "")}\``));
              } else {
                lines.push("- (no tools registered)");
              }
            }
            content = lines.join("\n");
          }
        } else {
          content = `**Model:** ${(initData.model as string) || "unknown"}`;
        }
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "user", content: trimmed },
          { id: crypto.randomUUID(), role: "assistant", content },
        ]);
        return;
      }
      // All other slash commands pass through to server/SDK
    }

    const userMessage: MessageBlock = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsStreaming(true);

    // Create placeholder assistant message
    const assistantId = crypto.randomUUID();
    const assistantMessage: MessageBlock = {
      id: assistantId,
      role: "assistant",
      content: "",
      toolCalls: [],
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          sessionId,
          projectPath,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error("Failed to start chat");
      }

      const reader = res.body.getReader();

      for await (const event of parseSSEStream(reader)) {
        switch (event.type) {
          case "init": {
            const newSessionId = event.data.sessionId as string;
            setSessionId(newSessionId);
            setInitData(event.data);
            localStorage.setItem(`cc-session-${projectPath}`, newSessionId);
            break;
          }
          case "assistant": {
            const text = event.data.text as string;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + text }
                  : m
              )
            );
            break;
          }
          case "tool_call": {
            const toolCall = {
              name: event.data.name as string,
              input: event.data.input as Record<string, unknown>,
              id: event.data.id as string,
            };
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, toolCalls: [...(m.toolCalls || []), toolCall] }
                  : m
              )
            );
            break;
          }
          case "tool_result": {
            const toolUseId = event.data.toolUseId as string;
            const content = event.data.content as string;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      toolCalls: m.toolCalls?.map((tc) =>
                        tc.id === toolUseId ? { ...tc, result: content } : tc
                      ),
                    }
                  : m
              )
            );
            break;
          }
          case "tool_progress": {
            const toolUseId = event.data.toolUseId as string;
            const elapsedSeconds = event.data.elapsedSeconds as number;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      toolCalls: m.toolCalls?.map((tc) =>
                        tc.id === toolUseId ? { ...tc, elapsedSeconds } : tc
                      ),
                    }
                  : m
              )
            );
            break;
          }
          case "system": {
            // SDK system events (compact_boundary, context info, etc.)
            const subtype = event.data.subtype as string;
            const sysContent = event.data.result as string | undefined;
            if (sysContent) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + sysContent }
                    : m
                )
              );
            } else {
              // Log the raw event data for subtypes that don't have a result string
              console.log(`[system event] subtype=${subtype}`, event.data);
            }
            break;
          }
          case "result": {
            const isError = event.data.isError as boolean | undefined;
            const errors = event.data.errors as string[] | undefined;
            const result = event.data.result as string | undefined;
            const totalCostUsd = event.data.totalCostUsd as number | undefined;
            const durationMs = event.data.durationMs as number | undefined;
            const numTurns = event.data.numTurns as number | undefined;

            // Accumulate session cost
            if (totalCostUsd !== undefined) {
              setSessionCost((prev) => ({
                totalCostUsd: prev.totalCostUsd + totalCostUsd,
                totalDurationMs: prev.totalDurationMs + (durationMs || 0),
                totalTurns: prev.totalTurns + (numTurns || 0),
              }));
            }

            if (isError && errors?.length) {
              // Show SDK error results that were previously swallowed
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        content: m.content + `\n\n**Error:** ${errors.join("\n")}`,
                      }
                    : m
                )
              );
            } else if (result) {
              // Use result text as fallback if no streamed content
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId && !m.content
                    ? { ...m, content: result }
                    : m
                )
              );
            }
            const sid = event.data.sessionId as string | undefined;
            if (sid) {
              setSessionId(sid);
              localStorage.setItem(`cc-session-${projectPath}`, sid);
            }
            break;
          }
          case "error": {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content:
                        m.content +
                        `\n\n**Error:** ${event.data.error}`,
                    }
                  : m
              )
            );
            break;
          }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: `**Error:** ${err instanceof Error ? err.message : "Connection failed"}`,
              }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
    }
  };

  const startNewConversation = () => {
    setMessages([]);
    setSessionId(null);
    setSessionCost({ totalCostUsd: 0, totalDurationMs: 0, totalTurns: 0 });
    setInitData(null);
    localStorage.removeItem(`cc-session-${projectPath}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className={`flex flex-col ${embedded ? "h-full" : "h-[100dvh]"}`}>
      {/* Header — hidden when embedded in ProjectWorkspace */}
      {!embedded && (
        <header className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold truncate">{projectName}</h1>
            <p className="text-xs text-muted truncate">Claude Code</p>
          </div>
          <button
            onClick={startNewConversation}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted hover:text-foreground border border-border rounded-md hover:bg-card transition-colors shrink-0"
          >
            <Plus size={14} />
            New
          </button>
        </header>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted text-sm">
            <p>Start a conversation with Claude Code</p>
            <p className="text-xs mt-1">Project: {projectPath}</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.role === "user" ? (
              <div className="flex justify-end">
                <div className="bg-accent/20 text-foreground rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[85%] text-sm whitespace-pre-wrap">
                  {msg.content}
                </div>
              </div>
            ) : (
              <div className="max-w-full">
                {/* Tool calls */}
                {msg.toolCalls?.map((tc) => (
                  <ToolCallIndicator
                    key={tc.id}
                    name={tc.name}
                    input={tc.input}
                    result={tc.result}
                    elapsedSeconds={tc.elapsedSeconds}
                  />
                ))}
                {/* Text content */}
                {msg.content && <StreamingMessage content={msg.content} />}
                {/* Streaming indicator — hide once tool calls or content appear */}
                {isStreaming &&
                  msg === messages[messages.length - 1] &&
                  !msg.content &&
                  (!msg.toolCalls || msg.toolCalls.length === 0) && (
                    <div className="flex items-center gap-2 text-muted text-sm py-2">
                      <Loader2 className="animate-spin" size={14} />
                      Thinking...
                    </div>
                  )}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-border px-4 py-3 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Claude Code..."
            rows={1}
            className="flex-1 bg-card border border-border rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-muted/60"
            style={{ maxHeight: "120px" }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height = Math.min(target.scrollHeight, 120) + "px";
            }}
            disabled={isStreaming}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming}
            className="flex items-center justify-center w-10 h-10 bg-accent rounded-xl text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent/80 transition-colors shrink-0"
          >
            {isStreaming ? (
              <Loader2 className="animate-spin" size={18} />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
