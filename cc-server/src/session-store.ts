/**
 * SessionStore — persistent session state with debounced disk writes.
 *
 * Sessions are kept in memory for fast access, but flushed to disk every 5s
 * when dirty. On startup, sessions are loaded from disk. On SIGTERM/SIGINT,
 * we flush synchronously before exiting.
 *
 * Bulky fields (supportedModels, lastInit) are NOT persisted — they repopulate
 * on the next message via the SDK init event.
 */

import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// ── Session state ────────────────────────────────────────────────────

export interface SessionState {
  model: string;
  permissionMode: "default" | "acceptEdits" | "plan";
  totalCostUsd: number;
  messageCount: number;
  contextTokens: number;   // Last input_tokens (current context size)
  contextWindow: number;   // Max context window for the model
  lastActivity: number;    // timestamp for TTL cleanup
  checkpoints?: string[];  // User message UUIDs for file checkpointing

  // Bulky — not persisted, repopulated on next message
  supportedModels?: { id: string; name?: string }[];
  lastInit?: {
    tools: string[];
    mcpServers: { name: string; status: string }[];
    slashCommands: string[];
    skills: string[];
    plugins: { name: string; path: string }[];
    claudeCodeVersion: string;
    cwd: string;
  };
}

// Fields to strip before writing to disk (bulky, repopulated on next message)
const EPHEMERAL_FIELDS: (keyof SessionState)[] = ["supportedModels", "lastInit"];

type PersistedSessionState = Omit<SessionState, "supportedModels" | "lastInit">;

// ── Storage path ──────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

// ── In-memory store ────────────────────────────────────────────────────

const sessions = new Map<string, SessionState>();
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const FLUSH_DEBOUNCE_MS = 5_000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Public API ────────────────────────────────────────────────────────

export function getSession(sessionId: string | undefined, defaultModel: string): SessionState {
  if (sessionId && sessions.has(sessionId)) return sessions.get(sessionId)!;
  return {
    model: defaultModel,
    permissionMode: "default",
    totalCostUsd: 0,
    messageCount: 0,
    contextTokens: 0,
    contextWindow: 0,
    lastActivity: Date.now(),
  };
}

export function saveSession(sessionId: string, state: SessionState): void {
  state.lastActivity = Date.now();
  sessions.set(sessionId, state);
  scheduleDirtyFlush();
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
  scheduleDirtyFlush();
}

export function getAllSessions(): Map<string, SessionState> {
  return sessions;
}

export function getSessionCount(): number {
  return sessions.size;
}

// ── TTL cleanup ────────────────────────────────────────────────────────

export function cleanupStaleSessions(): number {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, state] of sessions) {
    if (now - state.lastActivity > SESSION_TTL_MS) {
      sessions.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    scheduleDirtyFlush();
    console.error(`[session-store] cleanup: removed ${cleaned}, remaining ${sessions.size}`);
  }
  return cleaned;
}

// ── Debounced disk writes ──────────────────────────────────────────────

function scheduleDirtyFlush(): void {
  dirty = true;
  if (flushTimer) return; // already scheduled
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushToDisk().catch((err) => {
      console.error("[session-store] flush error:", err);
    });
  }, FLUSH_DEBOUNCE_MS);
}

export async function flushToDisk(): Promise<void> {
  if (!dirty) return;
  dirty = false;

  try {
    await fsPromises.mkdir(DATA_DIR, { recursive: true });

    const persisted: Record<string, PersistedSessionState> = {};
    for (const [id, state] of sessions) {
      const { ...rest } = state;
      // Strip ephemeral fields
      for (const field of EPHEMERAL_FIELDS) {
        delete (rest as Partial<SessionState>)[field];
      }
      persisted[id] = rest as PersistedSessionState;
    }

    const tmp = SESSIONS_FILE + ".tmp";
    await fsPromises.writeFile(tmp, JSON.stringify(persisted, null, 2), "utf-8");
    await fsPromises.rename(tmp, SESSIONS_FILE);

    console.error(`[session-store] flushed ${Object.keys(persisted).length} sessions to disk`);
  } catch (err) {
    dirty = true; // mark dirty again so next flush retries
    throw err;
  }
}

/** Synchronous flush for SIGTERM/SIGINT handlers */
export function flushToDiskSync(): void {
  if (!dirty) return;
  dirty = false;

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const persisted: Record<string, PersistedSessionState> = {};
    for (const [id, state] of sessions) {
      const { ...rest } = state;
      for (const field of EPHEMERAL_FIELDS) {
        delete (rest as Partial<SessionState>)[field];
      }
      persisted[id] = rest as PersistedSessionState;
    }

    const tmp = SESSIONS_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(persisted, null, 2), "utf-8");
    fs.renameSync(tmp, SESSIONS_FILE);

    console.error(`[session-store] sync flush: ${Object.keys(persisted).length} sessions`);
  } catch (err) {
    console.error("[session-store] sync flush error:", err);
  }
}

// ── Load from disk on startup ──────────────────────────────────────────

export async function loadFromDisk(): Promise<void> {
  try {
    const raw = await fsPromises.readFile(SESSIONS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, PersistedSessionState>;

    const now = Date.now();
    let loaded = 0;
    let expired = 0;

    for (const [id, state] of Object.entries(parsed)) {
      // Skip sessions that have already expired
      if (now - (state.lastActivity ?? 0) > SESSION_TTL_MS) {
        expired++;
        continue;
      }
      sessions.set(id, state as SessionState);
      loaded++;
    }

    console.error(`[session-store] loaded ${loaded} sessions from disk (${expired} expired, skipped)`);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error("[session-store] no sessions file found, starting fresh");
    } else {
      console.error("[session-store] failed to load sessions:", err);
    }
  }
}

// ── SIGTERM / SIGINT handlers — flush before exit ─────────────────────

function handleExit(signal: string): void {
  console.error(`[session-store] ${signal} received — flushing sessions to disk...`);
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
    dirty = true; // ensure we flush even if timer was the only pending write
  }
  flushToDiskSync();
  process.exit(0);
}

process.on("SIGTERM", () => handleExit("SIGTERM"));
process.on("SIGINT", () => handleExit("SIGINT"));
