import { CreateSecurityGroupCommand, CreateTagsCommand } from "@aws-sdk/client-ec2";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { buildResponse, getEc2Client } from "../utils.mjs";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

const AUDIT_LOG_TABLE = process.env.AUDIT_LOG_TABLE || "SgAuditLogs";

export const handler = async (event) => {
  try {
    const ec2Client = await getEc2Client(event);
    if (!event.body) {
      return buildResponse(400, { message: "Request body is missing" });
    }

    const { groupName, description, vpcId, name } = JSON.parse(event.body);

    if (!groupName || !description || !vpcId) {
      return buildResponse(400, { message: "groupName, description, and vpcId are required fields" });
    }

    // 1. Create Security Group in AWS EC2
    const createParams = {
      GroupName: groupName,
      Description: description,
      VpcId: vpcId
    };
    const createResult = await ec2Client.send(new CreateSecurityGroupCommand(createParams));
    const sgId = createResult.GroupId;

    // 2. Add Name Tag if specified
    if (name || groupName) {
      const tagParams = {
        Resources: [sgId],
        Tags: [
          {
            Key: "Name",
            Value: name || groupName
          }
        ]
      };
      await ec2Client.send(new CreateTagsCommand(tagParams));
    }

    // 3. Log the action to DynamoDB
    const timestamp = new Date().toISOString();
    const logItem = {
      sgId: sgId,
      timestamp: timestamp,
      action: "CREATE",
      details: JSON.stringify({
        groupName,
        description,
        vpcId,
        name: name || groupName
      }),
      status: "SUCCESS"
    };

    await docClient.send(new PutCommand({
      TableName: AUDIT_LOG_TABLE,
      Item: logItem
    }));

    return buildResponse(201, {
      message: "Security group created successfully",
      securityGroup: {
        groupId: sgId,
        groupName,
        description,
        vpcId,
        name: name || groupName
      }
    });

  } catch (error) {
    console.error("Error creating security group:", error);
    return buildResponse(500, { message: "Failed to create security group", error: error.message });
  }
};
