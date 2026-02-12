"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { StreamingMessage } from "./StreamingMessage";
import { CodeBlock } from "./CodeBlock";

interface FileViewerProps {
  path: string;
}

export function FileViewer({ path }: FileViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [language, setLanguage] = useState("text");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/file?path=${encodeURIComponent(path)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setContent(data.content);
          setLanguage(data.language);
        }
      })
      .catch(() => setError("Failed to load file"))
      .finally(() => setLoading(false));
  }, [path]);

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

  if (content === null) return null;

  // Render markdown files with markdown renderer
  if (language === "markdown") {
    return (
      <div className="px-4 py-4">
        <StreamingMessage content={content} />
      </div>
    );
  }

  // Render code files with syntax highlighting
  return (
    <div className="px-2 py-2">
      <CodeBlock code={content} language={language} />
    </div>
  );
}
