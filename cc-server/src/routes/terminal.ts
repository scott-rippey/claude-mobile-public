import { Router } from "express";
import { spawn } from "child_process";
import path from "path";

const router = Router();

// POST /api/terminal — execute a command, stream output as SSE
router.post("/", (req, res) => {
  const baseDir = process.env.BASE_DIR!;
  const { command, projectPath } = req.body as {
    command: string;
    projectPath: string;
  };

  if (!command || !projectPath) {
    res.status(400).json({ error: "command and projectPath are required" });
    return;
  }

  // Validate projectPath doesn't escape BASE_DIR
  const cwd = path.resolve(baseDir, projectPath);
  if (!cwd.startsWith(path.resolve(baseDir))) {
    res.status(403).json({ error: "Path traversal not allowed" });
    return;
  }

  // Set up SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const sendEvent = (type: string, data: unknown) => {
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  };

  const child = spawn("bash", ["-c", command], {
    cwd,
    env: { ...process.env, TERM: "dumb" },
  });

  child.stdout.on("data", (chunk: Buffer) => {
    sendEvent("stdout", chunk.toString());
  });

  child.stderr.on("data", (chunk: Buffer) => {
    sendEvent("stderr", chunk.toString());
  });

  child.on("close", (code) => {
    sendEvent("exit", { code });
    res.end();
  });

  child.on("error", (err) => {
    sendEvent("error", { message: err.message });
    res.end();
  });

  // Kill child process if client disconnects
  req.on("close", () => {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  });
});

export default router;
