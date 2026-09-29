/**
 * SentinelGrid — Amazon SNS Service
 *
 * STATUS: STUBBED — Not connected to AWS yet.
 *
 * This file contains the real AWS SDK v3 code structure for SNS.
 * It will only run when USE_AWS=true in your .env file.
 *
 * Purpose in this prototype:
 *   - Publishes an alert notification every time a new incident is created
 *   - In a real deployment, this could notify monitoring staff via email or SMS
 *   - For the demo, it demonstrates that a real AWS notification was triggered
 *
 * AWS SERVICE: Amazon SNS (Simple Notification Service) — real AWS service
 * SDK DOCS: https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/sns-examples-publishing-messages.html
 *
 * SETUP REQUIRED BEFORE THIS WORKS:
 *   1. Create an SNS topic named "SentinelGridAlerts" in AWS Console
 *   2. Copy the topic ARN into SNS_TOPIC_ARN in your .env file
 *   3. Configure AWS credentials via AWS CLI
 *   4. Set USE_AWS=true in your .env file
 */

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

// Credentials are read automatically from the AWS CLI configuration.
// We do NOT hardcode credentials here.
const snsClient = new SNSClient({ region: process.env.AWS_REGION || 'us-east-1' });

const TOPIC_ARN = process.env.SNS_TOPIC_ARN;

/**
 * Publishes an incident alert to the SNS topic.
 * This is called automatically when a new incident is created (USE_AWS=true).
 *
 * @param {Object} incident — the newly created incident object
 */
async function publishAlert(incident) {
  if (!TOPIC_ARN) {
    console.warn('[SNS] SNS_TOPIC_ARN is not set — skipping notification');
    return;
  }

  const message = [
    '🚨 SentinelGrid — New Incident Alert',
    '─────────────────────────────────────',
    `ID:        ${incident.id}`,
    `Title:     ${incident.title}`,
    `Severity:  ${incident.severity}`,
    `Location:  ${incident.location?.label || 'Unknown'}`,
    `Time:      ${incident.createdAt}`,
    `Status:    ${incident.status} — Awaiting human verification`,
    '─────────────────────────────────────',
    'NOTE: This alert requires human verification.',
    'No automatic action has been taken.',
  ].join('\n');

  const command = new PublishCommand({
    TopicArn: TOPIC_ARN,
    Subject: `[SentinelGrid] ${incident.severity} Alert — ${incident.title}`,
    Message: message,
  });

  const response = await snsClient.send(command);
  console.log(`[SNS] Alert published. MessageId: ${response.MessageId}`);
  return response.MessageId;
}

module.exports = { publishAlert };
