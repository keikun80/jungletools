# VPC Security Group Multi-Account Automation Console (SG Operator)

A serverless operation solution designed to centrally manage EC2 Security Groups across multiple AWS accounts from a single web console. It supports viewing, creating, updating inbound/outbound rules, deleting security groups, and recording audit logs in real time.

---

## 📋 Pre-deployment Requirements

### 1. 💻 Local Environment & CLI Tools
* **Node.js (v20.x or higher) & npm:** Required for backend Lambda dependencies installation.
* **AWS CLI (v2.x or higher):** Required for AWS API invocations, profile management, and S3 sync.
* **AWS SAM CLI (Serverless Application Model):** Required to build and deploy `template.yaml`.
* **PowerShell (Windows v5.1+) or Bash (Linux/macOS):** Required to run deployment automation scripts.

### 2. 🔑 AWS Accounts & IAM Permissions
* **Hub Account (Primary Account):** 1 main AWS account where S3 website, API Gateway, Lambda backend, and DynamoDB table will be deployed.
* **Spoke Accounts (Target Management Accounts):** AWS accounts (`dev`, `test`, `prod`, etc.) where security groups will be managed remotely.
* **Deployer Credentials Permissions:** CloudFormation, S3, IAM Role, AWS Lambda, API Gateway v2, and DynamoDB create/update permissions.
* **Operator Credentials (Web Console User):** IAM User Access Key, Secret Key, and registered **Virtual MFA (OTP)** device.

### 3. 🌐 AWS CLI Profiles Setup (`~/.aws/credentials`)
Before running deployment scripts (`generate-env-json.ps1`, `setup-all-profiles.ps1`), AWS CLI profiles for the Hub account and all target Spoke accounts must be pre-configured in `~/.aws/credentials` (or `config`):

```ini
# Example ~/.aws/credentials

[hub-dev] ; Hub Account (Primary Deployment Account) profile
aws_access_key_id = AKIA...
aws_secret_access_key = ...

[spoke-dev] ; Spoke Account (Dev Environment) profile
aws_access_key_id = AKIA...
aws_secret_access_key = ...

[spoke-test] ; Spoke Account (Test Environment) profile
aws_access_key_id = AKIA...
aws_secret_access_key = ...

[spoke-prod] ; Spoke Account (Prod Environment) profile
aws_access_key_id = AKIA...
aws_secret_access_key = ...
```

---

## 🏗️ System Architecture

```
[ Web Browser (SigV4 Auth) ] 
       │
       ▼ (REST API / HTTP API v2)
[ Hub Account: <HUB_ACCOUNT_ID> ]
  ├── S3 Static Website (Frontend Console)
  ├── API Gateway (AWS_IAM Authorizer)
  ├── Lambda Backend (Node.js 20.x)
  └── DynamoDB Table (Audit Logs Storage)
       │
       ▼ (STS AssumeRole - Cross-Account Role Assumption)
[ Spoke Accounts (Target Management Accounts) ]
  ├── Spoke Account 1 (<SPOKE_ACCOUNT_ID_1>) -> SgAutomationCrossAccountRole
  ├── Spoke Account 2 (<SPOKE_ACCOUNT_ID_2>) -> SgAutomationCrossAccountRole
  └── Other Configured Profile Accounts...     -> SgAutomationCrossAccountRole
```

---

## ⚙️ Environment Configuration

For security and automation, this project manages all account IDs, profile names, and account mappings in `env.json`.

### Backend & Script Environment Variables (`env.json`)
Create an `env.json` file in the project root directory or generate it automatically from your local AWS CLI configuration:
```json
{
  "HUB_ACCOUNT_ID": "<YOUR_HUB_ACCOUNT_ID>",
  "HUB_PROFILE": "<YOUR_HUB_CLI_PROFILE>",
  "REGION": "<REGION>",
  "SPOKE_PROFILES": [
    { "profile": "spoke-dev", "accountId": "<SPOKE_ACCOUNT_ID_1>" },
    { "profile": "spoke-test", "accountId": "<SPOKE_ACCOUNT_ID_2>" }
  ]
}
```

---

## 🚀 Step-by-Step Deployment Sequence

