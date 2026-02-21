export interface FileEntry {
  name: string;
  type: "file" | "directory";
  size: number;
  modified: string;
}

export interface DirectoryListing {
  entries: FileEntry[];
  path: string;
}

export interface FileContents {
  content: string;
  path: string;
  language: string;
}

export interface ChatRequest {
  message: string;
  sessionId?: string;
  projectPath: string;
  continue?: boolean;    // Resume most recent conversation
  forkSession?: boolean; // Fork to new session branch
  outputFormat?: { type: "json_schema"; schema: Record<string, unknown> };
}

// SSE event types sent to the client
export type SSEEventType =
  | "init"
  | "assistant"
  | "tool_call"
  | "result"
  | "error"
  | "done";

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
}
