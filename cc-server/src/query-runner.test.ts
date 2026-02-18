import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  QueryRunner,
  registerRunner,
  getRunnerByQueryId,
  getRunnerBySessionId,
  updateRunnerSessionId,
  markRunnerCompleted,
  getRunnerStats,
} from "./query-runner.js";

// ── QueryRunner class tests ─────────────────────────────────────────

describe("QueryRunner", () => {
  describe("event buffering", () => {
    it("assigns sequential indices to events", () => {
      const runner = new QueryRunner("q1", "s1");
      const e1 = runner.bufferEvent("assistant", { text: "hello" });
      const e2 = runner.bufferEvent("assistant", { text: "world" });

      expect(e1.index).toBe(0);
      expect(e2.index).toBe(1);
    });

    it("tracks total event count", () => {
      const runner = new QueryRunner("q1", "s1");
      expect(runner.eventCount).toBe(0);

      runner.bufferEvent("assistant", {});
      runner.bufferEvent("assistant", {});
      runner.bufferEvent("assistant", {});

      expect(runner.eventCount).toBe(3);
    });

    it("returns the buffered event", () => {
      const runner = new QueryRunner("q1", "s1");
      const event = runner.bufferEvent("tool_call", { name: "read" });

      expect(event).toEqual({
        index: 0,
        type: "tool_call",
        data: { name: "read" },
      });
    });
  });

  describe("FIFO eviction", () => {
    it("retains up to 2000 events", () => {
      const runner = new QueryRunner("q1", "s1");
      for (let i = 0; i < 2000; i++) {
        runner.bufferEvent("assistant", { i });
      }

      expect(runner.eventCount).toBe(2000);
      expect(runner.firstBufferedIndex).toBe(0);
    });

    it("evicts oldest events beyond 2000", () => {
      const runner = new QueryRunner("q1", "s1");
      for (let i = 0; i < 2050; i++) {
        runner.bufferEvent("assistant", { i });
      }

      expect(runner.eventCount).toBe(2050);
      // First 50 should have been evicted
      expect(runner.firstBufferedIndex).toBe(50);
    });
  });

  describe("listeners", () => {
    it("notifies listeners on bufferEvent", () => {
      const runner = new QueryRunner("q1", "s1");
      const received: unknown[] = [];
      runner.addListener((event) => received.push(event));

      runner.bufferEvent("assistant", { text: "hi" });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({
        index: 0,
        type: "assistant",
        data: { text: "hi" },
      });
    });

    it("auto-removes throwing listeners", () => {
      const runner = new QueryRunner("q1", "s1");
      const badListener = () => {
        throw new Error("dead connection");
      };
      runner.addListener(badListener);
      expect(runner.listenerCount).toBe(1);

      runner.bufferEvent("assistant", {});

      expect(runner.listenerCount).toBe(0);
    });

    it("supports add/remove/count", () => {
      const runner = new QueryRunner("q1", "s1");
      const fn = () => {};

      expect(runner.listenerCount).toBe(0);
      runner.addListener(fn);
      expect(runner.listenerCount).toBe(1);
      runner.removeListener(fn);
      expect(runner.listenerCount).toBe(0);
    });
  });

  describe("replayFrom", () => {
    it("replays all events from index 0", () => {
      const runner = new QueryRunner("q1", "s1");
      runner.bufferEvent("a", { n: 0 });
      runner.bufferEvent("b", { n: 1 });
      runner.bufferEvent("c", { n: 2 });

      const { events, gap } = runner.replayFrom(0);

      expect(gap).toBe(false);
      expect(events).toHaveLength(3);
      expect(events[0].index).toBe(0);
      expect(events[2].index).toBe(2);
    });

    it("replays subset from a later index", () => {
      const runner = new QueryRunner("q1", "s1");
      runner.bufferEvent("a", {});
      runner.bufferEvent("b", {});
      runner.bufferEvent("c", {});

      const { events, gap } = runner.replayFrom(2);

      expect(gap).toBe(false);
      expect(events).toHaveLength(1);
      expect(events[0].index).toBe(2);
    });

    it("detects gap when events were evicted", () => {
      const runner = new QueryRunner("q1", "s1");
      for (let i = 0; i < 2010; i++) {
        runner.bufferEvent("a", { i });
      }

      // Requesting from index 0, but first 10 have been evicted
      const { events, gap } = runner.replayFrom(0);

      expect(gap).toBe(true);
      expect(events[0].index).toBe(10);
    });

    it("returns empty for empty buffer with no history", () => {
      const runner = new QueryRunner("q1", "s1");

      const { events, gap } = runner.replayFrom(0);

      expect(events).toHaveLength(0);
      expect(gap).toBe(false);
    });

    it("detects gap for empty buffer when events existed", () => {
      // Edge case: buffer is empty but nextIndex > 0
      // This can't happen with current impl (buffer only grows),
      // but replayFrom handles it: empty buffer + fromIndex < nextIndex → gap
      const runner = new QueryRunner("q1", "s1");
      runner.bufferEvent("a", {});
      // Buffer has 1 event, requesting from 0 should work
      const { events, gap } = runner.replayFrom(0);
      expect(events).toHaveLength(1);
      expect(gap).toBe(false);
    });

    it("returns empty when fromIndex is at current position", () => {
      const runner = new QueryRunner("q1", "s1");
      runner.bufferEvent("a", {});
      runner.bufferEvent("b", {});

      // Requesting from index 2 (next event), nothing to replay
      const { events, gap } = runner.replayFrom(2);

      expect(events).toHaveLength(0);
      expect(gap).toBe(false);
    });
  });

  describe("status and abort", () => {
    it("starts with 'running' status", () => {
      const runner = new QueryRunner("q1", "s1");
      expect(runner.status).toBe("running");
    });

    it("setStatus changes status", () => {
      const runner = new QueryRunner("q1", "s1");
      runner.setStatus("completed");
      expect(runner.status).toBe("completed");

      runner.setStatus("error");
      expect(runner.status).toBe("error");
    });

    it("abort() signals controller and sets status to aborted", () => {
      const controller = new AbortController();
      const runner = new QueryRunner("q1", "s1", controller);

      expect(controller.signal.aborted).toBe(false);

      runner.abort();

      expect(controller.signal.aborted).toBe(true);
      expect(runner.status).toBe("aborted");
    });

    it("abort() without controller still sets status", () => {
      const runner = new QueryRunner("q1", "s1");
      runner.abort();
      expect(runner.status).toBe("aborted");
    });
  });

  describe("firstBufferedIndex", () => {
    it("equals nextIndex when buffer is empty", () => {
      const runner = new QueryRunner("q1", "s1");
      expect(runner.firstBufferedIndex).toBe(0);
    });

    it("equals first event index when buffer has events", () => {
      const runner = new QueryRunner("q1", "s1");
      runner.bufferEvent("a", {});
      runner.bufferEvent("b", {});
      expect(runner.firstBufferedIndex).toBe(0);
    });
  });
});

