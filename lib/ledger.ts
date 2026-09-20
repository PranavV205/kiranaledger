/**
 * The ledger itself: one DynamoDB table, one shop.
 *
 * Single table because every question this app asks is "what has this
 * supplier done before" or "what has this item cost before", and both are
 * answered by a prefix scan under a partition key. A relational schema would
 * be tidier on paper and slower to build in a weekend.
 *
 *   Bill         pk SUP#<supplier>             sk BILL#<date>#<id>
 *   Price point  pk SUP#<supplier>#ITEM#<item> sk PRICE#<date>#<id>
 *   Supplier     pk SUP#<supplier>             sk META
 *
 * Bills and suppliers also carry gsi1 keys so the ledger view can read
 * everything for the shop in one query, newest first.
 */

import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { ddb, config } from "@/lib/aws";
import type { ExtractedBill, Flag, LedgerBill } from "@/lib/types";

/** Single hardcoded tenant. Accounts are explicitly out of scope. */
export const SHOP = "SHOP#demo";

/** DynamoDB refuses a transaction over 100 items, bill and supplier included. */
const MAX_TRANSACT_ITEMS = 100;

/**
 * Keys have to survive a supplier being photographed twice with different
 * capitalisation or spacing, since that is the difference between finding a
 * duplicate and silently filing a second copy.
 */
export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "unknown"
  );
}

/** Time ordered so ids sort the way bills were recorded. */
export function newBillId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const supplierPk = (slug: string) => `SUP#${slug}`;
const itemPk = (supplierSlug: string, itemSlug: string) =>
  `SUP#${supplierSlug}#ITEM#${itemSlug}`;

type BillRecord = LedgerBill & {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entity: "BILL";
};

function stripKeys(record: Record<string, unknown>): LedgerBill {
  const { pk, sk, gsi1pk, gsi1sk, entity, ...bill } = record;
  void pk; void sk; void gsi1pk; void gsi1sk; void entity;
  return bill as LedgerBill;
}

/**
 * Writes a bill and one price point per line item in a single transaction.
 *
 * Atomicity matters more than it looks. A bill recorded without its price
 * points would leave the next bill from that supplier with nothing to compare
 * against, so the price check would quietly pass instead of flagging. A
 * partial write here is worse than no write at all.
 */
export async function putBill(input: {
  bill: ExtractedBill;
  s3Key: string;
  flags: Flag[];
}): Promise<LedgerBill> {
  const { bill, s3Key, flags } = input;
  const supplierSlug = slugify(bill.supplierName);
  const billId = newBillId();
  const createdAt = new Date().toISOString();

  const record: BillRecord = {
    ...bill,
    billId,
    supplierSlug,
    s3Key,
    createdAt,
    flags,
    status: flags.some((f) => f.severity === "high") ? "needs_review" : "recorded",
    pk: supplierPk(supplierSlug),
    sk: `BILL#${bill.billDate}#${billId}`,
    gsi1pk: SHOP,
    gsi1sk: `BILL#${createdAt}`,
    entity: "BILL",
  };

  const pricePoints = bill.lineItems
    // A row with no rate cannot be compared against anything later, so it is
    // not worth a row of its own in the price history.
    .filter((item) => item.unitPrice !== null)
    .map((item) => ({
      Put: {
        TableName: config.ledgerTable,
        Item: {
          pk: itemPk(supplierSlug, slugify(item.name)),
          sk: `PRICE#${bill.billDate}#${billId}`,
          entity: "PRICE" as const,
          itemName: item.name,
          itemSlug: slugify(item.name),
          supplierSlug,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          unit: item.unit,
          billId,
          billDate: bill.billDate,
        },
      },
    }));

  const supplier = {
    Put: {
      TableName: config.ledgerTable,
      Item: {
        pk: supplierPk(supplierSlug),
        sk: "META",
        gsi1pk: SHOP,
        gsi1sk: `SUP#${bill.supplierName}`,
        entity: "SUPPLIER" as const,
        supplierName: bill.supplierName,
        supplierSlug,
        lastBillDate: bill.billDate,
      },
    },
  };

  const writes = [
    { Put: { TableName: config.ledgerTable, Item: record } },
    supplier,
    ...pricePoints,
  ];

  if (writes.length > MAX_TRANSACT_ITEMS) {
    // Far past any real kirana bill, but a silent truncation here would be a
    // nasty thing to debug, so it fails loudly instead.
    throw new Error(
      `This bill has ${bill.lineItems.length} line items, more than a single transaction can hold.`,
    );
  }

  await ddb().send(new TransactWriteCommand({ TransactItems: writes }));
  return stripKeys(record);
}

/** Recent bills from one supplier, newest first. Feeds the duplicate check. */
export async function getSupplierBills(
  supplierSlug: string,
  limit = 20,
): Promise<LedgerBill[]> {
  const result = await ddb().send(
    new QueryCommand({
      TableName: config.ledgerTable,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": supplierPk(supplierSlug), ":prefix": "BILL#" },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (result.Items ?? []).map((i) => stripKeys(i));
}

export type PricePoint = {
  itemName: string;
  unitPrice: number;
  unit: string | null;
  billId: string;
  billDate: string;
};

/**
 * The price this supplier last charged for an item, as of a given bill date.
 *
 * Scoped to the supplier on purpose. Two suppliers charging different prices
 * for the same sack of dal is ordinary commerce, not something to flag; the
 * same supplier changing their own price is the thing worth noticing.
 *
 * Scoped by date for a subtler reason. Bills do not arrive in the order they
 * were issued: an owner photographs a stack at the end of the week, or
 * re-photographs an old bill. Comparing against whatever was recorded most
 * recently rather than what was charged most recently produces confident
 * nonsense, an August bill reported as a price drop against a September one.
 * The sort key starts with the bill date, so asking for the newest key at or
 * below this bill's date answers the question actually being asked.
 */
export async function getLastItemPrice(
  supplierSlug: string,
  itemName: string,
  onOrBefore: string,
): Promise<PricePoint | null> {
  const result = await ddb().send(
    new QueryCommand({
      TableName: config.ledgerTable,
      KeyConditionExpression: "pk = :pk AND sk BETWEEN :from AND :to",
      ExpressionAttributeValues: {
        ":pk": itemPk(supplierSlug, slugify(itemName)),
        ":from": "PRICE#",
        // "~" sorts above every character the key can contain, so this takes
        // in every bill dated on or before this one.
        ":to": `PRICE#${onOrBefore}~`,
      },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );
  const item = result.Items?.[0];
  return item ? (item as PricePoint) : null;
}

/** Every bill for the shop, newest recorded first. */
export async function getAllBills(limit = 100): Promise<LedgerBill[]> {
  const result = await ddb().send(
    new QueryCommand({
      TableName: config.ledgerTable,
      IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :prefix)",
      ExpressionAttributeValues: { ":pk": SHOP, ":prefix": "BILL#" },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (result.Items ?? []).map((i) => stripKeys(i));
}

/**
 * One bill by id.
 *
 * The id is not a key on its own, so this reads the shop's bills and picks
 * the match. That is one query at the scale this runs at, and adding an index
 * to turn it into a point read would cost more than it saves today.
 */
export async function getBillById(billId: string): Promise<LedgerBill | null> {
  const bills = await getAllBills();
  return bills.find((b) => b.billId === billId) ?? null;
}

export { GetCommand, PutCommand };
