"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Square, Loader2, Send } from "lucide-react";

interface TerminalEntry {
  id: number;
  command: string;
  output: string;
  exitCode: number | null;
  running: boolean;
}

interface TerminalProps {
  projectPath: string;
}

export function Terminal({ projectPath }: TerminalProps) {
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [input, setInput] = useState("");
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);

  const isRunning = entries.some((e) => e.running);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [entries, scrollToBottom]);

  const killProcess = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const executeCommand = useCallback(
    async (command: string) => {
      const id = nextId.current++;

      setEntries((prev) => [
        ...prev,
        { id, command, output: "", exitCode: null, running: true },
      ]);
      setCommandHistory((prev) => [...prev, command]);
      setHistoryIndex(-1);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/terminal/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command, projectPath }),
          signal: controller.signal,
        });

        const rawText = await res.text();
        let output: string;
        let exitCode: number;

        try {
          const data = JSON.parse(rawText);
          output = data.output ?? "";
          exitCode = data.exitCode ?? 1;
        } catch {
          output = rawText || `HTTP ${res.status}`;
          exitCode = 1;
        }

        setEntries((prev) =>
          prev.map((e) =>
            e.id === id
              ? {
                  ...e,
                  output: output || (exitCode !== 0 ? "[command failed]" : "[no output]"),
                  running: false,
                  exitCode,
                }
              : e
          )
        );
      } catch (err: unknown) {
        let msg: string;
        if (err instanceof DOMException && err.name === "AbortError") {
          msg = "[killed]";
        } else {
          msg = err instanceof Error ? err.message : "Connection error";
        }
        setEntries((prev) =>
          prev.map((e) =>
            e.id === id
              ? { ...e, output: msg, running: false, exitCode: 130 }
              : e
          )
        );
      }

      abortRef.current = null;
    },
    [projectPath]
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
