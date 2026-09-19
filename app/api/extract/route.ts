/**
 * Reads a bill that has already been uploaded.
 *
 * This is the seam between the two halves of the app. Everything upstream
 * deals in photos; everything downstream deals in an ExtractedBill and never
 * needs to know a photo existed.
 *
 * POST { s3Key } -> { bill: ExtractedBill }
 */

import { NextResponse } from "next/server";
import { extractBill } from "@/lib/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Textract on a large photo is slow enough to need the headroom. */
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: { s3Key?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const s3Key = body.s3Key?.trim();
  if (!s3Key) {
    return NextResponse.json({ error: "s3Key is required" }, { status: 400 });
  }
  // The key is ours to mint, so anything outside the bills prefix did not come
  // from this app and should not be handed to Textract on our bill.
  if (!s3Key.startsWith("bills/")) {
    return NextResponse.json({ error: "Unrecognised s3Key" }, { status: 400 });
  }

  try {
    const bill = await extractBill(s3Key);
    return NextResponse.json({ bill });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Worth surfacing rather than swallowing: almost every failure here is
    // either an unreadable photo or a missing Textract permission, and the
    // two look nothing alike once you can see the message.
    console.error("extract failed", { s3Key, message });
    return NextResponse.json(
      { error: `Could not read that bill. ${message}` },
      { status: 502 },
    );
  }
}
