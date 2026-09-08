import { EFSClient, DescribeFileSystemsCommand, DescribeBackupPolicyCommand } from "@aws-sdk/client-efs";
import { buildResponse, getAwsClient } from "../utils.mjs";

export const handler = async (event) => {
  try {
    const efsClient = await getAwsClient(EFSClient, event);

    let fileSystems = [];
    try {
      const fsData = await efsClient.send(new DescribeFileSystemsCommand({}));
      fileSystems = fsData.FileSystems || [];
    } catch (err) {
      console.error("Error describing EFS file systems:", err.message);
      return buildResponse(200, {
        summary: { totalFileSystems: 0, healthy: 0, failure: 0, unprotected: 0 },
        fileSystems: [],
        error: `IAM or Access Error: ${err.message}`
      });
    }

    let healthyCount = 0;
    let failureCount = 0;
    let unprotectedCount = 0;

    const formattedFileSystems = await Promise.all(
      fileSystems.map(async (fs) => {
        const nameTag = fs.Tags?.find((t) => t.Key === "Name")?.Value || "";
        let backupPolicyStatus = "DISABLED";
        let status = "Unprotected";

        try {
          const policyData = await efsClient.send(
            new DescribeBackupPolicyCommand({
              FileSystemId: fs.FileSystemId
            })
          );
          backupPolicyStatus = policyData.BackupPolicy?.Status || "DISABLED";
          if (backupPolicyStatus === "ENABLED") {
            status = "Healthy";
            healthyCount++;
          } else {
            status = "Unprotected";
            unprotectedCount++;
          }
        } catch (err) {
          console.warn(`Could not fetch backup policy for ${fs.FileSystemId}:`, err.message);
          status = "Failure";
          failureCount++;
        }

        return {
          fileSystemId: fs.FileSystemId,
          name: nameTag || "Unnamed EFS",
          creationTime: fs.CreationTime,
          lifeCycleState: fs.LifeCycleState,
          numberOfMountTargets: fs.NumberOfMountTargets,
          sizeInBytes: fs.SizeInBytes?.Value || 0,
          performanceMode: fs.PerformanceMode,
          throughputMode: fs.ThroughputMode,
          backupPolicyStatus,
          status
        };
      })
    );

    const summary = {
      totalFileSystems: fileSystems.length,
      healthy: healthyCount,
      failure: failureCount,
      unprotected: unprotectedCount
    };

    return buildResponse(200, {
      summary,
      fileSystems: formattedFileSystems
    });
  } catch (error) {
    console.error("Error fetching EFS backup status:", error);
    return buildResponse(200, {
      summary: { totalFileSystems: 0, healthy: 0, failure: 0, unprotected: 0 },
      fileSystems: [],
      error: error.message
    });
  }
};
