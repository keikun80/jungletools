# VPC Security Group Multi-Account Automation Console (SG Operator)

다중 AWS 계정(Multi-Account) 환경에서 EC2 보안 그룹(VPC Security Group)을 단일 웹 콘솔에서 통합 조회, 생성, 규칙(Inbound/Outbound) 변경 및 삭제하고 감사 로그(Audit Logs)를 기록할 수 있는 서버리스 오퍼레이션 솔루션입니다.

---

## 📋 사전 요구 사항 (Pre-deployment Requirements)

### 1. 💻 로컬 개발 및 배포 도구 (Local Environment & CLI Tools)
* **Node.js (v20.x 이상) & npm:** 백엔드 Lambda 함수 의존성 패키지 설치용.
* **AWS CLI (v2.x 이상):** AWS 서비스 호출, 프로필 관리 및 S3 동기화용.
* **AWS SAM CLI (Serverless Application Model):** 백엔드 인프라(`template.yaml`) 빌드 및 CloudFormation 배포용.
* **PowerShell (Windows v5.1 이상) 또는 Bash (Linux/macOS):** 배포 자동화 스크립트 실행용.

### 2. 🔑 AWS 계정 및 IAM 권한 구조 (AWS Accounts & IAM Permissions)
* **Hub 계정 (메인 배포 계정):** S3 웹사이트, API Gateway, Lambda 백엔드, DynamoDB 감사 테이블이 배포될 메인 계정 1개.
* **Spoke 계정들 (대상 관리 계정):** 보안 그룹을 원격으로 조회/생성/수정/삭제할 관리 대상 계정들 (`dev`, `test`, `prod` 등).
* **배포 자격 증명 권한:** CloudFormation, S3, IAM Role, AWS Lambda, API Gateway v2, DynamoDB 생성/수정 권한.
* **오퍼레이터 자격 증명 (웹 콘솔 사용자):** IAM 사용자 Access Key, Secret Key 및 **Virtual MFA (OTP)** 기기 등록 필수.

### 3. 🌐 AWS CLI 프로필 세팅 (`~/.aws/credentials`)
배포 자동화 스크립트(`generate-env-json.ps1`, `setup-all-profiles.ps1`)가 구동되려면, 로컬 PC의 `~/.aws/credentials` (또는 `config`) 파일에 Hub 계정 및 각 Spoke 계정에 접근할 수 있는 AWS CLI 프로필이 미리 정의되어 있어야 합니다:

```ini
# ~/.aws/credentials 예시

[hub-dev] ; Hub 계정 (메인 배포 계정) 프로필
aws_access_key_id = AKIA...
aws_secret_access_key = ...

[spoke-dev] ; Spoke 계정 (Dev 환경) 프로필
aws_access_key_id = AKIA...
aws_secret_access_key = ...

[spoke-test] ; Spoke 계정 (Test 환경) 프로필
aws_access_key_id = AKIA...
aws_secret_access_key = ...

[spoke-prod] ; Spoke 계정 (Prod 환경) 프로필
aws_access_key_id = AKIA...
aws_secret_access_key = ...
```

---

## 🏗️ 시스템 아키텍처

```
[ 웹 브라우저 (SigV4 인증) ] 
       │
       ▼ (REST API / HTTP API v2)
[ Hub 계정: <HUB_ACCOUNT_ID> ]
  ├── S3 Static Website (프론트엔드 콘솔)
  ├── API Gateway (AWS_IAM Authorizer)
  ├── Lambda Backend (Node.js 20.x)
  └── DynamoDB Table (감사 로그 저장)
       │
       ▼ (STS AssumeRole - 크로스 계정 역할 수임)
[ Spoke 계정들 (대상 관리 계정) ]
  ├── Spoke Account 1 (<SPOKE_ACCOUNT_ID_1>) -> SgAutomationCrossAccountRole
  ├── Spoke Account 2 (<SPOKE_ACCOUNT_ID_2>) -> SgAutomationCrossAccountRole
  └── 기타 설정 프로필 계정들...               -> SgAutomationCrossAccountRole
```

---

