/**
 * The Amazon Textract half of extraction.
 *
 * AnalyzeExpense is purpose built for invoices and receipts: it returns
 * labelled summary fields (vendor, invoice number, dates, total) and grouped
 * line items, rather than a wall of text we would have to segment ourselves.
 *
 * This module deliberately does no parsing. It pulls the labelled values out
 * of the Textract response exactly as printed and hands them on as strings.
 * Turning "1,20,000" into a number and "18/09/2026" into an ISO date is a
 * separate concern, and keeping it separate means the messy part can be
 * tested without calling AWS at all.
 */

import { AnalyzeExpenseCommand } from "@aws-sdk/client-textract";
import type { ExpenseDocument } from "@aws-sdk/client-textract";
import { textract, config } from "@/lib/aws";

/** One line item as printed, before any parsing. */
export type RawLineItem = {
  item: string | null;
  quantity: string | null;
  unitPrice: string | null;
  price: string | null;
};

/** Everything we care about from one bill, still as printed. */
export type RawExpense = {
  vendorName: string | null;
  invoiceId: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  subtotal: string | null;
  tax: string | null;
  total: string | null;
  lineItems: RawLineItem[];
  /** Textract's per field confidences, 0..100, for everything we read. */
  confidences: number[];
  /** First text line on the page. Used when no vendor is labelled. */
  firstLine: string | null;
};

/**
 * Textract can return the same field type more than once, most often when a
 * bill prints a value in two places. The first occurrence is the one it is
 * most confident about, so later duplicates are ignored.
 */
function collectSummary(doc: ExpenseDocument) {
  const values: Record<string, string> = {};
  const confidences: number[] = [];

  for (const field of doc.SummaryFields ?? []) {
    const type = field.Type?.Text;
    const value = field.ValueDetection?.Text?.replace(/\s+/g, " ").trim();
    if (!type || !value || type in values) continue;
    values[type] = value;
    if (field.ValueDetection?.Confidence) {
      confidences.push(field.ValueDetection.Confidence);
    }
  }
  return { values, confidences };
}

function collectLineItems(doc: ExpenseDocument) {
  const items: RawLineItem[] = [];
  const confidences: number[] = [];

  for (const group of doc.LineItemGroups ?? []) {
    for (const lineItem of group.LineItems ?? []) {
      const fields: Record<string, string> = {};
      for (const field of lineItem.LineItemExpenseFields ?? []) {
        const type = field.Type?.Text;
        const value = field.ValueDetection?.Text?.replace(/\s+/g, " ").trim();
        if (!type || !value || type in fields) continue;
        fields[type] = value;
        if (field.ValueDetection?.Confidence) {
          confidences.push(field.ValueDetection.Confidence);
        }
      }
      // A row with no money on it is a heading or a separator, not an item.
      if (!fields.PRICE && !fields.UNIT_PRICE) continue;
      items.push({
        item: fields.ITEM ?? null,
        quantity: fields.QUANTITY ?? null,
        unitPrice: fields.UNIT_PRICE ?? null,
        price: fields.PRICE ?? null,
      });
    }
  }
  return { items, confidences };
}

/**
 * Reads a bill that is already sitting in S3.
 *
 * Textract fetches the object itself using our credentials, so the image
 * never travels through this process. That keeps the request small and means
 * a 5 MB phone photo costs us nothing to pass along.
 */
export async function analyseBill(s3Key: string): Promise<RawExpense> {
  const response = await textract().send(
    new AnalyzeExpenseCommand({
      Document: { S3Object: { Bucket: config.billsBucket, Name: s3Key } },
    }),
  );

  const doc = response.ExpenseDocuments?.[0];
  if (!doc) {
    throw new Error(
      "Textract returned no expense document. The photo may not be a bill.",
    );
  }

  const summary = collectSummary(doc);
  const lines = collectLineItems(doc);

  return {
    vendorName: summary.values.VENDOR_NAME ?? null,
    invoiceId: summary.values.INVOICE_RECEIPT_ID ?? null,
    invoiceDate: summary.values.INVOICE_RECEIPT_DATE ?? null,
    dueDate: summary.values.DUE_DATE ?? null,
    subtotal: summary.values.SUBTOTAL ?? null,
    tax: summary.values.TAX ?? null,
    total: summary.values.TOTAL ?? null,
    lineItems: lines.items,
    confidences: [...summary.confidences, ...lines.confidences],
    firstLine: firstTextLine(doc),
  };
}

/**
 * Small shops often print their name as a letterhead that Textract does not
 * label as a vendor. The topmost block on the page is nearly always that
 * letterhead, so it is a reasonable last resort before giving up.
 */
function firstTextLine(doc: ExpenseDocument): string | null {
  const blocks = (doc.Blocks ?? [])
    .filter((b) => b.BlockType === "LINE" && b.Text)
    .sort(
      (a, b) =>
        (a.Geometry?.BoundingBox?.Top ?? 1) - (b.Geometry?.BoundingBox?.Top ?? 1),
    );
  return blocks[0]?.Text?.trim() || null;
}
