import { NextRequest, NextResponse } from "next/server";
import { serverFetch } from "@/lib/server-api";

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path") || "";

  try {
    const res = await serverFetch(`/api/files?path=${encodeURIComponent(path)}`);
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Failed to connect to server" },
      { status: 502 }
    );
  }
}
