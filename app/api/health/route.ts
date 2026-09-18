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
 * GET /api/health?deep=1   also calls Bedrock, which costs tokens
 */

import { NextResponse } from "next/server";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { s3, ddb, bedrock, config } from "@/lib/aws";

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

/** Smallest real InvokeModel call. Costs tokens, so it is opt in. */
function checkBedrock(): Promise<Check> {
  return timed(async () => {
    const response = await bedrock().messages.create({
      model: config.modelId,
      max_tokens: 1024,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
    });
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    return `${config.modelId} in ${config.bedrockRegion} replied ${JSON.stringify(text)}`;
  });
}

export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get("deep") === "1";

  const [s3Check, dynamoCheck, bedrockCheck] = await Promise.all([
    checkS3(),
    checkDynamo(),
    deep ? checkBedrock() : Promise.resolve(undefined),
  ]);

  const checks: Record<string, Check> = { s3: s3Check, dynamodb: dynamoCheck };
  if (bedrockCheck) checks.bedrock = bedrockCheck;

  const ok = Object.values(checks).every((check) => check.ok);
  return NextResponse.json(
    { ok, deep, checks, commit: process.env.AWS_COMMIT_ID ?? null },
    { status: ok ? 200 : 503 },
  );
}
