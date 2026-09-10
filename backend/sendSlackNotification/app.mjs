import { EC2Client, DescribeVolumesCommand, DescribeSnapshotsCommand } from "@aws-sdk/client-ec2";
import { EFSClient, DescribeFileSystemsCommand, DescribeBackupPolicyCommand } from "@aws-sdk/client-efs";
import { RDSClient, DescribeDBInstancesCommand, DescribeDBSnapshotsCommand, DescribeDBClustersCommand, DescribeDBClusterSnapshotsCommand } from "@aws-sdk/client-rds";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { buildResponse, getAwsClient, isValidSlackWebhookUrl } from "../utils.mjs";

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

function filterReportByMessageType(reportData, type) {
  if (type === "summary") {
    return {
      summary: reportData.summary || reportData.subject
    };
  } else if (type === "report") {
    return {
      type: "report",
      subject: reportData.subject,
      report: reportData.plainTextBody,
      totalHealthy: reportData.totalHealthy,
      totalFailure: reportData.totalFailure,
      nonUnprotectedTotal: reportData.nonUnprotectedTotal
    };
  } else if (type === "preview") {
    return {
      type: "preview",
      subject: reportData.subject,
      backupStatusText: reportData.backupStatusText,
      dateFormatted: reportData.dateFormatted,
      dateOnlyFormatted: reportData.dateOnlyFormatted
    };
  } else if (type === "full") {
    return {
      type: "full",
      subject: reportData.subject,
      report: reportData.fullTextBody || reportData.plainTextBody,
      totalHealthy: reportData.totalHealthy,
      totalFailure: reportData.totalFailure,
      nonUnprotectedTotal: reportData.nonUnprotectedTotal,
      accountReports: reportData.accountReports
    };
  } else {
    return reportData;
  }
}

function generateFullTextBody(reportData, accountReports) {
  const { fullDateFormatted, totalHealthy, totalFailure, nonUnprotectedTotal, totalUnprotected } = reportData;
  const healthPercent = nonUnprotectedTotal > 0 ? Math.round((totalHealthy / nonUnprotectedTotal) * 100) : 100;
  
  let out = `📊 백화점BO 백업 모니터링 종합 리포트\n`;
  out += `기준 일시: ${fullDateFormatted}\n\n`;
  out += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  out += `[📌 전체 종합 현황]\n`;
  out += `• 전체 모니터링: ${totalHealthy} / ${nonUnprotectedTotal} (${healthPercent}% 정상)\n`;
  out += `• Success: ${totalHealthy}개  |  Error: ${totalFailure}개  |  Unprotected: ${totalUnprotected}개\n`;
  out += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  out += `[🏢 계정별 백업 현황 (${accountReports.length}개 계정)]\n\n`;

  accountReports.forEach((acc, idx) => {
    const accHealthy = acc.ebs.healthy + acc.efs.healthy + acc.rds.healthy;
    const accFailure = acc.ebs.failure + acc.efs.failure + acc.rds.failure;
    const accTotal = accHealthy + accFailure;
    const isAccHealthy = accFailure === 0;

    out += `${idx + 1}. ${acc.name} [${acc.id}] ${isAccHealthy ? "" : "⚠️ 확인 필요"}\n`;
    out += `   • 상태: ${isAccHealthy ? `정상 (Healthy: ${accHealthy} / ${accTotal})` : `${accFailure}건 실패 (Healthy: ${accHealthy} / ${accTotal})`}\n`;

    const parts = [];
    if (acc.ebs.healthy + acc.ebs.failure > 0) {
      parts.push(`EBS: ${acc.ebs.healthy}개 정상${acc.ebs.failure > 0 ? `, ${acc.ebs.failure}개 실패 ❌` : ""}`);
    } else {
      parts.push(`EBS: -`);
    }
    if (acc.efs.healthy + acc.efs.failure > 0) {
      parts.push(`EFS: ${acc.efs.healthy}개 정상${acc.efs.failure > 0 ? `, ${acc.efs.failure}개 실패 ❌` : ""}`);
    } else {
      parts.push(`EFS: -`);
    }
    if (acc.rds.healthy + acc.rds.failure > 0) {
      parts.push(`RDS: ${acc.rds.healthy}개 정상${acc.rds.failure > 0 ? `, ${acc.rds.failure}개 실패 ❌` : ""}`);
    } else {
      parts.push(`RDS: -`);
    }
    out += `   • ${parts.join("  |  ")}\n`;

    const failures = (acc.items || []).filter(item => item.status === "Failure");
    if (failures.length > 0) {
      failures.forEach(f => {
        out += `     - [${f.service}] ${f.name}: ${f.detail || "스냅샷 실패"}\n`;
      });
    }
    out += `\n`;
  });

  out += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  out += `* 자세한 사항은 Jungle Tools Console 대시보드에서 확인하세요.`;
  return out;
}


