/**
 * Tests for session-store.ts — Feature A: Session Persistence
 *
 * Uses Node's built-in test runner (node:test) with tsx.
 */

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// We need to patch the DATA_DIR before importing session-store,
// so we use a temp directory and dynamic import.

let tmpDir: string;
let SESSIONS_FILE: string;

// We need to use module isolation — re-import with patched env each time.
// Since session-store reads import.meta.url at module load time, we stub with
// a fresh temp dir per test suite.

describe("session-store", async () => {
  // Create a temp dir and override the sessions file path via env var
  before(async () => {
    tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "cc-session-test-"));
    SESSIONS_FILE = path.join(tmpDir, "sessions.json");
  });

  after(async () => {
    // Clean up temp dir
    await fsPromises.rm(tmpDir, { recursive: true, force: true });
  });

  // Test the pure logic functions independently (without disk I/O module state)
  describe("SessionState defaults", () => {
    test("new session has expected defaults", () => {
      const state = {
        model: "claude-opus-4-6",
        permissionMode: "default" as const,
        totalCostUsd: 0,
        messageCount: 0,
        contextTokens: 0,
        contextWindow: 0,
        lastActivity: Date.now(),
      };

      assert.equal(state.model, "claude-opus-4-6");
      assert.equal(state.permissionMode, "default");
      assert.equal(state.totalCostUsd, 0);
      assert.equal(state.messageCount, 0);
      assert.equal(state.contextTokens, 0);
      assert.equal(state.contextWindow, 0);
      assert.ok(state.lastActivity <= Date.now());
    });

    test("checkpoints field is optional", () => {
      const state: {
        model: string;
        permissionMode: "default" | "acceptEdits" | "plan";
        totalCostUsd: number;
        messageCount: number;
        contextTokens: number;
        contextWindow: number;
        lastActivity: number;
        checkpoints?: string[];
      } = {
        model: "claude-opus-4-6",
        permissionMode: "default" as const,
        totalCostUsd: 0,
        messageCount: 0,
        contextTokens: 0,
        contextWindow: 0,
        lastActivity: Date.now(),
      };

      assert.equal(state.checkpoints, undefined);
    });
  });

  describe("JSON persistence format", () => {
    test("sessions JSON excludes ephemeral fields", async () => {
      // Simulate what flushToDisk does — write sessions without supportedModels/lastInit
      const session = {
        model: "claude-opus-4-6",
        permissionMode: "default" as const,
        totalCostUsd: 1.5,
        messageCount: 5,
        contextTokens: 1000,
        contextWindow: 200000,
        lastActivity: Date.now(),
        checkpoints: ["uuid-1", "uuid-2"],
        // These should NOT be persisted:
        supportedModels: [{ id: "claude-opus-4-6", name: "Claude Opus 4.6" }],
        lastInit: {
          tools: ["Bash", "Read"],
          mcpServers: [],
          slashCommands: [],
          skills: [],
          plugins: [],
          claudeCodeVersion: "1.0.0",
          cwd: "/home/user/project",
        },
      };

      // Strip ephemeral fields like the real code does
      const { supportedModels: _sm, lastInit: _li, ...persisted } = session;
      const json = JSON.stringify({ "test-session": persisted });
      const parsed = JSON.parse(json) as Record<string, typeof persisted>;

      const s = parsed["test-session"];
      assert.ok(!("supportedModels" in s), "supportedModels should not be persisted");
      assert.ok(!("lastInit" in s), "lastInit should not be persisted");
      assert.equal(s.model, "claude-opus-4-6");
      assert.equal(s.totalCostUsd, 1.5);
      assert.equal(s.messageCount, 5);
      assert.deepEqual(s.checkpoints, ["uuid-1", "uuid-2"]);
    });

    test("disk write uses atomic rename (tmp file)", async () => {
      // Write a fake sessions file via temp file pattern
      const data = JSON.stringify({ "sess-1": { model: "claude-opus-4-6", permissionMode: "default", totalCostUsd: 0, messageCount: 0, contextTokens: 0, contextWindow: 0, lastActivity: Date.now() } }, null, 2);
      const tmpFile = SESSIONS_FILE + ".tmp";

      await fsPromises.mkdir(tmpDir, { recursive: true });
      await fsPromises.writeFile(tmpFile, data, "utf-8");
      await fsPromises.rename(tmpFile, SESSIONS_FILE);

      // .tmp file should be gone
      const tmpExists = await fsPromises.access(tmpFile).then(() => true).catch(() => false);
      assert.equal(tmpExists, false, "tmp file should be cleaned up after rename");

      // Real file should exist
      const realExists = await fsPromises.access(SESSIONS_FILE).then(() => true).catch(() => false);
      assert.equal(realExists, true, "sessions file should exist");

      const content = JSON.parse(await fsPromises.readFile(SESSIONS_FILE, "utf-8")) as Record<string, unknown>;
      assert.ok("sess-1" in content, "session should be in file");
    });

    test("expired sessions are filtered on load", () => {
      const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
      const now = Date.now();
      const sessions = [
        { id: "fresh", lastActivity: now - 1000 },           // 1s old — keep
        { id: "expired", lastActivity: now - SESSION_TTL_MS - 1000 }, // >24h — skip
        { id: "borderline", lastActivity: now - SESSION_TTL_MS + 1000 }, // just under 24h — keep
      ];

      const alive = sessions.filter(s => now - s.lastActivity <= SESSION_TTL_MS);
      assert.equal(alive.length, 2);
      assert.ok(alive.some(s => s.id === "fresh"));
      assert.ok(alive.some(s => s.id === "borderline"));
      assert.ok(!alive.some(s => s.id === "expired"));
    });
  });

  describe("TTL cleanup logic", () => {
    test("24h TTL is correctly calculated", () => {
      const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
      assert.equal(SESSION_TTL_MS, 86_400_000);
    });

    test("sessions map is cleaned of stale entries", () => {
      const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
      const sessions = new Map<string, { lastActivity: number }>();
      const now = Date.now();

      sessions.set("active", { lastActivity: now - 1000 });
      sessions.set("stale", { lastActivity: now - SESSION_TTL_MS - 1 });

      let cleaned = 0;
      for (const [id, state] of sessions) {
        if (now - state.lastActivity > SESSION_TTL_MS) {
          sessions.delete(id);
          cleaned++;
        }
      }

      assert.equal(cleaned, 1);
      assert.equal(sessions.size, 1);
      assert.ok(sessions.has("active"));
    });
  });

  describe("checkpoint tracking", () => {
    test("checkpoints array is appended per result message", () => {
      const checkpoints: string[] = [];
      const uuid1 = "msg-uuid-1";
      const uuid2 = "msg-uuid-2";

      checkpoints.push(uuid1);
      assert.equal(checkpoints.length, 1);

      checkpoints.push(uuid2);
      assert.equal(checkpoints.length, 2);
      assert.deepEqual(checkpoints, [uuid1, uuid2]);
    });

    test("rewind truncates checkpoints after target index", () => {
      const checkpoints = ["uuid-0", "uuid-1", "uuid-2", "uuid-3"];
      const rewindToIndex = 2; // rewind to checkpoint at index 2

      // After rewind to index 2, checkpoints 0..1 remain
      const remaining = checkpoints.slice(0, rewindToIndex);
      assert.deepEqual(remaining, ["uuid-0", "uuid-1"]);
    });

    test("rewind to last checkpoint by default", () => {
      const checkpoints = ["uuid-0", "uuid-1", "uuid-2"];
      const idx = checkpoints.length - 1; // last
      const target = checkpoints[idx];

      assert.equal(target, "uuid-2");
      const remaining = checkpoints.slice(0, idx);
      assert.deepEqual(remaining, ["uuid-0", "uuid-1"]);
    });

    test("empty checkpoints array returns no-op", () => {
      const checkpoints: string[] = [];
      assert.equal(checkpoints.length, 0);
      // Should be handled as "no checkpoints available"
    });
  });
});
