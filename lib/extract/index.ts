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

/**
 * How much the total may exceed the line items before it stops looking like
 * tax and starts looking like a misread.
 *
 * Indian printed bills routinely add GST and a service charge on top of the
 * items, so the two genuinely do not match and that is not an error. The
 * worst realistic combination is 28% GST plus a service charge, so anything
 * past this is more likely an item that was missed than a tax line.
 */
const MAX_TAX_FRACTION = 0.35;

/** Below this, the UI should tell the user to check the numbers themselves. */
const LOW_CONFIDENCE = 0.8;

/**
 * How far a row's own arithmetic may drift before we stop believing it.
 * Proportional, because a rupee out on 80 means something different from a
 * rupee out on 8000.
 */
const ROW_TOLERANCE = 0.02;

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

    // A row that contradicts itself has been misread. On a poor photo Textract
    // will return a confidently wrong digit, "88" as "8", while still reading
    // the line total correctly, so quantity times rate stops matching the
    // amount. The amount is the number to trust: it is corroborated by the
    // bill total, and the rate is not corroborated by anything.
    if (
      resolvedQuantity &&
      resolvedUnitPrice !== null &&
      lineTotal !== null &&
      Math.abs(resolvedQuantity * resolvedUnitPrice - lineTotal) >
        Math.max(1, Math.abs(lineTotal) * ROW_TOLERANCE)
    ) {
      const corrected = round(lineTotal / resolvedQuantity, 2);
      warnings.push(
        `"${cleanItemName(row.item)}" did not add up, the rate was read as ${resolvedUnitPrice} but ${lineTotal} over ${resolvedQuantity} works out to ${corrected}`,
      );
      resolvedUnitPrice = corrected;
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
  let subtotal = parseAmount(raw.subtotal);
  let tax = parseAmount(raw.tax);

  // Line items rarely add up to the printed total on an Indian bill, because
  // GST and a service charge sit between them. Textract does not reliably
  // label those lines, so the gap has to be interpreted rather than reported
  // as a discrepancy. Getting this wrong means every printed restaurant bill
  // arrives carrying a warning that says nothing useful.
  if (total !== null && lineItems.length > 0) {
    const gap = total - summed;

    if (gap < -SUM_TOLERANCE) {
      // Items add up to more than the bill asks for. Tax cannot explain that,
      // so something was read twice or read wrong.
      warnings.push(
        `Line items add up to ${summed.toFixed(2)}, which is more than the bill total of ${total.toFixed(2)}`,
      );
    } else if (gap > SUM_TOLERANCE) {
      if (summed > 0 && gap / summed <= MAX_TAX_FRACTION) {
        // Consistent with tax and charges. Record it as such instead of
        // complaining, so the stored bill adds up the way the paper does.
        if (subtotal === null) subtotal = round(summed, 2);

        // Textract's own TAX field is not trustworthy here. Indian bills
        // split GST into CGST and SGST and print a service charge separately,
        // and it tends to return whichever single line it recognised. A bill
        // showing 330 plus 16.50 gratuity plus 8.25 twice comes back claiming
        // 8.25 of tax, which does not reconcile with anything. Keep its value
        // only when the arithmetic works, otherwise take the whole gap.
        const reconciles =
          tax !== null && Math.abs(summed + tax - total) <= SUM_TOLERANCE;
        if (!reconciles) tax = round(gap, 2);
      } else {
        warnings.push(
          `Line items add up to ${summed.toFixed(2)} but the bill total reads ${total.toFixed(2)}, so an item may have been missed`,
        );
      }
    }
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

  // Textract's confidence describes how sure it is of the characters it saw,
  // not whether the result makes sense. The degraded fixture comes back at
  // 99.5% with a rate off by a factor of ten, so this is a weak signal and
  // the arithmetic checks above are the ones that actually catch anything.
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
    subtotal,
    tax,
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
