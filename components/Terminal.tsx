"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Square, Loader2, Send } from "lucide-react";

interface TerminalEntry {
  id: number;
  command: string;
  output: string;
  exitCode: number | null;
  running: boolean;
  commandId?: string;  // Server-assigned ID for reconnection
  lastEventIndex: number;  // Last received event index
}

interface TerminalProps {
  projectPath: string;
}

export function Terminal({ projectPath }: TerminalProps) {
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [input, setInput] = useState("");
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [commandHistory, setCommandHistory] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(`cc-terminal-history-${projectPath}`);
        return saved ? JSON.parse(saved) : [];
      } catch {
        return [];
      }
    }
    return [];
  });
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const runningRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const runningEntryRef = useRef<{ id: number; commandId: string | null; lastEventIndex: number } | null>(null);

  const isRunning = entries.some((e) => e.running);

  // Persist command history to localStorage (cap at 100 entries)
  useEffect(() => {
    try {
      const capped = commandHistory.slice(-100);
      localStorage.setItem(`cc-terminal-history-${projectPath}`, JSON.stringify(capped));
    } catch {
      // QuotaExceeded — non-critical
    }
  }, [commandHistory, projectPath]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [entries, scrollToBottom]);

  const markDone = useCallback((id: number, output: string, exitCode: number) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;
        const finalOutput = e.output + output;
        return {
          ...e,
          output: finalOutput || (exitCode !== 0 ? "[command failed]" : "[no output]"),
          running: false,
          exitCode,
        };
      })
    );
  }, []);

  // ── Reconnect to a running terminal command ─────────────────────
  const reconnectToCommand = useCallback(async (entryId: number, commandId: string, fromIndex: number) => {
    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const res = await fetch("/api/terminal/reconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandId, fromIndex }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));

            // Track index
            if (typeof event.index === "number") {
              // Skip already-seen events
              if (event.index <= fromIndex) continue;
              if (runningEntryRef.current) {
                runningEntryRef.current.lastEventIndex = event.index;
              }
              setEntries((prev) =>
                prev.map((e) =>
                  e.id === entryId ? { ...e, lastEventIndex: event.index } : e
                )
              );
            }

            if (event.type === "stdout" || event.type === "stderr") {
              setEntries((prev) =>
                prev.map((e) =>
                  e.id === entryId ? { ...e, output: e.output + event.data } : e
                )
              );
            } else if (event.type === "exit") {
              setEntries((prev) =>
                prev.map((e) =>
                  e.id === entryId
                    ? { ...e, running: false, exitCode: event.data.code }
                    : e
                )
              );
            } else if (event.type === "reconnect_complete") {
              // Command finished before we reconnected
              if (event.data?.exitCode !== undefined) {
                setEntries((prev) =>
                  prev.map((e) =>
                    e.id === entryId
                      ? { ...e, running: false, exitCode: event.data.exitCode }
                      : e
                  )
                );
              }
            } else if (event.type === "buffer_gap") {
              setEntries((prev) =>
                prev.map((e) =>
                  e.id === entryId
                    ? { ...e, output: e.output + "\n[some output lost during reconnection]\n" }
                    : e
                )
              );
            } else if (event.type === "error") {
              markDone(entryId, event.data.error || event.data.message, 1);
            }
          } catch {
            // skip malformed
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User abort during reconnect
      }
    } finally {
      abortRef.current = null;
      runningRef.current = false;
      runningEntryRef.current = null;
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    }
  }, [markDone]);

  // ── Visibility handler — reconnect instead of abort ───────────────
  useEffect(() => {
    const handleVisibility = async () => {
      if (document.visibilityState !== "visible" || !runningRef.current) return;

      const entry = runningEntryRef.current;
      if (!entry?.commandId) return;

      // Check server status
      try {
        const statusRes = await fetch(`/api/terminal/status?commandId=${encodeURIComponent(entry.commandId)}`);
        if (!statusRes.ok) return;

        const status = await statusRes.json();

        if (status.active || status.status === "completed") {
          // Command still exists — abort stale connection and reconnect
          abortRef.current?.abort();
          await reconnectToCommand(entry.id, entry.commandId, entry.lastEventIndex);

          if (!status.active) {
            // Command finished
            runningRef.current = false;
            runningEntryRef.current = null;
          }
        } else {
          // Command gone from server
          markDone(entry.id, "\n[command lost — server restarted?]", 1);
          runningRef.current = false;
          runningEntryRef.current = null;
        }
      } catch {
        // Status check failed
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [reconnectToCommand, markDone]);

  const killProcess = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const executeCommand = useCallback(
    async (command: string) => {
      const id = nextId.current++;

      setEntries((prev) => [
        ...prev,
        { id, command, output: "", exitCode: null, running: true, lastEventIndex: -1 },
      ]);
      setCommandHistory((prev) => [...prev, command]);
      setHistoryIndex(-1);
      runningRef.current = true;

      // Request wake lock
      try {
        if ("wakeLock" in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
        }
      } catch {
        // Non-critical
      }

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/terminal/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command, projectPath }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const rawBody = await res.text();
          let errorMsg = `HTTP ${res.status}`;
          try {
            const data = JSON.parse(rawBody);
            errorMsg = data.error || errorMsg;
          } catch {
            errorMsg = rawBody || errorMsg;
          }
          markDone(id, errorMsg, 1);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          markDone(id, "No response body", 1);
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let gotExit = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6));

              // Track event index and commandId
              if (typeof event.index === "number") {
                runningEntryRef.current = {
                  ...runningEntryRef.current!,
                  lastEventIndex: event.index,
                };
                setEntries((prev) =>
                  prev.map((e) =>
                    e.id === id ? { ...e, lastEventIndex: event.index } : e
                  )
                );
              }

              if (event.type === "command_start") {
                const commandId = event.data.commandId as string;
                runningEntryRef.current = { id, commandId, lastEventIndex: event.index ?? -1 };
                setEntries((prev) =>
                  prev.map((e) =>
                    e.id === id ? { ...e, commandId } : e
                  )
                );
              } else if (event.type === "stdout" || event.type === "stderr") {
                setEntries((prev) =>
                  prev.map((e) =>
                    e.id === id ? { ...e, output: e.output + event.data } : e
                  )
                );
              } else if (event.type === "exit") {
                gotExit = true;
                setEntries((prev) =>
                  prev.map((e) =>
                    e.id === id
                      ? { ...e, running: false, exitCode: event.data.code }
                      : e
                  )
                );
              } else if (event.type === "error") {
                gotExit = true;
                markDone(id, event.data.error || event.data.message, 1);
              }
            } catch {
              // skip malformed SSE lines
            }
          }
        }

        if (!gotExit) {
          // Connection ended without exit — command may still be running on server
          // Check status and potentially reconnect
          const entry = runningEntryRef.current;
          if (entry?.commandId) {
            try {
              const statusRes = await fetch(`/api/terminal/status?commandId=${encodeURIComponent(entry.commandId)}`);
              if (statusRes.ok) {
                const status = await statusRes.json();
                if (status.active) {
                  // Still running — reconnect
                  await reconnectToCommand(id, entry.commandId, entry.lastEventIndex);
                  return;
                } else if (status.status === "completed") {
                  // Finished — replay remaining events
                  await reconnectToCommand(id, entry.commandId, entry.lastEventIndex);
                  return;
                }
              }
            } catch {
              // Fall through
            }
          }
          markDone(id, "", 1);
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // Try to reconnect if command is still running on server
          const entry = runningEntryRef.current;
          if (entry?.commandId) {
            try {
              const statusRes = await fetch(`/api/terminal/status?commandId=${encodeURIComponent(entry.commandId)}`);
              if (statusRes.ok) {
                const status = await statusRes.json();
                if (status.active || status.status === "completed") {
                  await reconnectToCommand(id, entry.commandId, entry.lastEventIndex);
                  return;
                }
              }
            } catch {
              // Fall through to abort indication
            }
          }
          markDone(id, "\n[stopped]", 130);
        } else {
          const msg = err instanceof Error ? err.message : "Connection error";
          markDone(id, msg, 1);
        }
      }

      abortRef.current = null;
      runningRef.current = false;
      runningEntryRef.current = null;
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    },
    [projectPath, markDone, reconnectToCommand]
  );

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isRunning) return;
    setInput("");
    executeCommand(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      const newIndex =
        historyIndex === -1
          ? commandHistory.length - 1
          : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIndex);
      setInput(commandHistory[newIndex]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex === -1) return;
      const newIndex = historyIndex + 1;
      if (newIndex >= commandHistory.length) {
        setHistoryIndex(-1);
        setInput("");
      } else {
        setHistoryIndex(newIndex);
        setInput(commandHistory[newIndex]);
      }
    }
  };

  return (
    <div
      className="flex flex-col h-full font-mono text-sm"
      onClick={() => inputRef.current?.focus()}
    >
      {/* Output area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {entries.length === 0 && (
          <div className="text-muted text-center py-8">
            Run commands in {projectPath}
          </div>
        )}
        {entries.map((entry) => (
          <div key={entry.id}>
            <div className="flex items-center gap-2 text-accent">
              <span className="text-muted">$</span>
              <span>{entry.command}</span>
              {entry.running && (
                <Loader2 size={14} className="animate-spin text-muted" />
              )}
            </div>
            {entry.output && (
              <pre className="whitespace-pre-wrap break-all text-foreground/90 mt-1">
                {entry.output}
              </pre>
            )}
            {!entry.running && entry.exitCode !== null && entry.exitCode !== 0 && (
              <div className="text-red-400 text-xs mt-1">
                exit {entry.exitCode}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-border px-3 py-2 bg-card"
      >
        <span className="text-muted">$</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setHistoryIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          placeholder={isRunning ? "Running..." : "command"}
          disabled={isRunning}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="send"
          className="flex-1 bg-transparent outline-none placeholder:text-muted/50 disabled:opacity-50"
        />
        {isRunning ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              killProcess();
            }}
            className="p-1.5 text-red-400 hover:text-red-300"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="p-1.5 text-accent disabled:text-muted/30"
          >
            <Send size={16} />
          </button>
        )}
      </form>
    </div>
  );
}
