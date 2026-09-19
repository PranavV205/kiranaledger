/**
 * Where a bill stops being a photo and becomes a ledger entry.
 *
 * The order matters and is the whole point of the product: the checks run
 * against history BEFORE the write, so a bill that looks wrong arrives with
 * the reason already attached rather than being filed silently and queried
 * later.
 *
 * POST { bill, s3Key } -> { billId, flags, status }
 * GET                  -> { bills }
 */

import { NextResponse } from "next/server";
import type { ExtractedBill } from "@/lib/types";
import {
  getAllBills,
  getLastItemPrice,
  getSupplierBills,
  putBill,
  slugify,
  type PricePoint,
} from "@/lib/ledger";
import {
  detectDueSoon,
  detectDuplicate,
  detectPriceJumps,
  type Finding,
} from "@/lib/reasoning/checks";
import { explainFindings } from "@/lib/reasoning/explain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: { bill?: ExtractedBill; s3Key?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const bill = body.bill;
  if (!bill?.supplierName || !bill.billDate || !Array.isArray(bill.lineItems)) {
    return NextResponse.json(
      { error: "bill must include supplierName, billDate and lineItems" },
      { status: 400 },
    );
  }

  const supplierSlug = slugify(bill.supplierName);

  try {
    // Both lookups feed the checks, and neither depends on the other, so they
    // go together. On a four line bill that is five reads in one round trip.
    const [history, pricePoints] = await Promise.all([
      getSupplierBills(supplierSlug),
      Promise.all(
        bill.lineItems
          .filter((item) => item.unitPrice !== null)
          .map(async (item) => [item.name, await getLastItemPrice(supplierSlug, item.name)] as const),
      ),
    ]);

    const previous = new Map<string, PricePoint>();
    for (const [name, point] of pricePoints) {
      if (point) previous.set(name, point);
    }

    const today = new Date().toISOString().slice(0, 10);
    const findings: Finding[] = [
      detectDuplicate(bill, history),
      ...detectPriceJumps(bill, previous),
      detectDueSoon(bill, today),
    ].filter((f): f is Finding => f !== null);

    // Phrasing can fail; the decision cannot. explainFindings falls back to
    // templates internally, so this always returns one flag per finding.
    const flags = await explainFindings(findings);

    const saved = await putBill({ bill, s3Key: body.s3Key ?? "", flags });

    return NextResponse.json({
      billId: saved.billId,
      status: saved.status,
      flags: saved.flags,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("saving bill failed", { supplierSlug, message });
    return NextResponse.json(
      { error: `Could not save this bill. ${message}` },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    return NextResponse.json({ bills: await getAllBills() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("reading ledger failed", message);
    return NextResponse.json({ error: `Could not read the ledger. ${message}` }, { status: 500 });
  }
}
