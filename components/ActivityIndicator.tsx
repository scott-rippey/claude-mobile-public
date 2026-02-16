import { Loader2 } from "lucide-react";

export type ActivityState =
  | "thinking"
  | "tool-starting"
  | { type: "tool-running"; toolName: string; description?: string }
  | { type: "agent-working"; description: string }
  | null;

function getLabel(state: NonNullable<ActivityState>): string {
  if (state === "thinking") return "Thinking...";
  if (state === "tool-starting") return "Preparing tool call...";
  if (typeof state === "object") {
    if (state.type === "tool-running") {
      if (state.description) {
        return `${state.toolName}: ${state.description}`;
      }
      return `Running ${state.toolName}...`;
    }
    if (state.type === "agent-working") {
      return `Agent: ${state.description}`;
    }
  }
  return "Working...";
}

export function ActivityIndicator({ state }: { state: NonNullable<ActivityState> }) {
  return (
    <div className="flex items-center gap-2 text-muted text-sm py-2">
      <Loader2 className="animate-spin" size={14} />
      {getLabel(state)}
    </div>
  );
}