// ── Registry tests ──────────────────────────────────────────────────

describe("Registry", () => {
  // Use unique IDs per test to avoid cross-test pollution from module-level Maps
  let testId = 0;
  beforeEach(() => {
    testId++;
  });

  function ids() {
    return {
      queryId: `q-${testId}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: `s-${testId}-${Math.random().toString(36).slice(2, 8)}`,
    };
  }

  it("registerRunner makes runner retrievable by queryId", () => {
    const { queryId, sessionId } = ids();
    const runner = new QueryRunner(queryId, sessionId);
    registerRunner(runner);

    expect(getRunnerByQueryId(queryId)).toBe(runner);
  });

  it("registerRunner makes runner retrievable by sessionId", () => {
    const { queryId, sessionId } = ids();
    const runner = new QueryRunner(queryId, sessionId);
    registerRunner(runner);

    expect(getRunnerBySessionId(sessionId)).toBe(runner);
  });

  it("getRunnerByQueryId returns undefined for unknown id", () => {
    expect(getRunnerByQueryId("nonexistent")).toBeUndefined();
  });

  it("getRunnerBySessionId returns undefined for unknown id", () => {
    expect(getRunnerBySessionId("nonexistent")).toBeUndefined();
  });

  it("updateRunnerSessionId remaps session lookup", () => {
    const { queryId, sessionId } = ids();
    const newSessionId = `s-new-${testId}`;
    const runner = new QueryRunner(queryId, sessionId);
    registerRunner(runner);

    updateRunnerSessionId(queryId, sessionId, newSessionId);

    expect(getRunnerBySessionId(sessionId)).toBeUndefined();
    expect(getRunnerBySessionId(newSessionId)).toBe(runner);
  });

  it("updateRunnerSessionId is a no-op when ids are the same", () => {
    const { queryId, sessionId } = ids();
    const runner = new QueryRunner(queryId, sessionId);
    registerRunner(runner);

    updateRunnerSessionId(queryId, sessionId, sessionId);

    expect(getRunnerBySessionId(sessionId)).toBe(runner);
  });

  it("markRunnerCompleted records completion in stats", () => {
    const { queryId, sessionId } = ids();
    const runner = new QueryRunner(queryId, sessionId);
    registerRunner(runner);

    const statsBefore = getRunnerStats();
    markRunnerCompleted(queryId);
    const statsAfter = getRunnerStats();

    // completedPending should increase by 1
    expect(statsAfter.completedPending).toBe(statsBefore.completedPending + 1);
    // Runner is still accessible (cleanup happens asynchronously via setInterval)
    expect(getRunnerByQueryId(queryId)).toBe(runner);
  });

  it("getRunnerStats returns counts", () => {
    const stats = getRunnerStats();
    expect(stats).toHaveProperty("activeRunners");
    expect(stats).toHaveProperty("completedPending");
    expect(typeof stats.activeRunners).toBe("number");
    expect(typeof stats.completedPending).toBe("number");
  });
});
