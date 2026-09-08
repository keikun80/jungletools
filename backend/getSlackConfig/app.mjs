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

    const config = result.Item || {
      id: "default",
      channelEmail: "",
      senderEmail: "",
      scheduleCron: "cron(0 0 * * ? *)",
      enabled: false,
      lastSentTimestamp: null
    };

    return buildResponse(200, { config });
  } catch (error) {
    console.error("Error fetching Slack config:", error);
    return buildResponse(500, { message: "Failed to fetch Slack config", error: error.message });
  }
};
