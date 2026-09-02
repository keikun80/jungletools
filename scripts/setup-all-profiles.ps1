<#
.SYNOPSIS
Batch deploys the Cross-Account IAM Role to all target AWS CLI profiles.
#>

param (
    [string]$EnvFile = "env.json"
)

# Read environment variables from env.json
if (Test-Path $EnvFile) {
    $envConfig = Get-Content $EnvFile | ConvertFrom-Json
} else {
    Write-Host "Error: Environment configuration file '$EnvFile' not found." -ForegroundColor Red
    Exit 1
}

$hubId = $envConfig.HUB_ACCOUNT_ID
$region = $envConfig.REGION
$profiles = $envConfig.SPOKE_PROFILES

if (-not $profiles -or $profiles.Count -eq 0) {
    Write-Host "No spoke profiles defined in '$EnvFile'." -ForegroundColor Red
    Exit 1
}

Write-Host "==========================================================" -ForegroundColor Yellow
Write-Host "Starting batch deployment of Cross-Account IAM Role..." -ForegroundColor Yellow
Write-Host "Hub Account ID: $hubId" -ForegroundColor Yellow
Write-Host "Region: $region" -ForegroundColor Yellow
Write-Host "Target Profiles Count: $($profiles.Count)" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Yellow

$successCount = 0
$failCount = 0

foreach ($item in $profiles) {
    $prof = if ($item.profile) { $item.profile } else { $item }
    Write-Host "`n---> Deploying to profile: $prof" -ForegroundColor Cyan
    
    cmd /c aws cloudformation deploy `
        --template-file spoke-account-template.yaml `
        --stack-name sg-automation-spoke-role `
        --parameter-overrides HubAccountId=$hubId `
        --capabilities CAPABILITY_NAMED_IAM `
        --profile $prof `
        --region $region

    if ($LASTEXITCODE -eq 0) {
        Write-Host "SUCCESS: Profile '$prof' configured successfully." -ForegroundColor Green
        $successCount++
    } else {
        Write-Host "WARNING: Could not deploy to profile '$prof'. Skip or check credentials." -ForegroundColor Red
        $failCount++
    }
}

Write-Host "`n==========================================================" -ForegroundColor Yellow
Write-Host "Batch Deployment Summary:" -ForegroundColor Yellow
Write-Host "  Success: $successCount" -ForegroundColor Green
Write-Host "  Failed:  $failCount" -ForegroundColor Red
Write-Host "==========================================================" -ForegroundColor Yellow
