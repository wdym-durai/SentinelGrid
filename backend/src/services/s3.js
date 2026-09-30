/**
 * SentinelGrid — Amazon S3 Service
 *
 * STATUS: STUBBED — Not connected to AWS yet.
 *
 * This file contains the real AWS SDK v3 code structure for S3.
 * It will only run when USE_AWS=true in your .env file.
 *
 * Purpose in this prototype:
 *   - Stores "evidence" files (images) associated with incidents
 *   - In the prototype, evidence is simulated (preloaded sample images)
 *   - In a real system, camera frame captures would be uploaded here
 *
 * AWS SERVICE: Amazon S3 (Simple Storage Service) — real AWS service
 * SDK DOCS: https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-example-creating-buckets.html
 *
 * SETUP REQUIRED BEFORE THIS WORKS:
 *   1. Create an S3 bucket named "sentinelgrid-evidence" (or your chosen name)
 *   2. Configure AWS credentials via AWS CLI
 *   3. Set USE_AWS=true and S3_BUCKET_NAME in your .env file
 */

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fs = require('fs');
const path = require('path');

// Credentials are read automatically from the AWS CLI configuration.
// We do NOT hardcode credentials here.
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'sentinelgrid-evidence';

/**
 * Uploads an evidence file (Buffer or stream) to S3.
 *
 * @param {string} key       — the filename/path in S3 (e.g. "evidence/incident-123.jpg")
 * @param {Buffer} fileBuffer — the file data
 * @param {string} contentType — MIME type, e.g. "image/jpeg"
 * @returns {string} — the S3 object key on success
 */
async function uploadEvidence(key, fileBuffer, contentType = 'image/jpeg') {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
  });

  await s3Client.send(command);
  console.log(`[S3] Evidence uploaded: s3://${BUCKET_NAME}/${key}`);
  return key;
}

/**
 * Generates a temporary signed URL so the frontend can display an evidence image
 * directly from S3 without making the bucket fully public.
 *
 * The URL expires after 1 hour (3600 seconds).
 *
 * @param {string} key — the S3 object key
 * @returns {string} — a temporary HTTPS URL
 */
async function getEvidenceUrl(key) {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  return signedUrl;
}

module.exports = { uploadEvidence, getEvidenceUrl, uploadEvidenceFromPath };

/**
 * Reads a simulated evidence SVG from disk and uploads it to S3.
 *
 * IMPORTANT: This uploads SIMULATED / PROTOTYPE evidence only.
 * The source files are pre-made SVG graphics, not real camera captures.
 * They are clearly labeled as simulated within the SVG content itself.
 *
 * Called only when USE_AWS=true. Never called in Local Mock Mode.
 *
 * @param {string} filename   — the SVG filename, e.g. "sample1.svg"
 * @param {string} incidentId — the UUID of the incident being created
 * @returns {{ s3Key: string, presignedUrl: string }}
 *   s3Key        — the object key stored in DynamoDB, e.g. "evidence/<incidentId>/sample1.svg"
 *   presignedUrl — a temporary HTTPS URL the frontend can use to display the image (1 hour TTL)
 */
async function uploadEvidenceFromPath(filename, incidentId) {
  // Resolve the absolute path to the SVG file on disk.
  // The SVGs live in frontend/public/sample-evidence/ relative to the repo root.
  // __dirname is backend/src/services/, so we walk up three levels to reach the repo root.
  const filePath = path.resolve(
    __dirname,
    '../../../frontend/public/sample-evidence',
    filename
  );

  // Read the file into a Buffer (synchronous — acceptable for prototype scale)
  const fileBuffer = fs.readFileSync(filePath);

  // Build a unique S3 key scoped to this incident so each upload is distinct
  const s3Key = `evidence/${incidentId}/${filename}`;

  // Upload to S3
  await uploadEvidence(s3Key, fileBuffer, 'image/svg+xml');

  // Generate a presigned URL so the frontend can load it directly from S3
  const presignedUrl = await getEvidenceUrl(s3Key);

  return { s3Key, presignedUrl };
}

module.exports = { uploadEvidence, getEvidenceUrl, uploadEvidenceFromPath };
