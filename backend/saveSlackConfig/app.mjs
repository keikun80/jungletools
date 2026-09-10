import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { buildResponse, isValidSlackWebhookUrl } from "../utils.mjs";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const SLACK_CONFIG_TABLE = process.env.SLACK_CONFIG_TABLE || "SlackConfig";

export const handler = async (event) => {
  try {
    let body = {};
    if (event.body) {
      body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    }

    // Security Validation: Validate webhook URLs to prevent SSRF and injection
    if (body.webhookUrl && typeof body.webhookUrl === "string" && body.webhookUrl.trim().length > 0) {
      if (!isValidSlackWebhookUrl(body.webhookUrl)) {
        return buildResponse(400, {
          message: "유효하지 않은 슬랙 웹훅 URL입니다. 'https://hooks.slack.com/services/...', '/triggers/...', 또는 '/workflows/...' 형식이어야 합니다."
        });
      }
    }

    if (Array.isArray(body.webhooks)) {
      for (let i = 0; i < body.webhooks.length; i++) {
        const wh = body.webhooks[i];
        if (wh && wh.url && typeof wh.url === "string" && wh.url.trim().length > 0) {
          if (!isValidSlackWebhookUrl(wh.url)) {
            return buildResponse(400, {
              message: `웹훅 #${i + 1} (${wh.name || "이름 없음"}): 유효하지 않은 슬랙 웹훅 URL입니다. 'https://hooks.slack.com/services/...', '/triggers/...', 또는 '/workflows/...' 형식이어야 합니다.`
            });
          }
        }
      }
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
      ...(Array.isArray(body.webhooks) && { webhooks: body.webhooks }),
      ...(body.webhookUrl !== undefined && { webhookUrl: body.webhookUrl }),
      ...(body.webhookMessageType !== undefined && { webhookMessageType: body.webhookMessageType }),
      ...(body.webhookEnabled !== undefined && { webhookEnabled: body.webhookEnabled === true }),
      ...(body.webhookScheduleCron !== undefined && { webhookScheduleCron: body.webhookScheduleCron }),
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
