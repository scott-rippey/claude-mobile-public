"use client";

import { useState } from "react";
import Link from "next/link";
import { Folder, TerminalSquare, FileText, MessageSquare, ChevronLeft, Home, HelpCircle } from "lucide-react";
import { LogoutButton } from "./LogoutButton";
import { FileBrowser } from "./FileBrowser";
import { FileViewer } from "./FileViewer";
import { Terminal } from "./Terminal";
import { ChatInterface } from "./ChatInterface";

type Tab = "browse" | "file" | "chat" | "terminal" | "help";

const tabs = [
  { id: "browse" as const, label: "Browse", icon: Folder },
  { id: "file" as const, label: "File", icon: FileText },
  { id: "chat" as const, label: "Chat", icon: MessageSquare },
  { id: "terminal" as const, label: "Terminal", icon: TerminalSquare },
  { id: "help" as const, label: "Help", icon: HelpCircle },
];

interface ProjectWorkspaceProps {
  projectPath: string;
}

export function ProjectWorkspace({ projectPath }: ProjectWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<Tab>("browse");
  const [browsePath, setBrowsePath] = useState(projectPath);
  const [viewingFile, setViewingFile] = useState<string | null>(null);

  const handleFileSelect = (filePath: string) => {
    setViewingFile(filePath);
    setActiveTab("file");
  };

  const handleNavigate = (dirPath: string) => {
    setBrowsePath(dirPath);
  };

  const projectName = projectPath.split("/").pop() || projectPath;
  const canGoBack = browsePath !== projectPath;

  // Parent directory URL for exiting the workspace (go up one level from project root)
  const projectParts = projectPath.split("/");
  const parentBrowseUrl = projectParts.length > 1
    ? `/browse/${projectParts.slice(0, -1).map(s => encodeURIComponent(s)).join("/")}`
    : "/browse";

  const handleBack = () => {
    const parts = browsePath.split("/");
    parts.pop();
    const parent = parts.join("/");
    // Don't go above the project root
    if (parent.length >= projectPath.length) {
      setBrowsePath(parent);
    } else {
      setBrowsePath(projectPath);
    }
  };

  // Figure out what to show in the header based on active tab
  const headerTitle =
    activeTab === "browse"
      ? browsePath === projectPath
        ? projectName
        : browsePath.split("/").pop() || projectName
      : activeTab === "chat"
        ? `Chat - ${projectName}`
        : activeTab === "terminal"
          ? `Terminal - ${projectName}`
          : activeTab === "help"
            ? "Help"
            : viewingFile
              ? viewingFile.split("/").pop() || "File"
              : "File";

  return (
    <div className="flex flex-col h-[100dvh]">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-border bg-background/80 backdrop-blur-md px-3 py-2.5 shrink-0">
        {activeTab === "browse" ? (
          canGoBack ? (
            <button onClick={handleBack} className="text-accent p-1">
              <ChevronLeft size={20} />
            </button>
          ) : (
            <Link href={parentBrowseUrl} className="text-accent p-1">
              <ChevronLeft size={20} />
            </Link>
          )
        ) : (
          <Link href="/browse" className="text-accent p-1">
            <Home size={18} />
          </Link>
        )}
        <h1 className="text-sm font-medium truncate flex-1">{headerTitle}</h1>
        <LogoutButton />
      </header>

      {/* Content area — all tabs mounted, inactive ones hidden */}
      <div className="flex-1 overflow-hidden relative">
        <div className={`absolute inset-0 overflow-y-auto ${activeTab !== "browse" ? "hidden" : ""}`}>
          <FileBrowser
            path={browsePath}
            onFileSelect={handleFileSelect}
            onNavigate={handleNavigate}
          />
        </div>

        <div className={`absolute inset-0 ${activeTab !== "chat" ? "hidden" : ""}`}>
          <ChatInterface projectPath={projectPath} projectName={projectName} embedded />
        </div>

        <div className={`absolute inset-0 ${activeTab !== "terminal" ? "hidden" : ""}`}>
          <Terminal projectPath={projectPath} />
        </div>

        <div className={`absolute inset-0 overflow-y-auto ${activeTab !== "file" ? "hidden" : ""}`}>
          {viewingFile ? (
            <FileViewer path={viewingFile} />
          ) : (
            <div className="flex items-center justify-center h-full text-muted">
              Select a file from Browse
            </div>
          )}
        </div>

        <div className={`absolute inset-0 overflow-y-auto ${activeTab !== "help" ? "hidden" : ""}`}>
          <div className="px-4 py-5 max-w-lg mx-auto space-y-6 text-sm">
            <section>
              <h2 className="text-base font-semibold text-foreground mb-2">Claude Code Mobile</h2>
              <p className="text-muted leading-relaxed">
                Remote interface to Claude Code running on your local computer. Chat with Claude, browse files, and run terminal commands — all from your phone.
              </p>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-foreground mb-1.5">Chat</h3>
              <p className="text-muted leading-relaxed mb-2">
                Full Claude Code agent with access to your project files, tools, MCP servers, and plugins. It can read/write files, run commands, search code, and more — same as the CLI.
              </p>
              <p className="text-muted leading-relaxed">
                A <span className="text-foreground">context bar</span> appears above the input showing how much of the conversation window is used. When it gets high, use <code className="bg-card px-1.5 py-0.5 rounded border border-border text-xs">/clear</code> to start fresh.
              </p>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-foreground mb-1.5">Terminal</h3>
              <p className="text-muted leading-relaxed">
                Run shell commands directly on your local computer. Useful for git operations, running builds, checking logs, or anything you&apos;d do in a terminal. Commands run in your project directory.
              </p>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-foreground mb-1.5">Browse &amp; File</h3>
              <p className="text-muted leading-relaxed">
                Navigate your project&apos;s file tree and view file contents with syntax highlighting. Tap a file in Browse to open it in the File tab.
              </p>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-foreground mb-2">Commands</h3>

              <div className="space-y-3">
                <div>
                  <h4 className="text-xs font-semibold text-foreground/70 uppercase tracking-wider mb-1">Built-in</h4>
                  <div className="bg-card rounded-lg border border-border divide-y divide-border">
                    {[
                      ["/clear", "Clear conversation, start fresh session"],
                      ["/help", "List all available commands"],
                      ["/context", "Context usage, loaded CLAUDE.md, MCP, tools"],
                      ["/model [name]", "Show or change the AI model"],
                      ["/mcp", "MCP server connection status"],
                      ["/status", "Full session overview"],
                      ["/compact", "Compact conversation (passes to SDK)"],
                    ].map(([cmd, desc]) => (
                      <div key={cmd} className="flex gap-3 px-3 py-2">
                        <code className="text-accent text-xs font-mono whitespace-nowrap">{cmd}</code>
                        <span className="text-muted text-xs">{desc}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-foreground/70 uppercase tracking-wider mb-1">Custom Commands</h4>
                  <p className="text-muted text-xs leading-relaxed">
                    Any <code className="bg-card px-1 py-0.5 rounded border border-border">.md</code> files in your project&apos;s <code className="bg-card px-1 py-0.5 rounded border border-border">.claude/commands/</code> or <code className="bg-card px-1 py-0.5 rounded border border-border">~/.claude/commands/</code> folder work as slash commands. They get expanded and sent to Claude as instructions. Use <code className="bg-card px-1 py-0.5 rounded border border-border">/help</code> in chat to see all discovered commands.
                  </p>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-foreground/70 uppercase tracking-wider mb-1">SDK Skills</h4>
                  <p className="text-muted text-xs leading-relaxed">
                    Skills like <code className="bg-card px-1 py-0.5 rounded border border-border">/commit</code>, <code className="bg-card px-1 py-0.5 rounded border border-border">/review-pr</code>, etc. are handled by the Claude Code SDK directly. These pass through to Claude and work the same as in the CLI.
                  </p>
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-foreground mb-1.5">Good to Know</h3>
              <ul className="text-muted text-xs leading-relaxed space-y-1.5 list-disc list-inside">
                <li>Sessions persist — close the app and come back, your conversation continues</li>
                <li>The SDK loads your project&apos;s CLAUDE.md, MCP servers, and plugins automatically</li>
                <li>Running in <span className="text-foreground">bypass permissions</span> mode — Claude won&apos;t ask before editing files or running commands</li>
                <li>Context compaction happens automatically when the conversation gets long</li>
                <li>Server state (model changes, cost tracking) resets when cc-server restarts</li>
              </ul>
            </section>
          </div>
        </div>
      </div>

      {/* Bottom tab bar */}
      <nav className="flex border-t border-border bg-card shrink-0">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors ${
                isActive
                  ? "text-accent"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <Icon size={20} />
              <span className="text-xs">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
