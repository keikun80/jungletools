// State Management
let apiEndpoint = localStorage.getItem('sg_api_endpoint') || (window.APP_CONFIG && window.APP_CONFIG.apiEndpoint) || '';
let vpcData = [];
let selectedSg = null;
let currentInboundRules = [];
let currentOutboundRules = [];
let credentials = null; // { accessKeyId, secretAccessKey, sessionToken, region }
let isSessionExpired = false;

// DOM Elements
const apiInput = document.getElementById('api-endpoint-input');
const saveApiBtn = document.getElementById('btn-save-endpoint');
const apiStatusBadge = document.getElementById('api-status');
const apiStatusText = document.getElementById('api-status-text');

const navDashboard = document.getElementById('nav-dashboard');
const navLogs = document.getElementById('nav-logs');
const viewDashboard = document.getElementById('view-dashboard');
const viewSgDetail = document.getElementById('view-sg-detail');
const viewLogs = document.getElementById('view-logs');

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

  if (apiEndpoint) {
    apiInput.value = apiEndpoint;
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
  navDashboard.addEventListener('click', () => switchView('dashboard'));
  navLogs.addEventListener('click', () => {
    switchView('logs');
    fetchAuditLogs();
  });

  // Refresh SGs
  btnRefreshSgs.addEventListener('click', () => {
    if (validateEndpoint() && validateAuth()) testAndFetchData();
  });

  // Refresh Logs
  btnRefreshLogs.addEventListener('click', () => {
    if (validateEndpoint() && validateAuth()) fetchAuditLogs();
  });

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
  navDashboard.classList.remove('active');
  navLogs.classList.remove('active');
  
  viewDashboard.classList.remove('active');
  viewSgDetail.classList.remove('active');
  viewLogs.classList.remove('active');

  const parentBreadcrumb = document.getElementById('breadcrumb-parent');
  const activeBreadcrumb = document.getElementById('breadcrumb-active');

  if (viewName === 'dashboard') {
    navDashboard.classList.add('active');
    viewDashboard.classList.add('active');
    parentBreadcrumb.textContent = 'Console';
    activeBreadcrumb.textContent = 'Overview';
  } else if (viewName === 'logs') {
    navLogs.classList.add('active');
    viewLogs.classList.add('active');
    parentBreadcrumb.textContent = 'Console';
    activeBreadcrumb.textContent = 'Audit Logs';
  } else if (viewName === 'detail') {
    viewSgDetail.classList.add('active');
    parentBreadcrumb.textContent = 'Security Groups';
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

// Render dynamic VPC navigation list
function renderSidebarVpcList(searchTerm = '') {
  vpcListContainer.innerHTML = '';
  
  const searchInput = document.getElementById('sidebar-sg-search');
  const clearBtn = document.getElementById('btn-clear-sg-search');
  if (searchInput && !searchTerm) {
    searchTerm = searchInput.value;
  }
  
  const query = (searchTerm || '').trim().toLowerCase();

  if (clearBtn) {
    clearBtn.style.display = query ? 'block' : 'none';
  }
  
  if (vpcData.length === 0) {
    vpcListContainer.innerHTML = `
      <div class="dashboard-placeholder" style="padding: 20px; border-style: solid;">
        <p style="font-size: 0.8rem;">No VPCs/SGs loaded. Enter valid AWS keys to login.</p>
      </div>
    `;
    return;
  }

  let matchCount = 0;

  vpcData.forEach(vpc => {
    const vpcMatch = query === '' || 
      (vpc.vpcName && vpc.vpcName.toLowerCase().includes(query)) || 
      (vpc.vpcId && vpc.vpcId.toLowerCase().includes(query)) ||
      (vpc.cidrBlock && vpc.cidrBlock.toLowerCase().includes(query));

    const sgs = (vpc.securityGroups || []).filter(sg => {
      if (query === '' || vpcMatch) return true;
      return (sg.groupName && sg.groupName.toLowerCase().includes(query)) ||
             (sg.groupId && sg.groupId.toLowerCase().includes(query)) ||
             (sg.description && sg.description.toLowerCase().includes(query));
    });

    if (!vpcMatch && sgs.length === 0) {
      return;
    }

    matchCount++;

    const accordion = document.createElement('div');
    accordion.className = 'vpc-accordion-item';
    if (query !== '' || (selectedSg && selectedSg.vpcId === vpc.vpcId)) {
      accordion.classList.add('open');
    }
    accordion.id = `vpc-acc-${vpc.vpcId}`;

    const header = document.createElement('div');
    header.className = 'vpc-header';
    header.innerHTML = `
      <div class="vpc-title-wrapper">
        <span class="vpc-name" title="${vpc.vpcName}">${vpc.vpcName}</span>
        <span class="vpc-id" title="${vpc.vpcId} (${vpc.cidrBlock})">${vpc.vpcId} (${vpc.cidrBlock})</span>
      </div>
      <i data-lucide="chevron-right" class="vpc-chevron"></i>
    `;

    const sgList = document.createElement('div');
    sgList.className = 'vpc-sgs-list';

    if (sgs.length > 0) {
      sgs.forEach(sg => {
        const item = document.createElement('div');
        item.className = 'sg-item';
        if (selectedSg && selectedSg.groupId === sg.groupId) {
          item.classList.add('active');
        }
        item.id = `sg-item-${sg.groupId}`;
        item.innerHTML = `
          <span class="sg-item-name" title="${sg.groupName}">${sg.groupName}</span>
          <span class="sg-item-id" title="${sg.groupId}">${sg.groupId}</span>
        `;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          selectSecurityGroup(sg.groupId);
        });
        sgList.appendChild(item);
      });
    } else {
      sgList.innerHTML = `<span class="loading-text" style="padding: 4px 8px;">No matching security groups.</span>`;
    }

    header.addEventListener('click', () => {
      accordion.classList.toggle('open');
    });

    accordion.appendChild(header);
    accordion.appendChild(sgList);
    vpcListContainer.appendChild(accordion);
  });

  if (matchCount === 0) {
    vpcListContainer.innerHTML = `
      <div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 0.8rem;">
        No security groups found matching "${query}".
      </div>
    `;
  }

  lucide.createIcons();
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

  const formatPayloadRules = (rules) => {
    return rules.map(r => {
      const payloadRule = {
        ipProtocol: r.ipProtocol === 'all' ? '-1' : r.ipProtocol,
        fromPort: r.fromPort === '' ? null : Number(r.fromPort),
        toPort: r.toPort === '' ? null : Number(r.toPort)
      };

      if (r.type === 'cidr') {
        payloadRule.ipRanges = [{ cidrIp: r.cidrIp, description: r.description }];
      } else {
        payloadRule.userIdGroupPairs = [{ groupId: r.groupId, description: r.description }];
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
