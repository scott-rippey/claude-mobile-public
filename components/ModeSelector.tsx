export type ChatMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

const MODES: { value: ChatMode; label: string; warning?: boolean }[] = [
  { value: "default", label: "Default" },
  { value: "acceptEdits", label: "Accept Edits" },
  { value: "plan", label: "Plan" },
  { value: "bypassPermissions", label: "Bypass", warning: true },
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
          onClick={() => {
            if (m.warning && mode !== m.value) {
              if (!confirm("Bypass mode skips ALL permission checks. Are you sure?")) return;
            }
            onChange(m.value);
          }}
          disabled={disabled}
          className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
            mode === m.value
              ? m.warning
                ? "bg-red-600 text-white"
                : "bg-accent text-white"
              : m.warning
                ? "text-red-400/60 hover:text-red-400 hover:bg-red-500/10"
                : "text-muted hover:text-foreground hover:bg-border/50"
          } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
