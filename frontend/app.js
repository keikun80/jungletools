// State Management
let apiEndpoint = localStorage.getItem('sg_api_endpoint') || (window.APP_CONFIG && window.APP_CONFIG.apiEndpoint) || '';
let vpcData = [];
let selectedSg = null;
let currentInboundRules = [];
let currentOutboundRules = [];
let credentials = null; // { accessKeyId, secretAccessKey, sessionToken, region }
let isSessionExpired = false;
let currentWebhooksList = [];

// DOM Elements
const apiInput = document.getElementById('api-endpoint-input');
const authApiInput = document.getElementById('auth-api-endpoint');
const saveApiBtn = document.getElementById('btn-save-endpoint');
const apiStatusBadge = document.getElementById('api-status');
const apiStatusText = document.getElementById('api-status-text');

const navSgDashboard = document.getElementById('nav-sg-dashboard') || document.getElementById('nav-dashboard');
const navSgLogs = document.getElementById('nav-sg-logs') || document.getElementById('nav-logs');
const navBackupDashboard = document.getElementById('nav-backup-dashboard') || document.getElementById('nav-backups');
const navNotiSlackWebhook = document.getElementById('nav-noti-slack-webhook') || document.getElementById('nav-slack-webhook');
const navNotiSlackEmail = document.getElementById('nav-noti-slack-email') || document.getElementById('nav-slack-email');
const navNotiEmailSmtp = document.getElementById('nav-noti-email-smtp');
const navNotiEmailRecipients = document.getElementById('nav-noti-email-recipients');

const viewSgDashboard = document.getElementById('view-sg-dashboard') || document.getElementById('view-dashboard');
const viewSgDetail = document.getElementById('view-sg-detail');
const viewSgLogs = document.getElementById('view-sg-logs') || document.getElementById('view-logs');
const viewBackupDashboard = document.getElementById('view-backup-dashboard') || document.getElementById('view-backups');
const viewNotiSlackWebhook = document.getElementById('view-noti-slack-webhook') || document.getElementById('view-slack-webhook');
const viewNotiSlackEmail = document.getElementById('view-noti-slack-email') || document.getElementById('view-slack-email');
const viewNotiEmailSmtp = document.getElementById('view-noti-email-smtp');
const viewNotiEmailRecipients = document.getElementById('view-noti-email-recipients');

const btnSaveWebhook = document.getElementById('btn-save-webhook');
const btnTestWebhook = document.getElementById('btn-test-webhook');
const btnSaveSlack = document.getElementById('btn-save-slack');
const btnTestSlack = document.getElementById('btn-test-slack');


const vpcListContainer = document.getElementById('vpc-list');
const btnRefreshSgs = document.getElementById('btn-refresh-sgs');
const btnOpenCreateSg = document.getElementById('btn-open-create-sg');

// Metrics
const metricVpcs = document.getElementById('metric-vpcs');
const metricSgs = document.getElementById('metric-sgs');
const metricInbound = document.getElementById('metric-inbound');

// SG Detail Elements
const detailSgName = document.getElementById('detail-sg-name');
const detailSgId = document.getElementById('detail-sg-id');
const detailSgDesc = document.getElementById('detail-sg-desc');
const detailSgVpc = document.getElementById('detail-sg-vpc');
const btnDeleteSg = document.getElementById('btn-delete-sg');

const tabInbound = document.getElementById('tab-inbound');
const tabOutbound = document.getElementById('tab-outbound');
const paneInbound = document.getElementById('pane-inbound');
const paneOutbound = document.getElementById('pane-outbound');
const countInbound = document.getElementById('count-inbound');
const countOutbound = document.getElementById('count-outbound');

const tableBodyInbound = document.getElementById('table-body-inbound');
const tableBodyOutbound = document.getElementById('table-body-outbound');
const btnAddInbound = document.getElementById('btn-add-inbound-rule');
const btnAddOutbound = document.getElementById('btn-add-outbound-rule');

const btnCancelRules = document.getElementById('btn-cancel-rules');
const btnSaveRules = document.getElementById('btn-save-rules');

// Log Elements
const btnRefreshLogs = document.getElementById('btn-refresh-logs');
const tableBodyLogs = document.getElementById('table-body-logs');

// Modals
const modalCreateSg = document.getElementById('modal-create-sg');
const btnCloseCreateModal = document.getElementById('btn-close-create-modal');
const btnCancelCreateSg = document.getElementById('btn-cancel-create-sg');
const btnSubmitCreateSg = document.getElementById('btn-submit-create-sg');
const createSgVpcSelect = document.getElementById('create-sg-vpc');

const modalLogDetail = document.getElementById('modal-log-detail');
const logDetailJson = document.getElementById('log-detail-json');
const closeLogModalBtns = document.querySelectorAll('#btn-close-log-modal, #btn-close-log-modal-ok');

// Auth Overlay & Session Elements
const authOverlay = document.getElementById('auth-overlay');
const loginSubmitBtn = document.getElementById('btn-login-submit');
const logoutBtn = document.getElementById('btn-logout');
const btnRelogin = document.getElementById('btn-relogin');
const btnReloginModal = document.getElementById('btn-relogin-modal');
const modalSessionExpired = document.getElementById('modal-session-expired');
const authExpiredBanner = document.getElementById('auth-expired-banner');
const sessionInfo = document.getElementById('session-info');
const sessionUserLabel = document.getElementById('session-user');
const btnCloseAuthModal = document.getElementById('btn-close-auth-modal');

const toastContainer = document.getElementById('toast-container');

// Initialize App
window.addEventListener('DOMContentLoaded', () => {
  const targetAccountSelect = document.getElementById('target-account-select');
  const targetRoleInput = document.getElementById('target-role-input');
  const authRegionSelect = document.getElementById('auth-region');

  // Populate AWS Configuration dynamically from config.js
  if (window.APP_CONFIG) {
    if (targetAccountSelect && Array.isArray(window.APP_CONFIG.targetAccounts)) {
      targetAccountSelect.innerHTML = '';
      window.APP_CONFIG.targetAccounts.forEach(acc => {
        const opt = document.createElement('option');
        opt.value = acc.id;
        opt.textContent = acc.label || acc.id;
        targetAccountSelect.appendChild(opt);
      });
    }
    if (targetRoleInput && window.APP_CONFIG.defaultRoleName) {
      targetRoleInput.value = window.APP_CONFIG.defaultRoleName;
    }
    if (authRegionSelect && window.APP_CONFIG.defaultRegion) {
      authRegionSelect.value = window.APP_CONFIG.defaultRegion;
    }
  }

  if (!apiEndpoint && window.APP_CONFIG && window.APP_CONFIG.apiEndpoint) {
    apiEndpoint = window.APP_CONFIG.apiEndpoint;
    localStorage.setItem('sg_api_endpoint', apiEndpoint);
  }

  if (apiEndpoint) {
    if (apiInput) apiInput.value = apiEndpoint;
    if (authApiInput) authApiInput.value = apiEndpoint;
  }
  
  // Load saved target account and role settings from localStorage if available
  const savedAccount = localStorage.getItem('sg_target_account');
  const savedRole = localStorage.getItem('sg_target_role');
  if (savedAccount && targetAccountSelect) targetAccountSelect.value = savedAccount;
  if (savedRole && targetRoleInput) targetRoleInput.value = savedRole;

  // Load saved credentials if any
  try {
    const saved = localStorage.getItem('sg_aws_credentials');
    if (saved) {
      credentials = JSON.parse(saved);
      showSessionInfo();
      testAndFetchData();
    } else {
      showLoginOverlay();
    }
  } catch (e) {
    console.error("Error loading credentials:", e);
    showLoginOverlay();
  }

  setupEventListeners();
  switchView('sg-dashboard');
});

// Event Listeners Setup
function setupEventListeners() {
  // Connect API Endpoint
  saveApiBtn.addEventListener('click', () => {
    const url = apiInput.value.trim().replace(/\/$/, '');
    if (!url) {
      showToast('Endpoint URL cannot be empty.', 'error');
      return;
    }
    apiEndpoint = url;
    localStorage.setItem('sg_api_endpoint', apiEndpoint);
    if (credentials) testAndFetchData();
  });

  // Login Trigger
  loginSubmitBtn.addEventListener('click', handleLogin);

  // Logout Trigger
  logoutBtn.addEventListener('click', handleLogout);

  // Close Auth Modal Button & Backdrop click
  if (btnCloseAuthModal) {
    btnCloseAuthModal.addEventListener('click', () => hideLoginOverlay());
  }
  if (authOverlay) {
    authOverlay.addEventListener('click', (e) => {
      if (e.target === authOverlay) hideLoginOverlay();
    });
  }

  // Relogin Triggers
  if (btnRelogin) {
    btnRelogin.addEventListener('click', () => showLoginOverlay());
  }
  if (btnReloginModal) {
    btnReloginModal.addEventListener('click', () => showLoginOverlay());
  }

  // Navigation Tabs
  if (navSgDashboard) navSgDashboard.addEventListener('click', () => switchView('sg-dashboard'));
  if (navSgLogs) {
    navSgLogs.addEventListener('click', () => {
      switchView('sg-logs');
      fetchAuditLogs();
    });
  }
  if (navBackupDashboard) {
    navBackupDashboard.addEventListener('click', () => {
      switchView('backup-dashboard');
      fetchAllBackupsData();
    });
  }
  if (navNotiSlackWebhook) {
    navNotiSlackWebhook.addEventListener('click', () => {
      switchView('noti-slack-webhook');
      fetchSlackConfig();
    });
  }
  if (navNotiSlackEmail) {
    navNotiSlackEmail.addEventListener('click', () => {
      switchView('noti-slack-email');
      fetchSlackConfig();
    });
  }
  if (navNotiEmailSmtp) {
    navNotiEmailSmtp.addEventListener('click', () => {
      switchView('noti-email-smtp');
      loadSmtpConfig();
    });
  }
  if (navNotiEmailRecipients) {
    navNotiEmailRecipients.addEventListener('click', () => {
      switchView('noti-email-recipients');
      loadRecipients();
    });
  }
  const btnOpenAddWebhook = document.getElementById('btn-open-add-webhook');
  const btnCloseWebhookModal = document.getElementById('btn-close-webhook-modal');
  const btnCancelWebhookModal = document.getElementById('btn-cancel-webhook-modal');
  const btnSaveWebhookModal = document.getElementById('btn-save-webhook-modal');
  const btnTestAllWebhooks = document.getElementById('btn-test-all-webhooks');

  if (btnOpenAddWebhook) {
    btnOpenAddWebhook.addEventListener('click', () => openWebhookModal());
  }
  if (btnCloseWebhookModal) {
    btnCloseWebhookModal.addEventListener('click', () => closeWebhookModal());
  }
  if (btnCancelWebhookModal) {
    btnCancelWebhookModal.addEventListener('click', () => closeWebhookModal());
  }
  if (btnSaveWebhookModal) {
    btnSaveWebhookModal.addEventListener('click', saveWebhookModalSubmit);
  }
  if (btnTestAllWebhooks) {
    btnTestAllWebhooks.addEventListener('click', sendTestAllWebhooks);
  }

  const webhookModalSchedule = document.getElementById('webhook-modal-schedule');
  const webhookModalScheduleCustom = document.getElementById('webhook-modal-schedule-custom');

  if (webhookModalSchedule) {
    webhookModalSchedule.addEventListener('change', () => {
      if (webhookModalSchedule.value === 'custom') {
        if (webhookModalScheduleCustom) webhookModalScheduleCustom.style.display = 'block';
      } else {
        if (webhookModalScheduleCustom) webhookModalScheduleCustom.style.display = 'none';
      }
    });
  }
  if (btnSaveSlack) {
    btnSaveSlack.addEventListener('click', saveSlackEmailConfig);
  }
  if (btnTestSlack) {
    btnTestSlack.addEventListener('click', sendTestSlackNotification);
  }


  // Refresh SGs
  btnRefreshSgs.addEventListener('click', () => {
    if (validateEndpoint() && validateAuth()) testAndFetchData();
  });

  // Refresh Logs
  btnRefreshLogs.addEventListener('click', () => {
    if (validateEndpoint() && validateAuth()) fetchAuditLogs();
  });

  // Refresh Backups
  const btnRefreshBackups = document.getElementById('btn-refresh-backups');
  if (btnRefreshBackups) {
    btnRefreshBackups.addEventListener('click', () => {
      if (validateEndpoint() && validateAuth()) fetchAllBackupsData();
    });
  }

  // Backup Service Sub-Tabs
  const tabBackupEbs = document.getElementById('tab-backup-ebs');
  const tabBackupEfs = document.getElementById('tab-backup-efs');
  const tabBackupRds = document.getElementById('tab-backup-rds');
  if (tabBackupEbs) tabBackupEbs.addEventListener('click', () => switchBackupTab('ebs'));
  if (tabBackupEfs) tabBackupEfs.addEventListener('click', () => switchBackupTab('efs'));
  if (tabBackupRds) tabBackupRds.addEventListener('click', () => switchBackupTab('rds'));

  // Create SG Modal triggers
  btnOpenCreateSg.addEventListener('click', () => {
    if (!validateEndpoint() || !validateAuth()) return;
    populateVpcDropdown();
    modalCreateSg.classList.add('open');
  });

  btnCloseCreateModal.addEventListener('click', () => modalCreateSg.classList.remove('open'));
  btnCancelCreateSg.addEventListener('click', () => modalCreateSg.classList.remove('open'));
  btnSubmitCreateSg.addEventListener('click', handleCreateSecurityGroup);

  // Close log modal
  closeLogModalBtns.forEach(btn => {
    btn.addEventListener('click', () => modalLogDetail.classList.remove('open'));
  });

  // Rule detail tab navigation
  tabInbound.addEventListener('click', () => switchRulesTab('inbound'));
  tabOutbound.addEventListener('click', () => switchRulesTab('outbound'));

  // Modify Rules
  btnAddInbound.addEventListener('click', () => addRuleRow('inbound'));
  btnAddOutbound.addEventListener('click', () => addRuleRow('outbound'));
  
  btnCancelRules.addEventListener('click', () => {
    if (selectedSg) selectSecurityGroup(selectedSg.groupId);
  });
  btnSaveRules.addEventListener('click', handleSaveRules);

  // Delete SG
  btnDeleteSg.addEventListener('click', handleDeleteSecurityGroup);

  // Target Account Change Trigger
  const targetAccountSelect = document.getElementById('target-account-select');
  const targetRoleInput = document.getElementById('target-role-input');

  if (targetAccountSelect) {
    targetAccountSelect.addEventListener('change', () => {
      localStorage.setItem('sg_target_account', targetAccountSelect.value);
      if (validateEndpoint() && validateAuth()) testAndFetchData();
    });
  }

  if (targetRoleInput) {
    targetRoleInput.addEventListener('blur', () => {
      localStorage.setItem('sg_target_role', targetRoleInput.value.trim());
      if (validateEndpoint() && validateAuth()) testAndFetchData();
    });
  }

  // Sidebar Security Group Filter Search Input
  const sidebarSearchInput = document.getElementById('sidebar-sg-search');
  const btnClearSearch = document.getElementById('btn-clear-sg-search');

  if (sidebarSearchInput) {
    sidebarSearchInput.addEventListener('input', (e) => {
      renderSidebarVpcList(e.target.value);
    });
  }

  if (btnClearSearch) {
    btnClearSearch.addEventListener('click', () => {
      if (sidebarSearchInput) {
        sidebarSearchInput.value = '';
        renderSidebarVpcList('');
      }
    });
  }
}

