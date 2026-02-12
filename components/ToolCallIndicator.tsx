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
} from "lucide-react";

interface ToolCallIndicatorProps {
  name: string;
  input: Record<string, unknown>;
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

export function ToolCallIndicator({ name, input }: ToolCallIndicatorProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_ICONS[name] || Terminal;
  const label = getToolLabel(name, input);

  return (
    <div className="my-1.5 rounded-md border border-border bg-card text-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-muted hover:text-foreground transition-colors"
      >
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
        </div>
      )}
    </div>
  );
}
