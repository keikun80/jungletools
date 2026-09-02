#!/usr/bin/env pwsh
# Usage: .\scripts\deploy-all.ps1 [-Profile <PROFILE_NAME>] [-Region <REGION>]

param(
    [string]$Profile = "l-iam-s2",
    [string]$Region = "ap-northeast-2"
)

# Load environment configuration
$envFile = "../env.json"
if (Test-Path $envFile) {
    $envConfig = Get-Content $envFile -Raw | ConvertFrom-Json
    $Profile = $envConfig.HUB_PROFILE
    $Region = $envConfig.REGION
    Write-Host "Loaded configuration from $envFile" -ForegroundColor Yellow
    Write-Host "  Profile: $($envConfig.HUB_PROFILE)" -ForegroundColor Yellow
    Write-Host "  Region: $($envConfig.REGION)" -ForegroundColor Yellow
} else {
    Write-Host "No env.json found. Using default values." -ForegroundColor Yellow
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "SG Automation Full Deployment" -ForegroundColor Cyan
Write-Host "Profile: $Profile" -ForegroundColor Cyan
Write-Host "Region: $Region" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# Step 0: Generate env.json if not exists
Write-Host "`n[Step 0] Checking environment configuration..." -ForegroundColor Yellow
if (-not (Test-Path "../env.json")) {
    Write-Host "env.json not found. Please run generate-env-json.ps1 first." -ForegroundColor Red
    exit 1
}

# Step 1: Install backend dependencies
Write-Host "`n[Step 1] Installing backend dependencies..." -ForegroundColor Yellow
Set-Location "../backend"
Write-Host "Running: npm install" -ForegroundColor Gray
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to install backend dependencies." -ForegroundColor Red
    exit 1
}
Set-Location "../"

# Step 2: Build SAM application
Write-Host "`n[Step 2] Building SAM application..." -ForegroundColor Yellow
Write-Host "Running: sam build" -ForegroundColor Gray
sam build --template-file template.yaml --build-dir .aws-sam/build --use-container
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to build SAM application." -ForegroundColor Red
    exit 1
}

# Step 3: Deploy SAM application
Write-Host "`n[Step 3] Deploying SAM application..." -ForegroundColor Yellow
Write-Host "Running: sam deploy" -ForegroundColor Gray
sam deploy `
    --template-file .aws-sam/build/template.yaml `
    --stack-name sg-automation-stack `
    --resolve-s3 `
    --capabilities CAPABILITY_NAMED_IAM `
    --region $Region `
    --profile $Profile `
    --no-confirm-changeset
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to deploy SAM application." -ForegroundColor Red
    exit 1
}

# Step 4: Get S3 bucket name and sync frontend
Write-Host "`n[Step 4] Syncing frontend to S3..." -ForegroundColor Yellow
$stackOutputs = aws cloudformation describe-stacks `
    --stack-name sg-automation-stack `
    --query "Stacks[0].Outputs[?OutputKey=='FrontendWebsiteUrl'].OutputValue" `
    --output text `
    --profile $Profile `
    --region $Region `
    --no-paginate

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to get stack outputs." -ForegroundColor Red
    exit 1
}

# Extract bucket name from website URL (e.g., https://bucket-name.s3-website.region.amazonaws.com)
$bucketName = ($stackOutputs -split '/')[2]
Write-Host "S3 Bucket Name: $bucketName" -ForegroundColor Green

Write-Host "Running: aws s3 sync frontend/ s3://$bucketName/" -ForegroundColor Gray
aws s3 sync ../frontend/ "s3://$bucketName/" `
    --profile $Profile `
    --region $Region `
    --delete `
    --no-paginate

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to sync frontend to S3." -ForegroundColor Red
    exit 1
}

# Summary
Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "Deployment Completed Successfully!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "`nCloudFormation Stack: sg-automation-stack" -ForegroundColor White
Write-Host "API Endpoint: " -NoNewline; Write-Host ($stackOutputs -replace 'website', 'execute-api') -ForegroundColor Cyan
Write-Host "Frontend URL: $stackOutputs" -ForegroundColor Cyan
Write-Host "`nNext Steps:" -ForegroundColor Yellow
Write-Host "  1. Open the Frontend URL in your browser" -ForegroundColor White
Write-Host "  2. Configure IAM credentials with MFA for authentication" -ForegroundColor White
Write-Host "  3. Refer to README.md for usage instructions" -ForegroundColor White