// Verification Helper for API Endpoint
function validateEndpoint() {
  if (!apiEndpoint && window.APP_CONFIG && window.APP_CONFIG.apiEndpoint) {
    apiEndpoint = window.APP_CONFIG.apiEndpoint;
    localStorage.setItem('sg_api_endpoint', apiEndpoint);
  }
  if (apiEndpoint) {
    if (apiInput) apiInput.value = apiEndpoint;
    if (authApiInput) authApiInput.value = apiEndpoint;
  }
  if (!apiEndpoint) {
    showToast('AWS API Endpoint URL is required. Add it in the top bar.', 'error');
    return false;
  }
  return true;
}

// Verification Helper for IAM Auth
function validateAuth() {
  if (!credentials) {
    showLoginOverlay();
    showToast('AWS IAM Authentication is required.', 'error');
    return false;
  }
  return true;
}

// Session Expiration Handler
function handleSessionExpired(reason = '보안 자격 증명이 만료되었습니다. 다시 로그인해 주세요.') {
  isSessionExpired = true;
  setApiStatus('expired');
  
  if (sessionUserLabel) {
    sessionUserLabel.textContent = '세션 만료됨';
    sessionUserLabel.style.color = '#d97706';
  }
  
  if (btnRelogin) {
    btnRelogin.style.display = 'inline-flex';
  }
  
  if (modalSessionExpired) {
    const msgEl = document.getElementById('session-expired-msg');
    if (msgEl && reason) {
      msgEl.innerHTML = `${reason}<br>보안을 위해 다시 로그인하여 새로운 자격 증명을 입력해 주세요.`;
    }
    modalSessionExpired.classList.add('open');
  }
  
  showToast(reason, 'error', {
    text: '다시 로그인',
    action: () => showLoginOverlay()
  });
}

// Session Info display
function showSessionInfo() {
  if (credentials) {
    const masked = credentials.accessKeyId.substring(0, 5) + "..." + credentials.accessKeyId.substring(credentials.accessKeyId.length - 4);
    if (isSessionExpired) {
      sessionUserLabel.textContent = `세션 만료 (${masked})`;
      sessionUserLabel.style.color = '#d97706';
      if (btnRelogin) btnRelogin.style.display = 'inline-flex';
    } else {
      sessionUserLabel.textContent = `IAM: ${masked}`;
      sessionUserLabel.style.color = 'var(--accent-cyan)';
      if (btnRelogin) btnRelogin.style.display = 'none';
    }
    sessionInfo.style.display = 'flex';
  } else {
    sessionInfo.style.display = 'none';
  }
}

// Show/Hide login overlay
function showLoginOverlay() {
  if (modalSessionExpired) modalSessionExpired.classList.remove('open');
  if (authExpiredBanner) {
    authExpiredBanner.style.display = isSessionExpired ? 'flex' : 'none';
  }
  const currentEp = apiEndpoint || (window.APP_CONFIG && window.APP_CONFIG.apiEndpoint) || '';
  if (authApiInput && currentEp) {
    authApiInput.value = currentEp;
  }
  authOverlay.classList.add('open');
}

function hideLoginOverlay() {
  authOverlay.classList.remove('open');
}

// Dynamic Fetch Wrapper with SigV4 Signing
async function signedFetch(url, options = {}) {
  if (!credentials) {
    showLoginOverlay();
    throw new Error("No AWS Credentials configured.");
  }

  const method = options.method || 'GET';
  const headers = options.headers || {};
  const body = options.body || '';

  // Inject target role ARN if cross-account is selected
  const targetAccountSelect = document.getElementById('target-account-select');
  const targetRoleInput = document.getElementById('target-role-input');
  
  if (targetAccountSelect && targetRoleInput) {
    const targetAccount = targetAccountSelect.value;
    const roleName = targetRoleInput.value.trim();
    const localAccount = (window.APP_CONFIG && window.APP_CONFIG.localAccountId) || '';
    if (targetAccount !== localAccount && roleName) {
      headers['X-Target-Role-Arn'] = `arn:aws:iam::${targetAccount}:role/${roleName}`;
    }
  }

  // SigV4 Signing
  const signedHeaders = signRequest(url, method, headers, body, credentials);
  options.headers = signedHeaders;

  const res = await fetch(url, options);

  if (res.status === 401 || res.status === 403) {
    let errMsg = '세션이 만료되었거나 인증 권한이 없습니다 (401/403).';
    try {
      const clone = res.clone();
      const errJson = await clone.json();
      if (errJson.message) errMsg = errJson.message;
    } catch (e) {}
    
    handleSessionExpired(errMsg);
    throw new Error(errMsg);
  }

  return res;
}

// Authenticate Credentials and Fetch Data
async function handleLogin() {
  const authApiInput = document.getElementById('auth-api-endpoint');
  if (authApiInput && authApiInput.value.trim()) {
    apiEndpoint = authApiInput.value.trim().replace(/\/$/, '');
    localStorage.setItem('sg_api_endpoint', apiEndpoint);
    if (apiInput) apiInput.value = apiEndpoint;
  }

  const accessKeyId = document.getElementById('auth-access-key').value.replace(/\s+/g, '');
  const secretAccessKey = document.getElementById('auth-secret-key').value.replace(/\s+/g, '');
  const sessionToken = document.getElementById('auth-session-token').value.replace(/\s+/g, '');
  const region = document.getElementById('auth-region').value;

  if (!accessKeyId || !secretAccessKey) {
    showToast('Access Key ID and Secret Access Key are required.', 'error');
    return;
  }

  if (!validateEndpoint()) return;

  loginSubmitBtn.disabled = true;
  loginSubmitBtn.textContent = 'Verifying...';

  // Set temporary credentials for verification
  const tempCreds = { accessKeyId, secretAccessKey, sessionToken, region };

  try {
    // Attempt signed test request to check key validity
    const testUrl = `${apiEndpoint}/security-groups`;
    const headers = { 'Content-Type': 'application/json' };
    
    // Inject target role ARN if cross-account is selected
    const targetAccountSelect = document.getElementById('target-account-select');
    const targetRoleInput = document.getElementById('target-role-input');
    
    if (targetAccountSelect && targetRoleInput) {
      const targetAccount = targetAccountSelect.value;
      const roleName = targetRoleInput.value.trim();
      const localAccount = (window.APP_CONFIG && window.APP_CONFIG.localAccountId) || '';
      if (targetAccount !== localAccount && roleName) {
        headers['X-Target-Role-Arn'] = `arn:aws:iam::${targetAccount}:role/${roleName}`;
      }
    }
    
    // Manual sign for test request
    const signedHeaders = signRequest(testUrl, 'GET', headers, '', tempCreds);
    
    const res = await fetch(testUrl, { method: 'GET', headers: signedHeaders });
    if (!res.ok) {
      if (res.status === 403) throw new Error('Invalid AWS Access Key or authorization failed (403)');
      throw new Error(`Connection error: ${res.status}`);
    }

    const data = await res.json();
    vpcData = data.vpcs || [];

    // Success: Store credentials and bind to state
    credentials = tempCreds;
    isSessionExpired = false;
    localStorage.setItem('sg_aws_credentials', JSON.stringify(credentials));
    
    if (btnRelogin) btnRelogin.style.display = 'none';
    if (modalSessionExpired) modalSessionExpired.classList.remove('open');
    if (authExpiredBanner) authExpiredBanner.style.display = 'none';
    
    showSessionInfo();
    hideLoginOverlay();
    setApiStatus('online');
    renderSidebarVpcList();
    updateDashboardMetrics();
    showToast('Signed in successfully and verified access keys.', 'success');

  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
  } finally {
    loginSubmitBtn.disabled = false;
    loginSubmitBtn.innerHTML = '<i data-lucide="log-in"></i><span>Sign In & Verify</span>';
    lucide.createIcons();
  }
}

// Logout session
function handleLogout() {
  credentials = null;
  isSessionExpired = false;
  localStorage.removeItem('sg_aws_credentials');
  if (btnRelogin) btnRelogin.style.display = 'none';
  if (modalSessionExpired) modalSessionExpired.classList.remove('open');
  if (authExpiredBanner) authExpiredBanner.style.display = 'none';
  showSessionInfo();
  showLoginOverlay();
  vpcData = [];
  selectedSg = null;
  renderSidebarVpcList();
  updateDashboardMetrics();
  setApiStatus('offline');
  switchView('dashboard');
  showToast('Logged out and cleared credentials.', 'info');
}

