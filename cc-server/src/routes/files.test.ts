import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { createMockRequest, createMockResponse, createTempDir, cleanupTempDir } from "../test-utils.js";
import { handleListFiles, handleMkdir } from "./files.js";

describe("GET /api/files (handleListFiles)", () => {
  let tmpDir: string;
  const originalBaseDir = process.env.BASE_DIR;

  beforeEach(async () => {
    tmpDir = await createTempDir();
    process.env.BASE_DIR = tmpDir;

    // Create test structure:
    // tmpDir/
    //   subdir/
    //   file-a.ts
    //   file-b.md
    //   .hidden-file
    await mkdir(path.join(tmpDir, "subdir"));
    await writeFile(path.join(tmpDir, "file-a.ts"), "const x = 1;");
    await writeFile(path.join(tmpDir, "file-b.md"), "# Hello");
    await writeFile(path.join(tmpDir, ".hidden-file"), "secret");
  });

  afterEach(async () => {
    await cleanupTempDir(tmpDir);
    if (originalBaseDir !== undefined) {
      process.env.BASE_DIR = originalBaseDir;
    } else {
      delete process.env.BASE_DIR;
    }
  });

  it("lists files and directories", async () => {
    const req = createMockRequest({ query: {} });
    const res = createMockResponse();

    await handleListFiles(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: expect.arrayContaining([
          expect.objectContaining({ name: "subdir", type: "directory" }),
          expect.objectContaining({ name: "file-a.ts", type: "file" }),
          expect.objectContaining({ name: "file-b.md", type: "file" }),
        ]),
        path: "",
      })
    );
  });

  it("filters hidden files (dotfiles)", async () => {
    const req = createMockRequest({ query: {} });
    const res = createMockResponse();

    await handleListFiles(req, res);

    const call = res.json.mock.calls[0][0];
    const names = call.entries.map((e: { name: string }) => e.name);
    expect(names).not.toContain(".hidden-file");
  });

  it("sorts directories first, then alphabetically", async () => {
    const req = createMockRequest({ query: {} });
    const res = createMockResponse();

    await handleListFiles(req, res);

    const call = res.json.mock.calls[0][0];
    const names = call.entries.map((e: { name: string }) => e.name);
    expect(names[0]).toBe("subdir"); // directory comes first
    expect(names.indexOf("file-a.ts")).toBeLessThan(names.indexOf("file-b.md"));
  });

  it("returns correct entry structure (name, type, size, modified)", async () => {
    const req = createMockRequest({ query: {} });
    const res = createMockResponse();

    await handleListFiles(req, res);

    const call = res.json.mock.calls[0][0];
    const fileEntry = call.entries.find((e: { name: string }) => e.name === "file-a.ts");
    expect(fileEntry).toEqual({
      name: "file-a.ts",
      type: "file",
      size: expect.any(Number),
      modified: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(fileEntry.size).toBeGreaterThan(0);
  });

  it("lists subdirectories when path is provided", async () => {
    await writeFile(path.join(tmpDir, "subdir", "nested.txt"), "nested content");
    const req = createMockRequest({ query: { path: "subdir" } });
    const res = createMockResponse();

    await handleListFiles(req, res);

    const call = res.json.mock.calls[0][0];
    expect(call.entries).toEqual([
      expect.objectContaining({ name: "nested.txt", type: "file" }),
    ]);
    expect(call.path).toBe("subdir");
  });

  it("returns 404 for nonexistent directory", async () => {
    const req = createMockRequest({ query: { path: "no-such-dir" } });
    const res = createMockResponse();

    await handleListFiles(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Directory not found" });
  });

  it("returns 403 for path traversal", async () => {
    const req = createMockRequest({ query: { path: "../../etc" } });
    const res = createMockResponse();

    await handleListFiles(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Path traversal not allowed" });
  });

  it("returns empty entries for empty directory", async () => {
    await mkdir(path.join(tmpDir, "empty-dir"));
    const req = createMockRequest({ query: { path: "empty-dir" } });
    const res = createMockResponse();

    await handleListFiles(req, res);

    const call = res.json.mock.calls[0][0];
    expect(call.entries).toEqual([]);
  });
});

describe("POST /api/files/mkdir (handleMkdir)", () => {
  let tmpDir: string;
  const originalBaseDir = process.env.BASE_DIR;

  beforeEach(async () => {
    tmpDir = await createTempDir();
    process.env.BASE_DIR = tmpDir;
  });

  afterEach(async () => {
    await cleanupTempDir(tmpDir);
    if (originalBaseDir !== undefined) {
      process.env.BASE_DIR = originalBaseDir;
    } else {
      delete process.env.BASE_DIR;
    }
  });

  it("creates a new folder", async () => {
    const req = createMockRequest({ body: { path: "", name: "new-folder" } });
    const res = createMockResponse();

    await handleMkdir(req, res);

    expect(res.json).toHaveBeenCalledWith({ ok: true, name: "new-folder" });
  });

  it("rejects names containing /", async () => {
    const req = createMockRequest({ body: { path: "", name: "bad/name" } });
    const res = createMockResponse();

    await handleMkdir(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid folder name" });
  });

  it("rejects names containing ..", async () => {
    const req = createMockRequest({ body: { path: "", name: ".." } });
    const res = createMockResponse();

    await handleMkdir(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid folder name" });
  });

  it("rejects empty names", async () => {
    const req = createMockRequest({ body: { path: "", name: "" } });
    const res = createMockResponse();

    await handleMkdir(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid folder name" });
  });

  it("returns 409 for existing folder", async () => {
    await mkdir(path.join(tmpDir, "existing"));
    const req = createMockRequest({ body: { path: "", name: "existing" } });
    const res = createMockResponse();

    await handleMkdir(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "Folder already exists" });
  });

  it("blocks path traversal in parent path", async () => {
    const req = createMockRequest({ body: { path: "../../etc", name: "hacked" } });
    const res = createMockResponse();

    await handleMkdir(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Path traversal not allowed" });
  });

  it("creates folder in subdirectory", async () => {
    await mkdir(path.join(tmpDir, "parent"));
    const req = createMockRequest({ body: { path: "parent", name: "child" } });
    const res = createMockResponse();

    await handleMkdir(req, res);

    expect(res.json).toHaveBeenCalledWith({ ok: true, name: "child" });
  });
});
