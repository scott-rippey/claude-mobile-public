import { vi } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import path from "path";
import os from "os";
import type { Request, Response } from "express";

/** Create a mock Express Request with configurable query, body, and headers */
export function createMockRequest(
  overrides: {
    query?: Record<string, string>;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  } = {}
) {
  return {
    query: overrides.query || {},
    body: overrides.body || {},
    headers: overrides.headers || {},
  } as unknown as Request;
}

/** Create a mock Express Response with spies for status, json, writeHead, write, end, on */
export function createMockResponse() {
  const written: string[] = [];
  const listeners = new Map<string, Function>();

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    writeHead: vi.fn().mockReturnThis(),
    write: vi.fn((chunk: string) => {
      written.push(chunk);
      return true;
    }),
    end: vi.fn(),
    on: vi.fn((event: string, fn: Function) => {
      listeners.set(event, fn);
    }),
    // Test helpers
    _written: written,
    _listeners: listeners,
    /** Simulate client disconnect */
    _triggerClose: () => listeners.get("close")?.(),
    /** Parse all SSE data lines written to the response */
    _parseSSEEvents: () =>
      written
        .filter((line) => line.startsWith("data: "))
        .map((line) => JSON.parse(line.replace("data: ", "").replace(/\n\n$/, ""))),
  };

  return res as typeof res & Response;
}

/** Create a temporary directory for filesystem tests */
export async function createTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "cc-test-"));
}

/** Remove a temporary directory and all contents */
export async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Run a function with temporary env vars, restoring originals after */
export async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => void | Promise<void>
): Promise<void> {
  const originals: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    originals[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
  try {
    await fn();
  } finally {
    for (const key of Object.keys(originals)) {
      if (originals[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originals[key];
      }
    }
  }
}
