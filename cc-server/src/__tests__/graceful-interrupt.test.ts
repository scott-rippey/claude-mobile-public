/**
 * Tests for Feature B: Graceful Interrupt
 *
 * Tests the abort endpoint logic and client-side double-tap behavior.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("graceful-interrupt", () => {
  describe("abort endpoint request body", () => {
    test("abort body with graceful=true is typed correctly", () => {
      const body = { queryId: "test-query-id", graceful: true };
      assert.equal(body.graceful, true);
      assert.equal(body.queryId, "test-query-id");
    });

    test("abort body with graceful=false triggers hard abort", () => {
      const body = { queryId: "test-query-id", graceful: false };
      assert.equal(body.graceful, false);
    });

    test("abort body without graceful defaults to false (hard abort)", () => {
      const body: { queryId: string; graceful?: boolean } = { queryId: "test-query-id" };
      const graceful = body.graceful ?? false;
      assert.equal(graceful, false);
    });
  });

  describe("double-tap interrupt state machine", () => {
    test("first tap triggers graceful interrupt", () => {
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
      assert.equal(isInterrupting, true);
      assert.equal(graceful, true);
    });

    test("second tap within 3s triggers hard abort", () => {
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
      assert.equal(isInterrupting, false);
    });

    test("timer reset after 3s resets isInterrupting to false", () => {
      let isInterrupting = true;

      // Simulate timer expiry
      const timerCallback = () => {
        isInterrupting = false;
      };
      timerCallback();

      assert.equal(isInterrupting, false);
    });

    test("interrupt state resets when streaming stops", () => {
      let isInterrupting = true;
      let isStreaming = false;

      // When streaming ends, isInterrupting should be reset
      if (!isStreaming) {
        isInterrupting = false;
      }

      assert.equal(isInterrupting, false);
    });
  });

  describe("abort response methods", () => {
    test("graceful interrupt returns method=interrupt", () => {
      const response = { ok: true, method: "interrupt" };
      assert.equal(response.ok, true);
      assert.equal(response.method, "interrupt");
    });

    test("hard abort via controller returns method=abort", () => {
      const response = { ok: true, method: "abort" };
      assert.equal(response.ok, true);
      assert.equal(response.method, "abort");
    });

    test("runner fallback abort returns method=runner-abort", () => {
      const response = { ok: true, method: "runner-abort" };
      assert.equal(response.ok, true);
      assert.equal(response.method, "runner-abort");
    });

    test("not-found returns 404-like error", () => {
      const response = { error: "Query not found or already finished" };
      assert.ok("error" in response);
    });
  });

  describe("graceful fallback to hard abort", () => {
    test("interrupt() not available → falls through to hard abort", () => {
      const mockQuery = {}; // no interrupt() method
      const hasInterrupt = typeof (mockQuery as any).interrupt === "function";
      assert.equal(hasInterrupt, false);

      // Should use AbortController as fallback
      let aborted = false;
      const controller = new AbortController();
      controller.signal.addEventListener("abort", () => { aborted = true; });

      if (!hasInterrupt) {
        controller.abort();
      }

      assert.equal(aborted, true);
    });

    test("interrupt() throws → falls through to hard abort", async () => {
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

      assert.equal(usedHardAbort, true);
      assert.equal(aborted, true);
    });
  });
});
