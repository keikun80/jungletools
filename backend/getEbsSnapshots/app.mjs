import { EC2Client, DescribeVolumesCommand, DescribeSnapshotsCommand } from "@aws-sdk/client-ec2";
import { buildResponse, getAwsClient } from "../utils.mjs";

export const handler = async (event) => {
  try {
    const ec2Client = await getAwsClient(EC2Client, event);

    let volumes = [];
    let snapshots = [];

    try {
      const volumesData = await ec2Client.send(new DescribeVolumesCommand({}));
      volumes = volumesData.Volumes || [];
    } catch (err) {
      console.error("Error describing volumes:", err.message);
      return buildResponse(200, {
        summary: { totalVolumes: 0, healthy: 0, failure: 0, unprotected: 0, totalSnapshots: 0 },
        volumes: [],
        snapshots: [],
        error: `IAM or Access Error: ${err.message}`
      });
    }

    try {
      const snapshotsData = await ec2Client.send(
        new DescribeSnapshotsCommand({
          OwnerIds: ["self"]
        })
      );
      snapshots = snapshotsData.Snapshots || [];
    } catch (err) {
      console.warn("Error describing snapshots:", err.message);
    }

    const now = new Date();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

    // Group snapshots by VolumeId
    const snapshotMapByVolume = {};
    snapshots.forEach((snap) => {
      const volId = snap.VolumeId;
      if (!snapshotMapByVolume[volId]) {
        snapshotMapByVolume[volId] = [];
      }
      snapshotMapByVolume[volId].push(snap);
    });

    let healthyCount = 0;
    let failureCount = 0;
    let unprotectedCount = 0;

    const formattedVolumes = volumes.map((vol) => {
      const volSnapshots = snapshotMapByVolume[vol.VolumeId] || [];
      volSnapshots.sort((a, b) => new Date(b.StartTime) - new Date(a.StartTime));

      const latestSnap = volSnapshots[0] || null;
      const nameTag = vol.Tags?.find((t) => t.Key === "Name")?.Value || "";
      const attachedInstance = vol.Attachments?.[0]?.InstanceId || "Unattached";

      let status = "Unprotected";
      let latestSnapshotTime = null;
      let latestSnapshotId = null;
      let latestSnapshotState = null;

      if (latestSnap) {
        latestSnapshotId = latestSnap.SnapshotId;
        latestSnapshotTime = latestSnap.StartTime;
        latestSnapshotState = latestSnap.State;

        const ageMs = now - new Date(latestSnap.StartTime);

        // Updated Decision Logic:
        // - State === "completed" AND <= 7 days -> Healthy
        // - State === "error" OR >= 8 days -> Failure
        if (latestSnap.State === "completed" && ageMs <= SEVEN_DAYS_MS) {
          status = "Healthy";
          healthyCount++;
        } else {
          status = "Failure";
          failureCount++;
        }
      } else {
        unprotectedCount++;
      }

      return {
        volumeId: vol.VolumeId,
        volumeName: nameTag || "Unnamed Volume",
        size: vol.Size,
        volumeType: vol.VolumeType,
        state: vol.State,
        availabilityZone: vol.AvailabilityZone,
        attachedInstanceId: attachedInstance,
        createTime: vol.CreateTime,
        latestSnapshotId,
        latestSnapshotTime,
        latestSnapshotState,
        snapshotCount: volSnapshots.length,
        status
      };
    });

    const summary = {
      totalVolumes: volumes.length,
      healthy: healthyCount,
      failure: failureCount,
      unprotected: unprotectedCount,
      totalSnapshots: snapshots.length
    };

    return buildResponse(200, {
      summary,
      volumes: formattedVolumes,
      snapshots: snapshots.map((s) => ({
        snapshotId: s.SnapshotId,
        volumeId: s.VolumeId,
        startTime: s.StartTime,
        state: s.State,
        progress: s.Progress,
        volumeSize: s.VolumeSize,
        description: s.Description || "",
        tags: s.Tags || []
      }))
    });
  } catch (error) {
    console.error("Error fetching EBS snapshot status:", error);
    return buildResponse(200, {
      summary: { totalVolumes: 0, healthy: 0, failure: 0, unprotected: 0, totalSnapshots: 0 },
      volumes: [],
      snapshots: [],
      error: error.message
    });
  }
};
