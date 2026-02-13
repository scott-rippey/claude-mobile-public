"use client";

import { useEffect, useRef, useState } from "react";
import {
  Folder,
  FolderPlus,
  FileText,
  FileCode,
  ChevronRight,
  MessageSquare,
  Loader2,
  Check,
  X,
} from "lucide-react";
import Link from "next/link";

interface FileEntry {
  name: string;
  type: "file" | "directory";
  size: number;
  modified: string;
}

interface FileBrowserProps {
  path: string;
  onFileSelect?: (filePath: string) => void;
  onNavigate?: (dirPath: string) => void;
}

const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "json", "css", "scss", "html", "py",
  "rs", "go", "sh", "sql", "graphql", "toml", "yaml", "yml",
]);

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (CODE_EXTENSIONS.has(ext)) return FileCode;
  return FileText;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileBrowser({ path, onFileSelect, onNavigate }: FileBrowserProps) {
  const isEmbedded = !!(onFileSelect || onNavigate);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [mkdirError, setMkdirError] = useState<string | null>(null);
  const [mkdirLoading, setMkdirLoading] = useState(false);
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  const fetchEntries = (cancelled = false) => {
    fetch(`/api/files?path=${encodeURIComponent(path)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.error);
          setEntries([]);
        } else {
          setError(null);
          setEntries(data.entries);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load directory");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
  };

  useEffect(() => {
    let cancelled = false;
    fetchEntries(cancelled);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    if (creatingFolder) {
      newFolderInputRef.current?.focus();
    }
  }, [creatingFolder]);

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setMkdirError(null);
    setMkdirLoading(true);
    try {
      const res = await fetch("/api/files/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMkdirError(data.error || "Failed to create folder");
        return;
      }
      setCreatingFolder(false);
      setNewFolderName("");
      setMkdirError(null);
      fetchEntries();
    } catch {
      setMkdirError("Failed to connect to server");
    } finally {
      setMkdirLoading(false);
    }
  };

  const cancelCreateFolder = () => {
    setCreatingFolder(false);
    setNewFolderName("");
    setMkdirError(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-muted" size={24} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20 text-red-400">
        {error}
      </div>
    );
  }

  // Check if this looks like a project directory (has package.json, Cargo.toml, etc.)
  const isProject = entries.some((e) =>
    ["package.json", "Cargo.toml", "pyproject.toml", "go.mod", ".git"].includes(
      e.name
    )
  );

  return (
    <div>
      {isProject && !isEmbedded && (
        <Link
          href={`/project/${encodeURIComponent(path)}`}
          className="flex items-center gap-3 px-4 py-3 mb-2 bg-accent/10 border border-accent/30 rounded-lg text-accent hover:bg-accent/20 transition-colors"
        >
          <MessageSquare size={20} />
          <span className="font-medium">Open Project Workspace</span>
          <ChevronRight size={16} className="ml-auto" />
        </Link>
      )}

      {!isEmbedded && !creatingFolder && (
        <button
          onClick={() => setCreatingFolder(true)}
          className="flex items-center gap-2 px-4 py-2.5 mb-2 text-sm text-muted hover:text-foreground hover:bg-card rounded-lg transition-colors"
        >
          <FolderPlus size={18} />
          <span>New Folder</span>
        </button>
      )}

      <div className="divide-y divide-border">
        {creatingFolder && (
          <div className="px-4 py-3">
            <div className="flex items-center gap-2">
              <Folder size={20} className="text-accent shrink-0" />
              <input
                ref={newFolderInputRef}
                type="text"
                value={newFolderName}
                onChange={(e) => { setNewFolderName(e.target.value); setMkdirError(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateFolder();
                  if (e.key === "Escape") cancelCreateFolder();
                }}
                placeholder="Folder name"
                disabled={mkdirLoading}
                className="flex-1 min-w-0 bg-background border border-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
              />
              <button
                onClick={handleCreateFolder}
                disabled={mkdirLoading || !newFolderName.trim()}
                className="p-1.5 text-green-400 hover:bg-green-400/10 rounded disabled:opacity-40"
              >
                {mkdirLoading ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
              </button>
              <button
                onClick={cancelCreateFolder}
                disabled={mkdirLoading}
                className="p-1.5 text-red-400 hover:bg-red-400/10 rounded disabled:opacity-40"
              >
                <X size={18} />
              </button>
            </div>
            {mkdirError && (
              <div className="text-xs text-red-400 mt-1.5 ml-7">{mkdirError}</div>
            )}
          </div>
        )}
        {entries.map((entry) => {
          const Icon =
            entry.type === "directory" ? Folder : getFileIcon(entry.name);
          const entryPath = path ? path + "/" + entry.name : entry.name;

          if (isEmbedded) {
            const handleClick = () => {
              if (entry.type === "directory") {
                onNavigate?.(entryPath);
              } else {
                onFileSelect?.(entryPath);
              }
            };

            return (
              <button
                key={entry.name}
                onClick={handleClick}
                className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-card active:bg-card/80 transition-colors text-left"
              >
                <Icon
                  size={20}
                  className={
                    entry.type === "directory" ? "text-accent" : "text-muted"
                  }
                />
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{entry.name}</div>
                  {entry.type === "file" && (
                    <div className="text-xs text-muted">
                      {formatSize(entry.size)}
                    </div>
                  )}
                </div>
                <ChevronRight size={16} className="text-muted shrink-0" />
              </button>
            );
          }

          const href =
            entry.type === "directory"
              ? `/browse/${entryPath}`
              : `/browse/${entryPath}?view=true`;

          return (
            <Link
              key={entry.name}
              href={href}
              className="flex items-center gap-3 px-4 py-3.5 hover:bg-card active:bg-card/80 transition-colors"
            >
              <Icon
                size={20}
                className={
                  entry.type === "directory" ? "text-accent" : "text-muted"
                }
              />
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{entry.name}</div>
                {entry.type === "file" && (
                  <div className="text-xs text-muted">
                    {formatSize(entry.size)}
                  </div>
                )}
              </div>
              <ChevronRight size={16} className="text-muted shrink-0" />
            </Link>
          );
        })}
      </div>

      {entries.length === 0 && (
        <div className="text-center py-20 text-muted">Empty directory</div>
      )}
    </div>
  );
}