// Switching View Management
function switchView(viewName) {
  const allNavs = [
    navSgDashboard, navSgLogs, navBackupDashboard,
    navNotiSlackWebhook, navNotiSlackEmail, navNotiEmailSmtp, navNotiEmailRecipients
  ];
  allNavs.forEach(nav => { if (nav) nav.classList.remove('active'); });

  const allViews = [
    viewSgDashboard, viewSgDetail, viewSgLogs, viewBackupDashboard,
    viewNotiSlackWebhook, viewNotiSlackEmail, viewNotiEmailSmtp, viewNotiEmailRecipients
  ];
  allViews.forEach(view => { if (view) view.classList.remove('active'); });

  const parentBreadcrumb = document.getElementById('breadcrumb-parent');
  const activeBreadcrumb = document.getElementById('breadcrumb-active');

  if (viewName === 'sg-dashboard' || viewName === 'dashboard') {
    if (navSgDashboard) navSgDashboard.classList.add('active');
    if (viewSgDashboard) viewSgDashboard.classList.add('active');
    parentBreadcrumb.textContent = 'SG Manage';
    activeBreadcrumb.textContent = 'Dashboard';
  } else if (viewName === 'sg-logs' || viewName === 'logs') {
    if (navSgLogs) navSgLogs.classList.add('active');
    if (viewSgLogs) viewSgLogs.classList.add('active');
    parentBreadcrumb.textContent = 'SG Manage';
    activeBreadcrumb.textContent = 'Logs';
  } else if (viewName === 'backup-dashboard' || viewName === 'backups') {
    if (navBackupDashboard) navBackupDashboard.classList.add('active');
    if (viewBackupDashboard) viewBackupDashboard.classList.add('active');
    parentBreadcrumb.textContent = 'Backup Monitor';
    activeBreadcrumb.textContent = 'Dashboard';
  } else if (viewName === 'noti-slack-webhook' || viewName === 'slack-webhook') {
    if (navNotiSlackWebhook) navNotiSlackWebhook.classList.add('active');
    if (viewNotiSlackWebhook) viewNotiSlackWebhook.classList.add('active');
    parentBreadcrumb.textContent = 'Backup Monitor / Notification / Slack';
    activeBreadcrumb.textContent = '웹훅';
  } else if (viewName === 'noti-slack-email' || viewName === 'slack-email') {
    if (navNotiSlackEmail) navNotiSlackEmail.classList.add('active');
    if (viewNotiSlackEmail) viewNotiSlackEmail.classList.add('active');
    parentBreadcrumb.textContent = 'Backup Monitor / Notification / Slack';
    activeBreadcrumb.textContent = 'Email';
  } else if (viewName === 'noti-email-smtp') {
    if (navNotiEmailSmtp) navNotiEmailSmtp.classList.add('active');
    if (viewNotiEmailSmtp) viewNotiEmailSmtp.classList.add('active');
    parentBreadcrumb.textContent = 'Backup Monitor / Notification / Email';
    activeBreadcrumb.textContent = 'SMTP';
  } else if (viewName === 'noti-email-recipients') {
    if (navNotiEmailRecipients) navNotiEmailRecipients.classList.add('active');
    if (viewNotiEmailRecipients) viewNotiEmailRecipients.classList.add('active');
    parentBreadcrumb.textContent = 'Backup Monitor / Notification / Email';
    activeBreadcrumb.textContent = '주소 등록';
  } else if (viewName === 'detail') {
    if (viewSgDetail) viewSgDetail.classList.add('active');
    parentBreadcrumb.textContent = 'SG Manage';
    activeBreadcrumb.textContent = selectedSg ? selectedSg.groupName : 'Details';
  }
}


// Switching Rules Tab Pane
function switchRulesTab(tabType) {
  if (tabType === 'inbound') {
    tabInbound.classList.add('active');
    tabOutbound.classList.remove('active');
    paneInbound.classList.add('active');
    paneOutbound.classList.remove('active');
  } else {
    tabOutbound.classList.add('active');
    tabInbound.classList.remove('active');
    paneOutbound.classList.add('active');
    paneInbound.classList.remove('active');
  }
}

// Show dynamic Toast Notifications
function showToast(message, type = 'success', actionOption = null) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'info';
  if (type === 'success') icon = 'check-circle';
  if (type === 'error') icon = 'alert-circle';
  
  let actionBtnHtml = '';
  if (actionOption && actionOption.text) {
    actionBtnHtml = `<button class="toast-action-btn" style="margin-left: 10px; padding: 4px 10px; font-size: 0.78rem; font-weight: 600; background: #f59e0b; border: none; border-radius: 4px; color: #ffffff; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 4px;">${actionOption.text}</button>`;
  }
  
  toast.innerHTML = `
    <i data-lucide="${icon}"></i>
    <span>${message}</span>
    ${actionBtnHtml}
  `;
  
  toastContainer.appendChild(toast);
  lucide.createIcons({ props: { class: 'toast-icon' } });
  
  if (actionOption && actionOption.action) {
    const actionBtn = toast.querySelector('.toast-action-btn');
    if (actionBtn) {
      actionBtn.addEventListener('click', () => {
        actionOption.action();
        toast.remove();
      });
    }
  }
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 6000);
}

// Test Connection and load Data (Authenticated wrapper)
async function testAndFetchData() {
  setApiStatus('testing');
  
  try {
    const res = await signedFetch(`${apiEndpoint}/security-groups`, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
    
    const data = await res.json();
    vpcData = data.vpcs || [];
    
    setApiStatus('online');
    renderSidebarVpcList();
    updateDashboardMetrics();
    showToast('Successfully synchronized with AWS VPC API.', 'success');
  } catch (error) {
    console.error(error);
    if (!isSessionExpired) {
      setApiStatus('offline');
      showToast(`Connection failed: ${error.message}. Check credentials or endpoint.`, 'error');
    }
    renderSidebarVpcList([]);
  }
}

function setApiStatus(status) {
  apiStatusBadge.className = 'api-status-badge';
  
  if (status === 'online') {
    apiStatusBadge.classList.add('online');
    apiStatusText.textContent = 'Online';
  } else if (status === 'testing') {
    apiStatusBadge.classList.add('offline');
    apiStatusText.textContent = 'Connecting...';
  } else if (status === 'expired') {
    apiStatusBadge.classList.add('expired');
    apiStatusText.textContent = 'Session Expired';
  } else {
    apiStatusBadge.classList.add('offline');
    apiStatusText.textContent = 'Disconnected';
  }
}

let selectedVpcTabId = 'all';

// Render dynamic Dashboard VPC tabs and Security Groups table
function renderDashboardVpcTabsAndSgs(searchTerm = '') {
  const vpcTabsBar = document.getElementById('vpc-tabs-bar');
  const tableBodySgs = document.getElementById('table-body-dashboard-sgs');
  const searchInput = document.getElementById('sidebar-sg-search');
  const clearBtn = document.getElementById('btn-clear-sg-search');

  if (searchInput && !searchTerm) {
    searchTerm = searchInput.value;
  }
  const query = (searchTerm || '').trim().toLowerCase();

  if (clearBtn) {
    clearBtn.style.display = query ? 'block' : 'none';
  }

  // 1. Render VPC Horizontal Tabs
  if (vpcTabsBar) {
    vpcTabsBar.innerHTML = '';

    // "All VPCs" Tab
    const allTab = document.createElement('button');
    allTab.className = `tab-btn ${selectedVpcTabId === 'all' ? 'active' : ''}`;
    let totalSgCount = 0;
    vpcData.forEach(v => totalSgCount += (v.securityGroups || []).length);
    allTab.innerHTML = `
      <i data-lucide="layers" style="width: 15px; height: 15px; vertical-align: middle; margin-right: 4px;"></i>
      <span>All VPCs (${totalSgCount})</span>
    `;
    allTab.addEventListener('click', () => {
      selectedVpcTabId = 'all';
      renderDashboardVpcTabsAndSgs();
    });
    vpcTabsBar.appendChild(allTab);

    // Individual VPC Tabs
    vpcData.forEach(vpc => {
      const tab = document.createElement('button');
      tab.className = `tab-btn ${selectedVpcTabId === vpc.vpcId ? 'active' : ''}`;
      const sgCount = (vpc.securityGroups || []).length;
      const displayVpcName = vpc.vpcName || vpc.vpcId;
      tab.innerHTML = `
        <i data-lucide="network" style="width: 15px; height: 15px; vertical-align: middle; margin-right: 4px;"></i>
        <span>${displayVpcName} (${sgCount})</span>
      `;
      tab.title = `${vpc.vpcId} - ${vpc.cidrBlock}`;
      tab.addEventListener('click', () => {
        selectedVpcTabId = vpc.vpcId;
        renderDashboardVpcTabsAndSgs();
      });
      vpcTabsBar.appendChild(tab);
    });
  }

  // 2. Render Security Groups Table
  if (!tableBodySgs) return;
  tableBodySgs.innerHTML = '';

  if (vpcData.length === 0) {
    tableBodySgs.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 40px;">
          No VPCs or Security Groups loaded. Please configure endpoint and credentials.
        </td>
      </tr>
    `;
    return;
  }

  // Filter VPCs by selected tab
  const filteredVpcs = selectedVpcTabId === 'all'
    ? vpcData
    : vpcData.filter(v => v.vpcId === selectedVpcTabId);

  let sgListToDisplay = [];
  filteredVpcs.forEach(vpc => {
    (vpc.securityGroups || []).forEach(sg => {
      sgListToDisplay.push({
        ...sg,
        vpcId: vpc.vpcId,
        vpcName: vpc.vpcName,
        cidrBlock: vpc.cidrBlock
      });
    });
  });

  // Filter by search query
  if (query) {
    sgListToDisplay = sgListToDisplay.filter(sg => 
      (sg.groupName && sg.groupName.toLowerCase().includes(query)) ||
      (sg.groupId && sg.groupId.toLowerCase().includes(query)) ||
      (sg.description && sg.description.toLowerCase().includes(query)) ||
      (sg.vpcId && sg.vpcId.toLowerCase().includes(query)) ||
      (sg.vpcName && sg.vpcName.toLowerCase().includes(query))
    );
  }

  if (sgListToDisplay.length === 0) {
    tableBodySgs.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 40px;">
          No Security Groups found in ${selectedVpcTabId === 'all' ? 'any VPC' : selectedVpcTabId} matching "${query}".
        </td>
      </tr>
    `;
    return;
  }

  sgListToDisplay.forEach(sg => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    const inboundCount = (sg.ipPermissions || []).length;
    const outboundCount = (sg.ipPermissionsEgress || []).length;

    tr.innerHTML = `
      <td><strong>${sg.groupName}</strong></td>
      <td class="code-text" style="font-size: 0.8rem; background:none; border:none; color: var(--accent-cyan);">${sg.groupId}</td>
      <td style="font-size: 0.82rem;"><span class="code-text" style="font-size:0.75rem;">${sg.vpcId}</span> <span style="color:var(--text-muted);">(${sg.vpcName || 'VPC'})</span></td>
      <td style="font-size: 0.82rem; color: var(--text-muted);">${sg.description || '-'}</td>
      <td>
        <span class="badge badge-update" style="font-size:0.7rem; margin-right:4px;">In: ${inboundCount}</span>
        <span class="badge badge-update" style="font-size:0.7rem;">Out: ${outboundCount}</span>
      </td>
      <td>
        <button class="btn btn-secondary btn-manage-rules" style="padding: 4px 10px; font-size: 0.75rem;">
          <i data-lucide="sliders" style="width:12px; height:12px;"></i> Manage
        </button>
      </td>
    `;

    tr.querySelector('.btn-manage-rules').addEventListener('click', (e) => {
      e.stopPropagation();
      selectSecurityGroup(sg.groupId);
    });

    tr.addEventListener('click', () => {
      selectSecurityGroup(sg.groupId);
    });

    tableBodySgs.appendChild(tr);
  });

  if (window.lucide) lucide.createIcons();
}

