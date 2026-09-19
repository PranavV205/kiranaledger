/**
 * The part that makes this more than an OCR pipeline.
 *
 * Everything here is pure: bill in, findings out, no database and no network.
 * That is deliberate. These are the decisions the product exists to make, so
 * they need to be runnable against a fixture in milliseconds, and a model
 * should never be asked to do the arithmetic that produces them.
 *
 * A finding is a fact with a severity attached. Turning it into something a
 * shop owner wants to read happens in explain.ts, and it happens afterwards,
 * never before.
 */

import type { ExtractedBill, FlagType, LedgerBill } from "@/lib/types";
import type { PricePoint } from "@/lib/ledger";
import {
  DUE_SOON_DAYS,
  DUPLICATE_TOTAL_FRACTION,
  DUPLICATE_WINDOW_DAYS,
  PRICE_JUMP_ABSOLUTE,
  PRICE_JUMP_FRACTION,
  PRICE_JUMP_HIGH_FRACTION,
} from "./thresholds";

export type Finding = {
  type: FlagType;
  severity: "high" | "medium" | "low";
  evidence: Record<string, string | number>;
};

const DAY_MS = 86_400_000;

function daysBetween(a: string, b: string): number {
  return Math.abs(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS,
  );
}

/**
 * Has this bill already been recorded?
 *
 * Two routes to the same answer. A matching bill number from the same
 * supplier is as close to certainty as this gets, so it stops the write. A
 * near identical total inside a short window is suggestive rather than
 * conclusive, because the second photograph of a bill rarely produces exactly
 * the same total, and that near miss is precisely the case a naive equality
 * check would sail past.
 */
export function detectDuplicate(
  bill: ExtractedBill,
  history: LedgerBill[],
): Finding | null {
  if (bill.billNumber) {
    const sameNumber = history.find(
      (prior) =>
        prior.billNumber &&
        prior.billNumber.toLowerCase() === bill.billNumber!.toLowerCase(),
    );
    if (sameNumber) {
      return {
        type: "DUPLICATE",
        severity: "high",
        evidence: {
          reason: "matching bill number",
          billNumber: bill.billNumber,
          supplier: bill.supplierName,
          recordedOn: sameNumber.createdAt.slice(0, 10),
          recordedTotal: sameNumber.total ?? 0,
          newTotal: bill.total ?? 0,
          existingBillId: sameNumber.billId,
        },
      };
    }
  }

  if (bill.total === null) return null;

  for (const prior of history) {
    if (prior.total === null) continue;
    const gap = daysBetween(bill.billDate, prior.billDate);
    if (gap > DUPLICATE_WINDOW_DAYS) continue;

    const spread = Math.abs(prior.total - bill.total);
    const largest = Math.max(Math.abs(prior.total), Math.abs(bill.total), 1);
    if (spread / largest > DUPLICATE_TOTAL_FRACTION) continue;

    return {
      type: "DUPLICATE",
      severity: "medium",
      evidence: {
        reason: "near identical total within a few days",
        supplier: bill.supplierName,
        newTotal: bill.total,
        recordedTotal: prior.total,
        differenceRupees: Number(spread.toFixed(2)),
        daysApart: Math.round(gap),
        existingBillId: prior.billId,
      },
    };
  }
  return null;
}

/**
 * Has this supplier changed what they charge?
 *
 * Compared against the last recorded price for the same item from the same
 * supplier. Items with no prior history are skipped in silence: a first
 * appearance is not a price change, and saying so on every new item would
 * make the first week of use unusable.
 */
export function detectPriceJumps(
  bill: ExtractedBill,
  previous: Map<string, PricePoint>,
): Finding[] {
  const findings: Finding[] = [];

  for (const item of bill.lineItems) {
    if (item.unitPrice === null) continue;
    const prior = previous.get(item.name);
    if (!prior || prior.unitPrice === 0) continue;

    const change = item.unitPrice - prior.unitPrice;
    const fraction = change / prior.unitPrice;
    if (Math.abs(fraction) < PRICE_JUMP_FRACTION) continue;
    if (Math.abs(change) < PRICE_JUMP_ABSOLUTE) continue;

    findings.push({
      type: "PRICE_JUMP",
      severity: Math.abs(fraction) >= PRICE_JUMP_HIGH_FRACTION ? "high" : "medium",
      evidence: {
        supplier: bill.supplierName,
        item: item.name,
        previousUnitPrice: prior.unitPrice,
        newUnitPrice: item.unitPrice,
        changeRupees: Number(change.toFixed(2)),
        percentChange: Number((fraction * 100).toFixed(1)),
        direction: change > 0 ? "increase" : "decrease",
        previousBillDate: prior.billDate,
        unit: item.unit ?? "unit",
      },
    });
  }
  return findings;
}

/** Is this one about to be due? Cheap to check, and it is why people miss payments. */
export function detectDueSoon(bill: ExtractedBill, today: string): Finding | null {
  if (!bill.dueDate) return null;
  const due = Date.parse(`${bill.dueDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  const days = Math.round((due - now) / DAY_MS);
  if (days > DUE_SOON_DAYS) return null;

  return {
    type: "DUE_SOON",
    severity: days < 0 ? "high" : days <= 2 ? "medium" : "low",
    evidence: {
      supplier: bill.supplierName,
      dueDate: bill.dueDate,
      daysUntilDue: days,
      amount: bill.total ?? 0,
      overdue: days < 0 ? "yes" : "no",
    },
  };
}
