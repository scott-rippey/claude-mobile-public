export type ChatMode = "default" | "auto" | "plan";

const MODES: { value: ChatMode; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "auto", label: "Auto" },
  { value: "plan", label: "Plan" },
];

export function ModeSelector({
  mode,
  onChange,
  disabled,
}: {
  mode: ChatMode;
  onChange: (mode: ChatMode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex bg-card border border-border rounded-lg p-0.5 gap-0.5">
      {MODES.map((m) => (
        <button
          key={m.value}
          onClick={() => onChange(m.value)}
          disabled={disabled}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
            mode === m.value
              ? "bg-accent text-white"
              : "text-muted hover:text-foreground hover:bg-border/50"
          } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
