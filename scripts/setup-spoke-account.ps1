<#
.SYNOPSIS
Deploys the Cross-Account IAM Role to a single target AWS CLI profile.
#>

param (
    [Parameter(Mandatory=$true)]
    [string]$Profile,

    [string]$EnvFile = "env.json"
)

# Read environment variables from env.json
if (Test-Path $EnvFile) {
    $envConfig = Get-Content $EnvFile | ConvertFrom-Json
} else {
    Write-Host "Error: Environment file '$EnvFile' not found." -ForegroundColor Red
    Exit 1
}

$hubId = $envConfig.HUB_ACCOUNT_ID
$region = $envConfig.REGION

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Deploying Cross-Account IAM Role to Profile: $Profile" -ForegroundColor Cyan
Write-Host "Hub Account ID: $hubId" -ForegroundColor Cyan
Write-Host "Region: $region" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

cmd /c aws cloudformation deploy `
    --template-file spoke-account-template.yaml `
    --stack-name jungle-tools-spoke-role `
    --parameter-overrides HubAccountId=$hubId `
    --capabilities CAPABILITY_NAMED_IAM `
    --profile $Profile `
    --region $region

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nSuccessfully created/updated JungleToolsCrossAccountRole in profile '$Profile'!" -ForegroundColor Green
} else {
    Write-Host "`nFailed to deploy IAM Role to profile '$Profile'." -ForegroundColor Red
}
