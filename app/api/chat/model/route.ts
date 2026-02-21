import { NextRequest } from "next/server";
import { serverFetch } from "@/lib/server-api";

export async function POST(request: NextRequest) {
  const body = await request.json();

  try {
    const res = await serverFetch("/api/chat/model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(
      JSON.stringify({ error: "Failed to connect to server" }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}
