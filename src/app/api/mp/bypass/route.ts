import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const bypassKey = process.env.MP_BYPASS_KEY;
  if (!bypassKey) {
    return NextResponse.json({ valid: false });
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
