import { Router } from "express";
import { readdir, stat } from "fs/promises";
import path from "path";
import type { FileEntry } from "../types.js";

const router = Router();

// GET /api/files?path=relative/path
router.get("/", async (req, res) => {
  const baseDir = process.env.BASE_DIR!;
  const relativePath = (req.query.path as string) || "";

  // Security: prevent path traversal
  const resolved = path.resolve(baseDir, relativePath);
  if (!resolved.startsWith(path.resolve(baseDir))) {
    res.status(403).json({ error: "Path traversal not allowed" });
    return;
  }

  try {
    const dirents = await readdir(resolved, { withFileTypes: true });
    const entries: FileEntry[] = await Promise.all(
      dirents
        .filter((d) => !d.name.startsWith("."))
        .map(async (d) => {
          const fullPath = path.join(resolved, d.name);
          const stats = await stat(fullPath).catch(() => null);
          return {
            name: d.name,
            type: d.isDirectory() ? ("directory" as const) : ("file" as const),
            size: stats?.size ?? 0,
            modified: stats?.mtime.toISOString() ?? "",
          };
        })
    );

    // Sort: directories first, then alphabetical
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ entries, path: relativePath });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("ENOENT")) {
      res.status(404).json({ error: "Directory not found" });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

export default router;
