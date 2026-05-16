import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const backendRes = await fetch(`${BACKEND_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!backendRes.ok) {
      const data = await backendRes.json();
      return NextResponse.json(data, { status: backendRes.status });
    }

    const data = await backendRes.json();
    const sse = `event: final\ndata: ${JSON.stringify(data)}\n\n`;

    return new NextResponse(sse, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (err) {
    console.error("[proxy /api/chat] Error:", err);
    return NextResponse.json(
      { answer: `Proxy error: ${err instanceof Error ? err.message : "Unknown error"}`, chart: null },
      { status: 500 }
    );
  }
}
