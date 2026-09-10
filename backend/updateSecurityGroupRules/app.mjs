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

    // Helper to format & validate rule parameters from frontend to AWS SDK structures
    const mapRules = (rules, ruleTypeName = "rule") => {
      return rules.map((r, idx) => {
        const proto = (r.ipProtocol || "-1").toLowerCase();
        const isAll = proto === "-1" || proto === "all";
        const isTcpUdp = proto === "tcp" || proto === "udp";
        const isIcmp = proto === "icmp" || proto === "icmpv6";

        let fromPort = -1;
        let toPort = -1;

        if (isAll) {
          fromPort = -1;
          toPort = -1;
        } else if (isTcpUdp) {
          const fp = r.fromPort !== null && r.fromPort !== undefined && r.fromPort !== "" ? Number(r.fromPort) : null;
          const tp = r.toPort !== null && r.toPort !== undefined && r.toPort !== "" ? Number(r.toPort) : null;

          if (fp === null && tp === null) {
            throw new Error(`${ruleTypeName} #${idx + 1}: ${proto.toUpperCase()} 프로토콜에는 포트 번호를 입력해야 합니다.`);
          }
          fromPort = fp !== null ? fp : tp;
          toPort = tp !== null ? tp : fp;

          if (isNaN(fromPort) || fromPort < 0 || fromPort > 65535 || isNaN(toPort) || toPort < 0 || toPort > 65535) {
            throw new Error(`${ruleTypeName} #${idx + 1}: 유효하지 않은 포트 범위입니다 (${fromPort} - ${toPort}). 0 ~ 65535 사이여야 합니다.`);
          }
          if (fromPort > toPort) {
            throw new Error(`${ruleTypeName} #${idx + 1}: 시작 포트(${fromPort})는 종료 포트(${toPort})보다 작거나 같아야 합니다.`);
          }
        } else if (isIcmp) {
          fromPort = r.fromPort !== null && r.fromPort !== undefined && r.fromPort !== "" ? Number(r.fromPort) : -1;
          toPort = r.toPort !== null && r.toPort !== undefined && r.toPort !== "" ? Number(r.toPort) : -1;
        }

        const ipPerm = {
          IpProtocol: isAll ? "-1" : proto,
          FromPort: fromPort,
          ToPort: toPort
        };

        if (r.ipRanges && Array.isArray(r.ipRanges) && r.ipRanges.length > 0) {
          const validRanges = r.ipRanges.filter(ip => ip && typeof ip.cidrIp === "string" && ip.cidrIp.trim().length > 0);
          if (validRanges.length > 0) {
            ipPerm.IpRanges = validRanges.map((ip) => ({
              CidrIp: ip.cidrIp.trim(),
              Description: ip.description || ""
            }));
          }
        }

        if (r.userIdGroupPairs && Array.isArray(r.userIdGroupPairs) && r.userIdGroupPairs.length > 0) {
          const validPairs = r.userIdGroupPairs.filter(pair => pair && typeof pair.groupId === "string" && pair.groupId.trim().length > 0);
          if (validPairs.length > 0) {
            ipPerm.UserIdGroupPairs = validPairs.map((pair) => ({
              GroupId: pair.groupId.trim(),
              Description: pair.description || ""
            }));
          }
        }

        if (!ipPerm.IpRanges && !ipPerm.UserIdGroupPairs) {
          ipPerm.IpRanges = [{ CidrIp: "0.0.0.0/0", Description: r.description || "" }];
        }

        return ipPerm;
      });
    };

    // 2. Validate & construct new rules
    let newInbound = [];
    let newOutbound = [];
    try {
      newInbound = mapRules(inboundRules, "인바운드");
      newOutbound = mapRules(outboundRules, "아웃바운드");
    } catch (valErr) {
      return buildResponse(400, { message: valErr.message });
    }

    // 3. DryRun validation: verify that all new rules are valid in AWS EC2
    try {
      if (newInbound.length > 0) {
        await ec2Client.send(new AuthorizeSecurityGroupIngressCommand({
          GroupId: sgId,
          IpPermissions: newInbound,
          DryRun: true
        }));
      }
      if (newOutbound.length > 0) {
        await ec2Client.send(new AuthorizeSecurityGroupEgressCommand({
          GroupId: sgId,
          IpPermissions: newOutbound,
          DryRun: true
        }));
      }
    } catch (dryErr) {
      if (dryErr.name !== "DryRunOperation" && !dryErr.message?.includes("DryRun flag is set") && dryErr.name !== "InvalidPermission.Duplicate") {
        console.error("DryRun authorization check failed:", dryErr);
        return buildResponse(400, { message: `보안 그룹 규칙 검증 오류: ${dryErr.message}`, error: dryErr.message });
      }
    }

    // 4. Safe Apply: Revoke old rules & Apply new rules with Rollback Protection
    try {
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
    } catch (applyErr) {
      console.error("Failed to apply new rules, rolling back to previous rules:", applyErr);
      try {
        if (oldInbound.length > 0) {
          await ec2Client.send(new AuthorizeSecurityGroupIngressCommand({
            GroupId: sgId,
            IpPermissions: oldInbound
          }));
        }
        if (oldOutbound.length > 0) {
          await ec2Client.send(new AuthorizeSecurityGroupEgressCommand({
            GroupId: sgId,
            IpPermissions: oldOutbound
          }));
        }
      } catch (rollbackErr) {
        console.error("Critical: Rollback also failed:", rollbackErr);
      }
      return buildResponse(500, { message: `보안 그룹 규칙 적용 실패 (기존 규칙으로 복구됨): ${applyErr.message}`, error: applyErr.message });
    }

    // 5. Log changes to DynamoDB
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

    try {
      await docClient.send(new PutCommand({
        TableName: AUDIT_LOG_TABLE,
        Item: logItem
      }));
    } catch (logErr) {
      console.warn("Failed to write audit log to DynamoDB:", logErr.message);
    }

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
