import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { buildResponse } from "../utils.mjs";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const SLACK_CONFIG_TABLE = process.env.SLACK_CONFIG_TABLE || "SlackConfig";

export const handler = async (event) => {
  try {
    let body = {};
    if (event.body) {
      body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    }

    const existing = await docClient.send(
      new GetCommand({
        TableName: SLACK_CONFIG_TABLE,
        Key: { id: "default" }
      })
    );
    const existingItem = existing.Item || {};

    const updatedConfig = {
      ...existingItem,
      id: "default",
      ...(body.webhookUrl !== undefined && { webhookUrl: body.webhookUrl }),
      ...(body.webhookMessageType !== undefined && { webhookMessageType: body.webhookMessageType }),
      ...(body.webhookEnabled !== undefined && { webhookEnabled: body.webhookEnabled === true }),
      ...(body.channelEmail !== undefined && { channelEmail: body.channelEmail }),
      ...(body.senderEmail !== undefined && { senderEmail: body.senderEmail }),
      ...(body.scheduleCron !== undefined && { scheduleCron: body.scheduleCron }),
      ...(body.enabled !== undefined && { enabled: body.enabled === true }),
      ...(body.emailMessageType !== undefined && { emailMessageType: body.emailMessageType }),
      updatedAt: new Date().toISOString()
    };

    await docClient.send(
      new PutCommand({
        TableName: SLACK_CONFIG_TABLE,
        Item: updatedConfig
      })
    );

    return buildResponse(200, { message: "Slack config saved successfully", config: updatedConfig });
  } catch (error) {
    console.error("Error saving Slack config:", error);
    return buildResponse(500, { message: "Failed to save Slack config", error: error.message });
  }
};