## ⚙️ 환경 변수 설정 (Environment Configuration)

본 프로젝트는 로컬 PC의 AWS CLI 프로필 정보를 읽어 `env.json` 환경변수 파일을 **자동으로 생성**합니다.

```powershell
# PowerShell: 로컬 AWS CLI 프로필을 읽어 env.json 자동 생성
.\scripts\generate-env-json.ps1 -HubProfile <YOUR_HUB_PROFILE>

# Bash / Linux
./scripts/generate-env-json.sh <YOUR_HUB_PROFILE>
```

자동 생성되는 `env.json` 예시:
```json
{
  "HUB_ACCOUNT_ID": "<HUB_ACCOUNT_ID>",
  "HUB_PROFILE": "<HUB_PROFILE_NAME>",
  "REGION": "<REGION>",
  "SPOKE_PROFILES": [
    { "profile": "spoke-dev", "accountId": "<SPOKE_ACCOUNT_ID_1>" },
    { "profile": "spoke-test", "accountId": "<SPOKE_ACCOUNT_ID_2>" }
  ]
}
```

---

## 🚀 단계별 적용 순서 (Deployment Sequence)

### 0단계: 환경 변수 자동 생성 (`env.json`)
```powershell
.\scripts\generate-env-json.ps1 -HubProfile <YOUR_HUB_PROFILE>
```

### 1단계: Hub 계정 백엔드 배포

> **전체 배포 스크립트로 한 번에 실행할 수 있습니다:**
> ```bash
> # Windows (PowerShell)
> .\scripts\deploy-all.ps1
> 
> # Linux/macOS
> ./scripts/deploy-all.sh [PROFILE] [REGION]
> ```
> **스크립트가 자동으로 다음을 수행합니다:**
> 1. 백엔드 의존성 설치 (`npm install`)
> 2. SAM 애플리케이션 빌드 (`sam build`)
> 3. SAM 애플리케이션 배포 (`sam deploy`)
> 4. S3 버킷 이름을 자동으로 가져와 프론트엔드를 동기화

> **※ 단계별 수동 배포도 가능합니다. 각 단계를 실행하려면 아래를 참고하세요:**

#### 1-1. 백엔드 의존성 설치
```bash
cd backend
npm install
cd ..
```

#### 1-2. SAM 애플리케이션 빌드 (`sam build`)
```bash
sam build \
  --template-file template.yaml \
  --build-dir .aws-sam/build \
  --use-container
```
> **Note:** `--use-container` 옵션은 Lambda 런타임과 동일한 환경에서 빌드하여 의존성 호환성 문제를 방지합니다.

#### 1-3. SAM 애플리케이션 배포 (`sam deploy`)
```bash
sam deploy \
  --template-file .aws-sam/build/template.yaml \
  --stack-name sg-automation-stack \
  --resolve-s3 \
  --capabilities CAPABILITY_NAMED_IAM \
  --region ap-northeast-2 \
  --profile l-iam-s2 \
  --no-confirm-changeset
```
> **Parameters 설명:**
> - `--template-file`: 빌드 후 생성된 template.yaml 경로
> - `--stack-name`: CloudFormation 스택 이름
> - `--resolve-s3`: S3 버킷을 자동 생성 및 설정
> - `--capabilities CAPABILITY_NAMED_IAM`: IAM 역할 생성 허용
> - `--region`: 배포 리전 (기본값: ap-northeast-2)
> - `--profile`: AWS CLI 프로필 이름
> - `--no-confirm-changeset`: 변경 집합을 자동 승인

#### 1-4. 배포 결과 확인
```bash
# 배포된 엔드포인트 확인
aws cloudformation describe-stacks \
  --stack-name sg-automation-stack \
  --query "Stacks[0].Outputs" \
  --profile l-iam-s2 \
  --region ap-northeast-2
```

### 2단계: 대상 계정(Spoke Accounts) IAM 역할 자동 설치
```powershell
# 모든 Spoke 계정에 일괄 설치 (PowerShell)
.\scripts\setup-all-profiles.ps1
```

