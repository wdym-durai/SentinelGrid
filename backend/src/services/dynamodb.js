/**
 * SentinelGrid — Amazon DynamoDB Service
 *
 * STATUS: STUBBED — Not connected to AWS yet.
 *
 * This file contains the real AWS SDK v3 code structure for DynamoDB.
 * It will only run when USE_AWS=true in your .env file.
 *
 * When USE_AWS=false (current default), the routes use mockStore.js instead
 * and these functions are never called.
 *
 * AWS SERVICE: Amazon DynamoDB (real AWS service)
 * SDK DOCS: https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/dynamodb-example-dynamodb-utilities.html
 *
 * SETUP REQUIRED BEFORE THIS WORKS:
 *   1. Create a DynamoDB table named "SentinelGridIncidents" in AWS Console
 *   2. Configure AWS credentials via AWS CLI (we will do this together)
 *   3. Set USE_AWS=true and DYNAMODB_TABLE_NAME in your .env file
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

// The DynamoDB client reads credentials automatically from:
//   1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
//   2. AWS CLI configuration (~/.aws/credentials) — the preferred method
// We do NOT hardcode credentials here.
const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'SentinelGridIncidents';

/**
 * Retrieves all incidents from DynamoDB.
 * Uses a Scan operation (appropriate for prototype scale).
 */
async function getAllIncidents() {
  const command = new ScanCommand({ TableName: TABLE_NAME });
  const response = await docClient.send(command);
  // Sort newest first
  return (response.Items || []).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
}

/**
 * Retrieves a single incident by its ID.
 * @param {string} id — the incident's unique ID
 */
async function getIncidentById(id) {
  const command = new GetCommand({
    TableName: TABLE_NAME,
    Key: { id },
  });
  const response = await docClient.send(command);
  return response.Item || null;
}

/**
 * Saves a new incident to DynamoDB.
 * @param {Object} incident — the full incident object
 */
async function addIncident(incident) {
  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: incident,
  });
  await docClient.send(command);
  return incident;
}

/**
 * Updates fields on an existing incident.
 * @param {string} id — incident ID
 * @param {Object} updates — key/value pairs to update
 */
async function updateIncident(id, updates) {
  // Build DynamoDB update expression dynamically from the updates object
  const updateExpressions = [];
  const expressionAttributeNames = {};
  const expressionAttributeValues = {};

  Object.entries(updates).forEach(([key, value], index) => {
    const nameKey = `#field${index}`;
    const valueKey = `:val${index}`;
    updateExpressions.push(`${nameKey} = ${valueKey}`);
    expressionAttributeNames[nameKey] = key;
    expressionAttributeValues[valueKey] = value;
  });

  const command = new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { id },
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'ALL_NEW',
  });

  const response = await docClient.send(command);
  return response.Attributes || null;
}

module.exports = { getAllIncidents, getIncidentById, addIncident, updateIncident };
