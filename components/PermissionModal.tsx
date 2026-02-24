"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

function stringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatToolDisplay(toolName: string, input: Record<string, unknown>) {
  // Show the most relevant input for common tools
  if (toolName === "Bash" || toolName === "bash") {
    return { label: "Run command", detail: stringify(input.command || input.cmd || "") };
  }
  if (toolName === "Edit" || toolName === "edit") {
    return { label: "Edit file", detail: stringify(input.file_path || input.path || "") };
  }
  if (toolName === "Write" || toolName === "write") {
    return { label: "Write file", detail: stringify(input.file_path || input.path || "") };
  }
  if (toolName === "Read" || toolName === "read") {
    return { label: "Read file", detail: stringify(input.file_path || input.path || "") };
  }
  if (toolName === "MultiEdit" || toolName === "multiedit") {
    return { label: "Edit multiple files", detail: stringify(input.file_path || input.path || "") };
  }
  // Generic fallback — JSON-stringify objects instead of [object Object]
  // No truncation: detail area is scrollable, and tools like ExitPlanMode
  // need full plan text visible for user review
  const firstValue = Object.values(input)[0];
  return { label: toolName, detail: stringify(firstValue) };
}

function getToolIcon(toolName: string) {
  const lower = toolName.toLowerCase();
  if (lower === "bash") return <Terminal size={18} />;
  if (lower === "edit" || lower === "write" || lower === "multiedit") return <FileEdit size={18} />;
  return <Shield size={18} />;
}

function PermissionModalContent({ request, onAllow, onDeny }: PermissionModalProps) {
  const { label, detail } = formatToolDisplay(request.toolName, request.input);
  const detailRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [debugInfo, setDebugInfo] = useState("");

  useEffect(() => {
    const el = detailRef.current;
    const card = cardRef.current;
    if (el) {
      const cardH = card ? card.clientHeight : 0;
      const cs = window.getComputedStyle(el);
      setDebugInfo(
        `scroll:${el.scrollHeight} client:${el.clientHeight} overflow:${el.scrollHeight > el.clientHeight} chars:${detail?.length ?? 0} cardH:${cardH} overflowY:${cs.overflowY} maxH:${cs.maxHeight} keys:[${Object.keys(request.input).join(",")}]`
      );
    }
  }, [detail, request.input]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60">
      <div
        className="w-full max-w-lg bg-card border border-border rounded-t-2xl sm:rounded-2xl p-5 pb-8 sm:pb-5 mx-0 sm:mx-4 animate-in slide-in-from-bottom duration-200"
        ref={cardRef}
        style={{ maxHeight: "85vh", display: "flex", flexDirection: "column" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-4" style={{ flexShrink: 0 }}>
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

        {/* Debug info — TEMPORARY */}
        {debugInfo && (
          <div className="text-[10px] text-yellow-500 font-mono mb-2 shrink-0">{debugInfo}</div>
        )}

        {/* Detail — scrollable, flex-shrinks to fit between header and buttons */}
        {detail && (
          <div
            ref={detailRef}
            className="bg-[#0a0a0a] border border-border rounded-lg px-3 py-2.5 mb-5"
            style={{ minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" } as React.CSSProperties}
          >
            <code className="text-xs text-foreground/80 whitespace-pre-wrap break-words block">{detail}</code>
          </div>
        )}

        {/* Action buttons — large tap targets for mobile */}
        <div className="flex gap-3" style={{ flexShrink: 0 }}>
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

/**
 * Portal wrapper — renders modal at document.body level to escape
 * ancestor overflow:hidden containers that can break iOS Safari touch scrolling.
 */
export function PermissionModal(props: PermissionModalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;
  return createPortal(<PermissionModalContent {...props} />, document.body);
}
