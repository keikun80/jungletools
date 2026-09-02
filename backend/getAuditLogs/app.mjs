import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { buildResponse } from "../utils.mjs";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const AUDIT_LOG_TABLE = process.env.AUDIT_LOG_TABLE || "SgAuditLogs";

export const handler = async (event) => {
  try {
    // Retrieve logs from DynamoDB
    // For a fully production system with huge volume, a GSI on action/timestamp is preferred.
    // For this dashboard helper, a simple scan with limit/in-memory sort fits.
    const result = await docClient.send(new ScanCommand({
      TableName: AUDIT_LOG_TABLE,
      Limit: 100
    }));

    const items = result.Items || [];

    // Sort items by timestamp descending (newest first)
    items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return buildResponse(200, { logs: items });
  } catch (error) {
    console.error("Error fetching audit logs:", error);
    return buildResponse(500, { message: "Failed to fetch audit logs", error: error.message });
  }
};
