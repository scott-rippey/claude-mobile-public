/**
 * TerminalRunner — manages command lifecycle independently from SSE connections.
 *
 * Events are buffered so clients can reconnect and catch up. The spawned process
 * keeps running even when no SSE listeners are attached.
 */

import type { ChildProcess } from "child_process";

export interface IndexedTerminalEvent {
  index: number;
  type: string;
  data: unknown;
}

export type TerminalEventListener = (event: IndexedTerminalEvent) => void;

const MAX_BUFFER_SIZE = 1000;

export class TerminalRunner {
  readonly commandId: string;
  readonly command: string;

  private eventBuffer: IndexedTerminalEvent[] = [];
  private nextIndex = 0;
  private listeners = new Set<TerminalEventListener>();
  private _status: "running" | "completed" | "error" = "running";
  private _exitCode: number | null = null;
  private _child: ChildProcess | null = null;
  private createdAt = Date.now();

  constructor(commandId: string, command: string) {
    this.commandId = commandId;
    this.command = command;
  }

  get status() { return this._status; }
  get exitCode() { return this._exitCode; }
  get eventCount() { return this.nextIndex; }
  get firstBufferedIndex() {
    return this.eventBuffer.length > 0 ? this.eventBuffer[0].index : this.nextIndex;
  }
  get listenerCount() { return this.listeners.size; }
  get age() { return Date.now() - this.createdAt; }

  setChild(child: ChildProcess) { this._child = child; }

  bufferEvent(type: string, data: unknown): IndexedTerminalEvent {
    const event: IndexedTerminalEvent = { index: this.nextIndex++, type, data };
    this.eventBuffer.push(event);
    while (this.eventBuffer.length > MAX_BUFFER_SIZE) {
      this.eventBuffer.shift();
    }
    for (const listener of this.listeners) {
      try { listener(event); } catch { this.listeners.delete(listener); }
    }
    return event;
  }

  addListener(fn: TerminalEventListener) { this.listeners.add(fn); }
  removeListener(fn: TerminalEventListener) { this.listeners.delete(fn); }

  replayFrom(fromIndex: number): { events: IndexedTerminalEvent[]; gap: boolean } {
    if (this.eventBuffer.length === 0) {
      return { events: [], gap: fromIndex < this.nextIndex };
    }
    const firstAvailable = this.eventBuffer[0].index;
    const gap = fromIndex < firstAvailable;
    const startFrom = Math.max(fromIndex, firstAvailable);
    const bufferOffset = startFrom - firstAvailable;
    return { events: this.eventBuffer.slice(bufferOffset), gap };
  }

  complete(exitCode: number) {
    this._status = "completed";
    this._exitCode = exitCode;
  }

  fail() {
    this._status = "error";
  }

  kill() {
    if (this._child && !this._child.killed) {
      this._child.kill("SIGTERM");
    }
  }
}
