/**
 * One bill, and what the ledger made of it.
 *
 * Flags come first, above the bill itself. By the time this renders the
 * decision has already been made, and the answer to "should I pay this" is
 * the reason the screen exists. The bill is the evidence underneath it.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { getBillById } from "@/lib/ledger";
import type { Flag, LedgerBill } from "@/lib/types";

export const dynamic = "force-dynamic";

const money = (n: number | null) =>
  n === null
    ? "—"
    : `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const day = (iso: string | null) =>
  !iso
    ? "—"
    : new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

const TONE = {
  high: {
    ring: "border-red-500/35 bg-red-500/[0.07]",
    dot: "bg-red-500",
    label: "text-red-700 dark:text-red-300",
  },
  medium: {
    ring: "border-amber-500/35 bg-amber-500/[0.07]",
    dot: "bg-amber-500",
    label: "text-amber-800 dark:text-amber-300",
  },
  low: {
    ring: "border-sky-500/30 bg-sky-500/[0.06]",
    dot: "bg-sky-500",
    label: "text-sky-800 dark:text-sky-300",
  },
} as const;

export default async function BillPage({ params }: PageProps<"/bills/[id]">) {
  const { id } = await params;
  const bill = await getBillById(id);
  if (!bill) notFound();

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-5 py-8">
      <Link href="/ledger" className="text-sm opacity-55 transition hover:opacity-100">
        ← Ledger
      </Link>

      <header className="mt-4 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{bill.supplierName}</h1>
        <p className="mt-1 text-sm opacity-60">
          {bill.billNumber ?? "No bill number"} · {day(bill.billDate)}
        </p>
      </header>

      {bill.status === "needs_review" ? (
        <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-700 dark:text-red-300">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
          Held for review, not yet approved
        </p>
      ) : bill.flags.length === 0 ? (
        <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Checked against your ledger, nothing unusual
        </p>
      ) : null}

      {bill.flags.length > 0 && (
        <section className="mb-7 space-y-3">
          {bill.flags.map((flag, i) => (
            <FlagCard key={i} flag={flag} />
          ))}
        </section>
      )}

      <BillCard bill={bill} />
    </main>
  );
}

function FlagCard({ flag }: { flag: Flag }) {
  const tone = TONE[flag.severity];
  return (
    <article className={`rounded-2xl border p-4 ${tone.ring}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
        <h2 className={`font-semibold ${tone.label}`}>{flag.title}</h2>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed opacity-85">{flag.message}</p>
      <Evidence flag={flag} />
    </article>
  );
}

/**
 * The numbers behind the sentence.
 *
 * Shown because the flag is an interruption, and an interruption the reader
 * cannot verify is one they learn to dismiss.
 */
function Evidence({ flag }: { flag: Flag }) {
  const e = flag.evidence;

  if (flag.type === "PRICE_JUMP") {
    const up = e.direction === "increase";
    return (
      <dl className="mt-3 flex items-end gap-4 border-t border-current/10 pt-3 text-sm">
        <div>
          <dt className="text-xs opacity-55">{String(e.previousBillDate)}</dt>
          <dd className="tabular-nums line-through opacity-55">
            {money(Number(e.previousUnitPrice))}
          </dd>
        </div>
        <div aria-hidden className="pb-0.5 opacity-40">
          {up ? "↗" : "↘"}
        </div>
        <div>
          <dt className="text-xs opacity-55">this bill</dt>
          <dd className="font-semibold tabular-nums">{money(Number(e.newUnitPrice))}</dd>
        </div>
        <div className="ml-auto text-right">
          <dt className="text-xs opacity-55">per {String(e.unit)}</dt>
          <dd className="font-medium tabular-nums">
            {up ? "+" : ""}
            {String(e.percentChange)}%
          </dd>
        </div>
      </dl>
    );
  }

  if (flag.type === "DUPLICATE") {
    return (
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-current/10 pt-3 text-sm">
        <dt className="opacity-55">Already recorded</dt>
        <dd className="text-right tabular-nums">{money(Number(e.recordedTotal))}</dd>
        <dt className="opacity-55">This bill</dt>
        <dd className="text-right tabular-nums">{money(Number(e.newTotal))}</dd>
        {e.existingBillId ? (
          <>
            <dt className="opacity-55">The earlier one</dt>
            <dd className="text-right">
              <Link href={`/bills/${e.existingBillId}`} className="underline underline-offset-2">
                open it
              </Link>
            </dd>
          </>
        ) : null}
      </dl>
    );
  }

  return null;
}

function BillCard({ bill }: { bill: LedgerBill }) {
  return (
    <div className="rounded-2xl border border-black/10 dark:border-white/10">
      <ul className="divide-y divide-black/5 dark:divide-white/5">
        {bill.lineItems.map((item, i) => (
          <li key={i} className="flex items-baseline justify-between gap-4 px-5 py-3 text-sm">
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
            <span className="shrink-0 tabular-nums opacity-55">
              {item.quantity ?? "?"}
              {item.unit ? ` ${item.unit}` : ""} × {money(item.unitPrice)}
            </span>
            <span className="w-24 shrink-0 text-right font-medium tabular-nums">
              {money(item.lineTotal)}
            </span>
          </li>
        ))}
      </ul>

      {bill.tax !== null && (
        <div className="flex items-baseline justify-between border-t border-black/10 px-5 py-2.5 text-sm dark:border-white/10">
          <span className="opacity-60">Tax and charges</span>
          <span className="tabular-nums opacity-75">{money(bill.tax)}</span>
        </div>
      )}

      <div className="flex items-baseline justify-between border-t border-black/10 px-5 py-4 dark:border-white/10">
        <span className="text-sm font-medium opacity-70">Total</span>
        <span className="text-xl font-semibold tabular-nums">{money(bill.total)}</span>
      </div>

      {bill.dueDate && (
        <p className="border-t border-black/10 px-5 py-3 text-sm dark:border-white/10">
          <span className="opacity-60">Payment due</span>{" "}
          <span className="font-medium">{day(bill.dueDate)}</span>
        </p>
      )}

      {bill.warnings.length > 0 && (
        <div className="border-t border-black/10 px-5 py-3 dark:border-white/10">
          <p className="text-xs font-medium opacity-60">From reading the photo</p>
          <ul className="mt-1.5 space-y-1 text-sm opacity-75">
            {bill.warnings.map((w) => (
              <li key={w}>· {w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
