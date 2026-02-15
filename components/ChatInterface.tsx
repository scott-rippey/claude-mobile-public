"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Plus, Square, WifiOff } from "lucide-react";
import { StreamingMessage } from "./StreamingMessage";
import { ToolCallIndicator } from "./ToolCallIndicator";
import { PermissionModal } from "./PermissionModal";
import { ActivityIndicator, type ActivityState } from "./ActivityIndicator";
import { ModeSelector, type ChatMode } from "./ModeSelector";
import { parseSSEStream } from "@/lib/stream-parser";

interface MessageBlock {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: { name: string; input: Record<string, unknown>; id: string; result?: string; elapsedSeconds?: number }[];
}

interface PermissionRequest {
  requestId: string;
  queryId: string;
  toolName: string;
  input: Record<string, unknown>;
  decisionReason?: string;
}

interface ChatInterfaceProps {
  projectPath: string;
  projectName: string;
  embedded?: boolean;
}

// ── localStorage persistence for chat history ──────────────────────
const CHAT_STORAGE_PREFIX = "cc-chat-";

interface PersistedChat {
  messages: MessageBlock[];
  sessionStats: { contextTokens: number; contextWindow: number } | null;
}

function loadPersistedChat(projectPath: string): PersistedChat {
  try {
    const raw = localStorage.getItem(`${CHAT_STORAGE_PREFIX}${projectPath}`);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedChat;
      if (Array.isArray(parsed.messages)) return parsed;
    }
  } catch {
    // Corrupted data — start fresh
  }
  return { messages: [], sessionStats: null };
}

function savePersistedChat(projectPath: string, messages: MessageBlock[], sessionStats: { contextTokens: number; contextWindow: number } | null) {
  const data: PersistedChat = { messages, sessionStats };
  try {
    localStorage.setItem(`${CHAT_STORAGE_PREFIX}${projectPath}`, JSON.stringify(data));
  } catch {
    // QuotaExceededError — trim oldest messages and retry once
    try {
      const trimmed = messages.slice(-50);
      localStorage.setItem(`${CHAT_STORAGE_PREFIX}${projectPath}`, JSON.stringify({ messages: trimmed, sessionStats }));
    } catch {
      // Still too large — give up silently
    }
  }
}

