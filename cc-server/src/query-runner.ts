/**
 * QueryRunner — manages query lifecycle independently from HTTP connections.
 *
 * Events are buffered so clients can reconnect and catch up. The SDK query
 * keeps running even when no SSE listeners are attached.
 */

export interface IndexedEvent {
  index: number;
  type: string;
  data: unknown;
}

export type RunnerStatus = "running" | "completed" | "error" | "aborted";
export type EventListener = (event: IndexedEvent) => void;

const MAX_BUFFER_SIZE = 2000;

export class QueryRunner {
  readonly queryId: string;
  readonly sessionId: string;

  private eventBuffer: IndexedEvent[] = [];
  private nextIndex = 0;
  private listeners = new Set<EventListener>();
  private _status: RunnerStatus = "running";
  private _abortController: AbortController | null = null;

  constructor(queryId: string, sessionId: string, abortController?: AbortController) {
    this.queryId = queryId;
    this.sessionId = sessionId;
    this._abortController = abortController ?? null;
  }

  get status(): RunnerStatus {
    return this._status;
  }

  get eventCount(): number {
    return this.nextIndex;
  }

  get firstBufferedIndex(): number {
    return this.eventBuffer.length > 0 ? this.eventBuffer[0].index : this.nextIndex;
  }

  /** Buffer an event and notify all active listeners */
  bufferEvent(type: string, data: unknown): IndexedEvent {
    const event: IndexedEvent = { index: this.nextIndex++, type, data };

    this.eventBuffer.push(event);
    // FIFO eviction when buffer exceeds cap
    while (this.eventBuffer.length > MAX_BUFFER_SIZE) {
      this.eventBuffer.shift();
    }

    // Notify all active listeners
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener threw — remove it (probably a dead connection)
        this.listeners.delete(listener);
      }
    }

    return event;
  }

  addListener(fn: EventListener): void {
    this.listeners.add(fn);
  }

  removeListener(fn: EventListener): void {
    this.listeners.delete(fn);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Replay buffered events starting from `fromIndex` */
  replayFrom(fromIndex: number): { events: IndexedEvent[]; gap: boolean } {
    if (this.eventBuffer.length === 0) {
      return { events: [], gap: fromIndex < this.nextIndex };
    }

    const firstAvailable = this.eventBuffer[0].index;
    const gap = fromIndex < firstAvailable;

    // Find the starting position in the buffer
    const startFrom = Math.max(fromIndex, firstAvailable);
    const bufferOffset = startFrom - firstAvailable;
    const events = this.eventBuffer.slice(bufferOffset);

    return { events, gap };
  }

  setStatus(status: RunnerStatus): void {
    this._status = status;
  }

  abort(): void {
    this._abortController?.abort();
    this._status = "aborted";
  }
}

// ── Registry ─────────────────────────────────────────────────────────

const activeRunners = new Map<string, QueryRunner>();
const sessionToQuery = new Map<string, string>();

// Completed runners are kept for a TTL so clients can reconnect after completion
const COMPLETED_TTL_MS = 5 * 60 * 1000; // 5 minutes
const completedTimestamps = new Map<string, number>();

export function registerRunner(runner: QueryRunner): void {
  activeRunners.set(runner.queryId, runner);
  sessionToQuery.set(runner.sessionId, runner.queryId);
}

/** Update sessionId mapping when real sessionId is known (e.g. after SDK init) */
export function updateRunnerSessionId(queryId: string, oldSessionId: string, newSessionId: string): void {
  if (oldSessionId !== newSessionId) {
    sessionToQuery.delete(oldSessionId);
    sessionToQuery.set(newSessionId, queryId);
  }
}

export function getRunnerByQueryId(queryId: string): QueryRunner | undefined {
  return activeRunners.get(queryId);
}

export function getRunnerBySessionId(sessionId: string): QueryRunner | undefined {
  const queryId = sessionToQuery.get(sessionId);
  return queryId ? activeRunners.get(queryId) : undefined;
}

export function markRunnerCompleted(queryId: string): void {
  completedTimestamps.set(queryId, Date.now());
}

export function unregisterRunner(queryId: string, sessionId: string): void {
  // Don't remove from maps immediately — keep for reconnect window
  // The cleanup interval will handle removal after TTL
}

// Cleanup completed runners after TTL
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [queryId, timestamp] of completedTimestamps) {
    if (now - timestamp > COMPLETED_TTL_MS) {
      const runner = activeRunners.get(queryId);
      if (runner) {
        sessionToQuery.delete(runner.sessionId);
        activeRunners.delete(queryId);
      }
      completedTimestamps.delete(queryId);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.error(`[query-runner] cleanup: removed ${cleaned} completed runners, ${activeRunners.size} remaining`);
  }
}, 60_000); // every 1 min

export function getRunnerStats() {
  return {
    activeRunners: activeRunners.size,
    completedPending: completedTimestamps.size,
  };
}
