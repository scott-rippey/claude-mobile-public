"use client";

import { useState } from "react";
import Link from "next/link";
import { Folder, TerminalSquare, FileText, MessageSquare, ChevronLeft, Home } from "lucide-react";
import { LogoutButton } from "./LogoutButton";
import { FileBrowser } from "./FileBrowser";
import { FileViewer } from "./FileViewer";
import { Terminal } from "./Terminal";
import { ChatInterface } from "./ChatInterface";

type Tab = "browse" | "chat" | "terminal" | "file";

const tabs = [
  { id: "browse" as const, label: "Browse", icon: Folder },
  { id: "chat" as const, label: "Chat", icon: MessageSquare },
  { id: "terminal" as const, label: "Terminal", icon: TerminalSquare },
  { id: "file" as const, label: "File", icon: FileText },
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
          : viewingFile
            ? viewingFile.split("/").pop() || "File"
            : "File";

  return (
    <div className="flex flex-col h-[100dvh]">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-border bg-background/80 backdrop-blur-md px-3 py-2.5 shrink-0">
        {activeTab === "browse" && canGoBack ? (
          <button onClick={handleBack} className="text-accent p-1">
            <ChevronLeft size={20} />
          </button>
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
          <ChatInterface projectPath={projectPath} projectName={projectName} />
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