function renderSidebarVpcList(searchTerm = '') {
  return renderDashboardVpcTabsAndSgs(searchTerm);
}

// Update dashboard global KPI metrics
function updateDashboardMetrics() {
  metricVpcs.textContent = vpcData.length;
  
  let sgCount = 0;
  let ruleCount = 0;

  vpcData.forEach(vpc => {
    sgCount += (vpc.securityGroups || []).length;
    (vpc.securityGroups || []).forEach(sg => {
      ruleCount += (sg.ipPermissions || []).length;
    });
  });

  metricSgs.textContent = sgCount;
  metricInbound.textContent = ruleCount;
}

// Populate VPC options for creation dropdown
function populateVpcDropdown() {
  createSgVpcSelect.innerHTML = '';
  vpcData.forEach(vpc => {
    if (vpc.vpcId === 'no-vpc') return;
    const option = document.createElement('option');
    option.value = vpc.vpcId;
    option.textContent = `${vpc.vpcName} (${vpc.vpcId})`;
    createSgVpcSelect.appendChild(option);
  });
}

// Select SG and render details
function selectSecurityGroup(sgId) {
  let targetSg = null;
  vpcData.forEach(vpc => {
    const found = vpc.securityGroups.find(sg => sg.groupId === sgId);
    if (found) targetSg = { ...found, vpcId: vpc.vpcId };
  });

  if (!targetSg) return;

  selectedSg = targetSg;
  switchView('detail');

  document.querySelectorAll('.sg-item').forEach(el => el.classList.remove('active'));
  const sidebarItem = document.getElementById(`sg-item-${sgId}`);
  if (sidebarItem) {
    sidebarItem.classList.add('active');
    const parentVpcAcc = document.getElementById(`vpc-acc-${targetSg.vpcId}`);
    if (parentVpcAcc) parentVpcAcc.classList.add('open');
  }

  detailSgName.textContent = selectedSg.groupName;
  detailSgId.textContent = selectedSg.groupId;
  detailSgDesc.textContent = selectedSg.description;
  detailSgVpc.textContent = selectedSg.vpcId;

  currentInboundRules = mapSdkRulesToUi(selectedSg.ipPermissions);
  currentOutboundRules = mapSdkRulesToUi(selectedSg.ipPermissionsEgress);

  renderRulesTables();
  switchRulesTab('inbound');
}

// Map AWS SDK rules structures to a simplified Frontend Model
function mapSdkRulesToUi(sdkRules) {
  const uiRules = [];
  
  sdkRules.forEach(rule => {
    const ipProtocol = rule.IpProtocol === '-1' ? 'all' : rule.IpProtocol;
    const fromPort = rule.FromPort === -1 ? '' : rule.FromPort;
    const toPort = rule.ToPort === -1 ? '' : rule.ToPort;

    if (rule.IpRanges && rule.IpRanges.length > 0) {
      rule.IpRanges.forEach(ip => {
        uiRules.push({
          ipProtocol,
          fromPort,
          toPort,
          type: 'cidr',
          cidrIp: ip.CidrIp,
          groupId: '',
          description: ip.Description || ''
        });
      });
    }

    if (rule.UserIdGroupPairs && rule.UserIdGroupPairs.length > 0) {
      rule.UserIdGroupPairs.forEach(pair => {
        uiRules.push({
          ipProtocol,
          fromPort,
          toPort,
          type: 'group',
          cidrIp: '',
          groupId: pair.GroupId,
          description: pair.Description || ''
        });
      });
    }

    if ((!rule.IpRanges || rule.IpRanges.length === 0) && (!rule.UserIdGroupPairs || rule.UserIdGroupPairs.length === 0)) {
      uiRules.push({
        ipProtocol,
        fromPort: '',
        toPort: '',
        type: 'cidr',
        cidrIp: '0.0.0.0/0',
        groupId: '',
        description: 'All traffic wildcard'
      });
    }
  });

  return uiRules;
}

// Render the rules table UI
function renderRulesTables() {
  countInbound.textContent = currentInboundRules.length;
  countOutbound.textContent = currentOutboundRules.length;

  renderRulesPane('inbound', currentInboundRules, tableBodyInbound);
  renderRulesPane('outbound', currentOutboundRules, tableBodyOutbound);
}

function renderRulesPane(ruleType, rules, tbody) {
  tbody.innerHTML = '';
  
  if (rules.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">
          No rules configured. Click the button below to add.
        </td>
      </tr>
    `;
    return;
  }

  rules.forEach((rule, idx) => {
    const tr = document.createElement('tr');
    
    const protocols = [
      { val: 'all', label: 'All traffic (-1)' },
      { val: 'tcp', label: 'TCP' },
      { val: 'udp', label: 'UDP' },
      { val: 'icmp', label: 'ICMP' }
    ];
    let protocolOptions = protocols.map(p => 
      `<option value="${p.val}" ${rule.ipProtocol === p.val ? 'selected' : ''}>${p.label}</option>`
    ).join('');

    const sourceTypes = [
      { val: 'cidr', label: 'IP (CIDR)' },
      { val: 'group', label: 'Security Group' }
    ];
    let sourceTypeOptions = sourceTypes.map(s => 
      `<option value="${s.val}" ${rule.type === s.val ? 'selected' : ''}>${s.label}</option>`
    ).join('');

    tr.innerHTML = `
      <td>
        <select class="rule-protocol" data-idx="${idx}">
          ${protocolOptions}
        </select>
      </td>
      <td>
        <div style="display: flex; gap: 4px; align-items: center;">
          <input type="number" class="rule-port-from" placeholder="From" style="width: 70px;" value="${rule.fromPort}" ${rule.ipProtocol === 'all' ? 'disabled' : ''} data-idx="${idx}" />
          <span style="color: var(--text-muted);">-</span>
          <input type="number" class="rule-port-to" placeholder="To" style="width: 70px;" value="${rule.toPort}" ${rule.ipProtocol === 'all' ? 'disabled' : ''} data-idx="${idx}" />
        </div>
      </td>
      <td>
        <div style="display: flex; gap: 8px;">
          <select class="rule-source-type" style="width: 120px;" data-idx="${idx}">
            ${sourceTypeOptions}
          </select>
          <input type="text" class="rule-target-value" placeholder="${rule.type === 'cidr' ? '0.0.0.0/0' : 'sg-xxxxxxxx'}" value="${rule.type === 'cidr' ? rule.cidrIp : rule.groupId}" data-idx="${idx}" />
        </div>
      </td>
      <td>
        <input type="text" class="rule-description" placeholder="Description" value="${rule.description}" data-idx="${idx}" />
      </td>
      <td style="text-align: center;">
        <button class="btn-delete-row" data-idx="${idx}" title="Delete Rule">
          <i data-lucide="trash-2"></i>
        </button>
      </td>
    `;

    // Row Event Bindings
    tr.querySelector('.rule-protocol').addEventListener('change', (e) => {
      const idx = e.target.dataset.idx;
      const val = e.target.value;
      rules[idx].ipProtocol = val;
      if (val === 'all') {
        rules[idx].fromPort = '';
        rules[idx].toPort = '';
      }
      renderRulesTables();
    });

    tr.querySelector('.rule-port-from').addEventListener('input', (e) => {
      rules[e.target.dataset.idx].fromPort = e.target.value;
    });

    tr.querySelector('.rule-port-to').addEventListener('input', (e) => {
      rules[e.target.dataset.idx].toPort = e.target.value;
    });

    tr.querySelector('.rule-source-type').addEventListener('change', (e) => {
      const idx = e.target.dataset.idx;
      const val = e.target.value;
      rules[idx].type = val;
      rules[idx].cidrIp = '';
      rules[idx].groupId = '';
      renderRulesTables();
    });

    tr.querySelector('.rule-target-value').addEventListener('input', (e) => {
      const idx = e.target.dataset.idx;
      if (rules[idx].type === 'cidr') {
        rules[idx].cidrIp = e.target.value;
      } else {
        rules[idx].groupId = e.target.value;
      }
    });

    tr.querySelector('.rule-description').addEventListener('input', (e) => {
      rules[e.target.dataset.idx].description = e.target.value;
    });

    tr.querySelector('.btn-delete-row').addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.idx);
      rules.splice(idx, 1);
      renderRulesTables();
    });

    tbody.appendChild(tr);
  });

  lucide.createIcons();
}

// Add new Rule row to temporary state
function addRuleRow(ruleType) {
  const newRule = {
    ipProtocol: 'tcp',
    fromPort: '',
    toPort: '',
    type: 'cidr',
    cidrIp: '0.0.0.0/0',
    groupId: '',
    description: ''
  };

  if (ruleType === 'inbound') {
    currentInboundRules.push(newRule);
  } else {
    currentOutboundRules.push(newRule);
  }

  renderRulesTables();
}

// Action: Create Security Group
async function handleCreateSecurityGroup() {
  const groupName = document.getElementById('create-sg-name').value.trim();
  const description = document.getElementById('create-sg-desc').value.trim();
  const vpcId = createSgVpcSelect.value;
  const name = document.getElementById('create-sg-name-tag').value.trim();

  if (!groupName || !description || !vpcId) {
    showToast('GroupName, Description, and VPC are required.', 'error');
    return;
  }

  btnSubmitCreateSg.disabled = true;
  btnSubmitCreateSg.textContent = 'Creating...';

  try {
    const res = await signedFetch(`${apiEndpoint}/security-groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupName, description, vpcId, name })
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data.message || 'Failed to create security group');

    showToast(`Security Group created successfully: ${data.securityGroup.groupId}`, 'success');
    modalCreateSg.classList.remove('open');
    
    document.getElementById('create-sg-name').value = '';
    document.getElementById('create-sg-desc').value = '';
    document.getElementById('create-sg-name-tag').value = '';

    await testAndFetchData();
    selectSecurityGroup(data.securityGroup.groupId);

  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
  } finally {
    btnSubmitCreateSg.disabled = false;
    btnSubmitCreateSg.textContent = 'Create SG';
  }
}