### Step 0: Generate Environment Variables (`env.json`) Automatically
Generate `env.json` directly from your local AWS CLI configuration:
```powershell
# PowerShell: Read local AWS CLI profiles and generate env.json automatically
.\scripts\generate-env-json.ps1 -HubProfile <YOUR_HUB_PROFILE>

# Bash / Linux
./scripts/generate-env-json.sh <YOUR_HUB_PROFILE>
```

### Step 1: Deploy Hub Account Backend
Deploy API Gateway, Lambda, DynamoDB, and the S3 website bucket to the Hub Account:

```bash
# Install backend dependencies
cd backend
npm install
cd ..

# Build & Deploy SAM Stack
sam deploy --template-file template.yaml \
           --stack-name sg-automation-stack \
           --resolve-s3 \
           --capabilities CAPABILITY_NAMED_IAM \
           --region <REGION> \
           --profile <HUB_PROFILE_NAME> \
           --no-confirm-changeset
```

### Step 2: Auto-Install IAM Roles on Spoke Accounts
Automatically deploy the `SgAutomationCrossAccountRole` IAM Role to all target accounts defined in `env.json`:

```powershell
# Batch deploy to all Spoke accounts (PowerShell)
.\scripts\setup-all-profiles.ps1
```

### Step 3: Automatically Generate `frontend/config.js`
Fetch CloudFormation deployment outputs (`ApiEndpoint`, etc.) and `env.json` account mappings to **automatically generate** `frontend/config.js`:

```powershell
# Generate frontend configuration file
.\scripts\generate-frontend-config.ps1
```

### Step 4: Sync Frontend to S3
Sync the generated static web assets to the S3 bucket:

```bash
aws s3 sync frontend/ s3://<YOUR_S3_BUCKET_NAME>/ \
    --profile <HUB_PROFILE_NAME> \
    --region <REGION>
```

---

## 📖 User Manual

### 1. Obtain User Credentials (MFA)
For MFA-enabled accounts, generate a temporary session token using the terminal:

```bash
aws sts get-session-token \
    --serial-number arn:aws:iam::<HUB_ACCOUNT_ID>:mfa/<USERNAME> \
    --token-code <OTP_6_DIGITS> \
    --profile <HUB_PROFILE_NAME>
```

### 2. Sign In to Web Console
1. Access the S3 website URL in your browser: `http://<YOUR_S3_BUCKET_NAME>.s3-website.<REGION>.amazonaws.com`
2. Enter the temporary keys in the login modal (`AccessKeyId`, `SecretAccessKey`, `SessionToken`).
3. Click **[Sign In & Verify]**.

### 3. Multi-Account Security Group Management
* **Switch Account:** Select the target management account from the **dropdown menu** at the top right.
* **Manage Security Groups:** View, create, modify rules, or delete security groups in real-time.
* **View Audit Logs:** Click the **[Audit Logs]** tab in the top navigation to view the history of changes recorded in DynamoDB.

---

## 📁 Project Structure

```
sg_automation/
├── env.json                        # 🔒 local environment variables (Auto-generated / Git-ignored)
├── env.example.json                # ⚙️ environment variables template (Git-tracked)
├── spoke-account-template.yaml     # Spoke account IAM role CloudFormation template
├── template.yaml                   # Hub account SAM / CloudFormation template
├── backend/                        # AWS Lambda backend handlers
├── frontend/
│   ├── config.js                   # 🔒 local frontend configuration (Auto-generated / Git-ignored)
│   ├── config.example.js           # ⚙️ frontend configuration template (Git-tracked)
│   ├── app.js                      # Application state controller
│   └── index.html                  # Main UI layout
├── scripts/
│   ├── generate-env-json.ps1       # ⚡ Auto-generates env.json from aws configure
│   ├── generate-frontend-config.ps1# ⚡ Auto-generates frontend/config.js
│   ├── setup-all-profiles.ps1      # ⚡ Batch installs IAM roles on Spoke accounts
│   └── setup-spoke-account.ps1     # ⚡ Installs IAM role on a single Spoke account
├── README.md                       # Project documentation (Korean)
└── README_EN.md                    # Project documentation (English)
```
