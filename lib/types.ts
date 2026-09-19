/**
 * The contract between the extraction track and the ledger track.
 *
 * FROZEN until integration. Both tracks build against these shapes without
 * depending on each other's code, so a change here silently breaks the other
 * side. Change it only by agreeing in the moment, never by pushing a commit
 * the other person discovers later.
 */

/**
 * One row on a supplier bill.
 *
 * The three numbers are nullable because real bills leave them out. A row may
 * print an amount with no rate, or a rate with no quantity, and extraction
 * cannot always recover the missing one. Null is deliberate: defaulting to
 * zero would put a 0.00 unit price into the ledger and make the next bill
 * look like an infinite price rise.
 */
export type ExtractedLineItem = {
  /** Item name as printed, with a trailing quantity stripped if one bled in. */
  name: string;
  /** Null when the bill does not print one and it cannot be derived. */
  quantity: number | null;
  /** "kg", "pcs", "ltr", or null when the bill does not say. */
  unit: string | null;
  /** INR per single unit. Null means this row cannot be price checked. */
  unitPrice: number | null;
  /** INR for the whole row. Null means it does not count toward any sum. */
  lineTotal: number | null;
};

/** What the vision model returns for one bill photo. No ledger context. */
export type ExtractedBill = {
  supplierName: string;
  billNumber: string | null;
  /** ISO "YYYY-MM-DD". */
  billDate: string;
  /** ISO "YYYY-MM-DD", null when the bill carries no due date. */
  dueDate: string | null;
  lineItems: ExtractedLineItem[];
  subtotal: number | null;
  tax: number | null;
  /** INR. The number the shop owner actually owes. */
  total: number;
  currency: "INR";
  /** 0..1. The model's own read on how legible the photo was. */
  confidence: number;
  /** Human-readable problems, e.g. "line items do not sum to total". */
  warnings: string[];
};

export type FlagType = "DUPLICATE" | "PRICE_JUMP" | "DUE_SOON";

/**
 * Something the reasoning layer decided the owner should see before the bill
 * is filed away. `evidence` holds the deterministic facts; `title` and
 * `message` are written by the model from those facts.
 */
export type Flag = {
  type: FlagType;
  severity: "high" | "medium" | "low";
  /** Short, model-written. */
  title: string;
  /** One or two sentences, model-written. */
  message: string;
  /** The numbers behind the flag, so the UI can show its working. */
  evidence: Record<string, string | number>;
};

/** A bill as stored in the ledger, after reasoning has run over it. */
export type LedgerBill = ExtractedBill & {
  billId: string;
  /** Slugified supplier name, used as the partition key. */
  supplierSlug: string;
  s3Key: string;
  /** ISO timestamp of when it was recorded. */
  createdAt: string;
  flags: Flag[];
  /** "needs_review" when any flag is high severity. */
  status: "recorded" | "needs_review";
};
