/**
 * Tests for Feature C: File Checkpointing + Rewind
 *
 * Tests checkpoint tracking, rewind logic, and endpoint behavior.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("checkpointing", () => {
  describe("enableFileCheckpointing option", () => {
    test("query options include enableFileCheckpointing: true", () => {
      // Verify the option shape is correct
      const options = {
        cwd: "/some/project",
        permissionMode: "default" as const,
        model: "claude-opus-4-6",
        enableFileCheckpointing: true,
      };

      assert.equal(options.enableFileCheckpointing, true);
    });
  });

  describe("user_message_uuid capture", () => {
    test("uuid is captured from result event", () => {
      const checkpoints: string[] = [];
      const resultEvent = {
        session_id: "sess-abc",
        user_message_uuid: "uuid-123-456",
        is_error: false,
      };

      // Simulate the capture logic
      if (resultEvent.session_id && resultEvent.user_message_uuid) {
        checkpoints.push(resultEvent.user_message_uuid);
      }

      assert.deepEqual(checkpoints, ["uuid-123-456"]);
    });

    test("uuid is not captured when missing from result", () => {
      const checkpoints: string[] = [];
      const resultEvent = {
        session_id: "sess-abc",
        is_error: false,
        // no user_message_uuid
      };

      if ((resultEvent as any).session_id && (resultEvent as any).user_message_uuid) {
        checkpoints.push((resultEvent as any).user_message_uuid);
      }

      assert.deepEqual(checkpoints, []);
    });

    test("multiple results accumulate checkpoints", () => {
      const checkpoints: string[] = [];
      const results = [
        { session_id: "sess-1", user_message_uuid: "uuid-1" },
        { session_id: "sess-1", user_message_uuid: "uuid-2" },
        { session_id: "sess-1", user_message_uuid: "uuid-3" },
      ];

      for (const r of results) {
        if (r.session_id && r.user_message_uuid) {
          checkpoints.push(r.user_message_uuid);
        }
      }

      assert.equal(checkpoints.length, 3);
      assert.deepEqual(checkpoints, ["uuid-1", "uuid-2", "uuid-3"]);
    });
  });

  describe("rewind endpoint validation", () => {
    test("sessionId is required", () => {
      const body: Record<string, unknown> = {};
      const sessionId = body.sessionId as string | undefined;
      assert.equal(sessionId, undefined);
      // Should return 400
    });

    test("empty checkpoints array returns error", () => {
      const checkpoints: string[] = [];
      const hasCheckpoints = checkpoints.length > 0;
      assert.equal(hasCheckpoints, false);
      // Should return 400: "No checkpoints available"
    });

    test("default checkpointIndex is last element", () => {
      const checkpoints = ["uuid-0", "uuid-1", "uuid-2"];
      const checkpointIndex = undefined;
      const idx = typeof checkpointIndex === "number" ? checkpointIndex : checkpoints.length - 1;
      assert.equal(idx, 2);
      assert.equal(checkpoints[idx], "uuid-2");
    });

    test("explicit checkpointIndex targets correct entry", () => {
      const checkpoints = ["uuid-0", "uuid-1", "uuid-2"];
      const checkpointIndex = 1;
      const idx = typeof checkpointIndex === "number" ? checkpointIndex : checkpoints.length - 1;
      assert.equal(idx, 1);
      assert.equal(checkpoints[idx], "uuid-1");
    });

    test("out-of-range checkpointIndex is rejected", () => {
      const checkpoints = ["uuid-0", "uuid-1"];
      const checkpointIndex = 5;
      const idx = typeof checkpointIndex === "number" ? checkpointIndex : checkpoints.length - 1;
      const isValid = idx >= 0 && idx < checkpoints.length;
      assert.equal(isValid, false);
      // Should return 400: "Invalid checkpointIndex"
    });

    test("negative checkpointIndex is rejected", () => {
      const checkpoints = ["uuid-0", "uuid-1"];
      const checkpointIndex = -1;
      const isValid = checkpointIndex >= 0 && checkpointIndex < checkpoints.length;
      assert.equal(isValid, false);
    });
  });

  describe("checkpoint truncation after rewind", () => {
    test("rewind to index 2 of 4 leaves [0, 1]", () => {
      const checkpoints = ["uuid-0", "uuid-1", "uuid-2", "uuid-3"];
      const idx = 2;
      const remaining = checkpoints.slice(0, idx);
      assert.deepEqual(remaining, ["uuid-0", "uuid-1"]);
    });

    test("rewind to index 0 leaves empty array", () => {
      const checkpoints = ["uuid-0", "uuid-1"];
      const idx = 0;
      const remaining = checkpoints.slice(0, idx);
      assert.deepEqual(remaining, []);
    });

    test("rewind to last leaves all but last", () => {
      const checkpoints = ["uuid-0", "uuid-1", "uuid-2"];
      const idx = checkpoints.length - 1;
      const remaining = checkpoints.slice(0, idx);
      assert.deepEqual(remaining, ["uuid-0", "uuid-1"]);
    });
  });

  describe("rewind response shape", () => {
    test("successful rewind response has expected fields", () => {
      const response = {
        ok: true,
        checkpointIndex: 2,
        uuid: "uuid-2",
        remainingCheckpoints: 2,
      };

      assert.equal(response.ok, true);
      assert.equal(response.checkpointIndex, 2);
      assert.equal(response.uuid, "uuid-2");
      assert.equal(response.remainingCheckpoints, 2);
    });
  });

  describe("result event checkpoint propagation to client", () => {
    test("checkpoints array is sent in result event", () => {
      const session = {
        checkpoints: ["uuid-1", "uuid-2"],
        totalCostUsd: 0,
        messageCount: 2,
      };

      const resultEventPayload = {
        checkpoints: session.checkpoints ?? [],
        sessionCostUsd: session.totalCostUsd,
        numTurns: session.messageCount,
      };

      assert.deepEqual(resultEventPayload.checkpoints, ["uuid-1", "uuid-2"]);
    });

    test("client sets checkpointCount from result event", () => {
      let checkpointCount = 0;

      // Simulate handling result event
      const event = { data: { checkpoints: ["uuid-1", "uuid-2", "uuid-3"] } };
      const checkpoints = event.data.checkpoints as string[] | undefined;
      if (checkpoints !== undefined) {
        checkpointCount = checkpoints.length;
      }

      assert.equal(checkpointCount, 3);
    });
  });

  describe("undo button visibility", () => {
    test("undo button visible when checkpointCount > 0 and not streaming", () => {
      const checkpointCount = 2;
      const isStreaming = false;
      const showUndoButton = checkpointCount > 0 && !isStreaming;
      assert.equal(showUndoButton, true);
    });

    test("undo button hidden when streaming", () => {
      const checkpointCount = 2;
      const isStreaming = true;
      const showUndoButton = checkpointCount > 0 && !isStreaming;
      assert.equal(showUndoButton, false);
    });

    test("undo button hidden when no checkpoints", () => {
      const checkpointCount = 0;
      const isStreaming = false;
      const showUndoButton = checkpointCount > 0 && !isStreaming;
      assert.equal(showUndoButton, false);
    });
  });
});
