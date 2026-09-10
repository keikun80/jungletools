import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { buildResponse } from "../utils.mjs";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const SLACK_CONFIG_TABLE = process.env.SLACK_CONFIG_TABLE || "SlackConfig";

export const handler = async (event) => {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: SLACK_CONFIG_TABLE,
        Key: { id: "default" }
      })
    );

    const item = result.Item || {};
    let webhooks = Array.isArray(item.webhooks)
      ? item.webhooks.map((wh) => ({
          ...wh,
          scheduleCron: wh.scheduleCron || "cron(0 0 * * ? *)"
        }))
      : [];
    if (webhooks.length === 0 && item.webhookUrl) {
      webhooks = [{
        id: "wh_default",
        name: "기본 웹훅",
        url: item.webhookUrl,
        messageType: item.webhookMessageType || "summary",
        scheduleCron: item.webhookScheduleCron || "cron(0 0 * * ? *)",
        enabled: item.webhookEnabled === true
      }];
    }

    const config = {
      id: "default",
      webhooks,
      webhookUrl: item.webhookUrl || "",
      webhookMessageType: item.webhookMessageType || "summary",
      webhookEnabled: item.webhookEnabled === true,
      webhookScheduleCron: item.webhookScheduleCron || "cron(0 0 * * ? *)",
      channelEmail: item.channelEmail || "",
      senderEmail: item.senderEmail || "",
      scheduleCron: item.scheduleCron || "cron(0 0 * * ? *)",
      enabled: item.enabled === true,
      emailMessageType: item.emailMessageType || "report",
      lastSentTimestamp: item.lastSentTimestamp || null,
      lastWebhookSentTimestamp: item.lastWebhookSentTimestamp || null,
      updatedAt: item.updatedAt || null
    };

    return buildResponse(200, { config });
  } catch (error) {
    console.error("Error fetching Slack config:", error);
    return buildResponse(500, { message: "Failed to fetch Slack config", error: error.message });
  }
};
