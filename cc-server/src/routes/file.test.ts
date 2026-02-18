import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { createMockRequest, createMockResponse, createTempDir, cleanupTempDir } from "../test-utils.js";
import { handleReadFile } from "./file.js";

describe("GET /api/file (handleReadFile)", () => {
  let tmpDir: string;
  const originalBaseDir = process.env.BASE_DIR;

  beforeEach(async () => {
    tmpDir = await createTempDir();
    process.env.BASE_DIR = tmpDir;

    // Create test files
    await mkdir(path.join(tmpDir, "subdir"));
    await writeFile(path.join(tmpDir, "example.ts"), 'const x: number = 42;\nexport default x;\n');
    await writeFile(path.join(tmpDir, "styles.css"), "body { color: red; }");
    await writeFile(path.join(tmpDir, "readme.md"), "# Title\n\nSome text.");
    await writeFile(path.join(tmpDir, "data.xyz"), "unknown format");
    await writeFile(path.join(tmpDir, "photo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(path.join(tmpDir, "subdir", "nested.json"), '{"key": "value"}');
  });

  afterEach(async () => {
    await cleanupTempDir(tmpDir);
    if (originalBaseDir !== undefined) {
      process.env.BASE_DIR = originalBaseDir;
    } else {
      delete process.env.BASE_DIR;
    }
  });

  it("reads a TypeScript file with correct language", async () => {
    const req = createMockRequest({ query: { path: "example.ts" } });
    const res = createMockResponse();

    await handleReadFile(req, res);

    expect(res.json).toHaveBeenCalledWith({
      content: 'const x: number = 42;\nexport default x;\n',
      path: "example.ts",
      language: "typescript",
    });
  });

  it("detects CSS language", async () => {
    const req = createMockRequest({ query: { path: "styles.css" } });
    const res = createMockResponse();

    await handleReadFile(req, res);

    const call = res.json.mock.calls[0][0];
    expect(call.language).toBe("css");
  });

  it("detects markdown language", async () => {
    const req = createMockRequest({ query: { path: "readme.md" } });
    const res = createMockResponse();

    await handleReadFile(req, res);

    const call = res.json.mock.calls[0][0];
    expect(call.language).toBe("markdown");
  });

  it("returns 'text' for unrecognized extensions", async () => {
    const req = createMockRequest({ query: { path: "data.xyz" } });
    const res = createMockResponse();

    await handleReadFile(req, res);

    const call = res.json.mock.calls[0][0];
    expect(call.language).toBe("text");
  });

  it("returns 400 when path param is missing", async () => {
    const req = createMockRequest({ query: {} });
    const res = createMockResponse();

    await handleReadFile(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "path query parameter is required" });
  });

  it("returns 400 for binary files", async () => {
    const req = createMockRequest({ query: { path: "photo.png" } });
    const res = createMockResponse();

    await handleReadFile(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Binary files are not supported" });
  });

  it("returns 400 for files >1MB", async () => {
    // Create a file just over 1MB
    const bigContent = "x".repeat(1024 * 1024 + 1);
    await writeFile(path.join(tmpDir, "big.txt"), bigContent);

    const req = createMockRequest({ query: { path: "big.txt" } });
    const res = createMockResponse();

    await handleReadFile(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "File too large (max 1MB)" });
  });

  it("returns 404 for nonexistent file", async () => {
    const req = createMockRequest({ query: { path: "no-such-file.ts" } });
    const res = createMockResponse();

    await handleReadFile(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "File not found" });
  });

  it("returns 403 for path traversal", async () => {
    const req = createMockRequest({ query: { path: "../../etc/passwd" } });
    const res = createMockResponse();

    await handleReadFile(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Path traversal not allowed" });
  });

  it("handles files in subdirectories", async () => {
    const req = createMockRequest({ query: { path: "subdir/nested.json" } });
    const res = createMockResponse();

    await handleReadFile(req, res);

    expect(res.json).toHaveBeenCalledWith({
      content: '{"key": "value"}',
      path: "subdir/nested.json",
      language: "json",
    });
  });

  it("rejects .pdf as binary", async () => {
    await writeFile(path.join(tmpDir, "doc.pdf"), "fake pdf");
    const req = createMockRequest({ query: { path: "doc.pdf" } });
    const res = createMockResponse();

    await handleReadFile(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Binary files are not supported" });
  });
});