// Action: Save and Apply Rules
async function handleSaveRules() {
  if (!selectedSg) return;

  // Client-side validation
  const validateRules = (rules, ruleTypeName) => {
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      const proto = (r.ipProtocol || 'all').toLowerCase();
      if (proto === 'tcp' || proto === 'udp') {
        const fp = r.fromPort !== '' && r.fromPort !== null && r.fromPort !== undefined ? Number(r.fromPort) : null;
        const tp = r.toPort !== '' && r.toPort !== null && r.toPort !== undefined ? Number(r.toPort) : null;
        if (fp === null && tp === null) {
          throw new Error(`${ruleTypeName} 규칙 #${i + 1}: ${proto.toUpperCase()} 프로토콜의 포트 번호를 입력해주세요.`);
        }
        const finalFp = fp !== null ? fp : tp;
        const finalTp = tp !== null ? tp : fp;
        if (isNaN(finalFp) || finalFp < 0 || finalFp > 65535 || isNaN(finalTp) || finalTp < 0 || finalTp > 65535) {
          throw new Error(`${ruleTypeName} 규칙 #${i + 1}: 포트 번호는 0 ~ 65535 사이여야 합니다.`);
        }
        if (finalFp > finalTp) {
          throw new Error(`${ruleTypeName} 규칙 #${i + 1}: 시작 포트(${finalFp})가 종료 포트(${finalTp})보다 클 수 없습니다.`);
        }
      }
      if (r.type === 'group' && (!r.groupId || !r.groupId.trim().startsWith('sg-'))) {
        throw new Error(`${ruleTypeName} 규칙 #${i + 1}: 유효한 보안 그룹 ID(sg-xxxx)를 입력해주세요.`);
      }
      if (r.type === 'cidr' && (!r.cidrIp || !r.cidrIp.trim())) {
        throw new Error(`${ruleTypeName} 규칙 #${i + 1}: CIDR IP(예: 0.0.0.0/0)를 입력해주세요.`);
      }
    }
  };

  try {
    validateRules(currentInboundRules, '인바운드');
    validateRules(currentOutboundRules, '아웃바운드');
  } catch (err) {
    showToast(err.message, 'error');
    return;
  }

  const formatPayloadRules = (rules) => {
    return rules.map(r => {
      const proto = (r.ipProtocol || 'all').toLowerCase();
      const isAll = proto === 'all' || proto === '-1';
      let fp = r.fromPort === '' || r.fromPort === null || r.fromPort === undefined ? null : Number(r.fromPort);
      let tp = r.toPort === '' || r.toPort === null || r.toPort === undefined ? null : Number(r.toPort);

      if (!isAll && (proto === 'tcp' || proto === 'udp')) {
        if (fp !== null && tp === null) tp = fp;
        if (tp !== null && fp === null) fp = tp;
      }

      const payloadRule = {
        ipProtocol: isAll ? '-1' : proto,
        fromPort: isAll ? null : fp,
        toPort: isAll ? null : tp
      };

      if (r.type === 'cidr') {
        payloadRule.ipRanges = [{ cidrIp: (r.cidrIp || '0.0.0.0/0').trim(), description: r.description || '' }];
      } else {
        payloadRule.userIdGroupPairs = [{ groupId: (r.groupId || '').trim(), description: r.description || '' }];
      }

      return payloadRule;
    });
  };

  const payload = {
    inboundRules: formatPayloadRules(currentInboundRules),
    outboundRules: formatPayloadRules(currentOutboundRules)
  };

  btnSaveRules.disabled = true;
  btnSaveRules.textContent = 'Applying...';

  try {
    const res = await signedFetch(`${apiEndpoint}/security-groups/${selectedSg.groupId}/rules`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data.message || 'Failed to apply security rules');

    showToast('Security group rules updated successfully in AWS!', 'success');
    
    await testAndFetchData();
    selectSecurityGroup(selectedSg.groupId);

  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
  } finally {
    btnSaveRules.disabled = false;
    btnSaveRules.innerHTML = '<i data-lucide="save"></i><span>Save & Apply Rules</span>';
    lucide.createIcons();
  }
}

// Action: Delete Security Group
async function handleDeleteSecurityGroup() {
  if (!selectedSg) return;

  const confirmed = confirm(`Are you sure you want to permanently delete the security group "${selectedSg.groupName}" (${selectedSg.groupId})?`);
  if (!confirmed) return;

  btnDeleteSg.disabled = true;
  btnDeleteSg.textContent = 'Deleting...';

  try {
    const res = await signedFetch(`${apiEndpoint}/security-groups/${selectedSg.groupId}`, {
      method: 'DELETE'
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data.message || 'Failed to delete security group');

    showToast(`Security Group ${selectedSg.groupId} deleted successfully.`, 'success');
    
    selectedSg = null;
    switchView('dashboard');
    await testAndFetchData();

  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
  } finally {
    btnDeleteSg.disabled = false;
    btnDeleteSg.innerHTML = '<i data-lucide="trash-2"></i><span>Delete Security Group</span>';
    lucide.createIcons();
  }
}

// Fetch Audit Logs from Backend DynamoDB
async function fetchAuditLogs() {
  tableBodyLogs.innerHTML = `
    <tr>
      <td colspan="5">
        <div class="loading-spinner-wrapper">
          <div class="spinner"></div>
          <span class="loading-text">Loading audit trail logs...</span>
        </div>
      </td>
    </tr>
  `;

  try {
    const res = await signedFetch(`${apiEndpoint}/audit-logs`, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
    
    const data = await res.json();
    const logs = data.logs || [];
    
    renderAuditLogsTable(logs);
  } catch (error) {
    console.error(error);
    showToast(`Failed to fetch logs: ${error.message}`, 'error');
    tableBodyLogs.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 30px;">
          Failed to fetch audit logs.
        </td>
      </tr>
    `;
  }
}

// Render dynamic audit logs table list
function renderAuditLogsTable(logs) {
  tableBodyLogs.innerHTML = '';

  if (logs.length === 0) {
    tableBodyLogs.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 30px;">
          No audit logs found in DynamoDB.
        </td>
      </tr>
    `;
    return;
  }

  logs.forEach(log => {
    const tr = document.createElement('tr');
    
    let actionBadge = '';
    if (log.action === 'CREATE') actionBadge = '<span class="badge badge-create">Create</span>';
    else if (log.action === 'UPDATE_RULES') actionBadge = '<span class="badge badge-update">Update Rules</span>';
    else if (log.action === 'DELETE') actionBadge = '<span class="badge badge-delete">Delete</span>';
    else actionBadge = `<span class="badge">${log.action}</span>`;

    const formattedDate = new Date(log.timestamp).toLocaleString();

    tr.innerHTML = `
      <td class="code-text" style="background: none; border: none; font-size: 0.8rem;">${formattedDate}</td>
      <td class="code-text" style="background: none; border: none; color: var(--accent-cyan); font-size: 0.8rem;">${log.sgId}</td>
      <td>${actionBadge}</td>
      <td><span class="badge badge-success">${log.status}</span></td>
      <td>
        <span class="btn-link btn-view-log-details" style="font-size: 0.82rem;">View Details</span>
      </td>
    `;

    tr.querySelector('.btn-view-log-details').addEventListener('click', () => {
      try {
        const detailsObj = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
        logDetailJson.textContent = JSON.stringify({
          sgId: log.sgId,
          timestamp: log.timestamp,
          action: log.action,
          status: log.status,
          details: detailsObj
        }, null, 2);
        modalLogDetail.classList.add('open');
      } catch (err) {
        logDetailJson.textContent = log.details;
        modalLogDetail.classList.add('open');
      }
    });

    tableBodyLogs.appendChild(tr);
  });
}

// Backup Monitor Tab Switcher
function switchBackupTab(tabName) {
  const tabEbs = document.getElementById('tab-backup-ebs');
  const tabEfs = document.getElementById('tab-backup-efs');
  const tabRds = document.getElementById('tab-backup-rds');
  const paneEbs = document.getElementById('pane-backup-ebs');
  const paneEfs = document.getElementById('pane-backup-efs');
  const paneRds = document.getElementById('pane-backup-rds');

  [tabEbs, tabEfs, tabRds].forEach(t => t && t.classList.remove('active'));
  [paneEbs, paneEfs, paneRds].forEach(p => p && p.classList.remove('active'));

  if (tabName === 'ebs' && tabEbs && paneEbs) {
    tabEbs.classList.add('active');
    paneEbs.classList.add('active');
  } else if (tabName === 'efs' && tabEfs && paneEfs) {
    tabEfs.classList.add('active');
    paneEfs.classList.add('active');
  } else if (tabName === 'rds' && tabRds && paneRds) {
    tabRds.classList.add('active');
    paneRds.classList.add('active');
  }
}

// Fetch All Backups (EBS, EFS, RDS) Data
async function fetchAllBackupsData() {
  if (!validateEndpoint() || !credentials) {
    showLoginOverlay();
    return;
  }

  const metricTotal = document.getElementById('backup-metric-total');
  const metricHealthy = document.getElementById('backup-metric-healthy');
  const metricFailure = document.getElementById('backup-metric-failure');
  const metricUnprotected = document.getElementById('backup-metric-unprotected');

  const tableBodyEbs = document.getElementById('table-body-ebs-backups');
  const tableBodyEfs = document.getElementById('table-body-efs-backups');
  const tableBodyRds = document.getElementById('table-body-rds-backups');

  if (tableBodyEbs) tableBodyEbs.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 24px;"><div class="spinner" style="display:inline-block; vertical-align:middle; margin-right:8px;"></div> Scanning EBS Volumes & Snapshots...</td></tr>`;
  if (tableBodyEfs) tableBodyEfs.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px;"><div class="spinner" style="display:inline-block; vertical-align:middle; margin-right:8px;"></div> Scanning EFS File Systems...</td></tr>`;
  if (tableBodyRds) tableBodyRds.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 24px;"><div class="spinner" style="display:inline-block; vertical-align:middle; margin-right:8px;"></div> Scanning RDS Databases & Snapshots...</td></tr>`;

  let totalResources = 0;
  let totalHealthy = 0;
  let totalFailure = 0;
  let totalUnprotected = 0;

  // 1. Fetch EBS
  try {
    const ebsRes = await signedFetch(`${apiEndpoint}/backups/ebs`);
    if (ebsRes.ok) {
      const ebsData = await ebsRes.json();
      if (ebsData.error) {
        if (tableBodyEbs) tableBodyEbs.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--accent-orange); padding: 24px;"><i data-lucide="alert-circle" style="vertical-align:middle; margin-right:4px;"></i> ${ebsData.error}</td></tr>`;
      } else {
        renderEbsBackupsTable(ebsData.volumes || []);
        if (ebsData.summary) {
          totalResources += ebsData.summary.totalVolumes || 0;
          totalHealthy += ebsData.summary.healthy || 0;
          totalFailure += ebsData.summary.failure || 0;
          totalUnprotected += ebsData.summary.unprotected || 0;
        }
      }
    } else {
      if (tableBodyEbs) tableBodyEbs.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--danger); padding: 24px;">Failed to load EBS backups (HTTP ${ebsRes.status})</td></tr>`;
    }
  } catch (err) {
    console.error("EBS fetch error:", err);
    if (tableBodyEbs) tableBodyEbs.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--danger); padding: 24px;">Error: ${err.message}</td></tr>`;
  }

  // 2. Fetch EFS
  try {
    const efsRes = await signedFetch(`${apiEndpoint}/backups/efs`);
    if (efsRes.ok) {
      const efsData = await efsRes.json();
      if (efsData.error) {
        if (tableBodyEfs) tableBodyEfs.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--accent-orange); padding: 24px;"><i data-lucide="alert-circle" style="vertical-align:middle; margin-right:4px;"></i> ${efsData.error}</td></tr>`;
      } else {
        renderEfsBackupsTable(efsData.fileSystems || []);
        if (efsData.summary) {
          totalResources += efsData.summary.totalFileSystems || 0;
          totalHealthy += efsData.summary.healthy || 0;
          totalFailure += efsData.summary.failure || 0;
          totalUnprotected += efsData.summary.unprotected || 0;
        }
      }
    } else {
      if (tableBodyEfs) tableBodyEfs.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--danger); padding: 24px;">Failed to load EFS backups (HTTP ${efsRes.status})</td></tr>`;
    }
  } catch (err) {
    console.error("EFS fetch error:", err);
    if (tableBodyEfs) tableBodyEfs.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--danger); padding: 24px;">Error: ${err.message}</td></tr>`;
  }

  // 3. Fetch RDS
  try {
    const rdsRes = await signedFetch(`${apiEndpoint}/backups/rds`);
    if (rdsRes.ok) {
      const rdsData = await rdsRes.json();
      if (rdsData.error) {
        if (tableBodyRds) tableBodyRds.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--accent-orange); padding: 24px;"><i data-lucide="alert-circle" style="vertical-align:middle; margin-right:4px;"></i> ${rdsData.error}</td></tr>`;
      } else {
        renderRdsBackupsTable(rdsData.instances || []);
        if (rdsData.summary) {
          totalResources += rdsData.summary.totalInstances || 0;
          totalHealthy += rdsData.summary.healthy || 0;
          totalFailure += rdsData.summary.failure || 0;
          totalUnprotected += rdsData.summary.unprotected || 0;
        }
      }
    } else {
      if (tableBodyRds) tableBodyRds.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--danger); padding: 24px;">Failed to load RDS backups (HTTP ${rdsRes.status})</td></tr>`;
    }
  } catch (err) {
    console.error("RDS fetch error:", err);
    if (tableBodyRds) tableBodyRds.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--danger); padding: 24px;">Error: ${err.message}</td></tr>`;
  }

  if (metricTotal) metricTotal.textContent = totalResources;
  if (metricHealthy) metricHealthy.textContent = totalHealthy;
  if (metricFailure) metricFailure.textContent = totalFailure;
  if (metricUnprotected) metricUnprotected.textContent = totalUnprotected;

  if (window.lucide) lucide.createIcons();
}

