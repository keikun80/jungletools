# Jungle Tools Console - 설치 및 환경 구성 가이드 (Installation Guide)

본 문서는 **Jungle Tools Console**을 다중 AWS 계정(Multi-Account: Hub & Spoke) 환경에 성공적으로 배포하고 운영하기 위한 사전 준비 사항, 아키텍처 구조 설명, 단계별 설치 절차를 안내합니다.

---

## 📑 목차 (Table of Contents)
1. [허브(Hub)와 스포크(Spoke) 아키텍처 이해](#1-허브hub와-스포크spoke-아키텍처-이해)
2. [설치 전 사전 준비 사항 (Prerequisites)](#2-설치-전-사전-준비-사항-prerequisites)
3. [단계별 설치 및 배포 가이드](#3-단계별-설치-및-배포-가이드)
   - [Step 0. 환경 설정 파일 (`env.json`) 생성](#step-0-환경-설정-파일-envjson-생성)
   - [Step 1. Spoke 계정에 Cross-Account IAM Role 배포](#step-1-spoke-계정에-cross-account-iam-role-배포)
   - [Step 2. Hub 계정 인프라 및 프론트엔드 배포](#step-2-hub-계정-인프라-및-프론트엔드-배포)
   - [Step 3. 배포 확인 및 웹 콘솔 접속](#step-3-배포-확인-및-웹-콘솔-접속)
4. [로컬 개발 환경 실행 (선택 사항)](#4-로컬-개발-환경-실행-선택-사항)
5. [자주 묻는 질문 및 문제 해결 (Troubleshooting)](#5-자주-묻는-질문-및-문제-해결-troubleshooting)

---

## 1. 허브(Hub)와 스포크(Spoke) 아키텍처 이해

Jungle Tools Console은 엔터프라이즈 멀티 계정 환경에서 중앙 집중식 운영 및 보안 관리를 위해 **Hub & Spoke 모델**을 기반으로 설계되었습니다.

```mermaid
flowchart TB
    subgraph HubAccount ["🏢 Hub Account (중앙 관제 계정)"]
        S3["🪣 S3 웹 호스팅<br/>(Console Frontend)"]
        APIGW["⚡ API Gateway v2<br/>(IAM SigV4 Auth)"]
        Lambda["⚙️ Lambda Backend<br/>(Node.js 20.x)"]
        DynamoDB["📊 DynamoDB<br/>(감사로그 / 알림설정)"]
        EventBridge["⏰ EventBridge Cron<br/>(정기 알림 트리거)"]
        SES["📧 Amazon SES<br/>(이메일 발송)"]
        
        APIGW --> Lambda
        Lambda --> DynamoDB
        EventBridge --> Lambda
        Lambda --> SES
    end

    subgraph SpokeAccounts ["🎯 Spoke Accounts (모니터링 대상 계정 N개)"]
        Role["🔑 JungleToolsCrossAccountRole<br/>(STS 신뢰 정책: Hub 계정)"]
        EC2["🛡️ VPC Security Groups"]
        EBS["💾 EBS Volumes & Snapshots"]
        EFS["📁 EFS Backup Policies"]
        RDS["🗄️ RDS DB & Clusters"]
        
        Role --> EC2
        Role --> EBS
        Role --> EFS
        Role --> RDS
    end

    User["🖥️ 웹 브라우저 (운영자)"] -->|HTTPS| S3
    User -->|AWS SigV4 Signed API Call| APIGW
    Lambda -.->|1. STS AssumeRole| Role
    Role -.->|2. 리소스 조회 및 제어| SpokeAccounts
```

### 🏢 1) 허브(Hub) 계정이란?
* **정의**: Jungle Tools Console의 메인 인프라(프론트엔드 웹 콘솔, 백엔드 API, 데이터베이스, 스케줄러)가 배포되는 **중앙 관리/오퍼레이션 계정**입니다.
* **주요 구성 요소**:
  * **S3 Bucket**: 정적 웹 콘솔(HTML/CSS/JS) 호스팅.
  * **API Gateway (HTTP API)**: AWS IAM 인증(SigV4)이 적용된 백엔드 API 게이트웨이.
  * **AWS Lambda (Node.js 20.x)**: 보안 그룹 관리, 백업 현황 조회, Slack/Email 알림 발송을 담당하는 서버리스 백엔드.
  * **DynamoDB**: 보안 그룹 변경 감사 로그(`SgAuditLogs`) 및 Slack/Email 알림 구성 설정(`SlackConfig`) 저장.
  * **EventBridge & SES**: 정기 백업 모니터링 리포트 스케줄러 및 이메일 전송 엔진.

### 🎯 2) 스포크(Spoke) 계정이란?
* **정의**: 실제 서비스 인프라(VPC, EC2, EBS, EFS, RDS)가 구동되며 모니터링 및 보안 그룹 관리의 대상이 되는 **개별 타겟 계정(N개)**입니다.
* **주요 구성 요소**:
  * **`JungleToolsCrossAccountRole` (IAM 역할)**:
    * Hub 계정의 Lambda가 STS AssumeRole을 수행할 수 있도록 Hub 계정을 신뢰(Trust Relationship)하는 Cross-Account IAM 역할입니다.
    * 보안 그룹 조회/수정 및 EBS/EFS/RDS 백업 상태 조회에 필요한 최소한의 권한(Least Privilege)만을 보유합니다.

### 🔐 3) Cross-Account STS AssumeRole 동작 원리
1. 사용자가 웹 콘솔에서 특정 Spoke 계정(예: `spoke-dev`)을 선택하고 조회/수정 요청을 보냅니다.
2. Hub 계정의 Lambda 함수가 요청을 수신합니다.
3. Lambda 함수는 AWS STS(Security Token Service)를 호출하여 해당 Spoke 계정의 `arn:aws:iam::<SPOKE_ACCOUNT_ID>:role/JungleToolsCrossAccountRole`에 대해 **AssumeRole**을 요청합니다.
4. STS로부터 임시 자격 증명(Access Key, Secret Key, Session Token)을 획득합니다.
5. 임시 자격 증명을 사용하여 Spoke 계정의 AWS API(EC2, RDS, EFS 등)를 호출하고 결과를 사용자에게 반환합니다.

---

## 2. 설치 전 사전 준비 사항 (Prerequisites)

`env.json`을 생성하고 설치를 진행하기 전에 운영자의 로컬 머신 및 AWS 환경에 다음 사항들이 반드시 준비되어 있어야 합니다.

### 🛠️ 1) 로컬 개발 도구 설치
* **Node.js**: `v20.x` 이상 권장 ([Node.js 공식 다운로드](https://nodejs.org/))
* **npm**: Node.js 설치 시 함께 설치됨
* **AWS CLI**: `v2.x` 이상 ([AWS CLI 설치 가이드](https://docs.aws.amazon.com/ko_kr/cli/latest/userguide/getting-started-install.html))
* **AWS SAM CLI**: `v1.100` 이상 ([AWS SAM CLI 설치 가이드](https://docs.aws.amazon.com/ko_kr/serverless-application-model/latest/developerguide/install-sam-cli.html))

설치 확인 명령어:
```bash
node -v      # v20.x.x 이상
aws --version  # aws-cli/2.x.x 이상
sam --version  # SAM CLI, version 1.100.x 이상
```

---

### 🔑 2) AWS CLI 로컬 자격 증명(Profile) 설정
로컬 머신의 `~/.aws/credentials` 및 `~/.aws/config` 파일에 **Hub 계정**과 **모든 Spoke 계정**에 접근 가능한 프로필이 등록되어 있어야 합니다.

#### 예시: `~/.aws/credentials`
```ini
# [Hub 계정 프로필]
[hub-profile]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY

# [Spoke 계정 프로필들]
[spoke-dev]
aws_access_key_id = AKIAI44QH8DHBEXAMPLE
aws_secret_access_key = je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY

[spoke-prd]
aws_access_key_id = AKIAI77QH8DHBEXAMPLE
aws_secret_access_key = w9Utk/h3yCo8nvbje7MtGbClwBF/2ZpEXAMPLEKEY
```

#### 예시: `~/.aws/config`
```ini
[profile hub-profile]
region = ap-northeast-2
output = json

[profile spoke-dev]
region = ap-northeast-2
output = json

[profile spoke-prd]
region = ap-northeast-2
output = json
```

> [!TIP]
> **프로필 연결 테스트**:
> 각 프로필이 정상적으로 연결되는지 아래 명령어로 확인합니다.
> ```bash
> aws sts get-caller-identity --profile hub-profile
> aws sts get-caller-identity --profile spoke-dev
> aws sts get-caller-identity --profile spoke-prd
> ```

---

### 🛡️ 3) 필요한 AWS IAM 권한 확인
배포 작업을 실행하는 IAM 사용자 또는 역할은 다음 권한을 가져야 합니다.

1. **Hub 계정 배포 권한 (관리자 또는 SAM 배포 권한)**:
   * CloudFormation: 스택 생성/수정/삭제 (`cloudformation:*`)
   * S3: 버킷 생성, 정적 웹사이트 호스팅 설정, 객체 업로드 (`s3:*`)
   * API Gateway: HTTP API 생성, 라우트 및 IAM Authorizer 구성 (`apigateway:*`)
   * Lambda: 함수 생성 및 실행 역할 구성 (`lambda:*`)
   * DynamoDB: 테이블 생성 및 인덱스 관리 (`dynamodb:*`)
   * IAM: Lambda 실행 역할 생성 및 PassRole (`iam:CreateRole`, `iam:PutRolePolicy`, `iam:PassRole`)
   * EventBridge: 규칙 생성 및 대상 연결 (`events:*`)
2. **Spoke 계정 배포 권한**:
   * CloudFormation: 스택 생성/수정 (`cloudformation:*`)
   * IAM: `JungleToolsCrossAccountRole` 생성 및 정책 첨부 (`iam:CreateRole`, `iam:PutRolePolicy`)

---

## 3. 단계별 설치 및 배포 가이드

전체 배포는 **Step 0(환경설정) -> Step 1(Spoke 배포) -> Step 2(Hub 배포)** 순서로 진행됩니다.

---

### Step 0. 환경 설정 파일 (`env.json`) 생성

`env.json`은 배포 스크립트 및 프론트엔드가 참조하는 멀티 계정 설정 메타데이터 파일입니다.

#### 방법 A: 자동 생성 스크립트 실행 (권장)
로컬에 등록된 AWS CLI 프로필을 자동으로 감지하여 `env.json`을 생성합니다.

```bash
# Linux / macOS
chmod +x ./scripts/generate-env-json.sh
./scripts/generate-env-json.sh <HUB_PROFILE_NAME> <AWS_REGION>

# 예시: Hub 프로필명이 hub-profile, 리전이 ap-northeast-2인 경우
./scripts/generate-env-json.sh hub-profile ap-northeast-2
```

```powershell
# Windows (PowerShell)
.\scripts\generate-env-json.ps1 -HubProfile <HUB_PROFILE_NAME> -Region <AWS_REGION>

# 예시:
.\scripts\generate-env-json.ps1 -HubProfile hub-profile -Region ap-northeast-2
```

#### 방법 B: 수동 작성
프로젝트 루트의 [env.example.json](file:///home/keikun/project/jungletools/env.example.json) 파일을 복사하여 [env.json](file:///home/keikun/project/jungletools/env.json)을 직접 작성할 수도 있습니다.

```json
{
  "HUB_ACCOUNT_ID": "123456789012",
  "HUB_PROFILE": "hub-profile",
  "REGION": "ap-northeast-2",
  "SPOKE_PROFILES": [
    {
      "profile": "spoke-dev",
      "accountId": "111122223333"
    },
    {
      "profile": "spoke-prd",
      "accountId": "444455556666"
    }
  ]
}
```

* **`HUB_ACCOUNT_ID`**: Hub 계정의 12자리 AWS Account ID
* **`HUB_PROFILE`**: 로컬 AWS CLI에 등록된 Hub 계정 프로필 이름
* **`REGION`**: 리소스가 배포될 기본 AWS 리전 (예: `ap-northeast-2`)
* **`SPOKE_PROFILES`**: 모니터링 대상이 되는 Spoke 계정들의 프로필 이름 및 12자리 Account ID 목록

---

### Step 1. Spoke 계정에 Cross-Account IAM Role 배포

모든 Spoke 계정에 Hub 계정의 Lambda가 접근할 수 있도록 신뢰 역할(`JungleToolsCrossAccountRole`)을 배포합니다.

#### 1) 전체 Spoke 계정 일괄 배포
`env.json`에 등록된 모든 `SPOKE_PROFILES`에 순차적으로 CloudFormation 스택을 배포합니다.

```bash
# Linux / macOS
chmod +x ./scripts/setup-all-spokes.sh
./scripts/setup-all-spokes.sh
```

```powershell
# Windows (PowerShell)
.\scripts\setup-all-spokes.ps1
```

#### 2) 단일 Spoke 계정 개별 배포 (추가 계정이 있는 경우)
신규 Spoke 계정이 추가되었을 경우 특정 프로필만 단독으로 배포할 수 있습니다.

```bash
# Linux / macOS
./scripts/setup-spoke-account.sh <SPOKE_PROFILE_NAME>
```

```powershell
# Windows (PowerShell)
.\scripts\setup-spoke-account.ps1 -Profile <SPOKE_PROFILE_NAME>
```

> [!NOTE]
> Spoke 계정에 생성되는 리소스는 [spoke-account-template.yaml](file:///home/keikun/project/jungletools/spoke-account-template.yaml) CloudFormation 템플릿에 정의되어 있으며, 별도의 컴퓨팅 리소스 비용이 발생하지 않는 순수 IAM Role입니다.

---

### Step 2. Hub 계정 인프라 및 프론트엔드 배포

Hub 계정에 백엔드 서버리스 스택(SAM)을 빌드/배포하고, 웹 콘솔 정적 에셋을 S3 버킷에 동기화합니다.

```bash
# Linux / macOS
chmod +x ./scripts/deploy-all.sh
./scripts/deploy-all.sh <HUB_PROFILE_NAME> <AWS_REGION>

# 예시:
./scripts/deploy-all.sh hub-profile ap-northeast-2
```

```powershell
# Windows (PowerShell)
.\scripts\deploy-all.ps1 -HubProfile <HUB_PROFILE_NAME> -Region <AWS_REGION>
```

#### 🔄 `deploy-all` 스크립트가 자동으로 수행하는 작업:
1. `backend/` 의존성 패키지 설치 (`npm install`)
2. `template.yaml` 기반 AWS SAM 빌드 (`sam build`)
3. Hub 계정으로 SAM 스택 배포 (`sam deploy`)
4. CloudFormation Outputs에서 API Gateway 엔드포인트 및 S3 웹사이트 URL 추출
5. 프론트엔드 환경 설정 파일([frontend/config.js](file:///home/keikun/project/jungletools/frontend/config.js)) 자동 생성
6. 프론트엔드 소스 파일들을 S3 웹사이트 호스팅 버킷에 동기화 (`aws s3 sync`)

---

### Step 3. 배포 확인 및 웹 콘솔 접속

배포가 성공적으로 완료되면 터미널에 최종 결과가 출력됩니다.

```text
============================================================
Deployment Completed Successfully!
============================================================
CloudFormation Stack: jungle-tools-stack
API Endpoint: https://xxxxxxxxxx.execute-api.ap-northeast-2.amazonaws.com
Frontend URL: http://jungle-tools-stack-frontendbucket-xxxxxx.s3-website.ap-northeast-2.amazonaws.com
```

1. 출력된 **Frontend URL**을 웹 브라우저에서 엽니다.
2. 상단 네비게이션 바에서 계정 선택기(Account Selector)를 클릭하여 Hub 계정 및 Spoke 계정들이 정상적으로 표시되는지 확인합니다.
3. **SG Manage** 및 **Backup Monitor** 메뉴에서 각 계정의 리소스 조회가 정상 작동하는지 확인합니다.

---

## 4. 로컬 개발 환경 실행 (선택 사항)

백엔드 스택을 다시 배포하지 않고 프론트엔드 UI/UX 작업만을 로컬에서 수행할 수 있습니다.

```bash
# 프론트엔드 디렉터리를 로컬 HTTP 웹 서버로 실행 (포트 3000)
python3 -m http.server 3000 --directory frontend
```

브라우저에서 `http://localhost:3000`으로 접속하여 로컬 테스트를 진행합니다.

---

## 5. 자주 묻는 질문 및 문제 해결 (Troubleshooting)

### Q1. Spoke 계정 리소스 조회 시 `AssumeRole Failed` 에러가 발생합니다.
* **원인**:
  1. 해당 Spoke 계정에 [spoke-account-template.yaml](file:///home/keikun/project/jungletools/spoke-account-template.yaml) 스택이 배포되지 않았거나 Role 이름(`JungleToolsCrossAccountRole`)이 다를 수 있습니다.
  2. Spoke IAM Role의 신뢰 관계(Trust Relationship)에 기재된 `HubAccountId`가 실제 Hub 계정 ID와 일치하지 않을 수 있습니다.
* **해결 방법**:
  1. Spoke 계정의 CloudFormation 콘솔에서 `jungle-tools-spoke-role` 스택이 정상 배포되었는지 확인합니다.
  2. IAM 콘솔에서 `JungleToolsCrossAccountRole` 역할의 Trust Relationship에 `arn:aws:iam::<HUB_ACCOUNT_ID>:root`가 등록되어 있는지 점검합니다.

### Q2. `generate-env-json.sh` 실행 시 특정 계정의 Account ID를 가져오지 못합니다.
* **원인**: 해당 AWS CLI 프로필의 세션 토큰(MFA/SSO)이 만료되었거나 자격 증명이 유효하지 않은 경우입니다.
* **해결 방법**:
  * `aws sts get-caller-identity --profile <PROFILE_NAME>` 명령을 실행하여 자격 증명 상태를 확인하고, 필요한 경우 `aws sso login` 또는 Access Key를 재갱신합니다.

### Q3. API 요청 시 `403 Forbidden` 또는 `Missing Authentication Token` 에러가 발생합니다.
* **원인**: Jungle Tools의 API Gateway는 보안을 위해 IAM SigV4 인증을 사용합니다.
* **해결 방법**:
  * 프론트엔드 콘솔의 우측 상단 자격 증명 설정 모달(Settings)에 유효한 AWS Access Key / Secret Key / Session Token(필요 시)을 입력하여 브라우저에서 SigV4 서명 헤더가 생성되도록 합니다.