export function matchesCron(cronExpr, date = new Date()) {
  if (!cronExpr || typeof cronExpr !== "string") return true;
  let expr = cronExpr.trim();
  const matchWrapper = expr.match(/^cron\((.+)\)$/i);
  if (matchWrapper) {
    expr = matchWrapper[1].trim();
  }
  const parts = expr.split(/\s+/);
  if (parts.length < 5) return true;

  const currentMinute = date.getUTCMinutes();
  const currentHour = date.getUTCHours();
  const currentDayOfMonth = date.getUTCDate();
  const currentMonth = date.getUTCMonth() + 1;
  const currentDayOfWeek = date.getUTCDay(); // 0 (Sun) - 6 (Sat)

  const [minPart, hourPart, domPart, monPart, dowPart] = parts;

  function matchField(fieldVal, currentVal, isDow = false) {
    if (!fieldVal || fieldVal === "*" || fieldVal === "?") return true;
    const subparts = fieldVal.split(",");
    for (let p of subparts) {
      p = p.trim();
      if (p === "*" || p === "?") return true;
      if (isDow) {
        const dowMap = { SUN: 1, MON: 2, TUE: 3, WED: 4, THU: 5, FRI: 6, SAT: 7 };
        const awsDow = currentDayOfWeek + 1; // AWS: 1=SUN, 2=MON... 7=SAT
        const upper = p.toUpperCase();
        if (dowMap[upper] !== undefined && dowMap[upper] === awsDow) return true;
        if (parseInt(p, 10) === awsDow) return true;
        if (parseInt(p, 10) === currentDayOfWeek) return true;
        return false;
      }
      if (p.includes("/")) {
        const [range, stepStr] = p.split("/");
        const step = parseInt(stepStr, 10);
        if (isNaN(step) || step <= 0) continue;
        const start = range === "*" ? 0 : parseInt(range, 10);
        if ((currentVal - start) % step === 0 && currentVal >= start) return true;
      }
      if (p.includes("-")) {
        const [startStr, endStr] = p.split("-");
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (currentVal >= start && currentVal <= end) return true;
      }
      if (parseInt(p, 10) === currentVal) return true;
    }
    return false;
  }

  const hourMatch = matchField(hourPart, currentHour);
  const domMatch = matchField(domPart, currentDayOfMonth);
  const monMatch = matchField(monPart, currentMonth);
  const dowMatch = matchField(dowPart, currentDayOfWeek, true);

  return hourMatch && domMatch && monMatch && dowMatch;
}

