import { EC2Client, DescribeVolumesCommand, DescribeSnapshotsCommand } from "@aws-sdk/client-ec2";
import { EFSClient, DescribeFileSystemsCommand, DescribeBackupPolicyCommand } from "@aws-sdk/client-efs";
import { RDSClient, DescribeDBInstancesCommand, DescribeDBSnapshotsCommand, DescribeDBClustersCommand, DescribeDBClusterSnapshotsCommand } from "@aws-sdk/client-rds";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { buildResponse, getAwsClient } from "../utils.mjs";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const SLACK_CONFIG_TABLE = process.env.SLACK_CONFIG_TABLE || "SlackConfig";

const DEFAULT_SCAN_TARGET_ACCOUNTS = [
  { id: "132949884230", name: "Hub (l-iam-s2)" },
  { id: "515303172277", name: "l-ellotte-dev", roleArn: "arn:aws:iam::515303172277:role/JungleToolsCrossAccountRole" },
  { id: "087518667058", name: "l-b2-dev", roleArn: "arn:aws:iam::087518667058:role/JungleToolsCrossAccountRole" },
  { id: "755611797885", name: "l-cicd-s2", roleArn: "arn:aws:iam::755611797885:role/JungleToolsCrossAccountRole" },
  { id: "877551073942", name: "l-logging-s2", roleArn: "arn:aws:iam::877551073942:role/JungleToolsCrossAccountRole" },
  { id: "022222764296", name: "l-ellotte-test", roleArn: "arn:aws:iam::022222764296:role/JungleToolsCrossAccountRole" },
  { id: "885426109155", name: "l-b2-test", roleArn: "arn:aws:iam::885426109155:role/JungleToolsCrossAccountRole" },
  { id: "430340954761", name: "l-ellotte-prd", roleArn: "arn:aws:iam::430340954761:role/JungleToolsCrossAccountRole" },
  { id: "449512021474", name: "l-b2-prd", roleArn: "arn:aws:iam::449512021474:role/JungleToolsCrossAccountRole" },
  { id: "855539802178", name: "l-bi", roleArn: "arn:aws:iam::855539802178:role/JungleToolsCrossAccountRole" }
];

