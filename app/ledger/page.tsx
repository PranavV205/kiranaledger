/**
 * The ledger: what is recorded, what needs looking at, what is owed when.
 *
 * Ordered by urgency rather than by date. Anything held for review comes
 * first, then payments coming due, then the record itself. A shop owner
 * opening this wants to know what needs doing, and only then what happened.
 */

import Link from "next/link";
import { getAllBills } from "@/lib/ledger";
import type { LedgerBill } from "@/lib/types";

export const dynamic = "force-dynamic";

/** A payment inside this many days is worth putting at the top of the screen. */
const DUE_WINDOW_DAYS = 7;

const money = (n: number | null) =>
  n === null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const day = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

function daysUntil(iso: string): number {
  const today = new Date().toISOString().slice(0, 10);
  return Math.round(
    (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}

export default async function LedgerPage() {
  const bills = await getAllBills();

  const needsReview = bills.filter((b) => b.status === "needs_review");
  const dueSoon = bills
    .filter((b) => b.dueDate && daysUntil(b.dueDate) <= DUE_WINDOW_DAYS)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));

  // Bills held for review are deliberately excluded from what is owed. Half
  // of them are suspected duplicates, and counting a duplicate toward the
  // total owed is exactly the error this app exists to prevent.
  const owed = bills
    .filter((b) => b.status !== "needs_review")
    .reduce((sum, b) => sum + (b.total ?? 0), 0);

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-5 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ledger</h1>
          <p className="mt-1 text-sm opacity-60">
            {bills.length === 0
              ? "Nothing recorded yet"
              : `${bills.length} bill${bills.length === 1 ? "" : "s"} recorded`}
          </p>
        </div>
        <Link
          href="/upload"
          className="shrink-0 rounded-xl bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-85 dark:bg-white dark:text-black"
        >
          New bill
        </Link>
      </header>

      {bills.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/15 px-6 py-14 text-center dark:border-white/15">
          <p className="text-3xl">📄</p>
          <p className="mt-3 font-medium">Photograph your first supplier bill</p>
          <p className="mx-auto mt-1 max-w-xs text-sm opacity-55">
            Once there are a few, each new one gets checked against them for duplicates and price changes.
          </p>
        </div>
      ) : (
        <>
          <dl className="mb-7 grid grid-cols-3 gap-3">
            <Stat label="Recorded" value={money(owed)} />
            <Stat label="Need review" value={String(needsReview.length)} tone={needsReview.length ? "alert" : undefined} />
            <Stat label="Due this week" value={String(dueSoon.length)} />
          </dl>

          {needsReview.length > 0 && (
            <Section title="Needs your review">
              {needsReview.map((bill) => (
                <BillRow key={bill.billId} bill={bill} />
              ))}
            </Section>
          )}

          {dueSoon.length > 0 && (
            <Section title="Payments coming due">
              {dueSoon.map((bill) => (
                <BillRow key={bill.billId} bill={bill} showDue />
              ))}
            </Section>
          )}

          <Section title="All bills">
            {bills.map((bill) => (
              <BillRow key={bill.billId} bill={bill} />
            ))}
          </Section>
        </>
      )}
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "alert" }) {
  return (
    <div className="rounded-xl border border-black/10 px-3 py-3 dark:border-white/10">
      <dt className="text-xs opacity-55">{label}</dt>
      <dd
        className={`mt-0.5 text-lg font-semibold tabular-nums ${tone === "alert" ? "text-red-600 dark:text-red-400" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wider opacity-45">{title}</h2>
      <ul className="divide-y divide-black/5 overflow-hidden rounded-2xl border border-black/10 dark:divide-white/5 dark:border-white/10">
        {children}
      </ul>
    </section>
  );
}

function BillRow({ bill, showDue }: { bill: LedgerBill; showDue?: boolean }) {
  const worst = bill.flags.find((f) => f.severity === "high") ?? bill.flags[0];
  const due = bill.dueDate ? daysUntil(bill.dueDate) : null;

  return (
    <li>
      <Link
        href={`/bills/${bill.billId}`}
        className="flex items-center gap-3 px-4 py-3 transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
      >
        <span
          aria-hidden
          className={`h-2 w-2 shrink-0 rounded-full ${
            bill.status === "needs_review"
              ? "bg-red-500"
              : worst?.severity === "medium"
                ? "bg-amber-500"
                : bill.flags.length
                  ? "bg-sky-500"
                  : "bg-emerald-500"
          }`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{bill.supplierName}</span>
          <span className="block truncate text-xs opacity-55">
            {showDue && due !== null
              ? due < 0
                ? `Overdue by ${Math.abs(due)} day${Math.abs(due) === 1 ? "" : "s"}`
                : `Due in ${due} day${due === 1 ? "" : "s"}`
              : (worst?.title ?? `${bill.billNumber ?? "No number"} · ${day(bill.billDate)}`)}
          </span>
        </span>
        <span className="shrink-0 text-sm font-medium tabular-nums">{money(bill.total)}</span>
      </Link>
    </li>
  );
}
