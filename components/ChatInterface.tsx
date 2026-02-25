"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Plus, Square, WifiOff } from "lucide-react";
import { StreamingMessage } from "./StreamingMessage";
import { ToolCallIndicator } from "./ToolCallIndicator";
import { PermissionModal } from "./PermissionModal";
import type { ActivityState } from "./ActivityIndicator";
import { StatusBar, type ConnectionState } from "./StatusBar";
import type { ChatMode } from "./ModeSelector";
import { ChatSettings } from "./ChatSettings";
import { parseSSEStream, type SSEMessage } from "@/lib/stream-parser";

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

// ── Helper: get descriptive label for a tool call ──────────────────
function getToolActivityLabel(name: string, input: Record<string, unknown>): ActivityState {
  if (name === "Task") {
    const desc = input.description || input.prompt;
    return { type: "agent-working", description: typeof desc === "string" ? desc.slice(0, 60) : "Working..." };
  }
  if (name === "Bash" || name === "BashTool") {
    const cmd = input.command;
    return { type: "tool-running", toolName: name, description: typeof cmd === "string" ? cmd.slice(0, 60) : undefined };
  }
  if (name === "Read" || name === "ReadFile") {
    const fp = input.file_path;
    const filename = typeof fp === "string" ? fp.split("/").pop() : undefined;
    return { type: "tool-running", toolName: name, description: filename };
  }
  if (name === "Write" || name === "Edit" || name === "MultiEdit") {
    const fp = input.file_path;
    const filename = typeof fp === "string" ? fp.split("/").pop() : undefined;
    return { type: "tool-running", toolName: name, description: filename };
  }
  if (name === "Glob" || name === "Grep") {
    const pattern = input.pattern;
    return { type: "tool-running", toolName: name, description: typeof pattern === "string" ? pattern.slice(0, 40) : undefined };
  }
  return { type: "tool-running", toolName: name };
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

  // ── Reconnect state ──────────────────────────────────────────────
  const lastEventIndexRef = useRef(-1);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connected");
  const lastEventTimeRef = useRef<number>(0);
  const healthCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Feature B: Graceful interrupt state ──────────────────────────
  // First stop tap = graceful interrupt ("Interrupting..." state)
  // Second tap within 3s = hard abort
  const [isInterrupting, setIsInterrupting] = useState(false);
  const interruptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Session settings (Batch 1) ──────────────────────────────────
  const [sessionCost, setSessionCost] = useState(0);
  const [budgetCapUsd, setBudgetCapUsd] = useState<number | null>(null);
  const [maxTurns, setMaxTurns] = useState<number | null>(null);

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

  // ── Shared SSE event handler ──────────────────────────────────────
  // Used by both sendMessage and reconnectToQuery
  const handleSSEEvent = useCallback((event: SSEMessage, currentAssistantId: string) => {
    // Track event index for reconnection
    if (typeof event.index === "number") {
      lastEventIndexRef.current = event.index;
    }
    // Track event time for staleness detection
    lastEventTimeRef.current = Date.now();

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
              m.id === currentAssistantId
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
        setActivityState(getToolActivityLabel(toolCall.name, toolCall.input));
        setMessages((prev) =>
          prev.map((m) =>
            m.id === currentAssistantId
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
            m.id === currentAssistantId
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
            m.id === currentAssistantId
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
            // Separate text segments with a paragraph break
            setMessages((prev) =>
              prev.map((m) =>
                m.id === currentAssistantId && m.content.length > 0
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
                m.id === currentAssistantId
                  ? { ...m, content: m.content + text }
                  : m
              )
            );
          }
        }
        break;
      }
      case "context_update": {
        const ctxTokens = event.data.contextTokens as number | undefined;
        const ctxWindow = event.data.contextWindow as number | undefined;
        if (ctxTokens !== undefined && ctxWindow !== undefined && ctxWindow > 0) {
          setSessionStats({ contextTokens: ctxTokens, contextWindow: ctxWindow });
        } else if (ctxTokens !== undefined) {
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
            m.id === currentAssistantId
              ? { ...m, content: m.content + `\n\n*[Context compacted — ${freed}k tokens freed]*\n\n` }
              : m
          )
        );
        break;
      }
      case "system": {
        const sysContent = event.data.result as string | undefined;
        if (sysContent) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === currentAssistantId
                ? { ...m, content: m.content + sysContent }
                : m
            )
          );
        }
        break;
      }
      case "result": {
        const isError = event.data.isError as boolean | undefined;
        const errors = event.data.errors as string[] | undefined;
        const result = event.data.result as string | undefined;

        if (isError && errors?.length) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === currentAssistantId
                ? { ...m, content: m.content + `\n\n**Error:** ${errors.join("\n")}` }
                : m
            )
          );
        } else if (result) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === currentAssistantId && !m.content
                ? { ...m, content: result }
                : m
            )
          );
        }
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
        // Track session cost from result events
        const sessionCostUsd = event.data.sessionCostUsd as number | undefined;
        if (sessionCostUsd !== undefined) {
          setSessionCost(sessionCostUsd);
        }
        break;
      }
      case "error": {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === currentAssistantId
              ? { ...m, content: m.content + `\n\n**Error:** ${event.data.error}` }
              : m
          )
        );
        break;
      }
      case "buffer_gap": {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === currentAssistantId
              ? { ...m, content: m.content + "\n\n*[Some events were lost during reconnection]*\n\n" }
              : m
          )
        );
        break;
      }
      // reconnect_complete and done are handled by the caller
    }
  }, [projectPath]);

  // ── Reconnect to a running or completed query ─────────────────────
  const reconnectToQuery = useCallback(async (assistantId: string) => {
    const sid = sessionId;
    if (!sid) return;

    setConnectionState("reconnecting");

    try {
      const fetchAbort = new AbortController();
      abortRef.current = fetchAbort;

      const res = await fetch("/api/chat/reconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sid,
          fromIndex: lastEventIndexRef.current,
        }),
        signal: fetchAbort.signal,
      });

      if (!res.ok || !res.body) {
        setConnectionState("disconnected");
        return;
      }

      setConnectionState("connected");
      const reader = res.body.getReader();

      for await (const event of parseSSEStream(reader)) {
        // Skip events we already processed (dedup safety)
        if (typeof event.index === "number" && event.index <= lastEventIndexRef.current) {
          continue;
        }

        if (event.type === "reconnect_complete" || event.type === "done") {
          break;
        }

        handleSSEEvent(event, assistantId);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User-initiated abort during reconnect
      } else {
        setConnectionState("disconnected");
      }
    }
  }, [sessionId, handleSSEEvent]);

  // ── Smart visibility handler — status check + reconnect ───────────
  useEffect(() => {
    const handleVisibility = async () => {
      if (document.visibilityState !== "visible" || !streamingRef.current) return;

      const sid = sessionId;
      if (!sid) return;

      // Check server status first (fast JSON call)
      try {
        const statusRes = await fetch(`/api/chat/status?sessionId=${encodeURIComponent(sid)}`);
        if (!statusRes.ok) {
          setConnectionState("disconnected");
          return;
        }

        const status = await statusRes.json();

        if (status.queryActive || status.status === "completed" || status.status === "error") {
          // Query exists on server — abort stale SSE and reconnect
          abortRef.current?.abort();
          const aid = assistantIdRef.current;
          if (aid) {
            await reconnectToQuery(aid);
          }

          // If query is done, finalize
          if (!status.queryActive) {
            setIsStreaming(false);
            streamingRef.current = false;
            abortRef.current = null;
            queryIdRef.current = null;
            assistantIdRef.current = null;
            setActivityState(null);
            streamedTextRef.current = false;
            setPermissionQueue([]);
            wakeLockRef.current?.release().catch(() => {});
            wakeLockRef.current = null;
          }
        } else {
          // No query on server — connection truly lost, query died
          setConnectionLost(true);
          setIsStreaming(false);
          streamingRef.current = false;
          abortRef.current?.abort();
          abortRef.current = null;
          setActivityState(null);
        }
      } catch {
        // Can't reach server at all
        setConnectionState("disconnected");
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [sessionId, reconnectToQuery]);

  // ── Periodic health check during streaming ────────────────────────
  useEffect(() => {
    if (isStreaming) {
      lastEventTimeRef.current = Date.now();

      healthCheckIntervalRef.current = setInterval(async () => {
        if (!streamingRef.current) return;

        // Check for stale connection (no events in 20s)
        const staleness = Date.now() - lastEventTimeRef.current;
        if (staleness > 20_000) {
          setConnectionState("stale");
        }

        // Periodic status poll every 10s
        const sid = sessionId;
        if (!sid) return;

        try {
          const statusRes = await fetch(`/api/chat/status?sessionId=${encodeURIComponent(sid)}`);
          if (!statusRes.ok) return;

          const status = await statusRes.json();

          if (!status.queryActive && status.status !== "running") {
            // Query ended while we were streaming — might have missed done event
            if (streamingRef.current) {
              abortRef.current?.abort();
              const aid = assistantIdRef.current;
              if (aid) {
                await reconnectToQuery(aid);
              }
              // Finalize
              setIsStreaming(false);
              streamingRef.current = false;
              abortRef.current = null;
              queryIdRef.current = null;
              assistantIdRef.current = null;
              setActivityState(null);
              streamedTextRef.current = false;
              setPermissionQueue([]);
              wakeLockRef.current?.release().catch(() => {});
              wakeLockRef.current = null;
            }
          }
        } catch {
          // Status check failed — non-critical
        }
      }, 10_000);

      return () => {
        if (healthCheckIntervalRef.current) {
          clearInterval(healthCheckIntervalRef.current);
          healthCheckIntervalRef.current = null;
        }
      };
    } else {
      setConnectionState("connected");
    }
  }, [isStreaming, sessionId, reconnectToQuery]);

  // ── Network loss detection ────────────────────────────────────────
  const [isOffline, setIsOffline] = useState(false);
  useEffect(() => {
    const handleOffline = () => {
      setIsOffline(true);
      if (streamingRef.current) {
        // Don't abort — server keeps running. Just mark disconnected.
        setConnectionState("disconnected");
      }
    };
    const handleOnline = () => {
      setIsOffline(false);
      // If we were streaming, try to reconnect
      if (streamingRef.current && assistantIdRef.current) {
        reconnectToQuery(assistantIdRef.current);
      }
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [reconnectToQuery]);

  const sendMessage = async (overrideText?: string) => {
    const trimmed = overrideText || input.trim();
    if (!trimmed || isStreaming) return;

    // /clear — clear UI instantly + notify server to clean up session state
    if (trimmed.toLowerCase() === "/clear") {
      setInput("");
      const oldSessionId = sessionId;
      startNewConversation();
      if (oldSessionId) {
        fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "/clear", sessionId: oldSessionId, projectPath }),
        }).catch(() => {});
      }
      return;
    }

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
    lastEventIndexRef.current = -1;
    setConnectionState("connected");

    // Request wake lock
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      }
    } catch {
      // Non-critical
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
          // Recovery: when sessionId is lost but chat has messages, try to continue
          ...(!sessionId && messages.length > 0 ? { continue: true } : {}),
        }),
        signal: fetchAbort.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error("Failed to start chat");
      }

      const reader = res.body.getReader();

      for await (const event of parseSSEStream(reader)) {
        if (event.type === "done") break;
        handleSSEEvent(event, assistantId);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Could be user Stop, visibility reconnect, or network loss
        // Don't append "connection lost" — the visibility handler will reconnect
        if (connectionState === "reconnecting") {
          // Reconnect in progress — the reconnect handler manages this
        } else {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + "\n\n*[Connection interrupted — checking server...]*" }
                : m
            )
          );
          // Try to reconnect automatically
          try {
            const sid = sessionId;
            if (sid) {
              const statusRes = await fetch(`/api/chat/status?sessionId=${encodeURIComponent(sid)}`);
              if (statusRes.ok) {
                const status = await statusRes.json();
                if (status.queryActive || status.status === "completed") {
                  await reconnectToQuery(assistantId);
                  return; // Don't go to finally cleanup — reconnect handled it
                }
              }
            }
          } catch {
            // Reconnect attempt failed
          }
          setConnectionLost(true);
        }
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
    setSessionCost(0);
    setBudgetCapUsd(null);
    setMaxTurns(null);
    setIsInterrupting(false);
    if (interruptTimerRef.current) {
      clearTimeout(interruptTimerRef.current);
      interruptTimerRef.current = null;
    }
    lastEventIndexRef.current = -1;
    localStorage.removeItem(`cc-session-${projectPath}`);
    localStorage.removeItem(`${CHAT_STORAGE_PREFIX}${projectPath}`);
  };

  const stopQuery = () => {
    const qId = queryIdRef.current;

    if (!isInterrupting) {
      // First tap: graceful interrupt
      setIsInterrupting(true);
      if (qId) {
        fetch("/api/chat/abort", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queryId: qId, graceful: true }),
        }).catch(() => {});
      }
      // Reset after 3s — next tap becomes hard abort
      interruptTimerRef.current = setTimeout(() => {
        setIsInterrupting(false);
        interruptTimerRef.current = null;
      }, 3000);
    } else {
      // Second tap within 3s: hard abort
      if (interruptTimerRef.current) {
        clearTimeout(interruptTimerRef.current);
        interruptTimerRef.current = null;
      }
      setIsInterrupting(false);
      abortRef.current?.abort();
      if (qId) {
        fetch("/api/chat/abort", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queryId: qId, graceful: false }),
        }).catch(() => {});
      }
    }
  };

  // Feature C: rewind files to last checkpoint
  // ── Smart retry: reconnect if query exists, resend only if truly gone ──
  const retryLastMessage = async () => {
    if (isStreaming) return;

    const sid = sessionId;
    if (sid) {
      try {
        const statusRes = await fetch(`/api/chat/status?sessionId=${encodeURIComponent(sid)}`);
        if (statusRes.ok) {
          const status = await statusRes.json();
          if (status.queryActive || status.status === "completed" || status.status === "error") {
            // Query still exists — reconnect instead of resend
            setConnectionLost(false);
            setIsStreaming(true);
            streamingRef.current = true;
            setActivityState("thinking");

            // Find the last assistant message to use as reconnect target
            const lastAssistant = [...messages].reverse().find(m => m.role === "assistant");
            if (lastAssistant) {
              assistantIdRef.current = lastAssistant.id;
              await reconnectToQuery(lastAssistant.id);
              setIsStreaming(false);
              streamingRef.current = false;
              assistantIdRef.current = null;
              setActivityState(null);
              return;
            }
          }
        }
      } catch {
        // Status check failed — fall through to resend
      }
    }

    // No query on server — resend
    const lastMsg = lastUserMessageRef.current;
    if (!lastMsg) return;
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

  const handleSettingsChange = (settings: { budgetCapUsd?: number | null; maxTurns?: number | null }) => {
    if (!sessionId) return;
    if (settings.budgetCapUsd !== undefined) setBudgetCapUsd(settings.budgetCapUsd);
    if (settings.maxTurns !== undefined) setMaxTurns(settings.maxTurns);
    fetch("/api/chat/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, ...settings }),
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
            <p className="text-xs text-muted truncate">Code Anvil</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={startNewConversation}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted hover:text-foreground border border-border rounded-md hover:bg-card transition-colors"
            >
              <Plus size={14} />
              New
            </button>
          </div>
        </header>
      )}

      {/* Action bar — visible in embedded mode when session is active */}
      {embedded && sessionId && !isStreaming && (
        <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-b border-border bg-card/50 shrink-0">
          {sessionId && (
            <button
              onClick={startNewConversation}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-muted hover:text-foreground border border-border rounded-md hover:bg-card transition-colors"
            >
              <Plus size={13} />
              New
            </button>
          )}
        </div>
      )}

      {/* Offline banner */}
      {isOffline && (
        <div className="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 text-yellow-500 text-xs shrink-0">
          <WifiOff size={14} />
          Network lost — server keeps working, will reconnect automatically
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted text-sm">
            <p>Start a conversation with Code Anvil</p>
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
                {/* Retry/Reconnect button when connection was lost */}
                {connectionLost && !isStreaming && idx === messages.length - 1 && (
                  <button
                    onClick={retryLastMessage}
                    className="mt-2 px-3 py-1.5 text-xs bg-accent/20 text-accent rounded-lg hover:bg-accent/30 transition-colors"
                  >
                    Reconnect
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Context bar + Status bar + Input area */}
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

        {/* Sticky status bar — always visible during streaming */}
        {isStreaming && (
          <StatusBar
            activityState={activityState}
            connectionState={connectionState}
            isInterrupting={isInterrupting}
          />
        )}

        <ChatSettings
          mode={chatMode}
          onModeChange={handleModeChange}
          sessionId={sessionId}
          sessionCost={sessionCost}
          budgetCapUsd={budgetCapUsd}
          maxTurns={maxTurns}
          onSettingsChange={handleSettingsChange}
          disabled={isStreaming}
        />
        <div className="flex items-end gap-2 px-4 py-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Code Anvil..."
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
              title={isInterrupting ? "Tap again to force stop" : "Stop (tap twice to force)"}
              className={`flex items-center justify-center w-10 h-10 rounded-xl text-white transition-colors shrink-0 ${isInterrupting ? "bg-amber-600 hover:bg-amber-500 active:bg-amber-700" : "bg-red-600 hover:bg-red-500 active:bg-red-700"}`}
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
