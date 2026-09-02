<#
.SYNOPSIS
Automatically generates env.json by reading AWS CLI profiles using 'aws configure list-profiles'
and querying each profile's AWS Account ID via 'aws sts get-caller-identity'.

.EXAMPLE
.\scripts\generate-env-json.ps1 -HubProfile l-iam-s2
#>

param (
    [string]$HubProfile = "l-iam-s2",
    [string]$Region = "ap-northeast-2",
    [string]$OutputFile = "env.json"
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Generating env.json from local AWS CLI configuration..." -ForegroundColor Cyan
Write-Host "Hub Profile: $HubProfile" -ForegroundColor Cyan
Write-Host "Region: $Region" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Discover Hub Account ID
Write-Host "Discovering Hub Account ID for profile '$HubProfile'..." -ForegroundColor Gray
$hubAccountId = cmd /c aws sts get-caller-identity --profile $HubProfile --query "Account" --output text 2>$null
if ($hubAccountId) { $hubAccountId = $hubAccountId.Trim() }

if (-not $hubAccountId -or $hubAccountId -eq "None") {
    Write-Host "Error: Could not retrieve Account ID for Hub Profile '$HubProfile'. Check AWS credentials." -ForegroundColor Red
    Exit 1
}

Write-Host "Discovered Hub Account ID: $hubAccountId" -ForegroundColor Green

# 2. List all AWS CLI profiles
Write-Host "`nFetching local AWS CLI profiles..." -ForegroundColor Gray
$allProfiles = cmd /c aws configure list-profiles

if (-not $allProfiles) {
    Write-Host "Error: No AWS CLI profiles found." -ForegroundColor Red
    Exit 1
}

$spokeProfiles = @()

foreach ($prof in $allProfiles) {
    $profName = $prof.Trim()
    if (-not $profName) { continue }

    # Skip MFA / temporary / system profiles
    if ($profName -eq "mfa" -or $profName -eq "default") {
        Write-Host "Skipping profile: $profName (system/mfa profile)" -ForegroundColor Yellow
        continue
    }

    Write-Host "Resolving Account ID for profile '$profName'..." -ForegroundColor Gray
    $accId = cmd /c aws sts get-caller-identity --profile $profName --query "Account" --output text 2>$null
    if ($accId) { $accId = $accId.Trim() }

    if ($accId -and $accId -ne "None") {
        # Skip if matches Hub account
        if ($profName -eq $HubProfile -or $accId -eq $hubAccountId) {
            Write-Host "  -> Profile '$profName' ($accId) matches Hub Account. Skipping as Spoke." -ForegroundColor DarkGray
            continue
        }

        Write-Host "  -> Profile '$profName': $accId" -ForegroundColor Green
        $spokeProfiles += [PSCustomObject]@{
            profile = $profName
            accountId = $accId
        }
    } else {
        Write-Host "  -> Could not query Account ID for '$profName' (Expired/No Credentials). Skipping." -ForegroundColor Yellow
    }
}

# 3. Construct env.json Hashtable
$envData = [ordered]@{
    HUB_ACCOUNT_ID = $hubAccountId
    HUB_PROFILE = $HubProfile
    REGION = $Region
    SPOKE_PROFILES = $spokeProfiles
}

$jsonContent = $envData | ConvertTo-Json -Depth 3

# Write UTF-8 File
$targetPath = "$PSScriptRoot/../$OutputFile"
$utf8Encoding = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($targetPath, $jsonContent, $utf8Encoding)

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "Successfully generated '$OutputFile'!" -ForegroundColor Green
Write-Host "Hub Account: $hubAccountId ($HubProfile)" -ForegroundColor Green
Write-Host "Spoke Accounts Count: $($spokeProfiles.Count)" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
