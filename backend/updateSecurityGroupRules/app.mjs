import {
  DescribeSecurityGroupsCommand,
  AuthorizeSecurityGroupIngressCommand,
  RevokeSecurityGroupIngressCommand,
  AuthorizeSecurityGroupEgressCommand,
  RevokeSecurityGroupEgressCommand
} from "@aws-sdk/client-ec2";
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

    if (!event.body) {
      return buildResponse(400, { message: "Request body is missing" });
    }

    const { inboundRules, outboundRules } = JSON.parse(event.body);

    if (!Array.isArray(inboundRules) || !Array.isArray(outboundRules)) {
      return buildResponse(400, { message: "inboundRules and outboundRules must be arrays" });
    }

    // 1. Get current rules of the Security Group
    const sgData = await ec2Client.send(new DescribeSecurityGroupsCommand({ GroupIds: [sgId] }));
    if (!sgData.SecurityGroups || sgData.SecurityGroups.length === 0) {
      return buildResponse(404, { message: `Security Group ${sgId} not found` });
    }
    const currentSg = sgData.SecurityGroups[0];
    const oldInbound = currentSg.IpPermissions || [];
    const oldOutbound = currentSg.IpPermissionsEgress || [];

    // 2. Revoke current rules
    // To avoid EC2 API errors, we only revoke if rules actually exist.
    if (oldInbound.length > 0) {
      await ec2Client.send(new RevokeSecurityGroupIngressCommand({
        GroupId: sgId,
        IpPermissions: oldInbound
      }));
    }
    if (oldOutbound.length > 0) {
      await ec2Client.send(new RevokeSecurityGroupEgressCommand({
        GroupId: sgId,
        IpPermissions: oldOutbound
      }));
    }

    // Helper to format rule parameters from frontend to AWS SDK structures
    const mapRules = (rules) => {
      return rules.map((r) => {
        const ipPerm = {
          IpProtocol: r.ipProtocol,
          FromPort: r.fromPort === null || r.fromPort === undefined || r.ipProtocol === "-1" ? -1 : Number(r.fromPort),
          ToPort: r.toPort === null || r.toPort === undefined || r.ipProtocol === "-1" ? -1 : Number(r.toPort)
        };

        if (r.ipRanges && Array.isArray(r.ipRanges)) {
          ipPerm.IpRanges = r.ipRanges.map((ip) => ({
            CidrIp: ip.cidrIp,
            Description: ip.description || ""
          }));
        }

        if (r.userIdGroupPairs && Array.isArray(r.userIdGroupPairs)) {
          ipPerm.UserIdGroupPairs = r.userIdGroupPairs.map((pair) => ({
            GroupId: pair.groupId,
            Description: pair.description || ""
          }));
        }

        return ipPerm;
      });
    };

    const newInbound = mapRules(inboundRules);
    const newOutbound = mapRules(outboundRules);

    // 3. Authorize new rules
    if (newInbound.length > 0) {
      await ec2Client.send(new AuthorizeSecurityGroupIngressCommand({
        GroupId: sgId,
        IpPermissions: newInbound
      }));
    }
    if (newOutbound.length > 0) {
      await ec2Client.send(new AuthorizeSecurityGroupEgressCommand({
        GroupId: sgId,
        IpPermissions: newOutbound
      }));
    }

    // 4. Log changes to DynamoDB
    const timestamp = new Date().toISOString();
    const logItem = {
      sgId: sgId,
      timestamp: timestamp,
      action: "UPDATE_RULES",
      details: JSON.stringify({
        before: { inbound: oldInbound, outbound: oldOutbound },
        after: { inbound: newInbound, outbound: newOutbound }
      }),
      status: "SUCCESS"
    };

    await docClient.send(new PutCommand({
      TableName: AUDIT_LOG_TABLE,
      Item: logItem
    }));

    return buildResponse(200, {
      message: "Security Group rules updated successfully",
      sgId,
      inboundRules: newInbound,
      outboundRules: newOutbound
    });

  } catch (error) {
    console.error("Error updating security group rules:", error);
    return buildResponse(500, { message: "Failed to update security group rules", error: error.message });
  }
};
