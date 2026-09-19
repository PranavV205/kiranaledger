/**
 * Turning what a bill says into what the ledger can use.
 *
 * Every function here is pure and takes a string, so the awkward cases can be
 * exercised without touching AWS. That matters because this file, not the
 * Textract call, is where extraction actually goes wrong: Indian bills use
 * lakh grouping, three different date orders, and units that OCR reliably
 * mangles.
 */

/**
 * Parses an amount as printed on an Indian bill.
 *
 * Handles lakh grouping ("1,20,000"), both currency marks, and trailing
 * annotations like "/-". Returns null rather than guessing, because a wrong
 * number is worse than a missing one when the next step is a price comparison.
 */
export function parseAmount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[₹$]|(?:\bRs\.?|\bINR)/gi, "")
    .replace(/,/g, "")
    .replace(/\/-\s*$/, "")
    .trim();
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parses a date to ISO `YYYY-MM-DD`.
 *
 * Assumes day first when the order is ambiguous, which is correct for Indian
 * bills and wrong for American ones. A bill printing 09/04/2026 means the 9th
 * of April here, and reading it as September would put the duplicate window
 * five months out.
 */
export function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();

  const iso = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return build(+iso[1], +iso[2], +iso[3]);

  const named = text.match(/(\d{1,2})\s*[-/ ]\s*([A-Za-z]{3,})\s*[-/ ]\s*(\d{2,4})/);
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (month) return build(year(named[3]), month, +named[1]);
  }

  const numeric = text.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (numeric) return build(year(numeric[3]), +numeric[2], +numeric[1]);

  return null;
}

function year(raw: string): number {
  const n = Number(raw);
  return raw.length === 2 ? 2000 + n : n;
}

function build(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * OCR substitutions we see constantly on unit labels: a lowercase L reads as
 * a capital I, zero reads as O. Worth fixing because the unit ends up on
 * screen next to the quantity.
 */
const UNIT_FIXES: Record<string, string> = {
  itr: "ltr", ltrs: "ltr", litre: "ltr", litres: "ltr", l: "ltr",
  kgs: "kg", kilo: "kg", kilos: "kg", gms: "gm", grams: "gm", g: "gm",
  pc: "pcs", piece: "pcs", pieces: "pcs", nos: "pcs", no: "pcs",
  pkts: "pkt", packet: "pkt", packets: "pkt", dz: "dozen", doz: "dozen",
};

export function normaliseUnit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!key) return null;
  return UNIT_FIXES[key] ?? key;
}

/** Splits "10 kg" into a number and a unit. Either half may be absent. */
export function parseQuantity(raw: string | null | undefined): {
  quantity: number | null;
  unit: string | null;
} {
  if (!raw) return { quantity: null, unit: null };
  const match = raw.trim().match(/([\d.,]+)\s*([A-Za-z]+)?/);
  if (!match) return { quantity: null, unit: normaliseUnit(raw) };
  return {
    quantity: parseAmount(match[1]),
    unit: normaliseUnit(match[2] ?? null),
  };
}

/**
 * Textract often folds the quantity column into the item name, so "Toor Dal"
 * with quantity 10 comes back as "Toor Dal 10". Strips a trailing number, and
 * a trailing number plus unit, but leaves names that are genuinely numeric
 * such as "Maggi 2 Minute" alone by only cutting at the very end.
 */
export function cleanItemName(raw: string | null | undefined): string {
  if (!raw) return "Unknown item";
  const cleaned = raw
    .replace(/\s+[\d.,]+\s*(?:kg|kgs|gm|gms|g|ltr|itr|l|pcs|pc|nos|pkt|dozen)?\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || raw.trim();
}
