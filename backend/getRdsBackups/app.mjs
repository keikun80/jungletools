import { 
  RDSClient, 
  DescribeDBInstancesCommand, 
  DescribeDBSnapshotsCommand,
  DescribeDBClustersCommand,
  DescribeDBClusterSnapshotsCommand
} from "@aws-sdk/client-rds";
import { buildResponse, getAwsClient } from "../utils.mjs";

export const handler = async (event) => {
  try {
    const rdsClient = await getAwsClient(RDSClient, event);

    let instances = [];
    try {
      const instancesData = await rdsClient.send(new DescribeDBInstancesCommand({}));
      instances = instancesData.DBInstances || [];
    } catch (err) {
      console.error("Error describing DB instances:", err.message);
      return buildResponse(200, {
        summary: { totalInstances: 0, healthy: 0, failure: 0, unprotected: 0, totalSnapshots: 0 },
        instances: [],
        snapshots: [],
        error: `IAM or Access Error: ${err.message}`
      });
    }

    let clusters = [];
    try {
      const clustersData = await rdsClient.send(new DescribeDBClustersCommand({}));
      clusters = clustersData.DBClusters || [];
    } catch (e) {
      console.warn("Error fetching DB Clusters:", e.message);
    }

    const clusterMap = {};
    clusters.forEach(c => {
      if (c.DBClusterIdentifier) {
        clusterMap[c.DBClusterIdentifier] = c;
      }
    });

    let instanceSnapshots = [];
    try {
      const manualData = await rdsClient.send(new DescribeDBSnapshotsCommand({ SnapshotType: "manual" }));
      const autoData = await rdsClient.send(new DescribeDBSnapshotsCommand({ SnapshotType: "automated" }));
      instanceSnapshots = [...(manualData.DBSnapshots || []), ...(autoData.DBSnapshots || [])];
    } catch (e) {
      console.warn("Error fetching DB Instance Snapshots:", e.message);
    }

    let clusterSnapshots = [];
    try {
      const manualClusterData = await rdsClient.send(new DescribeDBClusterSnapshotsCommand({ SnapshotType: "manual" }));
      const autoClusterData = await rdsClient.send(new DescribeDBClusterSnapshotsCommand({ SnapshotType: "automated" }));
      clusterSnapshots = [...(manualClusterData.DBClusterSnapshots || []), ...(autoClusterData.DBClusterSnapshots || [])];
    } catch (e) {
      console.warn("Error fetching DB Cluster Snapshots:", e.message);
    }

    const instanceSnapMap = {};
    instanceSnapshots.forEach((snap) => {
      const dbId = snap.DBInstanceIdentifier;
      if (dbId) {
        if (!instanceSnapMap[dbId]) instanceSnapMap[dbId] = [];
        instanceSnapMap[dbId].push({
          id: snap.DBSnapshotIdentifier,
          time: snap.SnapshotCreateTime,
          status: snap.Status,
          type: snap.SnapshotType || "instance"
        });
      }
    });

    const clusterSnapMap = {};
    clusterSnapshots.forEach((snap) => {
      const cId = snap.DBClusterIdentifier;
      if (cId) {
        if (!clusterSnapMap[cId]) clusterSnapMap[cId] = [];
        clusterSnapMap[cId].push({
          id: snap.DBClusterSnapshotIdentifier,
          time: snap.SnapshotCreateTime || snap.ClusterSnapshotCreateTime,
          status: snap.Status,
          type: snap.SnapshotType || "cluster"
        });
      }
    });

    let healthyCount = 0;
    let failureCount = 0;
    let unprotectedCount = 0;

    const formattedInstances = instances.map((inst) => {
      const dbId = inst.DBInstanceIdentifier;
      const clusterId = inst.DBClusterIdentifier;
      const parentCluster = clusterId ? clusterMap[clusterId] : null;

      const backupRetention = inst.BackupRetentionPeriod ?? parentCluster?.BackupRetentionPeriod ?? 0;
      const rawRestorable = inst.LatestRestorableTime || parentCluster?.LatestRestorableTime || null;
      const latestRestorableTime = rawRestorable ? new Date(rawRestorable).toISOString() : null;

      const instSnaps = instanceSnapMap[dbId] || [];
      const cSnaps = clusterId ? (clusterSnapMap[clusterId] || []) : [];
      const allSnaps = [...instSnaps, ...cSnaps];
      allSnaps.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

      const latestSnap = allSnaps[0] || null;
      const latestSnapshotId = latestSnap ? latestSnap.id : null;
      const latestSnapshotTime = latestSnap?.time ? new Date(latestSnap.time).toISOString() : null;
      const latestSnapStatus = latestSnap ? latestSnap.status : null;

      let status = "Unprotected";
      if (!latestSnap) {
        status = "Unprotected";
        unprotectedCount++;
      } else if (latestSnapStatus === "available") {
        status = "Healthy";
        healthyCount++;
      } else {
        status = "Failure";
        failureCount++;
      }

      return {
        dbInstanceIdentifier: dbId,
        engine: inst.Engine,
        engineVersion: inst.EngineVersion,
        dbInstanceClass: inst.DBInstanceClass,
        status: inst.DBInstanceStatus,
        backupRetentionPeriod: backupRetention,
        latestRestorableTime,
        preferredBackupWindow: inst.PreferredBackupWindow,
        latestSnapshotId,
        latestSnapshotTime,
        snapshotCount: allSnaps.length,
        healthStatus: status
      };
    });

    const summary = {
      totalInstances: instances.length,
      healthy: healthyCount,
      failure: failureCount,
      unprotected: unprotectedCount,
      totalSnapshots: instanceSnapshots.length + clusterSnapshots.length
    };

    return buildResponse(200, {
      summary,
      instances: formattedInstances,
      snapshots: [
        ...instanceSnapshots.map(s => ({
          snapshotIdentifier: s.DBSnapshotIdentifier,
          dbInstanceIdentifier: s.DBInstanceIdentifier,
          snapshotCreateTime: s.SnapshotCreateTime,
          status: s.Status,
          snapshotType: s.SnapshotType,
          allocatedStorage: s.AllocatedStorage,
          engine: s.Engine
        })),
        ...clusterSnapshots.map(s => ({
          snapshotIdentifier: s.DBClusterSnapshotIdentifier,
          dbClusterIdentifier: s.DBClusterIdentifier,
          snapshotCreateTime: s.SnapshotCreateTime,
          status: s.Status,
          snapshotType: s.SnapshotType,
          allocatedStorage: s.AllocatedStorage,
          engine: s.Engine
        }))
      ]
    });
  } catch (error) {
    console.error("Error fetching RDS backup status:", error);
    return buildResponse(200, {
      summary: { totalInstances: 0, healthy: 0, failure: 0, unprotected: 0, totalSnapshots: 0 },
      instances: [],
      snapshots: [],
      error: error.message
    });
  }
};
