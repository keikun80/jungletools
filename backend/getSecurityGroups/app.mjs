import { DescribeVpcsCommand, DescribeSecurityGroupsCommand } from "@aws-sdk/client-ec2";
import { buildResponse, getEc2Client } from "../utils.mjs";

export const handler = async (event) => {
  try {
    const ec2Client = await getEc2Client(event);
    // 1. Fetch VPCs
    const vpcsData = await ec2Client.send(new DescribeVpcsCommand({}));
    const vpcs = vpcsData.Vpcs || [];

    // 2. Fetch Security Groups
    const sgsData = await ec2Client.send(new DescribeSecurityGroupsCommand({}));
    const securityGroups = sgsData.SecurityGroups || [];

    // Map security groups by VPC ID
    const sgMapByVpc = {};
    securityGroups.forEach((sg) => {
      const vpcId = sg.VpcId || "no-vpc";
      if (!sgMapByVpc[vpcId]) {
        sgMapByVpc[vpcId] = [];
      }

      // Format tags for easy frontend rendering
      const nameTag = sg.Tags?.find((t) => t.Key === "Name")?.Value || "";

      sgMapByVpc[vpcId].push({
        groupId: sg.GroupId,
        groupName: sg.GroupName,
        description: sg.Description,
        name: nameTag,
        ipPermissions: sg.IpPermissions || [],
        ipPermissionsEgress: sg.IpPermissionsEgress || [],
        tags: sg.Tags || []
      });
    });

    // 3. Construct rich VPC response list
    const resultVpcs = vpcs.map((vpc) => {
      const nameTag = vpc.Tags?.find((t) => t.Key === "Name")?.Value || "";
      return {
        vpcId: vpc.VpcId,
        vpcName: nameTag || "Unnamed VPC",
        cidrBlock: vpc.CidrBlock,
        isDefault: vpc.IsDefault || false,
        state: vpc.State,
        securityGroups: sgMapByVpc[vpc.VpcId] || []
      };
    });

    // Add security groups that don't belong to any VPC if any (rare edge case)
    if (sgMapByVpc["no-vpc"]) {
      resultVpcs.push({
        vpcId: "no-vpc",
        vpcName: "No VPC / Classic",
        cidrBlock: "N/A",
        isDefault: false,
        state: "available",
        securityGroups: sgMapByVpc["no-vpc"]
      });
    }

    return buildResponse(200, { vpcs: resultVpcs });
  } catch (error) {
    console.error("Error fetching security groups:", error);
    return buildResponse(500, { message: "Failed to fetch security groups", error: error.message });
  }
};
