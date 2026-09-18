/**
 * Shared AWS and Bedrock clients.
 *
 * Both tracks import from here so there is exactly one place that reads
 * environment variables and one place that constructs clients.
 *
 * Everything is lazy on purpose. Next builds evaluate modules, and Amplify
 * does not necessarily have the runtime environment set at build time, so
 * constructing clients at import would turn a missing variable into a failed
 * build instead of a clear error on the first request.
 *
 * Credentials are never passed explicitly. Locally they come from the AWS
 * profile, in production from the Amplify SSR compute role.
 */

import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`,
    );
  }
  return value;
}

export const config = {
  /** Region for S3 and DynamoDB. */
  get region() {
    return required("AWS_REGION");
  },
  /** Region Bedrock is called in. Not necessarily the same as `region`. */
  get bedrockRegion() {
    return required("BEDROCK_REGION");
  },
  /** Carries the "anthropic." prefix that Bedrock model IDs require. */
  get modelId() {
    return required("BEDROCK_MODEL_ID");
  },
  get billsBucket() {
    return required("BILLS_BUCKET");
  },
  get ledgerTable() {
    return required("LEDGER_TABLE");
  },
};

let s3Client: S3Client | undefined;
export function s3(): S3Client {
  s3Client ??= new S3Client({ region: config.region });
  return s3Client;
}

let ddbClient: DynamoDBDocumentClient | undefined;
export function ddb(): DynamoDBDocumentClient {
  ddbClient ??= DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: config.region }),
    // Undefined fields are common on an ExtractedBill (no bill number, no due
    // date). Dropping them beats writing nulls we would have to filter later.
    { marshallOptions: { removeUndefinedValues: true } },
  );
  return ddbClient;
}

let bedrockClient: AnthropicBedrockMantle | undefined;
export function bedrock(): AnthropicBedrockMantle {
  bedrockClient ??= new AnthropicBedrockMantle({
    awsRegion: config.bedrockRegion,
  });
  return bedrockClient;
}
