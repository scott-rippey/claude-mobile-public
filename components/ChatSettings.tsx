"use client";

import { useState, useCallback } from "react";
import { Settings, ChevronUp } from "lucide-react";
import { ModeSelector, type ChatMode } from "./ModeSelector";

interface ChatSettingsProps {
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  sessionId: string | null;
  sessionCost: number;
  budgetCapUsd: number | null;
  maxTurns: number | null;
  onSettingsChange: (settings: { budgetCapUsd?: number | null; maxTurns?: number | null }) => void;
  disabled?: boolean;
}

const BUDGET_PRESETS = [
  { label: "$1", value: 1 },
  { label: "$5", value: 5 },
  { label: "$25", value: 25 },
  { label: "None", value: null },
];

const TURN_PRESETS = [
  { label: "5", value: 5 },
  { label: "10", value: 10 },
  { label: "25", value: 25 },
  { label: "Auto", value: null },
];

export function ChatSettings({
  mode,
  onModeChange,
  sessionId,
  sessionCost,
  budgetCapUsd,
  maxTurns,
  onSettingsChange,
  disabled,
}: ChatSettingsProps) {
  const [expanded, setExpanded] = useState(false);

  const handleBudgetChange = useCallback(
    (value: number | null) => {
      onSettingsChange({ budgetCapUsd: value });
    },
    [onSettingsChange]
  );

  const handleTurnsChange = useCallback(
    (value: number | null) => {
      onSettingsChange({ maxTurns: value });
    },
    [onSettingsChange]
  );

  return (
    <div className="border-b border-border">
      {/* Collapsed row: mode selector + cost + expand toggle */}
      <div className="flex items-center justify-between px-4 py-2">
        <ModeSelector mode={mode} onChange={onModeChange} disabled={disabled} />
        <div className="flex items-center gap-2">
          {sessionCost > 0 && (
            <span className="text-[11px] text-muted tabular-nums">
              ${sessionCost.toFixed(4)}
              {budgetCapUsd ? ` / $${budgetCapUsd}` : ""}
            </span>
          )}
          <button
            onClick={() => setExpanded((prev) => !prev)}
            className="p-1 text-muted hover:text-foreground transition-colors"
            title="Session settings"
          >
            {expanded ? <ChevronUp size={14} /> : <Settings size={14} />}
          </button>
        </div>
      </div>

      {/* Expanded: budget + turn limits */}
      {expanded && (
        <div className="px-4 pb-3 space-y-3 animate-in slide-in-from-top-2 duration-150">
          {/* Budget cap */}
          <div>
            <label className="text-[11px] text-muted block mb-1">Budget cap</label>
            <div className="flex gap-1">
              {BUDGET_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => handleBudgetChange(preset.value)}
                  disabled={!sessionId}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    budgetCapUsd === preset.value ||
                    (preset.value === null && budgetCapUsd === null)
                      ? "bg-accent text-white"
                      : "bg-card border border-border text-muted hover:text-foreground"
                  } ${!sessionId ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Turn limit */}
          <div>
            <label className="text-[11px] text-muted block mb-1">Turn limit</label>
            <div className="flex gap-1">
              {TURN_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => handleTurnsChange(preset.value)}
                  disabled={!sessionId}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    maxTurns === preset.value ||
                    (preset.value === null && maxTurns === null)
                      ? "bg-accent text-white"
                      : "bg-card border border-border text-muted hover:text-foreground"
                  } ${!sessionId ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