function getScanTargetAccounts() {
  const envAccounts = process.env.SCAN_TARGET_ACCOUNTS || process.env.TARGET_ACCOUNTS;
  if (envAccounts) {
    try {
      const parsed = typeof envAccounts === "string"
        ? JSON.parse(envAccounts)
        : envAccounts;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch (e) {
      console.warn("Failed to parse SCAN_TARGET_ACCOUNTS:", e);
    }
  }
  return DEFAULT_SCAN_TARGET_ACCOUNTS;
}

export const handler = async (event) => {
  const SCAN_TARGET_ACCOUNTS = getScanTargetAccounts();
  try {
    let body = {};
    if (event.body) {
      body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    }

    let channelEmail = body.channelEmail || "";
    let senderEmail = body.senderEmail || "";
    let isTest = body.isTest === true;

    // 1. If channelEmail is not explicitly passed in test body, fetch from DynamoDB
    if (!channelEmail) {
      const configRes = await docClient.send(
        new GetCommand({
          TableName: SLACK_CONFIG_TABLE,
          Key: { id: "default" }
        })
      );
      const config = configRes.Item || {};
      channelEmail = config.channelEmail;
      senderEmail = senderEmail || config.senderEmail;

      // If scheduled cron run and disabled, exit
      if (!isTest && config.enabled === false) {
        console.log("Slack Email notification is disabled in config. Skipping.");
        return buildResponse(200, { message: "Slack Email notification is disabled." });
      }
    }

    if (!channelEmail) {
      return buildResponse(400, { message: "No Slack Channel Email address configured." });
    }

    // Support multiple comma/semicolon/space-separated emails
    const toAddresses = channelEmail
      .split(/[,;\s]+/)
      .map(e => e.trim())
      .filter(e => e.length > 0);

    if (toAddresses.length === 0) {
      return buildResponse(400, { message: "No valid Slack Channel Email address configured." });
    }

    if (!senderEmail) {
      senderEmail = toAddresses[0];
    }

    const targetRoleArn = event.headers?.["x-target-role-arn"] || event.headers?.["X-Target-Role-Arn"];
    let accountsToScan = [];

    // For test emails (isTest === true) or scheduled reports, ALWAYS scan ALL target accounts (profiles)
    if (targetRoleArn && !isTest && !body.scanAll) {
      const matchAcc = SCAN_TARGET_ACCOUNTS.find(a => a.roleArn === targetRoleArn.trim());
      const accName = matchAcc ? matchAcc.name : targetRoleArn.split(":")[4] || "Selected Account";
      accountsToScan = [{ id: targetRoleArn, name: accName, roleArn: targetRoleArn }];
    } else {
      accountsToScan = SCAN_TARGET_ACCOUNTS;
    }

    const now = new Date();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    let totalHealthy = 0;
    let totalFailure = 0;
    let totalUnprotected = 0;
    let ebsFailureCount = 0;
    let efsFailureCount = 0;
    let rdsFailureCount = 0;
    const accountReports = [];

    for (const acc of accountsToScan) {
      const fakeEvent = acc.roleArn 
        ? { headers: { "x-target-role-arn": acc.roleArn } }
        : { headers: {} };

      const accReport = {
        name: acc.name,
        id: acc.id || acc.roleArn?.split(":")[4] || "Selected Account",
        ebs: { healthy: 0, failure: 0, unprotected: 0 },
        efs: { healthy: 0, failure: 0, unprotected: 0 },
        rds: { healthy: 0, failure: 0, unprotected: 0 },
        items: []
      };

      try {
        const ec2Client = await getAwsClient(EC2Client, fakeEvent);
        const efsClient = await getAwsClient(EFSClient, fakeEvent);
        const rdsClient = await getAwsClient(RDSClient, fakeEvent);

        // 1. Scan EBS
        try {
          const volData = await ec2Client.send(new DescribeVolumesCommand({}));
          const volumes = volData.Volumes || [];
          const snapData = await ec2Client.send(new DescribeSnapshotsCommand({ OwnerIds: ["self"] }));
          const snapshots = snapData.Snapshots || [];

          const snapMap = {};
          snapshots.forEach(s => {
            if (!snapMap[s.VolumeId]) snapMap[s.VolumeId] = [];
            snapMap[s.VolumeId].push(s);
          });

          volumes.forEach(vol => {
            const volSnaps = snapMap[vol.VolumeId] || [];
            volSnaps.sort((a, b) => new Date(b.StartTime) - new Date(a.StartTime));
            const latest = volSnaps[0];
            const nameTag = vol.Tags?.find(t => t.Key === "Name")?.Value || "";

            if (!latest) {
              accReport.ebs.unprotected++;
              totalUnprotected++;
              accReport.items.push({
                service: "EBS",
                status: "Unprotected",
                name: nameTag,
                id: vol.VolumeId,
                detail: "스냅샷 없음"
              });
            } else {
              const dateStr = latest.StartTime ? new Date(latest.StartTime).toISOString().split('T')[0] : "";
              if (latest.State === "completed") {
                accReport.ebs.healthy++;
                totalHealthy++;
                accReport.items.push({
                  service: "EBS",
                  status: "Healthy",
                  name: nameTag,
                  id: vol.VolumeId,
                  detail: `최근 스냅샷: ${dateStr}, 상태: ${latest.State}`
                });
              } else {
                accReport.ebs.failure++;
                ebsFailureCount++;
                totalFailure++;
                accReport.items.push({
                  service: "EBS",
                  status: "Failure",
                  name: nameTag,
                  id: vol.VolumeId,
                  detail: `최근 스냅샷: ${dateStr}, 상태: ${latest.State}`
                });
              }
            }
          });
        } catch (e) {
          console.warn(`EBS scan error for ${acc.name}:`, e.message);
        }

        // 2. Scan EFS
        try {
          const fsData = await efsClient.send(new DescribeFileSystemsCommand({}));
          const fileSystems = fsData.FileSystems || [];
          for (const fs of fileSystems) {
            const nameTag = fs.Tags?.find(t => t.Key === "Name")?.Value || fs.FileSystemId;
            try {
              const policyData = await efsClient.send(new DescribeBackupPolicyCommand({ FileSystemId: fs.FileSystemId }));
              const policyStatus = policyData.BackupPolicy?.Status;
              if (policyStatus === "ENABLED") {
                accReport.efs.healthy++;
                totalHealthy++;
                accReport.items.push({
                  service: "EFS",
                  status: "Healthy",
                  name: nameTag,
                  id: fs.FileSystemId,
                  detail: "백업 정책 활성화 (ENABLED)"
                });
              } else if (policyStatus === "DISABLED") {
                accReport.efs.unprotected++;
                totalUnprotected++;
                accReport.items.push({
                  service: "EFS",
                  status: "Unprotected",
                  name: nameTag,
                  id: fs.FileSystemId,
                  detail: "백업 정책 비활성화 (DISABLED)"
                });
              } else {
                accReport.efs.failure++;
                efsFailureCount++;
                totalFailure++;
                accReport.items.push({
                  service: "EFS",
                  status: "Failure",
                  name: nameTag,
                  id: fs.FileSystemId,
                  detail: `백업 정책 상태: ${policyStatus || "UNKNOWN"}`
                });
              }
            } catch (err) {
              accReport.efs.unprotected++;
              totalUnprotected++;
              accReport.items.push({
                service: "EFS",
                status: "Unprotected",
                name: nameTag,
                id: fs.FileSystemId,
                detail: `백업 정책 확인 불가 (${err.message})`
              });
            }
          }
        } catch (e) {
          console.warn(`EFS scan error for ${acc.name}:`, e.message);
        }

        // 3. Scan RDS
        try {
          const instData = await rdsClient.send(new DescribeDBInstancesCommand({}));
          const instances = instData.DBInstances || [];

          let clusters = [];
          try {
            const clustersData = await rdsClient.send(new DescribeDBClustersCommand({}));
            clusters = clustersData.DBClusters || [];
          } catch (e) {}

          const clusterMap = {};
          clusters.forEach(c => {
            if (c.DBClusterIdentifier) clusterMap[c.DBClusterIdentifier] = c;
          });

          let instanceSnapshots = [];
          try {
            const manualData = await rdsClient.send(new DescribeDBSnapshotsCommand({ SnapshotType: "manual" }));
            const autoData = await rdsClient.send(new DescribeDBSnapshotsCommand({ SnapshotType: "automated" }));
            instanceSnapshots = [...(manualData.DBSnapshots || []), ...(autoData.DBSnapshots || [])];
          } catch (e) {}

          let clusterSnapshots = [];
          try {
            const manualClusterData = await rdsClient.send(new DescribeDBClusterSnapshotsCommand({ SnapshotType: "manual" }));
            const autoClusterData = await rdsClient.send(new DescribeDBClusterSnapshotsCommand({ SnapshotType: "automated" }));
            clusterSnapshots = [...(manualClusterData.DBClusterSnapshots || []), ...(autoClusterData.DBClusterSnapshots || [])];
          } catch (e) {}

          const instanceSnapMap = {};
          instanceSnapshots.forEach(s => {
            if (s.DBInstanceIdentifier) {
              if (!instanceSnapMap[s.DBInstanceIdentifier]) instanceSnapMap[s.DBInstanceIdentifier] = [];
              instanceSnapMap[s.DBInstanceIdentifier].push({
                time: s.SnapshotCreateTime,
                status: s.Status
              });
            }
          });

          const clusterSnapMap = {};
          clusterSnapshots.forEach(s => {
            if (s.DBClusterIdentifier) {
              if (!clusterSnapMap[s.DBClusterIdentifier]) clusterSnapMap[s.DBClusterIdentifier] = [];
              clusterSnapMap[s.DBClusterIdentifier].push({
                time: s.SnapshotCreateTime || s.ClusterSnapshotCreateTime,
                status: s.Status
              });
            }
          });

          instances.forEach(inst => {
            const dbId = inst.DBInstanceIdentifier;
            const clusterId = inst.DBClusterIdentifier;
            const parentCluster = clusterId ? clusterMap[clusterId] : null;

            const retention = inst.BackupRetentionPeriod ?? parentCluster?.BackupRetentionPeriod ?? 0;
            const rawRestorable = inst.LatestRestorableTime || parentCluster?.LatestRestorableTime || null;

            const instSnaps = instanceSnapMap[dbId] || [];
            const cSnaps = clusterId ? (clusterSnapMap[clusterId] || []) : [];
            const allSnaps = [...instSnaps, ...cSnaps];
            allSnaps.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

            const latestSnap = allSnaps[0] || null;

            const dateStr = latestSnap?.time ? new Date(latestSnap.time).toISOString().split('T')[0] : "없음";

            if (!latestSnap) {
              accReport.rds.unprotected++;
              totalUnprotected++;
              accReport.items.push({
                service: "RDS",
                status: "Unprotected",
                name: dbId,
                id: dbId,
                detail: "스냅샷 없음"
              });
            } else if (latestSnap.status === 'available') {
              accReport.rds.healthy++;
              totalHealthy++;
              accReport.items.push({
                service: "RDS",
                status: "Healthy",
                name: dbId,
                id: dbId,
                detail: `최근 스냅샷: ${dateStr} (Engine: ${inst.Engine}, 상태: ${latestSnap.status})`
              });
            } else {
              accReport.rds.failure++;
              rdsFailureCount++;
              totalFailure++;
              accReport.items.push({
                service: "RDS",
                status: "Failure",
                name: dbId,
                id: dbId,
                detail: `최근 스냅샷: ${dateStr} (Engine: ${inst.Engine}, 상태: ${latestSnap.status})`
              });
            }
          });
        } catch (e) {
          console.warn(`RDS scan error for ${acc.name}:`, e.message);
        }

      } catch (err) {
        console.warn(`Account scan failed for ${acc.name}:`, err.message);
      }

      accountReports.push(accReport);
    }

    // Date formatting
    const kstOffsetMs = 9 * 60 * 60 * 1000;
    const kstDate = new Date(now.getTime() + kstOffsetMs);
    const year = kstDate.getUTCFullYear();
    const month = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(kstDate.getUTCDate()).padStart(2, '0');
    const hours = String(kstDate.getUTCHours()).padStart(2, '0');
    const minutes = String(kstDate.getUTCMinutes()).padStart(2, '0');
    const dateOnlyFormatted = `${year}년 ${month}월 ${day}일`;
    const fullDateFormatted = `${year}년 ${month}월 ${day}일 (${hours}:${minutes} KST 기준시)`;

    const nonUnprotectedTotal = totalHealthy + totalFailure;
    const subjectText = `[${dateOnlyFormatted}] 백화점BO 백업 모니터링 (${totalHealthy} / ${nonUnprotectedTotal})`;

    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; margin: 0; padding: 16px; background-color: #f8fafc; }
    .card { background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px; max-width: 720px; margin: 0 auto; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .header { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 4px; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; }
    .date-subtitle { font-size: 13px; color: #64748b; margin-bottom: 16px; }
    .summary-box { background-color: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 14px 18px; margin-bottom: 20px; }
    .summary-grid { display: flex; gap: 12px; font-size: 13px; font-weight: 600; }
    .summary-item { flex: 1; padding: 8px 12px; border-radius: 4px; text-align: center; }
    .bg-healthy { background-color: #dcfce7; color: #166534; }
    .bg-failure { background-color: #fee2e2; color: #991b1b; }
    .bg-unprotected { background-color: #ffffff; color: #475569; border: 1px solid #cbd5e1; }
    
    .account-section { border: 1px solid #cbd5e1; border-radius: 6px; margin-bottom: 16px; overflow: hidden; background-color: #ffffff; }
    .account-header { background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 10px 14px; font-weight: 700; font-size: 14px; color: #1e293b; display: flex; justify-content: space-between; align-items: center; }
    .account-body { padding: 12px 14px; font-size: 13px; }
    .account-counts { font-size: 12px; color: #334155; margin-bottom: 10px; font-weight: 600; }
    .item-list { list-style: none; margin: 6px 0 0 0; padding: 0; }
    .item-row { padding: 7px 10px; margin-bottom: 4px; border-radius: 4px; font-size: 12px; font-family: monospace; display: flex; justify-content: space-between; }
    .item-healthy { background-color: #f0fdf4; color: #166534; border-left: 4px solid #22c55e; }
    .item-failure { background-color: #fef2f2; color: #991b1b; border-left: 4px solid #ef4444; }
    .item-unprotected { background-color: #f8fafc; color: #475569; border-left: 4px solid #94a3b8; }
    .no-items { color: #94a3b8; font-size: 12px; font-style: italic; padding: 6px 0; }
    .footer { margin-top: 24px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">📊 백화점BO 백업 모니터링 리포트</div>
    <div class="date-subtitle">기준 일시: ${fullDateFormatted}</div>
    
    <div class="summary-box">
      <div style="font-weight: 700; font-size: 14px; margin-bottom: 10px;">전체 요약</div>
      <div class="summary-grid">
        <div class="summary-item bg-healthy">Healthy: ${totalHealthy}개</div>
        <div class="summary-item bg-failure">Failure: ${totalFailure}개</div>
        <div class="summary-item bg-unprotected">Unprotected: ${totalUnprotected}개</div>
      </div>
      <div style="font-size: 12px; color: #475569; margin-top: 10px; text-align: right;">
        * 모니터링 비율 (Healthy / Unprotected 제외 전체): <strong>${totalHealthy} / ${nonUnprotectedTotal}</strong>
      </div>
    </div>

    <div style="font-weight: 700; font-size: 15px; margin-bottom: 12px; color: #0f172a;">🏢 프로파일(계정)별 백업/스냅샷 현황</div>

    ${accountReports.map(acc => {
      const accHealthy = acc.ebs.healthy + acc.efs.healthy + acc.rds.healthy;
      const accFailure = acc.ebs.failure + acc.efs.failure + acc.rds.failure;
      const accUnprotected = acc.ebs.unprotected + acc.efs.unprotected + acc.rds.unprotected;
      
      return `
        <div class="account-section">
          <div class="account-header">
            <span>🏢 ${acc.name}</span>
            <span style="font-size: 12px; color: #64748b; font-weight: normal;">(ID: ${acc.id})</span>
          </div>
          <div class="account-body">
            <div class="account-counts">
              🟢 Healthy: ${accHealthy}개 | 🔴 Failure: ${accFailure}개 | ⚪ Unprotected: ${accUnprotected}개
              <span style="color: #64748b; font-weight: normal; margin-left: 6px;">(EBS: ${acc.ebs.healthy + acc.ebs.failure + acc.ebs.unprotected} | EFS: ${acc.efs.healthy + acc.efs.failure + acc.efs.unprotected} | RDS: ${acc.rds.healthy + acc.rds.failure + acc.rds.unprotected})</span>
            </div>
            ${acc.items.length > 0 ? `
              <ul class="item-list">
                ${acc.items.map(iss => {
                  let cls = "item-healthy";
                  let icon = "🟢";
                  if (iss.status === "Failure") { cls = "item-failure"; icon = "🔴"; }
                  else if (iss.status === "Unprotected") { cls = "item-unprotected"; icon = "⚪"; }
                  
                  return `
                    <li class="item-row ${cls}">
                      <span><strong>${icon} [${iss.status}] ${iss.service}</strong>: ${iss.name ? `${iss.name} (${iss.id})` : iss.id}</span>
                      <span style="font-size: 11px; opacity: 0.9;">${iss.detail}</span>
                    </li>
                  `;
                }).join('')}
              </ul>
            ` : `
              <div class="no-items">등록된 백업 대상 리소스가 없습니다.</div>
            `}
          </div>
        </div>
      `;
    }).join('')}

    <div class="footer">Jungle Tools Console - AWS Multi-Account Backup Monitoring System</div>
  </div>
</body>
</html>
`;

    const plainTextBody = `📊 백화점BO 백업 모니터링 리포트
기준 일시: ${fullDateFormatted}

[전체 요약]
- Healthy: ${totalHealthy}개
- Failure: ${totalFailure}개
- Unprotected: ${totalUnprotected}개
- 모니터링 비율 (Healthy / Unprotected 제외 전체): ${totalHealthy} / ${nonUnprotectedTotal}

==================================================
🏢 프로파일(계정)별 백업/스냅샷 현황
==================================================

${accountReports.map(acc => {
  const accHealthy = acc.ebs.healthy + acc.efs.healthy + acc.rds.healthy;
  const accFailure = acc.ebs.failure + acc.efs.failure + acc.rds.failure;
  const accUnprotected = acc.ebs.unprotected + acc.efs.unprotected + acc.rds.unprotected;
  
  let str = `■ 계정: ${acc.name} (${acc.id})\n`;
  str += `  - 요약: Healthy: ${accHealthy}개 | Failure: ${accFailure}개 | Unprotected: ${accUnprotected}개\n`;
  if (acc.items.length > 0) {
    str += `  - 스냅샷/백업 세부 목록:\n`;
    acc.items.forEach(iss => {
      let icon = iss.status === "Healthy" ? "🟢" : (iss.status === "Failure" ? "🔴" : "⚪");
      str += `    • ${icon} [${iss.status}] ${iss.service}: ${iss.name ? `${iss.name} (${iss.id})` : iss.id} - ${iss.detail}\n`;
    });
  } else {
    str += `  - 등록된 백업 대상 리소스 없음\n`;
  }
  return str;
}).join('\n')}`;

    // Send Email via AWS SES
    const sesRegion = process.env.AWS_REGION || "ap-northeast-2";
    const sesClient = new SESClient({ region: sesRegion });

    const emailCommand = new SendEmailCommand({
      Source: senderEmail,
      Destination: {
        ToAddresses: toAddresses
      },
      Message: {
        Subject: { Data: subjectText, Charset: "UTF-8" },
        Body: {
          Html: { Data: htmlBody, Charset: "UTF-8" },
          Text: { Data: plainTextBody, Charset: "UTF-8" }
        }
      }
    });

    await sesClient.send(emailCommand);

    // Update lastSentTimestamp in DynamoDB
    const timestampStr = now.toISOString();
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: SLACK_CONFIG_TABLE,
          Key: { id: "default" },
          UpdateExpression: "SET lastSentTimestamp = :ts",
          ExpressionAttributeValues: { ":ts": timestampStr }
        })
      );
    } catch (e) {}

    return buildResponse(200, {
      message: `Slack Channel Email notification sent successfully to ${toAddresses.length} recipient(s)`,
      timestamp: timestampStr,
      totalFailure,
      ebsFailureCount,
      efsFailureCount,
      rdsFailureCount,
      sentTo: toAddresses
    });
  } catch (error) {
    console.error("Error sending Slack Email notification:", error);
    return buildResponse(500, { message: "Failed to send Slack Email notification", error: error.message });
  }
};
