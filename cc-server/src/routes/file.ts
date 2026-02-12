import { Router } from "express";
import { readFile, stat } from "fs/promises";
import path from "path";

const router = Router();

const EXTENSION_LANGUAGES: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".mdx": "markdown",
  ".css": "css",
  ".scss": "scss",
  ".html": "html",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".sql": "sql",
  ".graphql": "graphql",
  ".env": "shell",
  ".toml": "toml",
  ".txt": "text",
  ".csv": "csv",
  ".svg": "xml",
};

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico",
  ".woff", ".woff2", ".ttf", ".eot",
  ".mp3", ".mp4", ".wav", ".webm",
  ".zip", ".tar", ".gz", ".br",
  ".pdf", ".doc", ".docx",
  ".exe", ".dll", ".so", ".dylib",
]);

const MAX_FILE_SIZE = 1024 * 1024; // 1MB

// GET /api/file?path=relative/path/to/file
router.get("/", async (req, res) => {
  const baseDir = process.env.BASE_DIR!;
  const relativePath = req.query.path as string;

  if (!relativePath) {
    res.status(400).json({ error: "path query parameter is required" });
    return;
  }

  // Security: prevent path traversal
  const resolved = path.resolve(baseDir, relativePath);
  if (!resolved.startsWith(path.resolve(baseDir))) {
    res.status(403).json({ error: "Path traversal not allowed" });
    return;
  }

  const ext = path.extname(resolved).toLowerCase();

  if (BINARY_EXTENSIONS.has(ext)) {
    res.status(400).json({ error: "Binary files are not supported" });
    return;
  }

  try {
    const stats = await stat(resolved);
    if (stats.size > MAX_FILE_SIZE) {
      res.status(400).json({ error: "File too large (max 1MB)" });
      return;
    }

    const content = await readFile(resolved, "utf-8");
    const language = EXTENSION_LANGUAGES[ext] || "text";

    res.json({ content, path: relativePath, language });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("ENOENT")) {
      res.status(404).json({ error: "File not found" });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

export default router;