### 3단계: `frontend/config.js` 자동 생성
```powershell
# 프론트엔드 설정 파일 자동 생성
.\scripts\generate-frontend-config.ps1
```

### 4단계: 프론트엔드 S3 동기화

#### 4-1. S3 버킷 이름 확인
```bash
# CloudFormation 스택 출력에서 S3 버킷 이름 가져오기
aws cloudformation describe-stacks \
  --stack-name sg-automation-stack \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendWebsiteUrl'].OutputValue" \
  --output text \
  --profile l-iam-s2 \
  --region ap-northeast-2
```

#### 4-2. 프론트엔드 파일 업로드
```bash
# S3 버킷 이름을 위 명령어 결과로 교체하세요
aws s3 sync frontend/ s3://<YOUR_S3_BUCKET_NAME>/ \
    --profile l-iam-s2 \
    --region ap-northeast-2 \
    --delete
```

> **Note:** `--delete` 옵션은 S3에 있지만 로컬에 없는 파일을 삭제하여 정리됩니다.

---

## 📖 사용 설명서 (User Manual)

### 1. 사용자 자격 증명(MFA) 획득
MFA가 적용된 사용자 계정의 경우, 터미널에서 임시 세션 토큰을 발급받습니다:

```bash
aws sts get-session-token \
    --serial-number arn:aws:iam::<HUB_ACCOUNT_ID>:mfa/<USERNAME> \
    --token-code <OTP_6자리_숫자> \
    --profile <HUB_PROFILE_NAME>
```

### 2. 웹 콘솔 로그인
1. 브라우저로 S3 웹사이트 URL 접속: `http://<YOUR_S3_BUCKET_NAME>.s3-website.<REGION>.amazonaws.com`
2. 로그인 모달에 발급받은 임시 키 정보를 입력합니다 (`AccessKeyId`, `SecretAccessKey`, `SessionToken`).
3. **[Sign In & Verify]** 버튼을 클릭합니다.

### 3. 멀티 계정 보안 그룹 관리
* **계정 전환:** 우측 상단의 **드롭다운 메뉴**에서 관리하고자 하는 대상 계정을 선택합니다.
* **보안 그룹 목록 조회/생성/수정/삭제:** VPC 및 보안 그룹 조작을 실시간 수행합니다.
* **감사 로그(Audit Logs) 조회:** 상단 메뉴 **[Audit Logs]** 탭에서 DynamoDB 변경 이력을 조회합니다.

---

## 📁 프로젝트 파일 구조

```
sg_automation/
├── env.json                        # 🔒 local 환경변수 (자동생성 / Git 제외)
├── env.example.json                # ⚙️ 환경변수 샘플 템플릿 (Git 포함)
├── spoke-account-template.yaml     # Spoke 계정 IAM 역할 CloudFormation 템플릿
├── template.yaml                   # Hub 계정 SAM / CloudFormation 템플릿
├── backend/                        # AWS Lambda 백엔드 로직
├── frontend/
│   ├── config.js                   # 🔒 local 프론트엔드 환경변수 (자동생성 / Git 제외)
│   ├── config.example.js           # ⚙️ 프론트엔드 환경변수 샘플 (Git 포함)
│   ├── app.js                      # 애플리케이션 상태 컨트롤러
│   └── index.html                  # 메인 UI 레이아웃
├── scripts/
│   ├── deploy-all.ps1              # ⚡ 전체 배포 자동화 스크립트 (PowerShell)
│   ├── deploy-all.sh               # ⚡ 전체 배포 자동화 스크립트 (Bash)
│   ├── generate-env-json.ps1       # ⚡ aws configure 기반 env.json 자동 생성 스크립트
│   ├── generate-frontend-config.ps1# ⚡ frontend/config.js 자동 생성 스크립트
│   ├── setup-all-profiles.ps1      # ⚡ Spoke 계정 IAM 역할 일괄 설치 스크립트
│   └── setup-spoke-account.ps1     # ⚡ 단일 Spoke 계정 IAM 역할 설치 스크립트
├── README.md                       # 프로젝트 문서 (한국어)
└── README_EN.md                    # 프로젝트 문서 (영어)
```
