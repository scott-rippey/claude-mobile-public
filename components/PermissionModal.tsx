"use client";

import { Shield, Terminal, FileEdit, X } from "lucide-react";

interface PermissionRequest {
  requestId: string;
  queryId: string;
  toolName: string;
  input: Record<string, unknown>;
  decisionReason?: string;
}

interface PermissionModalProps {
  request: PermissionRequest;
  onAllow: (requestId: string) => void;
  onDeny: (requestId: string) => void;
}

function formatToolDisplay(toolName: string, input: Record<string, unknown>) {
  // Show the most relevant input for common tools
  if (toolName === "Bash" || toolName === "bash") {
    return { label: "Run command", detail: String(input.command || input.cmd || "") };
  }
  if (toolName === "Edit" || toolName === "edit") {
    return { label: "Edit file", detail: String(input.file_path || input.path || "") };
  }
  if (toolName === "Write" || toolName === "write") {
    return { label: "Write file", detail: String(input.file_path || input.path || "") };
  }
  if (toolName === "Read" || toolName === "read") {
    return { label: "Read file", detail: String(input.file_path || input.path || "") };
  }
  if (toolName === "MultiEdit" || toolName === "multiedit") {
    return { label: "Edit multiple files", detail: String(input.file_path || input.path || "") };
  }
  // Generic fallback
  const firstValue = Object.values(input)[0];
  return { label: toolName, detail: firstValue ? String(firstValue).slice(0, 200) : "" };
}

function getToolIcon(toolName: string) {
  const lower = toolName.toLowerCase();
  if (lower === "bash") return <Terminal size={18} />;
  if (lower === "edit" || lower === "write" || lower === "multiedit") return <FileEdit size={18} />;
  return <Shield size={18} />;
}

export function PermissionModal({ request, onAllow, onDeny }: PermissionModalProps) {
  const { label, detail } = formatToolDisplay(request.toolName, request.input);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60">
      <div className="w-full max-w-lg bg-card border border-border rounded-t-2xl sm:rounded-2xl p-5 pb-8 sm:pb-5 mx-0 sm:mx-4 animate-in slide-in-from-bottom duration-200">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-yellow-500/15 text-yellow-500">
            {getToolIcon(request.toolName)}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{label}</h3>
            {request.decisionReason && (
              <p className="text-xs text-muted truncate">{request.decisionReason}</p>
            )}
          </div>
          <button
            onClick={() => onDeny(request.requestId)}
            className="p-1.5 text-muted hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Detail */}
        {detail && (
          <div className="bg-[#0a0a0a] border border-border rounded-lg px-3 py-2.5 mb-5 overflow-x-auto">
            <code className="text-xs text-foreground/80 whitespace-pre-wrap break-all">{detail}</code>
          </div>
        )}

        {/* Action buttons — large tap targets for mobile */}
        <div className="flex gap-3">
          <button
            onClick={() => onDeny(request.requestId)}
            className="flex-1 py-3.5 text-sm font-medium text-muted border border-border rounded-xl hover:bg-card hover:text-foreground active:bg-border transition-colors"
          >
            Deny
          </button>
          <button
            onClick={() => onAllow(request.requestId)}
            className="flex-1 py-3.5 text-sm font-medium text-white bg-green-600 rounded-xl hover:bg-green-500 active:bg-green-700 transition-colors"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
