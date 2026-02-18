import { Router } from "express";
import { spawn } from "child_process";
import path from "path";
import crypto from "crypto";
import { TerminalRunner, type TerminalEventListener } from "../terminal-runner.js";

const router = Router();

// ── Registry ─────────────────────────────────────────────────────────

const activeTerminals = new Map<string, TerminalRunner>();
const completedTimestamps = new Map<string, number>();

const COMPLETED_TTL_MS = 5 * 60 * 1000;
const ORPHAN_TTL_MS = 30 * 60 * 1000; // Kill orphaned processes after 30min

// Cleanup completed terminals and orphaned processes
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;

  // Clean up completed runners past TTL
  for (const [id, timestamp] of completedTimestamps) {
    if (now - timestamp > COMPLETED_TTL_MS) {
      activeTerminals.delete(id);
      completedTimestamps.delete(id);
      cleaned++;
    }
  }

  // Kill orphaned running processes (no listeners for 30min)
  for (const [id, runner] of activeTerminals) {
    if (runner.status === "running" && runner.listenerCount === 0 && runner.age > ORPHAN_TTL_MS) {
      console.error(`[terminal] killing orphaned process ${id} (age: ${Math.round(runner.age / 60000)}min)`);
      runner.kill();
      activeTerminals.delete(id);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.error(`[terminal] cleanup: removed ${cleaned}, remaining ${activeTerminals.size}`);
  }
}, 60_000);

// Helper: subscribe response to terminal runner
function subscribeTerminalResponse(
  res: import("express").Response,
  runner: TerminalRunner
): { listener: TerminalEventListener; heartbeat: ReturnType<typeof setInterval> } {
  const listener: TerminalEventListener = (event) => {
    try {
      res.write(`data: ${JSON.stringify({ type: event.type, data: event.data, index: event.index })}\n\n`);
    } catch {
      runner.removeListener(listener);
    }
  };

  runner.addListener(listener);

  const heartbeat = setInterval(() => {
    try {
      res.write(`event: keepalive\ndata: {}\n\n`);
    } catch {
      clearInterval(heartbeat);
      runner.removeListener(listener);
    }
  }, 15_000);

  return { listener, heartbeat };
}

// POST /api/terminal — execute a command, stream output as SSE
export function handleTerminalPost(req: import("express").Request, res: import("express").Response) {
  const baseDir = process.env.BASE_DIR;
  console.error("[terminal] POST /api/terminal — body:", JSON.stringify(req.body));
  console.error("[terminal] BASE_DIR:", baseDir);

  if (!baseDir) {
    console.error("[terminal] ERROR: BASE_DIR not set");
    res.status(500).json({ error: "BASE_DIR not configured on cc-server" });
    return;
  }

  const { command, projectPath } = req.body as {
    command: string;
    projectPath: string;
  };

  if (!command || !projectPath) {
    console.error("[terminal] ERROR: missing command or projectPath");
    res.status(400).json({ error: "command and projectPath are required" });
    return;
  }

  // Validate projectPath doesn't escape BASE_DIR
  const cwd = path.resolve(baseDir, projectPath);
  if (!cwd.startsWith(path.resolve(baseDir))) {
    console.error("[terminal] ERROR: path traversal blocked:", cwd);
    res.status(403).json({ error: "Path traversal not allowed" });
    return;
  }

  console.error("[terminal] Spawning bash in:", cwd, "command:", command);

  // Create TerminalRunner
  const commandId = crypto.randomUUID();
  const runner = new TerminalRunner(commandId, command);
  activeTerminals.set(commandId, runner);

  // Set up SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Send commandId to client for reconnection
  runner.bufferEvent("command_start", { commandId });

  // Subscribe this response to the runner
  const { listener, heartbeat } = subscribeTerminalResponse(res, runner);

  const child = spawn("bash", ["-c", command], {
    cwd,
    env: { ...process.env, TERM: "dumb" },
  });
  runner.setChild(child);

  console.error("[terminal] Child process PID:", child.pid);

  child.stdout.on("data", (chunk: Buffer) => {
    console.error("[terminal] stdout:", chunk.toString().slice(0, 200));
    runner.bufferEvent("stdout", chunk.toString());
  });

  child.stderr.on("data", (chunk: Buffer) => {
    console.error("[terminal] stderr:", chunk.toString().slice(0, 200));
    runner.bufferEvent("stderr", chunk.toString());
  });

  child.on("close", (code) => {
    console.error("[terminal] Process exited with code:", code);
    runner.bufferEvent("exit", { code });
    runner.complete(code ?? 1);
    completedTimestamps.set(commandId, Date.now());
    // End all connected responses
    try { res.end(); } catch { /* already closed */ }
  });

  child.on("error", (err) => {
    console.error("[terminal] Process error:", err.message);
    runner.bufferEvent("error", { error: err.message });
    runner.fail();
    completedTimestamps.set(commandId, Date.now());
    try { res.end(); } catch { /* already closed */ }
  });

  // Client disconnect: remove listener but do NOT kill the process
  res.on("close", () => {
    console.error("[terminal] Client disconnected (command continues running)");
    clearInterval(heartbeat);
    runner.removeListener(listener);
  });
}

router.post("/", handleTerminalPost);

// GET /api/terminal/status — check if a command is still running
export function handleTerminalStatus(req: import("express").Request, res: import("express").Response) {
  const commandId = req.query.commandId as string | undefined;
  if (!commandId) {
    res.status(400).json({ error: "commandId is required" });
    return;
  }

  const runner = activeTerminals.get(commandId);
  if (!runner) {
    res.json({ active: false, commandId: null, eventCount: 0, status: "none" });
    return;
  }

  res.json({
    active: runner.status === "running",
    commandId: runner.commandId,
    eventCount: runner.eventCount,
    status: runner.status,
    exitCode: runner.exitCode,
  });
}

router.get("/status", handleTerminalStatus);

// POST /api/terminal/reconnect — replay + subscribe to running command
export function handleTerminalReconnect(req: import("express").Request, res: import("express").Response) {
  const { commandId, fromIndex } = req.body as { commandId?: string; fromIndex?: number };

  if (!commandId) {
    res.status(400).json({ error: "commandId is required" });
    return;
  }

  const runner = activeTerminals.get(commandId);
  if (!runner) {
    res.status(404).json({ error: "No active or recent command with this ID" });
    return;
  }

  // Set up SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const writeEvent = (type: string, data: unknown, index?: number) => {
    res.write(`data: ${JSON.stringify({ type, data, index })}\n\n`);
  };

  // Replay from requested index
  const startIndex = typeof fromIndex === "number" ? fromIndex + 1 : 0;
  const { events, gap } = runner.replayFrom(startIndex);

  if (gap) {
    writeEvent("buffer_gap", {
      message: "Some output was lost due to buffer overflow",
      firstAvailable: runner.firstBufferedIndex,
      requested: startIndex,
    });
  }

  for (const event of events) {
    writeEvent(event.type, event.data, event.index);
  }

  // If command is done, close
  if (runner.status !== "running") {
    writeEvent("reconnect_complete", { status: runner.status, exitCode: runner.exitCode });
    res.end();
    return;
  }

  // Still running — subscribe as live listener
  const { listener, heartbeat } = subscribeTerminalResponse(res, runner);

  res.on("close", () => {
    console.error(`[terminal] reconnect client disconnected from command ${commandId}`);
    clearInterval(heartbeat);
    runner.removeListener(listener);
  });
}

router.post("/reconnect", handleTerminalReconnect);

export default router;
