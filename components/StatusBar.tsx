"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import type { ActivityState } from "./ActivityIndicator";

export type ConnectionState = "connected" | "reconnecting" | "disconnected" | "stale";

function getActivityLabel(state: ActivityState): string {
  if (!state) return "Working...";
  if (state === "thinking") return "Thinking...";
  if (state === "tool-starting") return "Preparing tool call...";
  if (typeof state === "object") {
    if (state.type === "tool-running") {
      if (state.description) return `${state.toolName}: ${state.description}`;
      return `Running ${state.toolName}...`;
    }
    if (state.type === "agent-working") {
      return `Agent: ${state.description}`;
    }
  }
  return "Working...";
}

function ConnectionDot({ state }: { state: ConnectionState }) {
  switch (state) {
    case "connected":
      return <span className="relative flex h-2 w-2 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
      </span>;
    case "reconnecting":
      return <Loader2 size={10} className="animate-spin text-blue-400 shrink-0" />;
    case "stale":
      return <span className="relative flex h-2 w-2 shrink-0">
        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
      </span>;
    case "disconnected":
      return <span className="relative flex h-2 w-2 shrink-0">
        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
      </span>;
  }
}

function getConnectionLabel(state: ConnectionState): string | null {
  switch (state) {
    case "reconnecting": return "Reconnecting...";
    case "stale": return "No response in 20s...";
    case "disconnected": return "Connection lost";
    default: return null;
  }
}

interface StatusBarProps {
  activityState: ActivityState;
  connectionState: ConnectionState;
  isInterrupting?: boolean;
}

export function StatusBar({ activityState, connectionState, isInterrupting = false }: StatusBarProps) {
  // Elapsed time counter
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [activityState]);

  const connectionLabel = getConnectionLabel(connectionState);
  const activityLabel = isInterrupting ? "Interrupting..." : getActivityLabel(activityState);
  const elapsedStr = elapsed > 0 ? ` (${elapsed}s)` : "";

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 text-xs">
      <ConnectionDot state={connectionState} />
      <span className={`truncate ${connectionState === "disconnected" ? "text-red-400" : connectionState === "reconnecting" ? "text-blue-400" : connectionState === "stale" ? "text-amber-400" : isInterrupting ? "text-amber-400" : "text-muted"}`}>
        {connectionLabel || activityLabel}{elapsedStr}
      </span>
    </div>
  );
}
