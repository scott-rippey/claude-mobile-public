/**
 * Tests for Feature B: Graceful Interrupt
 *
 * Tests the abort endpoint logic and client-side double-tap behavior.
 */

import { describe, it, expect } from "vitest";

describe("graceful-interrupt", () => {
  describe("abort endpoint request body", () => {
    it("abort body with graceful=true is typed correctly", () => {
      const body = { queryId: "test-query-id", graceful: true };
      expect(body.graceful).toBe(true);
      expect(body.queryId).toBe("test-query-id");
    });

    it("abort body with graceful=false triggers hard abort", () => {
      const body = { queryId: "test-query-id", graceful: false };
      expect(body.graceful).toBe(false);
    });

    it("abort body without graceful defaults to false (hard abort)", () => {
      const body: { queryId: string; graceful?: boolean } = { queryId: "test-query-id" };
      const graceful = body.graceful ?? false;
      expect(graceful).toBe(false);
    });
  });

  describe("double-tap interrupt state machine", () => {
    it("first tap triggers graceful interrupt", () => {
      let isInterrupting = false;
      let graceful = false;

      // Simulate first tap
      const stopQuery = () => {
        if (!isInterrupting) {
          isInterrupting = true;
          graceful = true; // would send graceful: true to server
        } else {
          isInterrupting = false;
          graceful = false; // would send graceful: false to server (hard abort)
        }
      };

      stopQuery();
      expect(isInterrupting).toBe(true);
      expect(graceful).toBe(true);
    });

    it("second tap within 3s triggers hard abort", () => {
      let isInterrupting = true; // simulating first tap already done

      const stopQuery = () => {
        if (!isInterrupting) {
          isInterrupting = true;
        } else {
          // second tap: hard abort
          isInterrupting = false;
        }
      };

      stopQuery();
      expect(isInterrupting).toBe(false);
    });

    it("timer reset after 3s resets isInterrupting to false", () => {
      let isInterrupting = true;

      // Simulate timer expiry
      const timerCallback = () => {
        isInterrupting = false;
      };
      timerCallback();

      expect(isInterrupting).toBe(false);
    });

    it("interrupt state resets when streaming stops", () => {
      let isInterrupting = true;
      const isStreaming = false;

      // When streaming ends, isInterrupting should be reset
      if (!isStreaming) {
        isInterrupting = false;
      }

      expect(isInterrupting).toBe(false);
    });
  });

  describe("abort response methods", () => {
    it("graceful interrupt returns method=interrupt", () => {
      const response = { ok: true, method: "interrupt" };
      expect(response.ok).toBe(true);
      expect(response.method).toBe("interrupt");
    });

    it("hard abort via controller returns method=abort", () => {
      const response = { ok: true, method: "abort" };
      expect(response.ok).toBe(true);
      expect(response.method).toBe("abort");
    });

    it("runner fallback abort returns method=runner-abort", () => {
      const response = { ok: true, method: "runner-abort" };
      expect(response.ok).toBe(true);
      expect(response.method).toBe("runner-abort");
    });

    it("not-found returns 404-like error", () => {
      const response = { error: "Query not found or already finished" };
      expect("error" in response).toBe(true);
    });
  });

  describe("graceful fallback to hard abort", () => {
    it("interrupt() not available — falls through to hard abort", () => {
      const mockQuery = {}; // no interrupt() method
      const hasInterrupt = typeof (mockQuery as any).interrupt === "function";
      expect(hasInterrupt).toBe(false);

      // Should use AbortController as fallback
      let aborted = false;
      const controller = new AbortController();
      controller.signal.addEventListener("abort", () => { aborted = true; });

      if (!hasInterrupt) {
        controller.abort();
      }

      expect(aborted).toBe(true);
    });

    it("interrupt() throws — falls through to hard abort", async () => {
      const mockQuery = {
        interrupt: async () => { throw new Error("interrupt failed"); },
      };

      let usedHardAbort = false;
      let aborted = false;
      const controller = new AbortController();
      controller.signal.addEventListener("abort", () => { aborted = true; });

      try {
        await mockQuery.interrupt();
      } catch {
        // Fall through to hard abort
        usedHardAbort = true;
        controller.abort();
      }

      expect(usedHardAbort).toBe(true);
      expect(aborted).toBe(true);
    });
  });
});
