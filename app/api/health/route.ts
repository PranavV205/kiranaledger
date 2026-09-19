/**
 * Deployment smoke test.
 *
 * The point of this route is not uptime, it is permissions. Next builds and
 * runs fine with an SSR compute role that is missing half its policy, and the
 * failure only shows up the first time a real feature touches AWS. Hitting
 * this on every branch URL before either track starts turns that into a
 * fifteen minute problem instead of a two hour one.
 *
 * Each check exercises exactly the IAM action the app actually needs, rather
 * than a cheaper call that needs a different permission and proves nothing.
 *
 * GET /api/health          S3 and DynamoDB
 * GET /api/health?deep=1   also calls Textract (billed per page) and the
 *                          explanation model
 */

import { NextResponse } from "next/server";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { AnalyzeExpenseCommand } from "@aws-sdk/client-textract";
import { s3, ddb, textract, config } from "@/lib/aws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Check = { ok: boolean; ms: number; detail?: string; error?: string };

async function timed(fn: () => Promise<string>): Promise<Check> {
  const started = Date.now();
  try {
    const detail = await fn();
    return { ok: true, ms: Date.now() - started, detail };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Round trips a marker object, so it covers both PutObject and GetObject. */
function checkS3(): Promise<Check> {
  return timed(async () => {
    const key = "health/ping.txt";
    const body = new Date().toISOString();
    await s3().send(
      new PutObjectCommand({
        Bucket: config.billsBucket,
        Key: key,
        Body: body,
        ContentType: "text/plain",
      }),
    );
    const read = await s3().send(
      new GetObjectCommand({ Bucket: config.billsBucket, Key: key }),
    );
    const roundTripped = await read.Body?.transformToString();
    if (roundTripped !== body) throw new Error("S3 round trip mismatch");
    return `put and got s3://${config.billsBucket}/${key}`;
  });
}

/** Queries gsi1 exactly the way the ledger view will. */
function checkDynamo(): Promise<Check> {
  return timed(async () => {
    const result = await ddb().send(
      new QueryCommand({
        TableName: config.ledgerTable,
        IndexName: "gsi1",
        KeyConditionExpression: "gsi1pk = :pk",
        ExpressionAttributeValues: { ":pk": "SHOP#demo" },
        Limit: 1,
      }),
    );
    return `queried ${config.ledgerTable}/gsi1, ${result.Count ?? 0} row(s)`;
  });
}

/**
 * A 240x60 PNG reading "TOTAL 100.00". Small enough to inline, real enough
 * that AnalyzeExpense has to actually parse it.
 */
const PROBE_PNG = "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";

/** One page of AnalyzeExpense. Billed per page, so it is opt in. */
function checkTextract(): Promise<Check> {
  return timed(async () => {
    const result = await textract().send(
      new AnalyzeExpenseCommand({
        Document: { Bytes: Buffer.from(PROBE_PNG, "base64") },
      }),
    );
    const doc = result.ExpenseDocuments?.[0];
    if (!doc) throw new Error("analyze-expense returned no expense document");
    const fields = doc.SummaryFields?.length ?? 0;
    const items =
      doc.LineItemGroups?.reduce(
        (n, g) => n + (g.LineItems?.length ?? 0),
        0,
      ) ?? 0;
    return `analyze-expense parsed ${fields} summary field(s), ${items} line item(s)`;
  });
}

/** The explanation model. Free tier, so this costs nothing but a moment. */
function checkExplainModel(): Promise<Check> {
  return timed(async () => {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.openRouterKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.explainModel,
          max_tokens: 64,
          messages: [{ role: "user", content: "Reply with one word: ok" }],
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`${response.status} ${(await response.text()).slice(0, 160)}`);
    }
    const body = await response.json();
    const choice = body?.choices?.[0];
    const text = choice?.message?.content?.trim();
    // Reasoning models can spend the whole budget before emitting content.
    // The call still proves the key and the model id are good.
    const detail = text ? JSON.stringify(text) : `no text, finish_reason=${choice?.finish_reason}`;
    return `${config.explainModel} replied ${detail}`;
  });
}

export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get("deep") === "1";

  const [s3Check, dynamoCheck, textractCheck, explainCheck] = await Promise.all([
    checkS3(),
    checkDynamo(),
    deep ? checkTextract() : Promise.resolve(undefined),
    deep ? checkExplainModel() : Promise.resolve(undefined),
  ]);

  const checks: Record<string, Check> = { s3: s3Check, dynamodb: dynamoCheck };
  if (textractCheck) checks.textract = textractCheck;
  if (explainCheck) checks.explainModel = explainCheck;

  const ok = Object.values(checks).every((check) => check.ok);
  return NextResponse.json(
    { ok, deep, checks, commit: process.env.AWS_COMMIT_ID ?? null },
    { status: ok ? 200 : 503 },
  );
}
