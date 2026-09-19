/**
 * Photo in S3 to a validated ExtractedBill.
 *
 * The contract in lib/types.ts is frozen, so this is the only place that
 * decides how a Textract response becomes one. Anything it cannot establish
 * is left null and recorded in `warnings`, never guessed: the ledger compares
 * these numbers against history, and a confidently wrong price is worse than
 * an obviously missing one.
 */

import type { ExtractedBill, ExtractedLineItem } from "@/lib/types";
import { analyseBill, type RawExpense } from "./textract";
import {
  cleanItemName,
  parseAmount,
  parseDate,
  parseQuantity,
} from "./normalise";

/** Rupee tolerance when checking line items against the printed total. */
const SUM_TOLERANCE = 1;

/** Below this, the UI should tell the user to check the numbers themselves. */
const LOW_CONFIDENCE = 0.8;

export function toExtractedBill(raw: RawExpense): ExtractedBill {
  const warnings: string[] = [];

  const lineItems: ExtractedLineItem[] = raw.lineItems.map((row) => {
    const { quantity, unit } = parseQuantity(row.quantity);
    const unitPrice = parseAmount(row.unitPrice);
    const lineTotal = parseAmount(row.price);

    // Bills routinely print two of these three and leave the reader to infer
    // the third. The ledger needs a unit price to compare across bills, so
    // recover it when the arithmetic is unambiguous.
    let resolvedQuantity = quantity;
    let resolvedUnitPrice = unitPrice;
    if (resolvedQuantity === null && unitPrice && lineTotal && unitPrice !== 0) {
      resolvedQuantity = round(lineTotal / unitPrice, 3);
    }
    if (resolvedUnitPrice === null && lineTotal && resolvedQuantity) {
      resolvedUnitPrice = round(lineTotal / resolvedQuantity, 2);
    }

    return {
      name: cleanItemName(row.item),
      quantity: resolvedQuantity,
      unit,
      unitPrice: resolvedUnitPrice,
      lineTotal,
    };
  });

  const total = parseAmount(raw.total);
  const billDate = parseDate(raw.invoiceDate);

  const supplierName = raw.vendorName ?? raw.firstLine ?? null;
  if (!raw.vendorName && supplierName) {
    warnings.push("Supplier name was taken from the bill header, not a labelled field");
  }
  if (!supplierName) {
    warnings.push("Could not read the supplier name");
  }
  if (total === null) {
    warnings.push("Could not read the bill total");
  }
  if (!billDate) {
    warnings.push("Could not read the bill date, today's date was used instead");
  }

  const summed = lineItems.reduce((n, item) => n + (item.lineTotal ?? 0), 0);
  if (total !== null && lineItems.length > 0 && Math.abs(summed - total) > SUM_TOLERANCE) {
    warnings.push(
      `Line items add up to ${summed.toFixed(2)} but the bill total reads ${total.toFixed(2)}`,
    );
  }
  if (lineItems.length === 0) {
    warnings.push("No line items were found on this bill");
  }
  const missingPrices = lineItems.filter((i) => i.unitPrice === null).length;
  if (missingPrices > 0) {
    warnings.push(
      `${missingPrices} item${missingPrices > 1 ? "s have" : " has"} no unit price, so ${missingPrices > 1 ? "they" : "it"} cannot be price checked`,
    );
  }

  const confidence = raw.confidences.length
    ? round(
        raw.confidences.reduce((a, b) => a + b, 0) / raw.confidences.length / 100,
        3,
      )
    : 0;
  if (confidence > 0 && confidence < LOW_CONFIDENCE) {
    warnings.push("The photo was hard to read, please check these numbers");
  }

  return {
    supplierName: supplierName ?? "Unknown supplier",
    billNumber: raw.invoiceId,
    billDate: billDate ?? today(),
    dueDate: parseDate(raw.dueDate),
    lineItems,
    subtotal: parseAmount(raw.subtotal),
    tax: parseAmount(raw.tax),
    total: total ?? round(summed, 2),
    currency: "INR",
    confidence,
    warnings,
  };
}

/** Reads the bill at `s3Key` and returns it on the frozen contract. */
export async function extractBill(s3Key: string): Promise<ExtractedBill> {
  return toExtractedBill(await analyseBill(s3Key));
}

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export { analyseBill };
