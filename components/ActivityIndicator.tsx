import { Loader2 } from "lucide-react";

export type ActivityState = "thinking" | "tool-starting" | null;

const LABELS: Record<NonNullable<ActivityState>, string> = {
  "thinking": "Thinking...",
  "tool-starting": "Preparing tool call...",
};

export function ActivityIndicator({ state }: { state: NonNullable<ActivityState> }) {
  return (
    <div className="flex items-center gap-2 text-muted text-sm py-2">
      <Loader2 className="animate-spin" size={14} />
      {LABELS[state]}
    </div>
  );
}