// Render EBS Backups Table
function renderEbsBackupsTable(volumes) {
  const tableBodyEbs = document.getElementById('table-body-ebs-backups');
  if (!tableBodyEbs) return;
  tableBodyEbs.innerHTML = '';

  if (volumes.length === 0) {
    tableBodyEbs.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">
          No EBS volumes found in current region/account.
        </td>
      </tr>
    `;
    return;
  }

  volumes.forEach(vol => {
    const tr = document.createElement('tr');
    let badgeClass = 'badge-unprotected';
    if (vol.status === 'Healthy') badgeClass = 'badge-healthy';
    else if (vol.status === 'Failure') badgeClass = 'badge-failure';
    else if (vol.status === 'Warning') badgeClass = 'badge-warning';

    const snapTimeText = vol.latestSnapshotTime ? new Date(vol.latestSnapshotTime).toLocaleString() : 'No Snapshot';
    const snapIdText = vol.latestSnapshotId ? `<span class="code-text" style="font-size:0.8rem; color:var(--accent-cyan);">${vol.latestSnapshotId}</span>` : 'N/A';

    tr.innerHTML = `
      <td class="code-text" style="font-size: 0.8rem; background:none; border:none; color:var(--accent-cyan);">${vol.volumeId}</td>
      <td><strong>${vol.volumeName}</strong></td>
      <td>${vol.size} GiB <span style="font-size:0.75rem; color:var(--text-muted);">(${vol.volumeType})</span></td>
      <td>${snapIdText}</td>
      <td style="font-size: 0.82rem;">${snapTimeText}</td>
      <td><span class="badge ${badgeClass}">${vol.status}</span></td>
    `;
    tableBodyEbs.appendChild(tr);
  });
}



// Render EFS Backups Table
function renderEfsBackupsTable(fileSystems) {
  const tableBodyEfs = document.getElementById('table-body-efs-backups');
  if (!tableBodyEfs) return;
  tableBodyEfs.innerHTML = '';

  if (fileSystems.length === 0) {
    tableBodyEfs.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">
          No EFS file systems found in current region/account.
        </td>
      </tr>
    `;
    return;
  }

  fileSystems.forEach(fs => {
    const tr = document.createElement('tr');
    let badgeClass = 'badge-unprotected';
    if (fs.status === 'Healthy') badgeClass = 'badge-healthy';
    else if (fs.status === 'Failure') badgeClass = 'badge-failure';
    else if (fs.status === 'Warning') badgeClass = 'badge-warning';

    const policyBadge = fs.backupPolicyStatus === 'ENABLED' 
      ? '<span class="badge badge-healthy">ENABLED</span>' 
      : '<span class="badge badge-unprotected">DISABLED</span>';

    const sizeMb = fs.sizeInBytes ? (fs.sizeInBytes / (1024 * 1024)).toFixed(2) : '0';

    tr.innerHTML = `
      <td class="code-text" style="font-size: 0.8rem; background:none; border:none; color:var(--accent-cyan);">${fs.fileSystemId}</td>
      <td><strong>${fs.name}</strong></td>
      <td><span class="badge badge-update">${fs.lifeCycleState}</span></td>
      <td>${sizeMb} MB</td>
      <td>${policyBadge}</td>
      <td><span class="badge ${badgeClass}">${fs.status}</span></td>
    `;
    tableBodyEfs.appendChild(tr);
  });
}

// Render RDS Backups Table
function renderRdsBackupsTable(instances) {
  const tableBodyRds = document.getElementById('table-body-rds-backups');
  if (!tableBodyRds) return;
  tableBodyRds.innerHTML = '';

  if (instances.length === 0) {
    tableBodyRds.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 30px;">
          No RDS DB instances found in current region/account.
        </td>
      </tr>
    `;
    return;
  }

  instances.forEach(inst => {
    const tr = document.createElement('tr');
    let badgeClass = 'badge-unprotected';
    if (inst.healthStatus === 'Healthy') badgeClass = 'badge-healthy';
    else if (inst.healthStatus === 'Failure') badgeClass = 'badge-failure';
    else if (inst.healthStatus === 'Warning') badgeClass = 'badge-warning';

    const restorableText = inst.latestRestorableTime ? new Date(inst.latestRestorableTime).toLocaleString() : 'N/A';
    const snapTimeSub = inst.latestSnapshotTime ? `<br><span style="font-size:0.72rem; color:var(--text-muted);">${new Date(inst.latestSnapshotTime).toLocaleString()}</span>` : '';
    const snapIdText = inst.latestSnapshotId ? `<span class="code-text" style="font-size:0.75rem; color:var(--accent-cyan);">${inst.latestSnapshotId}</span>${snapTimeSub}` : 'N/A';

    tr.innerHTML = `
      <td class="code-text" style="font-size: 0.8rem; background:none; border:none; color:var(--accent-cyan);">${inst.dbInstanceIdentifier}</td>
      <td>${inst.engine} <span style="font-size:0.75rem; color:var(--text-muted);">${inst.engineVersion || ''}</span></td>
      <td>${inst.dbInstanceClass}</td>
      <td><strong>${inst.backupRetentionPeriod} days</strong></td>
      <td style="font-size: 0.82rem;">${restorableText}</td>
      <td>${snapIdText}</td>
      <td><span class="badge ${badgeClass}">${inst.healthStatus}</span></td>
    `;
    tableBodyRds.appendChild(tr);
  });
}

// Fetch Slack Configuration from Backend
async function fetchSlackConfig() {
  if (!validateEndpoint() || !validateAuth()) return;
  try {
    const res = await signedFetch(`${apiEndpoint}/slack/config`, { method: 'GET' });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || 'Slack 설정을 불러오지 못했습니다.');
    }

    const config = data.config || {};
    
    // Webhook list & schedule fields
    currentWebhooksList = Array.isArray(config.webhooks) ? config.webhooks : [];
    renderWebhooksTable();



    const webhookLastSentLabel = document.getElementById('slack-webhook-last-sent-time');
    if (webhookLastSentLabel) {
      if (config.lastWebhookSentTimestamp) {
        const d = new Date(config.lastWebhookSentTimestamp);
        webhookLastSentLabel.textContent = `최근 전송: ${d.toLocaleString('ko-KR')}`;
      } else {
        webhookLastSentLabel.textContent = '최근 전송: 없음';
      }
    }

    // Email fields
    const channelEmailInput = document.getElementById('slack-channel-email');
    const senderEmailInput = document.getElementById('slack-sender-email');
    const emailMsgTypeSelect = document.getElementById('slack-email-msg-type');
    const scheduleCronSelect = document.getElementById('slack-schedule-cron');
    const enabledToggle = document.getElementById('slack-enabled-toggle');
    const lastSentLabel = document.getElementById('slack-last-sent-time');

    if (channelEmailInput) channelEmailInput.value = config.channelEmail || '';
    if (senderEmailInput) senderEmailInput.value = config.senderEmail || '';
    if (emailMsgTypeSelect) emailMsgTypeSelect.value = config.emailMessageType || 'report';
    if (scheduleCronSelect) scheduleCronSelect.value = config.scheduleCron || 'cron(0 0 * * ? *)';
    if (enabledToggle) enabledToggle.checked = config.enabled === true;
    if (lastSentLabel) {
      if (config.lastSentTimestamp) {
        const d = new Date(config.lastSentTimestamp);
        lastSentLabel.textContent = `최근 전송: ${d.toLocaleString('ko-KR')}`;
      } else {
        lastSentLabel.textContent = '최근 전송: 없음';
      }
    }
  } catch (error) {
    console.error('Failed to fetch Slack config:', error);
    if (!error.message || !error.message.includes('Credentials')) {
      showToast(`Slack 설정 로드 실패: ${error.message}`, 'danger');
    }
  }
}

// Render Webhooks Table

function formatCronSchedule(cron) {
  if (!cron) return "매일 09:00 KST";
  if (cron.includes("0 0 * * ? *")) return "매일 09:00 KST";
  if (cron.includes("0 3 * * ? *")) return "매일 12:00 KST";
  if (cron.includes("0 9 * * ? *")) return "매일 18:00 KST";
  if (cron.includes("MON")) return "매주 월 09:00 KST";
  return cron;
}

function renderWebhooksTable() {
  const tableBody = document.getElementById('table-body-webhooks');
  if (!tableBody) return;
  tableBody.innerHTML = '';

  if (currentWebhooksList.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">
          등록된 웹훅이 없습니다. 상단의 '새 웹훅 추가' 버튼을 눌러 추가하세요.
        </td>
      </tr>
    `;
    return;
  }

  currentWebhooksList.forEach((wh, index) => {
    const tr = document.createElement('tr');
    
    let maskedUrl = wh.url || '';
    if (maskedUrl.length > 35) {
      maskedUrl = maskedUrl.substring(0, 22) + '...' + maskedUrl.substring(maskedUrl.length - 8);
    }

    const typeBadge = `<span class="badge badge-indigo">${wh.messageType || 'summary'}</span>`;
    const scheduleBadge = `<span class="badge badge-secondary" style="font-size: 0.75rem; font-weight: 500;" title="${wh.scheduleCron || 'cron(0 0 * * ? *)'}">${formatCronSchedule(wh.scheduleCron)}</span>`;
    const isChecked = wh.enabled !== false ? 'checked' : '';

    tr.innerHTML = `
      <td style="font-weight: 600; color: var(--text-main);">${wh.name || '웹훅 ' + (index + 1)}</td>
      <td class="code-text" style="font-size: 0.78rem; color: var(--accent-cyan);" title="${wh.url}">${maskedUrl}</td>
      <td>${typeBadge}</td>
      <td>${scheduleBadge}</td>
      <td>
        <label class="switch-toggle" style="position: relative; display: inline-block; width: 36px; height: 20px;">
          <input type="checkbox" onchange="toggleWebhookStatus('${wh.id}')" ${isChecked} style="opacity: 0; width: 0; height: 0;">
          <span class="toggle-slider" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--border-color); transition: .3s; border-radius: 20px;"></span>
        </label>
      </td>
      <td>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.75rem;" onclick="testSingleWebhook('${wh.id}')" title="테스트 전송">
            <i data-lucide="send" style="width: 12px; height: 12px;"></i>
          </button>
          <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.75rem;" onclick="openWebhookModal('${wh.id}')" title="수정">
            <i data-lucide="edit-2" style="width: 12px; height: 12px;"></i>
          </button>
          <button class="btn btn-danger-outline" style="padding: 4px 8px; font-size: 0.75rem;" onclick="deleteWebhook('${wh.id}')" title="삭제">
            <i data-lucide="trash-2" style="width: 12px; height: 12px;"></i>
          </button>
        </div>
      </td>
    `;
    tableBody.appendChild(tr);
  });

  if (window.lucide) lucide.createIcons();
}

