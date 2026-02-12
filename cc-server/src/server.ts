import "dotenv/config";
import express from "express";
import cors from "cors";
import { authMiddleware } from "./auth-middleware.js";
import filesRouter from "./routes/files.js";
import fileRouter from "./routes/file.js";
import chatRouter from "./routes/chat.js";
import terminalRouter from "./routes/terminal.js";

const app = express();
const port = parseInt(process.env.PORT || "3020", 10);

app.use(cors());
app.use(express.json());

// Health check (no auth)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// All /api routes require auth
app.use("/api", authMiddleware);
app.use("/api/files", filesRouter);
app.use("/api/file", fileRouter);
app.use("/api/chat", chatRouter);
app.use("/api/terminal", terminalRouter);

app.listen(port, () => {
  console.error(`CC Server running on http://localhost:${port}`);
  console.error(`Base directory: ${process.env.BASE_DIR}`);
});
