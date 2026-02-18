import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockRequest, createMockResponse } from "../test-utils.js";
import { handleTerminalPost, handleTerminalStatus, handleTerminalReconnect } from "./terminal.js";

describe("POST /api/terminal (handleTerminalPost)", () => {
  const originalBaseDir = process.env.BASE_DIR;

  afterEach(() => {
    if (originalBaseDir !== undefined) {
      process.env.BASE_DIR = originalBaseDir;
    } else {
      delete process.env.BASE_DIR;
    }
  });

  it("returns 500 when BASE_DIR is not set", () => {
    delete process.env.BASE_DIR;
    const req = createMockRequest({ body: { command: "ls", projectPath: "." } });
    const res = createMockResponse();

    handleTerminalPost(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "BASE_DIR not configured on cc-server" });
  });

  it("returns 400 when command is missing", () => {
    process.env.BASE_DIR = "/tmp";
    const req = createMockRequest({ body: { projectPath: "." } });
    const res = createMockResponse();

    handleTerminalPost(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "command and projectPath are required" });
  });

  it("returns 400 when projectPath is missing", () => {
    process.env.BASE_DIR = "/tmp";
    const req = createMockRequest({ body: { command: "ls" } });
    const res = createMockResponse();

    handleTerminalPost(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "command and projectPath are required" });
  });

  it("returns 403 for path traversal", () => {
    process.env.BASE_DIR = "/tmp/safe-dir";
    const req = createMockRequest({ body: { command: "ls", projectPath: "../../etc" } });
    const res = createMockResponse();

    handleTerminalPost(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Path traversal not allowed" });
  });
});

describe("GET /api/terminal/status (handleTerminalStatus)", () => {
  it("returns 400 without commandId", () => {
    const req = createMockRequest({ query: {} });
    const res = createMockResponse();

    handleTerminalStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "commandId is required" });
  });

  it("returns { active: false } for unknown commandId", () => {
    const req = createMockRequest({ query: { commandId: "nonexistent" } });
    const res = createMockResponse();

    handleTerminalStatus(req, res);

    expect(res.json).toHaveBeenCalledWith({
      active: false,
      commandId: null,
      eventCount: 0,
      status: "none",
    });
  });
});

describe("POST /api/terminal/reconnect (handleTerminalReconnect)", () => {
  it("returns 400 without commandId", () => {
    const req = createMockRequest({ body: {} });
    const res = createMockResponse();

    handleTerminalReconnect(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "commandId is required" });
  });

  it("returns 404 for unknown commandId", () => {
    const req = createMockRequest({ body: { commandId: "nonexistent" } });
    const res = createMockResponse();

    handleTerminalReconnect(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "No active or recent command with this ID" });
  });
});
