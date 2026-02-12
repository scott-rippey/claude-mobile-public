import { serverFetch } from "@/lib/server-api";

export async function GET() {
  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    tunnelUrl: process.env.TUNNEL_URL || "(not set — using localhost:3002)",
    sharedSecret: process.env.SHARED_SECRET ? "set (" + process.env.SHARED_SECRET.length + " chars)" : "(not set)",
  };

  // Step 1: Health check
  try {
    const health = await serverFetch("/health", undefined, 5000);
    const data = await health.text();
    results.health = { status: health.status, body: data };
  } catch (err) {
    results.health = { error: err instanceof Error ? err.message : String(err) };
  }

  // Step 2: Terminal echo test
  try {
    const terminal = await serverFetch("/api/terminal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "echo __terminal_test_ok__", projectPath: "." }),
    }, 10000);

    const rawBody = await terminal.text();
    results.terminal = {
      status: terminal.status,
      contentType: terminal.headers.get("content-type"),
      bodyLength: rawBody.length,
      bodyPreview: rawBody.slice(0, 500),
    };
  } catch (err) {
    results.terminal = { error: err instanceof Error ? err.message : String(err) };
  }

  return Response.json(results, {
    headers: { "Cache-Control": "no-store" },
  });
}
