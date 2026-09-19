/**
 * Turning findings into something a shop owner wants to read.
 *
 * The model's job here is narrow on purpose. Every number it sees has already
 * been computed and checked; it is writing a sentence around facts, not
 * working anything out. That is why a free model is enough, and why the
 * prompt tells it in as many words never to recalculate.
 *
 * It is also why the fallback matters more than the call. If the model is
 * slow, rate limited, or down, the flag still has to appear and the bill
 * still has to save. Nothing about the decision depends on this file, only
 * the wording, so a failure costs a little polish and nothing else.
 */

import type { Flag } from "@/lib/types";
import { config } from "@/lib/aws";
import type { Finding } from "./checks";

/**
 * Past this, stop waiting and use the templates.
 *
 * Deliberately tight. The person is watching a spinner over a bill they have
 * already photographed, and the templates below are good enough that waiting
 * longer for slightly better wording is a bad trade.
 */
const TIMEOUT_MS = 6000;

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `You write short alerts for a small shop owner in India who is reviewing a supplier bill.

You will be given findings that have ALREADY been calculated and verified. Your only job is to phrase each one.

Rules:
- NEVER recalculate, re-check, or dispute the numbers. They are correct.
- Use only the numbers given. Do not invent dates, amounts or item names.
- Plain language. The reader runs a shop, not a finance team.
- Amounts in rupees, written like Rs 145.
- title: at most 6 words, no punctuation at the end.
- message: one or two short sentences saying what happened and what to do.
- Keep the severity exactly as given.

Reply with JSON only, in this shape, one entry per finding in the same order:
{"flags":[{"title":"...","message":"...","severity":"high|medium|low"}]}`;

/** What the flag says when the model cannot be reached. Demo quality on purpose. */
function template(finding: Finding): Flag {
  const e = finding.evidence;
  const rupees = (v: unknown) =>
    `Rs ${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

  if (finding.type === "DUPLICATE") {
    const byNumber = e.reason === "matching bill number";
    return {
      type: "DUPLICATE",
      severity: finding.severity,
      title: byNumber ? "Bill already recorded" : "Possible duplicate bill",
      message: byNumber
        ? `Bill ${e.billNumber} from ${e.supplier} is already in your ledger, recorded on ${e.recordedOn} for ${rupees(e.recordedTotal)}. Check before paying it again.`
        : `${e.supplier} already has a bill for ${rupees(e.recordedTotal)} from ${e.daysApart} day${e.daysApart === 1 ? "" : "s"} earlier, and this one is ${rupees(e.newTotal)}. These may be the same bill.`,
      evidence: e,
    };
  }

  if (finding.type === "PRICE_JUMP") {
    const up = e.direction === "increase";
    return {
      type: "PRICE_JUMP",
      severity: finding.severity,
      title: `${e.item} price ${up ? "up" : "down"} ${Math.abs(Number(e.percentChange))}%`,
      message: `${e.supplier} charged ${rupees(e.newUnitPrice)} per ${e.unit} for ${e.item}, against ${rupees(e.previousUnitPrice)} on ${e.previousBillDate}. That is ${rupees(Math.abs(Number(e.changeRupees)))} ${up ? "more" : "less"} per ${e.unit}.`,
      evidence: e,
    };
  }

  const days = Number(e.daysUntilDue);
  return {
    type: "DUE_SOON",
    severity: finding.severity,
    title:
      days < 0
        ? "Payment overdue"
        : `Payment due in ${days} day${days === 1 ? "" : "s"}`,
    message:
      days < 0
        ? `${rupees(e.amount)} to ${e.supplier} was due on ${e.dueDate}, ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago.`
        : `${rupees(e.amount)} is due to ${e.supplier} on ${e.dueDate}.`,
    evidence: e,
  };
}

type ModelFlag = { title?: string; message?: string; severity?: string };

/**
 * Phrases every finding in one round trip.
 *
 * Batched rather than one call per finding, because this sits on the upload
 * path and three sequential calls to a free model is most of a minute.
 */
export async function explainFindings(findings: Finding[]): Promise<Flag[]> {
  if (findings.length === 0) return [];

  const fallback = findings.map(template);

  try {
    // The timer has to cover reading the body, not just the fetch. fetch()
    // settles as soon as headers arrive, so clearing it any earlier leaves a
    // slowly streaming response free to take as long as it likes.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.openRouterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.explainModel,
          response_format: { type: "json_object" },
          max_tokens: 900,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: JSON.stringify(
                findings.map((f) => ({
                  type: f.type,
                  severity: f.severity,
                  ...f.evidence,
                })),
              ),
            },
          ],
        }),
      });

      if (!response.ok) throw new Error(`model returned ${response.status}`);

      const body = await response.json();
      const raw = body?.choices?.[0]?.message?.content;
      if (typeof raw !== "string" || !raw.trim())
        throw new Error("model returned no text");

      const parsed = JSON.parse(raw) as { flags?: ModelFlag[] };
      const written = parsed.flags;
      if (!Array.isArray(written) || written.length !== findings.length) {
        throw new Error("model returned the wrong number of flags");
      }

      return findings.map((finding, i) => {
        const w = written[i];
        // Severity is ours, not the model's. It came out of the thresholds and
        // it drives whether the bill is held for review, so a model rewording
        // the sentence must not be able to change what the app does.
        return {
          type: finding.type,
          severity: finding.severity,
          title: clean(w?.title) ?? fallback[i].title,
          message: clean(w?.message) ?? fallback[i].message,
          evidence: finding.evidence,
        };
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn(
      "explanation model unavailable, using templates:",
      err instanceof Error ? err.message : err,
    );
    return fallback;
  }
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length < 400 ? trimmed : null;
}
