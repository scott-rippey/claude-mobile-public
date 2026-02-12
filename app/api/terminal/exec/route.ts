import { NextRequest } from "next/server";
import { serverFetch } from "@/lib/server-api";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ output: "", exitCode: 1, error: "Invalid request body" }, { status: 400 });
  }

  try {
    const res = await serverFetch("/api/terminal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const rawBody = await res.text();
      let errorMsg: string;
      try {
        const parsed = JSON.parse(rawBody);
        errorMsg = parsed.error || rawBody;
      } catch {
        errorMsg = rawBody || `cc-server returned ${res.status}`;
      }
      return Response.json({ output: errorMsg, exitCode: 1 }, { status: 200 });
    }

    // Consume the SSE stream server-side and collect output
    const sseBody = await res.text();
    let output = "";
    let exitCode = 0;

    for (const line of sseBody.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        const event = JSON.parse(line.slice(6));
        if (event.type === "stdout" || event.type === "stderr") {
          output += event.data;
        } else if (event.type === "exit") {
          exitCode = event.data.code ?? 0;
        } else if (event.type === "error") {
          output += event.data.message || "Unknown error";
          exitCode = 1;
        }
      } catch {
        // skip malformed SSE lines
      }
    }

    return Response.json({ output, exitCode });
  } catch (err) {
    console.error("[terminal proxy] error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ output: `Failed to connect to cc-server: ${msg}`, exitCode: 1 }, { status: 200 });
  }
}
