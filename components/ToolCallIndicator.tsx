"use client";

import { useState } from "react";
import {
  FileText,
  Pencil,
  Terminal,
  Search,
  FolderSearch,
  ChevronDown,
  ChevronRight,
  Loader2,
  Check,
} from "lucide-react";

interface ToolCallIndicatorProps {
  name: string;
  input: Record<string, unknown>;
  result?: string;
  elapsedSeconds?: number;
}

const TOOL_ICONS: Record<string, typeof FileText> = {
  Read: FileText,
  Edit: Pencil,
  MultiEdit: Pencil,
  Write: Pencil,
  Bash: Terminal,
  Grep: Search,
  Glob: FolderSearch,
};

const MAX_RESULT_LINES = 200;

function getToolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Read":
      return `Reading ${shortPath(input.file_path as string)}`;
    case "Edit":
    case "MultiEdit":
      return `Editing ${shortPath(input.file_path as string)}`;
    case "Write":
      return `Writing ${shortPath(input.file_path as string)}`;
    case "Bash":
      return `Running command`;
    case "Grep":
      return `Searching for "${input.pattern}"`;
    case "Glob":
      return `Finding files "${input.pattern}"`;
    default:
      return name;
  }
}

function shortPath(filepath: string | undefined): string {
  if (!filepath) return "";
  const parts = filepath.split("/");
  return parts.length > 2 ? `.../${parts.slice(-2).join("/")}` : filepath;
}

export function ToolCallIndicator({ name, input, result, elapsedSeconds }: ToolCallIndicatorProps) {
  const [expanded, setExpanded] = useState(false);
  const [showFullResult, setShowFullResult] = useState(false);
  const Icon = TOOL_ICONS[name] || Terminal;
  const label = getToolLabel(name, input);
  const hasResult = result !== undefined;

  const resultLines = result?.split("\n") ?? [];
  const isTruncated = resultLines.length > MAX_RESULT_LINES;
  const displayedResult = showFullResult
    ? result
    : resultLines.slice(0, MAX_RESULT_LINES).join("\n");

  return (
    <div className="my-1.5 rounded-md border border-border bg-card text-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-muted hover:text-foreground transition-colors"
      >
        {hasResult ? (
          <Check size={14} className="shrink-0 text-green-500" />
        ) : (
          <Loader2 size={14} className="shrink-0 animate-spin" />
        )}
        <Icon size={14} className="shrink-0" />
        <span className="truncate flex-1 text-left">{label}</span>
        {expanded ? (
          <ChevronDown size={14} className="shrink-0" />
        ) : (
          <ChevronRight size={14} className="shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-xs text-muted overflow-x-auto">
          <pre className="whitespace-pre-wrap break-all">
            {JSON.stringify(input, null, 2)}
          </pre>
          {hasResult && (
            <>
              <hr className="my-2 border-border" />
              <pre className="whitespace-pre-wrap break-all">{displayedResult}</pre>
              {isTruncated && !showFullResult && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowFullResult(true);
                  }}
                  className="mt-1 text-accent hover:underline text-xs"
                >
                  Show all ({resultLines.length} lines)
                </button>
              )}
            </>
          )}
          {!hasResult && (
            <div className="flex items-center gap-1.5 mt-2 text-muted">
              <Loader2 size={12} className="animate-spin" />
              Running{elapsedSeconds ? ` (${Math.round(elapsedSeconds)}s)` : ""}...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