export const handler = async (event) => {
  const SCAN_TARGET_ACCOUNTS = getScanTargetAccounts();
  try {
    let body = {};
    if (event.body) {
      body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    }

    const httpMethod = (event.requestContext?.http?.method || event.httpMethod || "POST").toUpperCase();
    const requestPath = event.rawPath || event.requestContext?.http?.path || "";
    const isWebhookRequest = requestPath.includes("/webhook") || body.isWebhook === true;
    const isApiGatewayEvent = !!(event.requestContext || event.httpMethod || event.rawPath);
    const isScheduledEvent = event.source === "aws.events" || event["detail-type"] === "Scheduled Event" || (!isApiGatewayEvent && !body.isTest);
    const isWebhook = isWebhookRequest || isScheduledEvent;
    const isGetOrPreview = 
      httpMethod === "GET" || 
      requestPath === "/slack/report" ||
      requestPath === "/slack/preview" ||
      body.preview === true ||
      body.dryRun === true;

    const messageType = (event.queryStringParameters?.type || body.messageType || body.type || (requestPath.includes("/preview") ? "preview" : "full")).toLowerCase();
    const isRefreshRequested = event.queryStringParameters?.refresh === "true" || body.refresh === true;



    let channelEmail = body.channelEmail || "";
    let senderEmail = body.senderEmail || "";
    let isTest = body.isTest === true;

    if (!isGetOrPreview && !isWebhook) {
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
    }

    let toAddresses = [];
    if (!isGetOrPreview && !isWebhook) {
      // Support multiple comma/semicolon/space-separated emails
      toAddresses = channelEmail
        .split(/[,;\s]+/)
        .map(e => e.trim())
        .filter(e => e.length > 0);

      if (toAddresses.length === 0) {
        return buildResponse(400, { message: "No valid Slack Channel Email address configured." });
      }

      if (!senderEmail) {
        senderEmail = toAddresses[0];
      }
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
    const isAllHealthy = nonUnprotectedTotal > 0 ? (totalHealthy === nonUnprotectedTotal) : true;
    const backupStatusText = isAllHealthy ? "이상 없습니다." : "확인 중";
    const subjectText = `[${dateOnlyFormatted}] 백화점BO개발팀 백업 ${backupStatusText} (${totalHealthy} / ${nonUnprotectedTotal})`;

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
        <div class="summary-item bg-healthy">Success: ${totalHealthy}개</div>
        <div class="summary-item bg-failure">Error: ${totalFailure}개</div>
      </div>
      <div style="font-size: 12px; color: #475569; margin-top: 10px; text-align: right;">
        * 모니터링 비율: <strong>${totalHealthy} / ${nonUnprotectedTotal}</strong>
      </div>
    </div>

    <div class="footer">Jungle Tools Console - AWS Multi-Account Backup Monitoring System</div>
  </div>
</body>
</html>
`;

    const plainTextBody = `📊 백화점BO 백업 모니터링 리포트
기준 일시: ${fullDateFormatted}

[전체 요약]
- Success: ${totalHealthy}개
- Error: ${totalFailure}개
- 모니터링 비율: ${totalHealthy} / ${nonUnprotectedTotal}`;

    const summaryText = subjectText;

    const baseReportData = {
      summary: summaryText,
      subject: subjectText,
      backupStatusText,
      dateFormatted: fullDateFormatted,
      dateOnlyFormatted,
      totalHealthy,
      totalFailure,
      totalUnprotected,
      nonUnprotectedTotal,
      htmlBody,
      plainTextBody,
      accountReports,
      cachedAt: now.toISOString()
    };

    const fullTextBody = generateFullTextBody(baseReportData, accountReports);
    const reportData = {
      ...baseReportData,
      fullTextBody
    };



    if (isWebhook) {
      let webhooksToSend = [];

      if (body.webhookId) {
        try {
          const configRes = await docClient.send(
            new GetCommand({ TableName: SLACK_CONFIG_TABLE, Key: { id: "default" } })
          );
          const configItem = configRes.Item || {};
          const configuredWebhooks = Array.isArray(configItem.webhooks) ? configItem.webhooks : [];
          const target = configuredWebhooks.find(w => w.id === body.webhookId);
          if (target && target.url) {
            webhooksToSend.push(target);
          }
        } catch (e) {
          console.warn("Failed to fetch target webhook:", e.message);
        }
      } else if (body.webhookUrl) {
        if (!isValidSlackWebhookUrl(body.webhookUrl)) {
          return buildResponse(400, {
            message: "유효하지 않은 슬랙 웹훅 URL입니다. 'https://hooks.slack.com/services/...' 형식이어야 합니다."
          });
        }
        webhooksToSend.push({
          id: "custom",
          name: "Test Webhook",
          url: body.webhookUrl.trim(),
          messageType: messageType || "summary",
          enabled: true
        });
      } else {
        try {
          const configRes = await docClient.send(
            new GetCommand({ TableName: SLACK_CONFIG_TABLE, Key: { id: "default" } })
          );
          const configItem = configRes.Item || {};
          let configuredWebhooks = Array.isArray(configItem.webhooks) ? configItem.webhooks : [];
          if (configuredWebhooks.length === 0 && configItem.webhookUrl) {
            configuredWebhooks = [{
              id: "default",
              name: "기본 웹훅",
              url: configItem.webhookUrl,
              messageType: configItem.webhookMessageType || "summary",
              scheduleCron: configItem.webhookScheduleCron || "cron(0 0 * * ? *)",
              enabled: configItem.webhookEnabled === true
            }];
          }

          if (isScheduledEvent) {
            webhooksToSend = configuredWebhooks.filter(w => {
              if (w.enabled === false || !w.url) return false;
              const cron = w.scheduleCron || "cron(0 0 * * ? *)";
              return matchesCron(cron, now);
            });
            console.log(`[Scheduled Run] Matching webhooks for UTC hour ${now.getUTCHours()}: ${webhooksToSend.length}/${configuredWebhooks.length}`);
          } else {
            webhooksToSend = configuredWebhooks.filter(w => w.enabled !== false && w.url);
          }
        } catch (e) {
          console.warn("Failed to fetch webhooks from DynamoDB:", e.message);
        }
      }

      if (webhooksToSend.length === 0 && !isScheduledEvent) {
        return buildResponse(400, { message: "No enabled Slack Webhook URL configured." });
      }

      let successful = [];
      let failed = [];

      if (webhooksToSend.length > 0) {
        const results = await Promise.allSettled(
          webhooksToSend.map(async (wh) => {
            if (!isValidSlackWebhookUrl(wh.url)) {
              throw new Error(`Security Violation: Disallowed or malformed webhook URL [${wh.url}]`);
            }

            const whType = (wh.messageType || messageType || "summary").toLowerCase();
            let textPayload = "";
            if (whType === "summary") {
              textPayload = summaryText;
            } else if (whType === "report") {
              textPayload = plainTextBody;
            } else if (whType === "preview") {
              textPayload = `*${subjectText}*\n상태: ${backupStatusText} (${fullDateFormatted})`;
            } else { // full or default
              textPayload = `*${subjectText}*\n\n${fullTextBody}`;
            }

            const slackRes = await fetch(wh.url.trim(), {
              method: "POST",
              headers: { "Content-Type": "application/json; charset=utf-8" },
              body: JSON.stringify({ text: textPayload })
            });

            if (!slackRes.ok) {
              const errText = await slackRes.text();
              throw new Error(`Webhook [${wh.name || wh.url}] failed: ${errText}`);
            }
            return { id: wh.id, name: wh.name, url: wh.url, messageType: whType };
          })
        );

        successful = results.filter(r => r.status === "fulfilled").map(r => r.value);
        failed = results.filter(r => r.status === "rejected").map(r => r.reason.message);

        const timestampStr = now.toISOString();
        try {
          await docClient.send(
            new UpdateCommand({
              TableName: SLACK_CONFIG_TABLE,
              Key: { id: "default" },
              UpdateExpression: "SET lastWebhookSentTimestamp = :ts",
              ExpressionAttributeValues: { ":ts": timestampStr }
            })
          );
        } catch (e) {}

        if (successful.length === 0 && !isScheduledEvent) {
          return buildResponse(500, {
            message: "All Slack Webhooks failed",
            errors: failed
          });
        }
      }

      if (!isScheduledEvent || isWebhookRequest) {
        return buildResponse(200, {
          message: `Slack Webhook notification sent successfully (${successful.length}/${webhooksToSend.length})`,
          timestamp: now.toISOString(),
          successfulCount: successful.length,
          failedCount: failed.length,
          totalFailure,
          totalHealthy,
          details: { successful, failed }
        });
      }
    }

    if (isGetOrPreview) {
      return buildResponse(200, filterReportByMessageType(reportData, messageType));
    }

    // Process Email sending (if channelEmail is configured and enabled)
    try {
      const configRes = await docClient.send(
        new GetCommand({ TableName: SLACK_CONFIG_TABLE, Key: { id: "default" } })
      );
      const config = configRes.Item || {};
      if (!channelEmail) {
        channelEmail = config.channelEmail || "";
        senderEmail = senderEmail || config.senderEmail || "";
      }

      if (config.enabled === false && !isTest && !body.channelEmail) {
        console.log("Slack Email notification is disabled in config.");
        return buildResponse(200, {
          message: "Scheduled run completed. Webhooks sent. Slack Email disabled.",
          timestamp: now.toISOString()
        });
      }

      if (isScheduledEvent) {
        const emailCron = config.scheduleCron || "cron(0 0 * * ? *)";
        if (!matchesCron(emailCron, now)) {
          console.log(`[Scheduled Run] Slack Email Alarm not scheduled for UTC hour ${now.getUTCHours()}. Skipping email.`);
          return buildResponse(200, {
            message: "Scheduled run completed. Webhooks processed. Slack Email not scheduled for this hour.",
            timestamp: now.toISOString()
          });
        }
      }
    } catch (e) {}

    if (!channelEmail) {
      return buildResponse(200, {
        message: "Scheduled run completed. Webhooks sent. No channel email configured.",
        timestamp: now.toISOString()
      });
    }

    toAddresses = channelEmail
      .split(/[,;\s]+/)
      .map(e => e.trim())
      .filter(e => e.length > 0);

    if (toAddresses.length === 0) {
      return buildResponse(200, {
        message: "Scheduled run completed. Webhooks sent.",
        timestamp: now.toISOString()
      });
    }

    if (!senderEmail) {
      senderEmail = toAddresses[0];
    }

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
    console.error("Error sending Slack notification:", error);
    return buildResponse(500, { message: error.message || "Failed to send Slack notification", error: error.message });
  }
};
