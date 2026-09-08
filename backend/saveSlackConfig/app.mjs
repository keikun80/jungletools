import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
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

    const { channelEmail, senderEmail, scheduleCron, enabled } = body;

    const updatedConfig = {
      id: "default",
      channelEmail: channelEmail || "",
      senderEmail: senderEmail || "",
      scheduleCron: scheduleCron || "cron(0 0 * * ? *)",
      enabled: enabled === true,
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
