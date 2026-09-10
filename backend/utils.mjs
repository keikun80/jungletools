import { EC2Client } from "@aws-sdk/client-ec2";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";

let localEc2Client = null;

export async function getAwsClient(ClientClass, event) {
  const targetRoleArn = event.headers?.["x-target-role-arn"] || event.headers?.["X-Target-Role-Arn"];
  const region = event.headers?.["x-target-region"] || event.headers?.["X-Target-Region"] || process.env.AWS_REGION || "ap-northeast-2";

  if (!targetRoleArn) {
    return new ClientClass({ region });
  }

  // Security Validation: Enforce exact role ARN pattern to prevent unauthorized assume role injection
  const roleArnPattern = /^arn:aws:iam::\d{12}:role\/JungleToolsCrossAccountRole$/;
  const trimmedRoleArn = targetRoleArn.trim();
  if (!roleArnPattern.test(trimmedRoleArn)) {
    console.error(`Security Violation: Unauthorized or malformed targetRoleArn '${targetRoleArn}'`);
    throw new Error("Invalid or unauthorized target role ARN.");
  }

  try {
    console.log(`Assuming role: ${trimmedRoleArn} in region: ${region} for ${ClientClass.name}`);
    const stsClient = new STSClient({ region });
    const assumeRoleResponse = await stsClient.send(
      new AssumeRoleCommand({
        RoleArn: trimmedRoleArn,
        RoleSessionName: "JungleToolsSession",
        DurationSeconds: 900
      })
    );

    const credentials = assumeRoleResponse.Credentials;
    return new ClientClass({
      region,
      credentials: {
        accessKeyId: credentials.AccessKeyId,
        secretAccessKey: credentials.SecretAccessKey,
        sessionToken: credentials.SessionToken
      }
    });
  } catch (error) {
    console.error(`Failed to assume role ${targetRoleArn}:`, error);
    throw new Error(`Failed to assume target role: ${error.message}`);
  }
}

export async function getEc2Client(event) {
  return getAwsClient(EC2Client, event);
}

export function buildResponse(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Target-Role-Arn,X-Target-Region"
    },
    body: JSON.stringify(body)
  };
}
