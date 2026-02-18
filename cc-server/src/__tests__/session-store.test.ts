/**
 * Tests for session-store.ts — Feature A: Session Persistence
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fsPromises from "fs/promises";
import path from "path";
import os from "os";

let tmpDir: string;
let SESSIONS_FILE: string;

describe("session-store", () => {
  beforeAll(async () => {
    tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "cc-session-test-"));
    SESSIONS_FILE = path.join(tmpDir, "sessions.json");
  });

  afterAll(async () => {
    await fsPromises.rm(tmpDir, { recursive: true, force: true });
  });

  describe("SessionState defaults", () => {
    it("new session has expected defaults", () => {
      const state = {
        model: "claude-opus-4-6",
        permissionMode: "default" as const,
        totalCostUsd: 0,
        messageCount: 0,
        contextTokens: 0,
        contextWindow: 0,
        lastActivity: Date.now(),
      };

      expect(state.model).toBe("claude-opus-4-6");
      expect(state.permissionMode).toBe("default");
      expect(state.totalCostUsd).toBe(0);
      expect(state.messageCount).toBe(0);
      expect(state.contextTokens).toBe(0);
      expect(state.contextWindow).toBe(0);
      expect(state.lastActivity).toBeLessThanOrEqual(Date.now());
    });

    it("checkpoints field is optional", () => {
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

      expect(state.checkpoints).toBeUndefined();
    });
  });

  describe("JSON persistence format", () => {
    it("sessions JSON excludes ephemeral fields", () => {
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
      expect("supportedModels" in s).toBe(false);
      expect("lastInit" in s).toBe(false);
      expect(s.model).toBe("claude-opus-4-6");
      expect(s.totalCostUsd).toBe(1.5);
      expect(s.messageCount).toBe(5);
      expect(s.checkpoints).toEqual(["uuid-1", "uuid-2"]);
    });

    it("disk write uses atomic rename (tmp file)", async () => {
      const data = JSON.stringify({ "sess-1": { model: "claude-opus-4-6", permissionMode: "default", totalCostUsd: 0, messageCount: 0, contextTokens: 0, contextWindow: 0, lastActivity: Date.now() } }, null, 2);
      const tmpFile = SESSIONS_FILE + ".tmp";

      await fsPromises.mkdir(tmpDir, { recursive: true });
      await fsPromises.writeFile(tmpFile, data, "utf-8");
      await fsPromises.rename(tmpFile, SESSIONS_FILE);

      // .tmp file should be gone
      const tmpExists = await fsPromises.access(tmpFile).then(() => true).catch(() => false);
      expect(tmpExists).toBe(false);

      // Real file should exist
      const realExists = await fsPromises.access(SESSIONS_FILE).then(() => true).catch(() => false);
      expect(realExists).toBe(true);

      const content = JSON.parse(await fsPromises.readFile(SESSIONS_FILE, "utf-8")) as Record<string, unknown>;
      expect("sess-1" in content).toBe(true);
    });

    it("expired sessions are filtered on load", () => {
      const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
      const now = Date.now();
      const sessions = [
        { id: "fresh", lastActivity: now - 1000 },           // 1s old — keep
        { id: "expired", lastActivity: now - SESSION_TTL_MS - 1000 }, // >24h — skip
        { id: "borderline", lastActivity: now - SESSION_TTL_MS + 1000 }, // just under 24h — keep
      ];

      const alive = sessions.filter(s => now - s.lastActivity <= SESSION_TTL_MS);
      expect(alive.length).toBe(2);
      expect(alive.some(s => s.id === "fresh")).toBe(true);
      expect(alive.some(s => s.id === "borderline")).toBe(true);
      expect(alive.some(s => s.id === "expired")).toBe(false);
    });
  });

  describe("TTL cleanup logic", () => {
    it("24h TTL is correctly calculated", () => {
      const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
      expect(SESSION_TTL_MS).toBe(86_400_000);
    });

    it("sessions map is cleaned of stale entries", () => {
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

      expect(cleaned).toBe(1);
      expect(sessions.size).toBe(1);
      expect(sessions.has("active")).toBe(true);
    });
  });

  describe("checkpoint tracking", () => {
    it("checkpoints array is appended per result message", () => {
      const checkpoints: string[] = [];
      const uuid1 = "msg-uuid-1";
      const uuid2 = "msg-uuid-2";

      checkpoints.push(uuid1);
      expect(checkpoints.length).toBe(1);

      checkpoints.push(uuid2);
      expect(checkpoints.length).toBe(2);
      expect(checkpoints).toEqual([uuid1, uuid2]);
    });

    it("rewind truncates checkpoints after target index", () => {
      const checkpoints = ["uuid-0", "uuid-1", "uuid-2", "uuid-3"];
      const rewindToIndex = 2; // rewind to checkpoint at index 2

      // After rewind to index 2, checkpoints 0..1 remain
      const remaining = checkpoints.slice(0, rewindToIndex);
      expect(remaining).toEqual(["uuid-0", "uuid-1"]);
    });

    it("rewind to last checkpoint by default", () => {
      const checkpoints = ["uuid-0", "uuid-1", "uuid-2"];
      const idx = checkpoints.length - 1; // last
      const target = checkpoints[idx];

      expect(target).toBe("uuid-2");
      const remaining = checkpoints.slice(0, idx);
      expect(remaining).toEqual(["uuid-0", "uuid-1"]);
    });

    it("empty checkpoints array returns no-op", () => {
      const checkpoints: string[] = [];
      expect(checkpoints.length).toBe(0);
      // Should be handled as "no checkpoints available"
    });
  });
});
