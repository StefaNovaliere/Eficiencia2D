import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    mode: "client-side",
    version: "0.1.0",
  });
}