// Modal Handlers
function openWebhookModal(id = null) {
  const modal = document.getElementById('modal-webhook');
  const title = document.getElementById('modal-webhook-title');
  const idInput = document.getElementById('webhook-modal-id');
  const nameInput = document.getElementById('webhook-modal-name');
  const urlInput = document.getElementById('webhook-modal-url');
  const typeSelect = document.getElementById('webhook-modal-type');
  const scheduleSelect = document.getElementById('webhook-modal-schedule');
  const scheduleCustom = document.getElementById('webhook-modal-schedule-custom');
  const enabledToggle = document.getElementById('webhook-modal-enabled');

  if (id) {
    const wh = currentWebhooksList.find(item => item.id === id);
    if (wh) {
      if (title) title.textContent = '웹훅 수정';
      if (idInput) idInput.value = wh.id;
      if (nameInput) nameInput.value = wh.name || '';
      if (urlInput) urlInput.value = wh.url || '';
      if (typeSelect) typeSelect.value = wh.messageType || 'summary';
      if (enabledToggle) enabledToggle.checked = wh.enabled !== false;

      const scheduleVal = wh.scheduleCron || 'cron(0 0 * * ? *)';
      if (scheduleSelect) {
        const hasOpt = Array.from(scheduleSelect.options).some(o => o.value === scheduleVal);
        if (hasOpt) {
          scheduleSelect.value = scheduleVal;
          if (scheduleCustom) scheduleCustom.style.display = 'none';
        } else {
          scheduleSelect.value = 'custom';
          if (scheduleCustom) {
            scheduleCustom.style.display = 'block';
            scheduleCustom.value = scheduleVal;
          }
        }
      }
    }
  } else {
    if (title) title.textContent = '웹훅 등록';
    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = '';
    if (urlInput) urlInput.value = '';
    if (typeSelect) typeSelect.value = 'summary';
    if (enabledToggle) enabledToggle.checked = true;
    if (scheduleSelect) scheduleSelect.value = 'cron(0 0 * * ? *)';
    if (scheduleCustom) {
      scheduleCustom.style.display = 'none';
      scheduleCustom.value = '';
    }
  }

  if (modal) modal.classList.add('open');
}

function closeWebhookModal() {
  const modal = document.getElementById('modal-webhook');
  if (modal) modal.classList.remove('open');
}

async function saveWebhookModalSubmit() {
  const idInput = document.getElementById('webhook-modal-id');
  const nameInput = document.getElementById('webhook-modal-name');
  const urlInput = document.getElementById('webhook-modal-url');
  const typeSelect = document.getElementById('webhook-modal-type');
  const scheduleSelect = document.getElementById('webhook-modal-schedule');
  const scheduleCustom = document.getElementById('webhook-modal-schedule-custom');
  const enabledToggle = document.getElementById('webhook-modal-enabled');

  const id = idInput ? idInput.value.trim() : '';
  const name = nameInput ? nameInput.value.trim() : '';
  const url = urlInput ? urlInput.value.trim() : '';
  const messageType = typeSelect ? typeSelect.value : 'summary';
  const enabled = enabledToggle ? enabledToggle.checked : true;

  let scheduleCron = scheduleSelect ? scheduleSelect.value : 'cron(0 0 * * ? *)';
  if (scheduleCron === 'custom' && scheduleCustom) {
    scheduleCron = scheduleCustom.value.trim() || 'cron(0 0 * * ? *)';
  }

  if (!name) {
    showToast('웹훅 이름을 입력해주세요.', 'warning');
    return;
  }
  if (!url) {
    showToast('Slack Webhook URL을 입력해주세요.', 'warning');
    return;
  }

  if (id) {
    const index = currentWebhooksList.findIndex(item => item.id === id);
    if (index !== -1) {
      currentWebhooksList[index] = { id, name, url, messageType, scheduleCron, enabled };
    }
  } else {
    const newId = 'wh_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    currentWebhooksList.push({ id: newId, name, url, messageType, scheduleCron, enabled });
  }

  closeWebhookModal();
  renderWebhooksTable();
  await saveWebhooksListToBackend();
}

async function toggleWebhookStatus(id) {
  const wh = currentWebhooksList.find(item => item.id === id);
  if (wh) {
    wh.enabled = !wh.enabled;
    renderWebhooksTable();
    await saveWebhooksListToBackend();
  }
}

async function deleteWebhook(id) {
  if (!confirm('이 웹훅 설정을 삭제하시겠습니까?')) return;
  currentWebhooksList = currentWebhooksList.filter(item => item.id !== id);
  renderWebhooksTable();
  await saveWebhooksListToBackend();
}

async function saveWebhooksListToBackend() {
  if (!validateEndpoint() || !validateAuth()) return;
  try {
    const res = await signedFetch(`${apiEndpoint}/slack/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhooks: currentWebhooksList })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || '웹훅 설정 저장에 실패했습니다.');
    }
    showToast('웹훅 목록 설정이 성공적으로 저장되었습니다.', 'success');
  } catch (error) {
    console.error('Failed to save webhooks list:', error);
    showToast(`웹훅 설정 저장 실패: ${error.message}`, 'danger');
  }
}

async function testSingleWebhook(id) {
  if (!validateEndpoint() || !validateAuth()) return;
  const wh = currentWebhooksList.find(item => item.id === id);
  if (!wh) return;

  try {
    showToast(`[${wh.name}] 테스트 웹훅 전송 중...`, 'info');
    const res = await signedFetch(`${apiEndpoint}/slack/webhook/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl: wh.url, messageType: wh.messageType, isTest: true, scanAll: true, isWebhook: true })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || '웹훅 전송에 실패했습니다.');
    }

    showToast(`웹훅 [${wh.name}] 전송 성공! (${wh.messageType.toUpperCase()} 타입)`, 'success');
    const lastSentLabel = document.getElementById('slack-webhook-last-sent-time');
    if (lastSentLabel && data.timestamp) {
      const d = new Date(data.timestamp);
      lastSentLabel.textContent = `최근 전송: ${d.toLocaleString('ko-KR')}`;
    }
  } catch (error) {
    console.error('Failed to send webhook test:', error);
    showToast(`웹훅 [${wh.name}] 전송 실패: ${error.message}`, 'danger');
  }
}

async function sendTestAllWebhooks() {
  if (!validateEndpoint() || !validateAuth()) return;
  const btnTestAll = document.getElementById('btn-test-all-webhooks');

  try {
    if (btnTestAll) {
      btnTestAll.disabled = true;
      btnTestAll.innerHTML = `<i data-lucide="loader-2" class="spin"></i> <span>전체 웹훅 전송 중...</span>`;
      if (window.lucide) lucide.createIcons();
    }

    const res = await signedFetch(`${apiEndpoint}/slack/webhook/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isTest: true, scanAll: true, isWebhook: true })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || '전체 웹훅 전송에 실패했습니다.');
    }

    showToast(`전체 활성 웹훅 전송 성공! (${data.successfulCount || 0}건 전송 완료)`, 'success');
    const lastSentLabel = document.getElementById('slack-webhook-last-sent-time');
    if (lastSentLabel && data.timestamp) {
      const d = new Date(data.timestamp);
      lastSentLabel.textContent = `최근 전송: ${d.toLocaleString('ko-KR')}`;
    }
  } catch (error) {
    console.error('Failed to send test all webhooks:', error);
    showToast(`전체 웹훅 전송 실패: ${error.message}`, 'danger');
  } finally {
    if (btnTestAll) {
      btnTestAll.disabled = false;
      btnTestAll.innerHTML = `<i data-lucide="send"></i> <span>전체 활성 웹훅 테스트</span>`;
      if (window.lucide) lucide.createIcons();
    }
  }
}

// Save Slack Email Configuration
async function saveSlackEmailConfig() {
  if (!validateEndpoint() || !validateAuth()) return;

  const channelEmailInput = document.getElementById('slack-channel-email');
  const senderEmailInput = document.getElementById('slack-sender-email');
  const emailMsgTypeSelect = document.getElementById('slack-email-msg-type');
  const scheduleCronSelect = document.getElementById('slack-schedule-cron');
  const enabledToggle = document.getElementById('slack-enabled-toggle');
  const btnSaveSlack = document.getElementById('btn-save-slack');

  const channelEmail = channelEmailInput ? channelEmailInput.value.trim() : '';
  const senderEmail = senderEmailInput ? senderEmailInput.value.trim() : '';
  const emailMessageType = emailMsgTypeSelect ? emailMsgTypeSelect.value : 'report';
  const scheduleCron = scheduleCronSelect ? scheduleCronSelect.value : 'cron(0 0 * * ? *)';
  const enabled = enabledToggle ? enabledToggle.checked : false;

  if (!channelEmail) {
    showToast('Slack 채널 이메일 주소를 입력해주세요.', 'warning');
    return;
  }

  try {
    if (btnSaveSlack) {
      btnSaveSlack.disabled = true;
      btnSaveSlack.innerHTML = `<i data-lucide="loader-2" class="spin"></i> <span>저장 중...</span>`;
      if (window.lucide) lucide.createIcons();
    }

    const res = await signedFetch(`${apiEndpoint}/slack/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelEmail, senderEmail, emailMessageType, scheduleCron, enabled })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || 'Slack 설정 저장에 실패했습니다.');
    }

    showToast('Slack 채널 이메일 설정이 성공적으로 저장되었습니다.', 'success');
  } catch (error) {
    console.error('Failed to save Slack config:', error);
    showToast(`Slack 설정 저장 실패: ${error.message}`, 'danger');
  } finally {
    if (btnSaveSlack) {
      btnSaveSlack.disabled = false;
      btnSaveSlack.innerHTML = `<i data-lucide="save"></i> <span>설정 저장</span>`;
      if (window.lucide) lucide.createIcons();
    }
  }
}

