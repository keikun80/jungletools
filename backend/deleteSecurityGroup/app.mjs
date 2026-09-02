import { DeleteSecurityGroupCommand } from "@aws-sdk/client-ec2";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { buildResponse, getEc2Client } from "../utils.mjs";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const AUDIT_LOG_TABLE = process.env.AUDIT_LOG_TABLE || "SgAuditLogs";

export const handler = async (event) => {
  try {
    const ec2Client = await getEc2Client(event);
    const sgId = event.pathParameters?.id;
    if (!sgId) {
      return buildResponse(400, { message: "Security Group ID (id) path parameter is missing" });
    }

    // 1. Delete Security Group in AWS EC2
    await ec2Client.send(new DeleteSecurityGroupCommand({ GroupId: sgId }));

    // 2. Log the action to DynamoDB
    const timestamp = new Date().toISOString();
    const logItem = {
      sgId: sgId,
      timestamp: timestamp,
      action: "DELETE",
      details: JSON.stringify({ message: `Security Group ${sgId} was deleted.` }),
      status: "SUCCESS"
    };

    await docClient.send(new PutCommand({
      TableName: AUDIT_LOG_TABLE,
      Item: logItem
    }));

    return buildResponse(200, {
      message: "Security group deleted successfully",
      sgId
    });

  } catch (error) {
    console.error("Error deleting security group:", error);
    return buildResponse(500, { message: "Failed to delete security group", error: error.message });
  }
};
