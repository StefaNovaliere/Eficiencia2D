import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const bypassKey = process.env.MP_BYPASS_KEY;
  if (!bypassKey) {
    // `configured: false` lets the UI explain that the bypass isn't set up in
    // this environment (e.g. local sin .env.local) en vez de "código inválido".
    return NextResponse.json({ valid: false, configured: false });
  }

  let body: { key?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ valid: false });
  }

  const valid = typeof body.key === "string" && body.key.length > 0 && body.key === bypassKey;
  return NextResponse.json({ valid });
}
