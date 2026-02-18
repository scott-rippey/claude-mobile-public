import { describe, it, expect, vi } from "vitest";
import { TerminalRunner } from "./terminal-runner.js";

describe("TerminalRunner", () => {
  describe("event buffering", () => {
    it("assigns sequential indices to events", () => {
      const runner = new TerminalRunner("cmd1", "ls -la");
      const e1 = runner.bufferEvent("stdout", "hello\n");
      const e2 = runner.bufferEvent("stdout", "world\n");

      expect(e1.index).toBe(0);
      expect(e2.index).toBe(1);
    });

    it("tracks total event count", () => {
      const runner = new TerminalRunner("cmd1", "ls");
      expect(runner.eventCount).toBe(0);

      runner.bufferEvent("stdout", "a");
      runner.bufferEvent("stderr", "b");
      runner.bufferEvent("exit", { code: 0 });

      expect(runner.eventCount).toBe(3);
    });

    it("returns the buffered event with correct structure", () => {
      const runner = new TerminalRunner("cmd1", "echo test");
      const event = runner.bufferEvent("stdout", "test output");

      expect(event).toEqual({
        index: 0,
        type: "stdout",
        data: "test output",
      });
    });
  });

  describe("FIFO eviction (1000 cap)", () => {
    it("retains up to 1000 events", () => {
      const runner = new TerminalRunner("cmd1", "big-output");
      for (let i = 0; i < 1000; i++) {
        runner.bufferEvent("stdout", `line ${i}`);
      }

      expect(runner.eventCount).toBe(1000);
      expect(runner.firstBufferedIndex).toBe(0);
    });

    it("evicts oldest events beyond 1000", () => {
      const runner = new TerminalRunner("cmd1", "big-output");
      for (let i = 0; i < 1050; i++) {
        runner.bufferEvent("stdout", `line ${i}`);
      }

      expect(runner.eventCount).toBe(1050);
      expect(runner.firstBufferedIndex).toBe(50);
    });
  });

  describe("listeners", () => {
    it("notifies listeners on bufferEvent", () => {
      const runner = new TerminalRunner("cmd1", "echo hi");
      const received: unknown[] = [];
      runner.addListener((event) => received.push(event));

      runner.bufferEvent("stdout", "hi\n");

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({
        index: 0,
        type: "stdout",
        data: "hi\n",
      });
    });

    it("auto-removes throwing listeners", () => {
      const runner = new TerminalRunner("cmd1", "echo");
      const badListener = () => {
        throw new Error("dead connection");
      };
      runner.addListener(badListener);
      expect(runner.listenerCount).toBe(1);

      runner.bufferEvent("stdout", "data");

      expect(runner.listenerCount).toBe(0);
    });

    it("supports add/remove/count", () => {
      const runner = new TerminalRunner("cmd1", "echo");
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
      const runner = new TerminalRunner("cmd1", "cmd");
      runner.bufferEvent("command_start", { commandId: "cmd1" });
      runner.bufferEvent("stdout", "output");
      runner.bufferEvent("exit", { code: 0 });

      const { events, gap } = runner.replayFrom(0);

      expect(gap).toBe(false);
      expect(events).toHaveLength(3);
      expect(events[0].index).toBe(0);
      expect(events[2].index).toBe(2);
    });

    it("detects gap when events were evicted", () => {
      const runner = new TerminalRunner("cmd1", "cmd");
      for (let i = 0; i < 1010; i++) {
        runner.bufferEvent("stdout", `line ${i}`);
      }

      const { events, gap } = runner.replayFrom(0);

      expect(gap).toBe(true);
      expect(events[0].index).toBe(10);
    });

    it("returns empty for empty buffer with no history", () => {
      const runner = new TerminalRunner("cmd1", "cmd");

      const { events, gap } = runner.replayFrom(0);

      expect(events).toHaveLength(0);
      expect(gap).toBe(false);
    });
  });

  describe("complete and fail", () => {
    it("starts with 'running' status", () => {
      const runner = new TerminalRunner("cmd1", "cmd");
      expect(runner.status).toBe("running");
      expect(runner.exitCode).toBeNull();
    });

    it("complete() sets status and exit code", () => {
      const runner = new TerminalRunner("cmd1", "cmd");
      runner.complete(0);

      expect(runner.status).toBe("completed");
      expect(runner.exitCode).toBe(0);
    });

    it("complete() with non-zero exit code", () => {
      const runner = new TerminalRunner("cmd1", "cmd");
      runner.complete(1);

      expect(runner.status).toBe("completed");
      expect(runner.exitCode).toBe(1);
    });

    it("fail() sets error status", () => {
      const runner = new TerminalRunner("cmd1", "cmd");
      runner.fail();

      expect(runner.status).toBe("error");
    });
  });

  describe("kill", () => {
    it("sends SIGTERM to child process", () => {
      const runner = new TerminalRunner("cmd1", "sleep 100");
      const mockChild = {
        killed: false,
        kill: vi.fn(),
      };
      runner.setChild(mockChild as any);

      runner.kill();

      expect(mockChild.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("does nothing when no child is set", () => {
      const runner = new TerminalRunner("cmd1", "cmd");
      // Should not throw
      runner.kill();
    });

    it("does nothing when child is already killed", () => {
      const runner = new TerminalRunner("cmd1", "cmd");
      const mockChild = {
        killed: true,
        kill: vi.fn(),
      };
      runner.setChild(mockChild as any);

      runner.kill();

      expect(mockChild.kill).not.toHaveBeenCalled();
    });
  });

  describe("metadata", () => {
    it("exposes commandId and command", () => {
      const runner = new TerminalRunner("cmd-123", "npm test");
      expect(runner.commandId).toBe("cmd-123");
      expect(runner.command).toBe("npm test");
    });

    it("tracks age", async () => {
      const runner = new TerminalRunner("cmd1", "cmd");
      expect(runner.age).toBeGreaterThanOrEqual(0);
      expect(runner.age).toBeLessThan(1000);
    });
  });
});
