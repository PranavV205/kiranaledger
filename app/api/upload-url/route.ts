/**
 * Hands the browser a presigned URL so the photo goes straight to S3.
 *
 * The alternative, posting the image through this route, would put a multi
 * megabyte phone photo through a serverless function for no reason and run
 * into request size limits on the way. Presigning keeps the bytes on a path
 * between the phone and the bucket, and this function only ever sees a name.
 *
 * POST { filename, contentType } -> { uploadUrl, s3Key }
 */

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, config } from "@/lib/aws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Long enough for a slow phone upload, short enough to be worth signing. */
const URL_TTL_SECONDS = 300;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export async function POST(request: Request) {
  let body: { filename?: string; contentType?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const contentType = body.contentType?.toLowerCase();
  if (!contentType || !(contentType in EXTENSIONS)) {
    return NextResponse.json(
      {
        error: `Unsupported file type${contentType ? ` "${contentType}"` : ""}. Upload a photo or a PDF.`,
      },
      { status: 415 },
    );
  }

  // Dated prefix so the bucket stays browsable by hand during the build, and
  // a uuid so two people photographing the same bill never collide.
  const day = new Date().toISOString().slice(0, 10);
  const s3Key = `bills/${day}/${randomUUID()}.${EXTENSIONS[contentType]}`;

  const uploadUrl = await getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: config.billsBucket,
      Key: s3Key,
      ContentType: contentType,
    }),
    { expiresIn: URL_TTL_SECONDS },
  );

  return NextResponse.json({ uploadUrl, s3Key });
}
