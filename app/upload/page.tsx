"use client";

/**
 * The capture screen.
 *
 * Three network round trips hide behind one button: presign, upload to S3,
 * then Textract. That is several seconds of nothing on a phone, and silence
 * reads as broken, so each stage names itself while it runs.
 *
 * The screen stops at the ledger. It shows what was read, the user confirms,
 * and the answer to "is anything wrong with this bill" belongs to the page
 * this one hands off to.
 */

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ExtractedBill } from "@/lib/types";

type Stage =
  | { name: "idle" }
  | { name: "uploading" }
  | { name: "reading" }
  | { name: "review"; bill: ExtractedBill; s3Key: string }
  | { name: "saving"; bill: ExtractedBill }
  | { name: "error"; message: string };

const money = (n: number | null) =>
  n === null ? "—" : `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const day = (iso: string | null) =>
  !iso ? "—" : new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function UploadPage() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [preview, setPreview] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setPreview(URL.createObjectURL(file));
    setStage({ name: "uploading" });

    try {
      const signed = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });
      if (!signed.ok) throw new Error((await signed.json()).error ?? "Could not start the upload");
      const { uploadUrl, s3Key } = await signed.json();

      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error(`The photo did not upload (${put.status})`);

      setStage({ name: "reading" });
      const read = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ s3Key }),
      });
      if (!read.ok) throw new Error((await read.json()).error ?? "Could not read the bill");

      const { bill } = await read.json();
      setStage({ name: "review", bill, s3Key });
    } catch (err) {
      setStage({ name: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  const confirm = useCallback(async (bill: ExtractedBill, s3Key: string) => {
    setStage({ name: "saving", bill });
    try {
      const saved = await fetch("/api/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bill, s3Key }),
      });
      if (!saved.ok) throw new Error((await saved.json()).error ?? "Could not save this bill");
      const { billId } = await saved.json();
      router.push(`/bills/${billId}`);
    } catch (err) {
      setStage({ name: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [router]);

  const reset = () => {
    setPreview(null);
    setStage({ name: "idle" });
    if (fileInput.current) fileInput.current.value = "";
  };

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-5 py-8">
      <Link href="/ledger" className="text-sm opacity-55 transition hover:opacity-100">
        ← Ledger
      </Link>

      <header className="mt-4 mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">New bill</h1>
        <p className="mt-1 text-sm opacity-60">
          Photograph a supplier bill. It gets read and checked against your ledger.
        </p>
      </header>

      <input
        ref={fileInput}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {stage.name === "idle" && (
        <button
          onClick={() => fileInput.current?.click()}
          className="flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-black/15 px-6 py-14 transition hover:border-black/35 hover:bg-black/[0.02] dark:border-white/15 dark:hover:border-white/35 dark:hover:bg-white/[0.03]"
        >
          <span className="text-4xl">📄</span>
          <span className="font-medium">Take a photo or choose a file</span>
          <span className="text-xs opacity-55">JPG, PNG, HEIC or PDF</span>
        </button>
      )}

      {(stage.name === "uploading" || stage.name === "reading" || stage.name === "saving") && (
        <Working
          preview={preview}
          steps={[
            { label: "Uploading the photo", state: stage.name === "uploading" ? "active" : "done" },
            {
              label: "Reading the bill",
              state: stage.name === "reading" ? "active" : stage.name === "uploading" ? "waiting" : "done",
            },
            {
              label: "Checking against your ledger",
              state: stage.name === "saving" ? "active" : "waiting",
            },
          ]}
        />
      )}

      {stage.name === "review" && (
        <Review
          bill={stage.bill}
          preview={preview}
          onConfirm={() => void confirm(stage.bill, stage.s3Key)}
          onDiscard={reset}
        />
      )}

      {stage.name === "error" && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-5">
          <p className="font-medium text-red-700 dark:text-red-300">That did not work</p>
          <p className="mt-1 text-sm opacity-75">{stage.message}</p>
          <button onClick={reset} className="mt-4 rounded-lg border border-current/20 px-4 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10">
            Try another photo
          </button>
        </div>
      )}
    </main>
  );
}

function Working({
  preview,
  steps,
}: {
  preview: string | null;
  steps: { label: string; state: "waiting" | "active" | "done" }[];
}) {
  return (
    <div className="space-y-5">
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="" className="max-h-56 w-full rounded-xl object-cover opacity-45" />
      )}
      <ol className="space-y-3">
        {steps.map((step) => (
          <li key={step.label} className="flex items-center gap-3 text-sm">
            <span
              aria-hidden
              className={
                step.state === "done"
                  ? "grid h-5 w-5 place-items-center rounded-full bg-emerald-500 text-[11px] text-white"
                  : step.state === "active"
                    ? "h-5 w-5 animate-spin rounded-full border-2 border-current/25 border-t-current"
                    : "h-5 w-5 rounded-full border-2 border-current/15"
              }
            >
              {step.state === "done" ? "✓" : ""}
            </span>
            <span className={step.state === "waiting" ? "opacity-40" : step.state === "active" ? "font-medium" : "opacity-70"}>
              {step.label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Review({
  bill,
  preview,
  onConfirm,
  onDiscard,
}: {
  bill: ExtractedBill;
  preview: string | null;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-black/10 dark:border-white/10">
        <div className="flex items-start justify-between gap-4 border-b border-black/10 p-5 dark:border-white/10">
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{bill.supplierName}</p>
            <p className="mt-0.5 text-sm opacity-60">
              {bill.billNumber ?? "No bill number"} · {day(bill.billDate)}
            </p>
          </div>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
          )}
        </div>

        <ul className="divide-y divide-black/5 dark:divide-white/5">
          {bill.lineItems.map((item, i) => (
            <li key={i} className="flex items-baseline justify-between gap-4 px-5 py-3 text-sm">
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <span className="shrink-0 tabular-nums opacity-55">
                {item.quantity ?? "?"}
                {item.unit ? ` ${item.unit}` : ""} × {money(item.unitPrice)}
              </span>
              <span className="w-24 shrink-0 text-right tabular-nums font-medium">{money(item.lineTotal)}</span>
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
      </div>

      {bill.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-4">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Worth a second look
          </p>
          <ul className="mt-2 space-y-1 text-sm opacity-80">
            {bill.warnings.map((w) => (
              <li key={w}>· {w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onConfirm}
          className="flex-1 rounded-xl bg-black px-5 py-3 font-medium text-white transition hover:opacity-85 dark:bg-white dark:text-black"
        >
          Save to ledger
        </button>
        <button
          onClick={onDiscard}
          className="rounded-xl border border-black/15 px-5 py-3 font-medium transition hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
        >
          Discard
        </button>
      </div>

      <p className="text-center text-xs opacity-45">
        Read with {Math.round(bill.confidence * 100)}% confidence
      </p>
    </div>
  );
}
