import { Router } from "express";
import { spawn } from "child_process";
import path from "path";

const router = Router();

// POST /api/terminal — execute a command, stream output as SSE
router.post("/", (req, res) => {
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

  console.error("[terminal] Child process PID:", child.pid);

  child.stdout.on("data", (chunk: Buffer) => {
    console.error("[terminal] stdout:", chunk.toString().slice(0, 200));
    sendEvent("stdout", chunk.toString());
  });

  child.stderr.on("data", (chunk: Buffer) => {
    console.error("[terminal] stderr:", chunk.toString().slice(0, 200));
    sendEvent("stderr", chunk.toString());
  });

  child.on("close", (code) => {
    console.error("[terminal] Process exited with code:", code);
    sendEvent("exit", { code });
    res.end();
  });

  child.on("error", (err) => {
    console.error("[terminal] Process error:", err.message);
    sendEvent("error", { message: err.message });
    res.end();
  });

  // Kill child process if client disconnects
  req.on("close", () => {
    console.error("[terminal] Client disconnected");
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  });
});

export default router;