export function ChatInterface({
  projectPath,
  projectName,
  embedded = false,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<MessageBlock[]>(() => {
    if (typeof window !== "undefined") {
      return loadPersistedChat(projectPath).messages;
    }
    return [];
  });
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(`cc-session-${projectPath}`) || null;
    }
    return null;
  });
  const [sessionStats, setSessionStats] = useState<{
    contextTokens: number;
    contextWindow: number;
  } | null>(() => {
    if (typeof window !== "undefined") {
      return loadPersistedChat(projectPath).sessionStats;
    }
    return null;
  });
  const [permissionQueue, setPermissionQueue] = useState<PermissionRequest[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const queryIdRef = useRef<string | null>(null);
  const streamingRef = useRef(false);
  const assistantIdRef = useRef<string | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const [activityState, setActivityState] = useState<ActivityState>(null);
  const streamedTextRef = useRef(false);
  const [chatMode, setChatMode] = useState<ChatMode>("default");

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Persist messages + sessionStats to localStorage on every change
  useEffect(() => {
    savePersistedChat(projectPath, messages, sessionStats);
  }, [projectPath, messages, sessionStats]);

  // Track the last user message for retry functionality
  const lastUserMessageRef = useRef<string | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);

  // Detect browser resume after suspend (screen off, tab switch)
  // Try to detect if stream is still alive before force-aborting
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && streamingRef.current) {
        // Page just became visible while we think we're streaming.
        // Wait a moment for buffered data, then check if connection survives.
        // If no data arrives within 3s, assume the connection is dead.
        const checkTimeout = setTimeout(() => {
          if (streamingRef.current && abortRef.current) {
            abortRef.current.abort();
            setConnectionLost(true);
            // Also tell server to abort
            const qId = queryIdRef.current;
            if (qId) {
              fetch("/api/chat/abort", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ queryId: qId }),
              }).catch(() => {});
            }
          }
        }, 3000);

        // If streaming finishes naturally within 3s, cancel the abort
        const checkInterval = setInterval(() => {
          if (!streamingRef.current) {
            clearTimeout(checkTimeout);
            clearInterval(checkInterval);
          }
        }, 500);

        return () => {
          clearTimeout(checkTimeout);
          clearInterval(checkInterval);
        };
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // 2A: Network loss detection
  const [isOffline, setIsOffline] = useState(false);
  useEffect(() => {
    const handleOffline = () => {
      setIsOffline(true);
      // If streaming when we go offline, mark connection lost
      if (streamingRef.current && abortRef.current) {
        abortRef.current.abort();
        setConnectionLost(true);
      }
    };
    const handleOnline = () => setIsOffline(false);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  const sendMessage = async (overrideText?: string) => {
    const trimmed = overrideText || input.trim();
    if (!trimmed || isStreaming) return;

    // /clear — clear UI instantly + notify server to clean up session state
    if (trimmed.toLowerCase() === "/clear") {
      setInput("");
      const oldSessionId = sessionId;
      startNewConversation();
      // Fire-and-forget: tell server to clean up session state
      if (oldSessionId) {
        fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "/clear", sessionId: oldSessionId, projectPath }),
        }).catch(() => {});
      }
      return;
    }
    // Everything else goes to the server (built-in commands, custom .md, SDK pass-through)

    const userMessage: MessageBlock = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsStreaming(true);
    streamingRef.current = true;
    lastUserMessageRef.current = trimmed;
    setConnectionLost(false);

    // Request wake lock to prevent screen from turning off during response
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      }
    } catch {
      // Wake lock not supported or denied — non-critical
    }

    // Create placeholder assistant message
    const assistantId = crypto.randomUUID();
    assistantIdRef.current = assistantId;
    const assistantMessage: MessageBlock = {
      id: assistantId,
      role: "assistant",
      content: "",
      toolCalls: [],
    };
    setMessages((prev) => [...prev, assistantMessage]);
    setActivityState("thinking");
    streamedTextRef.current = false;

    const fetchAbort = new AbortController();
    abortRef.current = fetchAbort;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          sessionId,
          projectPath,
        }),
        signal: fetchAbort.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error("Failed to start chat");
      }

      const reader = res.body.getReader();

      for await (const event of parseSSEStream(reader)) {
        switch (event.type) {
          case "query_start": {
            queryIdRef.current = event.data.queryId as string;
            break;
          }
          case "permission_request": {
            const req: PermissionRequest = {
              requestId: event.data.requestId as string,
              queryId: event.data.queryId as string,
              toolName: event.data.toolName as string,
              input: event.data.input as Record<string, unknown>,
              decisionReason: event.data.decisionReason as string | undefined,
            };
            setPermissionQueue((prev) => [...prev, req]);
            break;
          }
          case "init": {
            const newSessionId = event.data.sessionId as string;
            setSessionId(newSessionId);

            localStorage.setItem(`cc-session-${projectPath}`, newSessionId);
            break;
          }
          case "assistant": {
            // When streaming via deltas, the assistant event delivers the FULL text block
            // after streaming — skip it to avoid doubling the text
            if (!streamedTextRef.current) {
              const text = event.data.text as string;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + text }
                    : m
                )
              );
            }
            break;
          }
          case "tool_call": {
            const toolCall = {
              name: event.data.name as string,
              input: event.data.input as Record<string, unknown>,
              id: event.data.id as string,
            };
            setActivityState(null); // ToolCallIndicator takes over
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
            // Model is now analyzing results — show thinking indicator
            setActivityState("thinking");
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
          case "stream_event": {
            const eventType = event.data.eventType as string;
            if (eventType === "content_block_start") {
              const blockType = event.data.blockType as string;
              if (blockType === "text") {
                setActivityState(null); // text about to stream
                // Separate text segments with a paragraph break (e.g. text before vs after tool calls)
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId && m.content.length > 0
                      ? { ...m, content: m.content + "\n\n" }
                      : m
                  )
                );
              } else if (blockType === "tool_use") {
                setActivityState("tool-starting");
              }
            } else if (eventType === "content_block_delta") {
              const text = event.data.text as string | undefined;
              if (text) {
                streamedTextRef.current = true;
                setActivityState(null);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: m.content + text }
                      : m
                  )
                );
              }
            }
            // content_block_stop — no action needed
            break;
          }
          case "context_update": {
            const ctxTokens = event.data.contextTokens as number | undefined;
            const ctxWindow = event.data.contextWindow as number | undefined;
            if (ctxTokens !== undefined && ctxWindow !== undefined && ctxWindow > 0) {
              setSessionStats({ contextTokens: ctxTokens, contextWindow: ctxWindow });
            } else if (ctxTokens !== undefined) {
              // Update tokens even if we don't have contextWindow yet
              setSessionStats((prev) => prev ? { ...prev, contextTokens: ctxTokens } : prev);
            }
            break;
          }
          case "compact_boundary": {
            const preTokens = event.data.preTokens as number | undefined;
            const postTokens = event.data.postTokens as number | undefined;
            const freed = preTokens && postTokens ? ((preTokens - postTokens) / 1000).toFixed(1) : "?";
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + `\n\n*[Context compacted — ${freed}k tokens freed]*\n\n` }
                  : m
              )
            );
            break;
          }
          case "system": {
            // SDK system events (context info, etc.)
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
            // Update session stats from result event
            const contextTokens = event.data.contextTokens as number | undefined;
            const contextWindow = event.data.contextWindow as number | undefined;
            if (contextTokens !== undefined && contextWindow !== undefined) {
              setSessionStats({ contextTokens, contextWindow });
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
      if (err instanceof DOMException && err.name === "AbortError") {
        // Append stopped indicator — covers both user Stop and visibility-triggered abort
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content + "\n\n*[Connection lost — response may be incomplete]*" }
              : m
          )
        );
      } else {
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
      }
    } finally {
      setIsStreaming(false);
      streamingRef.current = false;
      abortRef.current = null;
      queryIdRef.current = null;
      assistantIdRef.current = null;
      setActivityState(null);
      streamedTextRef.current = false;
      setPermissionQueue([]);
      // Release wake lock
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    }
  };

  const startNewConversation = () => {
    setMessages([]);
    setSessionId(null);
    setSessionStats(null);
    setPermissionQueue([]);
    setChatMode("default");
    localStorage.removeItem(`cc-session-${projectPath}`);
    localStorage.removeItem(`${CHAT_STORAGE_PREFIX}${projectPath}`);
  };

  const stopQuery = () => {
    // Abort the fetch connection
    abortRef.current?.abort();
    // Fire-and-forget: tell server to abort the SDK query
    const qId = queryIdRef.current;
    if (qId) {
      fetch("/api/chat/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queryId: qId }),
      }).catch(() => {});
    }
  };

  const retryLastMessage = () => {
    const lastMsg = lastUserMessageRef.current;
    if (!lastMsg || isStreaming) return;
    setConnectionLost(false);
    sendMessage(lastMsg);
  };

  const handlePermissionAllow = (requestId: string) => {
    fetch("/api/chat/permission", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, behavior: "allow" }),
    }).catch(() => {});
    setPermissionQueue((prev) => prev.filter((p) => p.requestId !== requestId));
  };

  const handlePermissionDeny = (requestId: string) => {
    fetch("/api/chat/permission", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, behavior: "deny" }),
    }).catch(() => {});
    setPermissionQueue((prev) => prev.filter((p) => p.requestId !== requestId));
  };

  const handleModeChange = (mode: ChatMode) => {
    setChatMode(mode);
    fetch("/api/chat/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, mode }),
    }).catch(() => {});
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

      {/* Offline banner */}
      {isOffline && (
        <div className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 text-yellow-500 text-xs shrink-0">
          <WifiOff size={14} />
          Network lost — reconnect to continue
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted text-sm">
            <p>Start a conversation with Claude Code</p>
            <p className="text-xs mt-1">Project: {projectPath}</p>
          </div>
        )}

        {messages.map((msg, idx) => (
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
                {/* Activity indicator — shows between tool calls and during thinking */}
                {isStreaming &&
                  msg === messages[messages.length - 1] &&
                  activityState && (
                    <ActivityIndicator state={activityState} />
                  )}
                {/* Retry button when connection was lost */}
                {connectionLost && !isStreaming && idx === messages.length - 1 && (
                  <button
                    onClick={retryLastMessage}
                    className="mt-2 px-3 py-1.5 text-xs bg-accent/20 text-accent rounded-lg hover:bg-accent/30 transition-colors"
                  >
                    Retry last message
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Context bar + Input area */}
      <div className="border-t border-border shrink-0">
        {sessionStats && sessionStats.contextWindow > 0 && (
          <div className="px-4 pt-2 pb-0">
            <div className="flex items-center justify-between text-[11px] text-muted mb-1">
              <span>
                {(sessionStats.contextTokens / 1000).toFixed(1)}k / {(sessionStats.contextWindow / 1000).toFixed(0)}k tokens
              </span>
              <span>
                {((sessionStats.contextTokens / sessionStats.contextWindow) * 100).toFixed(0)}% used
              </span>
            </div>
            <div className="h-1 bg-border rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  sessionStats.contextTokens / sessionStats.contextWindow > 0.8
                    ? "bg-red-500"
                    : sessionStats.contextTokens / sessionStats.contextWindow > 0.6
                      ? "bg-yellow-500"
                      : "bg-accent"
                }`}
                style={{ width: `${Math.min((sessionStats.contextTokens / sessionStats.contextWindow) * 100, 100)}%` }}
              />
            </div>
          </div>
        )}
        <div className="flex items-center justify-between px-4 pt-2 pb-0">
          <ModeSelector mode={chatMode} onChange={handleModeChange} disabled={isStreaming} />
        </div>
        <div className="flex items-end gap-2 px-4 py-3">
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
          {isStreaming ? (
            <button
              onClick={stopQuery}
              className="flex items-center justify-center w-10 h-10 bg-red-600 rounded-xl text-white hover:bg-red-500 active:bg-red-700 transition-colors shrink-0"
            >
              <Square size={16} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim()}
              className="flex items-center justify-center w-10 h-10 bg-accent rounded-xl text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent/80 transition-colors shrink-0"
            >
              <Send size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Permission modal */}
      {permissionQueue.length > 0 && (
        <PermissionModal
          request={permissionQueue[0]}
          onAllow={handlePermissionAllow}
          onDeny={handlePermissionDeny}
        />
      )}
    </div>
  );
}