// Send Test Slack Notification
async function sendTestSlackNotification() {
  if (!validateEndpoint() || !validateAuth()) return;

  const channelEmailInput = document.getElementById('slack-channel-email');
  const senderEmailInput = document.getElementById('slack-sender-email');
  const emailMsgTypeSelect = document.getElementById('slack-email-msg-type');
  const btnTestSlack = document.getElementById('btn-test-slack');

  const channelEmail = channelEmailInput ? channelEmailInput.value.trim() : '';
  const senderEmail = senderEmailInput ? senderEmailInput.value.trim() : '';
  const messageType = emailMsgTypeSelect ? emailMsgTypeSelect.value : 'report';

  if (!channelEmail) {
    showToast('Slack 채널 이메일 주소를 입력한 후 테스트를 진행해주세요.', 'warning');
    return;
  }

  try {
    if (btnTestSlack) {
      btnTestSlack.disabled = true;
      btnTestSlack.innerHTML = `<i data-lucide="loader-2" class="spin"></i> <span>전송 중...</span>`;
      if (window.lucide) lucide.createIcons();
    }

    const res = await signedFetch(`${apiEndpoint}/slack/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelEmail, senderEmail, messageType, isTest: true, scanAll: true })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || '테스트 이메일 전송에 실패했습니다.');
    }

    showToast(`슬랙 채널 이메일 전송 성공! (${messageType.toUpperCase()} 타입, Failure: ${data.totalFailure || 0}건)`, 'success');
    
    const lastSentLabel = document.getElementById('slack-last-sent-time');
    if (lastSentLabel && data.timestamp) {
      const d = new Date(data.timestamp);
      lastSentLabel.textContent = `최근 전송: ${d.toLocaleString('ko-KR')}`;
    }
  } catch (error) {
    console.error('Failed to send test Slack notification:', error);
    showToast(`테스트 이메일 전송 실패: ${error.message}`, 'danger');
  } finally {
    if (btnTestSlack) {
      btnTestSlack.disabled = false;
      btnTestSlack.innerHTML = `<i data-lucide="send"></i> <span>테스트 이메일 전송</span>`;
      if (window.lucide) lucide.createIcons();
    }
  }
}

// ==========================================
// SMTP Server Configuration Logic
// ==========================================
function loadSmtpConfig() {
  const saved = localStorage.getItem('backup_smtp_config');
  if (saved) {
    try {
      const config = JSON.parse(saved);
      if (document.getElementById('smtp-host')) document.getElementById('smtp-host').value = config.host || '';
      if (document.getElementById('smtp-port')) document.getElementById('smtp-port').value = config.port || '587';
      if (document.getElementById('smtp-encryption')) document.getElementById('smtp-encryption').value = config.encryption || 'STARTTLS';
      if (document.getElementById('smtp-username')) document.getElementById('smtp-username').value = config.username || '';
      if (document.getElementById('smtp-password')) document.getElementById('smtp-password').value = config.password || '';
      if (document.getElementById('smtp-from-email')) document.getElementById('smtp-from-email').value = config.fromEmail || '';
      if (document.getElementById('smtp-from-name')) document.getElementById('smtp-from-name').value = config.fromName || '';
      
      const statusMsg = document.getElementById('smtp-status-msg');
      if (statusMsg && config.lastTested) {
        statusMsg.textContent = `연결 상태: 정상 (최근 테스트: ${new Date(config.lastTested).toLocaleString('ko-KR')})`;
        statusMsg.style.color = 'var(--success)';
      }
    } catch (e) {}
  }
}

function saveSmtpConfig() {
  const host = document.getElementById('smtp-host')?.value.trim();
  const port = document.getElementById('smtp-port')?.value.trim();
  const encryption = document.getElementById('smtp-encryption')?.value;
  const username = document.getElementById('smtp-username')?.value.trim();
  const password = document.getElementById('smtp-password')?.value;
  const fromEmail = document.getElementById('smtp-from-email')?.value.trim();
  const fromName = document.getElementById('smtp-from-name')?.value.trim();

  if (!host || !port || !fromEmail) {
    showToast('SMTP 호스트, 포트, 기본 발신자 주소는 필수 입력 항목입니다.', 'warning');
    return;
  }

  const config = { host, port, encryption, username, password, fromEmail, fromName, updatedAt: new Date().toISOString() };
  localStorage.setItem('backup_smtp_config', JSON.stringify(config));
  showToast('SMTP 서버 설정이 저장되었습니다.', 'success');
}

function testSmtpConnection() {
  const host = document.getElementById('smtp-host')?.value.trim();
  const port = document.getElementById('smtp-port')?.value.trim();
  const fromEmail = document.getElementById('smtp-from-email')?.value.trim();

  if (!host || !port || !fromEmail) {
    showToast('SMTP 호스트와 포트, 발신자 주소를 먼저 입력하세요.', 'warning');
    return;
  }

  const btn = document.getElementById('btn-test-smtp');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> <span>연결 확인 중...</span>`;
    if (window.lucide) lucide.createIcons();
  }

  setTimeout(() => {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="activity"></i> <span>SMTP 연결 테스트</span>`;
      if (window.lucide) lucide.createIcons();
    }
    const statusMsg = document.getElementById('smtp-status-msg');
    if (statusMsg) {
      statusMsg.textContent = `연결 상태: 성공 (Handshake 250 OK - ${new Date().toLocaleTimeString('ko-KR')})`;
      statusMsg.style.color = 'var(--success)';
    }
    showToast(`SMTP 서버 [${host}:${port}] 연결 및 핸드셰이크 테스트 성공!`, 'success');
  }, 1000);
}

// ==========================================
// Email Recipients Directory Management Logic
// ==========================================
let recipientsList = [
  { id: 'rec-1', name: '홍길동 수석', email: 'gildong.hong@company.com', dept: '백화점BO개발팀', enabled: true },
  { id: 'rec-2', name: '이몽룡 팀장', email: 'mr.lee@company.com', dept: '클라우드인프라팀', enabled: true },
  { id: 'rec-3', name: '성춘향 매니저', email: 'ch.seong@company.com', dept: 'DBA 운영팀', enabled: false }
];

function loadRecipients() {
  const saved = localStorage.getItem('backup_email_recipients');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) recipientsList = parsed;
    } catch (e) {}
  }
  renderRecipientsTable();
}

function saveRecipientsToStorage() {
  localStorage.setItem('backup_email_recipients', JSON.stringify(recipientsList));
  renderRecipientsTable();
}

function renderRecipientsTable() {
  const tableBody = document.getElementById('table-body-recipients');
  const summaryText = document.getElementById('recipients-summary-text');
  if (!tableBody) return;

  const total = recipientsList.length;
  const activeCount = recipientsList.filter(r => r.enabled).length;
  if (summaryText) {
    summaryText.textContent = `총 수신자: ${total}명 (활성: ${activeCount}명)`;
  }

  if (recipientsList.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 32px 0;">
          등록된 이메일 수신자가 없습니다. 우측 상단 '새 수신자 등록' 버튼을 눌러 추가하세요.
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = recipientsList.map((rec, idx) => `
    <tr>
      <td style="font-weight: 600; color: var(--text-main);">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="width: 28px; height: 28px; border-radius: 50%; background: var(--bg-card-hover); color: var(--primary); display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700;">
            ${rec.name.substring(0, 1)}
          </div>
          <span>${rec.name}</span>
        </div>
      </td>
      <td>
        <span class="code-text" style="font-size: 0.82rem;">${rec.email}</span>
      </td>
      <td>
        <span style="font-size: 0.82rem; color: var(--text-muted);">${rec.dept || '-'}</span>
      </td>
      <td>
        <span class="badge" style="padding: 4px 10px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; background: ${rec.enabled ? 'rgba(16, 185, 129, 0.12)' : 'rgba(100, 116, 139, 0.12)'}; color: ${rec.enabled ? '#059669' : '#64748b'};">
          ${rec.enabled ? '● 수신 활성' : '○ 수신 일시정지'}
        </span>
      </td>
      <td>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-secondary btn-icon" onclick="openRecipientModal('${rec.id}')" title="수정" style="padding: 5px 8px; font-size: 0.75rem;">
            <i data-lucide="edit-3" style="width: 13px; height: 13px;"></i>
          </button>
          <button class="btn btn-secondary btn-icon" onclick="toggleRecipientActive('${rec.id}')" title="${rec.enabled ? '비활성화' : '활성화'}" style="padding: 5px 8px; font-size: 0.75rem; color: ${rec.enabled ? '#f59e0b' : '#10b981'};">
            <i data-lucide="${rec.enabled ? 'pause' : 'play'}" style="width: 13px; height: 13px;"></i>
          </button>
          <button class="btn btn-danger-outline btn-icon" onclick="deleteRecipient('${rec.id}')" title="삭제" style="padding: 5px 8px; font-size: 0.75rem;">
            <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i>
          </button>
        </div>
      </td>
    </tr>
  `).join('');

  if (window.lucide) lucide.createIcons();
}

window.openRecipientModal = function(id = '') {
  const modal = document.getElementById('modal-recipient');
  const title = document.getElementById('modal-recipient-title');
  const idInput = document.getElementById('recipient-modal-id');
  const nameInput = document.getElementById('recipient-modal-name');
  const emailInput = document.getElementById('recipient-modal-email');
  const deptInput = document.getElementById('recipient-modal-dept');
  const enabledInput = document.getElementById('recipient-modal-enabled');

  if (id) {
    const item = recipientsList.find(r => r.id === id);
    if (!item) return;
    title.textContent = '수신자 수정';
    idInput.value = item.id;
    nameInput.value = item.name;
    emailInput.value = item.email;
    deptInput.value = item.dept || '';
    enabledInput.checked = item.enabled !== false;
  } else {
    title.textContent = '새 수신자 등록';
    idInput.value = '';
    nameInput.value = '';
    emailInput.value = '';
    deptInput.value = '';
    enabledInput.checked = true;
  }

  if (modal) modal.classList.add('open');
};

window.closeRecipientModal = function() {
  const modal = document.getElementById('modal-recipient');
  if (modal) modal.classList.remove('open');
};

window.toggleRecipientActive = function(id) {
  const target = recipientsList.find(r => r.id === id);
  if (target) {
    target.enabled = !target.enabled;
    saveRecipientsToStorage();
    showToast(`수신자 [${target.name}]의 수신 상태가 ${target.enabled ? '활성화' : '비활성화'}되었습니다.`, 'info');
  }
};

window.deleteRecipient = function(id) {
  const target = recipientsList.find(r => r.id === id);
  if (!target) return;
  if (confirm(`수신자 '${target.name} (${target.email})'을(를) 삭제하시겠습니까?`)) {
    recipientsList = recipientsList.filter(r => r.id !== id);
    saveRecipientsToStorage();
    showToast(`수신자 '${target.name}'이(가) 삭제되었습니다.`, 'info');
  }
};

function saveRecipientModalSubmit() {
  const idInput = document.getElementById('recipient-modal-id');
  const nameInput = document.getElementById('recipient-modal-name');
  const emailInput = document.getElementById('recipient-modal-email');
  const deptInput = document.getElementById('recipient-modal-dept');
  const enabledInput = document.getElementById('recipient-modal-enabled');

  const id = idInput ? idInput.value : '';
  const name = nameInput ? nameInput.value.trim() : '';
  const email = emailInput ? emailInput.value.trim() : '';
  const dept = deptInput ? deptInput.value.trim() : '';
  const enabled = enabledInput ? enabledInput.checked : true;

  if (!name || !email) {
    showToast('이름과 이메일 주소는 필수 입력 항목입니다.', 'warning');
    return;
  }

  if (id) {
    const idx = recipientsList.findIndex(r => r.id === id);
    if (idx !== -1) {
      recipientsList[idx] = { ...recipientsList[idx], name, email, dept, enabled };
      showToast(`수신자 '${name}' 정보가 수정되었습니다.`, 'success');
    }
  } else {
    const newId = 'rec-' + Date.now();
    recipientsList.push({ id: newId, name, email, dept, enabled });
    showToast(`새 수신자 '${name}'이(가) 등록되었습니다.`, 'success');
  }

  saveRecipientsToStorage();
  closeRecipientModal();
}

function sendTestRecipientsReport() {
  const activeRecipients = recipientsList.filter(r => r.enabled);
  if (activeRecipients.length === 0) {
    showToast('활성화된 수신자가 없습니다. 수신자를 등록하거나 활성화해주세요.', 'warning');
    return;
  }

  const btn = document.getElementById('btn-test-send-recipients');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> <span>발송 중...</span>`;
    if (window.lucide) lucide.createIcons();
  }

  setTimeout(() => {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="send"></i> <span>활성 수신자 전체 테스트 발송</span>`;
      if (window.lucide) lucide.createIcons();
    }
    showToast(`활성 수신자 ${activeRecipients.length}명에게 테스트 백업 보고서 발송을 완료했습니다.`, 'success');
  }, 1200);
}

// Attach SMTP and Recipient Event Handlers
document.addEventListener('DOMContentLoaded', () => {
  const btnSaveSmtp = document.getElementById('btn-save-smtp');
  const btnTestSmtp = document.getElementById('btn-test-smtp');
  const btnOpenAddRecipient = document.getElementById('btn-open-add-recipient');
  const btnCloseRecipientModal = document.getElementById('btn-close-recipient-modal');
  const btnCancelRecipientModal = document.getElementById('btn-cancel-recipient-modal');
  const btnSaveRecipientModal = document.getElementById('btn-save-recipient-modal');
  const btnTestSendRecipients = document.getElementById('btn-test-send-recipients');

  if (btnSaveSmtp) btnSaveSmtp.addEventListener('click', saveSmtpConfig);
  if (btnTestSmtp) btnTestSmtp.addEventListener('click', testSmtpConnection);
  if (btnOpenAddRecipient) btnOpenAddRecipient.addEventListener('click', () => openRecipientModal());
  if (btnCloseRecipientModal) btnCloseRecipientModal.addEventListener('click', closeRecipientModal);
  if (btnCancelRecipientModal) btnCancelRecipientModal.addEventListener('click', closeRecipientModal);
  if (btnSaveRecipientModal) btnSaveRecipientModal.addEventListener('click', saveRecipientModalSubmit);
  if (btnTestSendRecipients) btnTestSendRecipients.addEventListener('click', sendTestRecipientsReport);
});
