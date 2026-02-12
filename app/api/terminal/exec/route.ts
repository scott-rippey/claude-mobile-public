import { NextRequest } from "next/server";
import { serverFetch } from "@/lib/server-api";

export async function POST(request: NextRequest) {
  const body = await request.json();

  try {
    const res = await serverFetch("/api/terminal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // Read body as text first (can only consume once), then try JSON
      const rawBody = await res.text();
      let errorData: string;
      try {
        const data = JSON.parse(rawBody);
        errorData = JSON.stringify(data);
      } catch {
        errorData = JSON.stringify({ error: rawBody || `Server error ${res.status}` });
      }
      return new Response(errorData, {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Pass through the SSE stream
    return new Response(res.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("[terminal proxy] error:", err);
    return new Response(
      JSON.stringify({ error: "Failed to connect to cc-server" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}
