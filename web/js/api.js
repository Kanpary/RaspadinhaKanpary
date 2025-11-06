// API Base URL
const API_BASE = window.location.origin;

// API call helper - cookies are sent automatically with credentials: 'include'
async function apiCall(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include' // Automatically sends httpOnly cookies
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Erro na requisição');
  }

  return data;
}

// Auth API
const AuthAPI = {
  register: (data) => apiCall('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(data)
  }),

  login: (data) => apiCall('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(data)
  }),

  getProfile: () => apiCall('/api/auth/profile'),

  logout: () => apiCall('/api/auth/logout', { method: 'POST' })
};

// Wallet API
const WalletAPI = {
  getBalance: () => apiCall('/api/wallet/balance'),

  getTransactions: (limit = 20) => apiCall(`/api/wallet/transactions?limit=${limit}`)
};

// Deposit API
const DepositAPI = {
  create: (amount) => apiCall('/api/deposit/create', {
    method: 'POST',
    body: JSON.stringify({ amount })
  }),

  check: (transactionId) => apiCall(`/api/deposit/check/${transactionId}`)
};

// Withdrawal API
const WithdrawalAPI = {
  create: (data) => apiCall('/api/withdrawal/create', {
    method: 'POST',
    body: JSON.stringify(data)
  }),

  check: (transactionId) => apiCall(`/api/withdrawal/check/${transactionId}`)
};

// Game API
const GameAPI = {
  playScratch: (betAmount) => apiCall('/api/game/scratch', {
    method: 'POST',
    body: JSON.stringify({ betAmount })
  }),

  getHistory: (limit = 20) => apiCall(`/api/game/history?limit=${limit}`)
};

// Admin API
const AdminAPI = {
  getRTP: () => apiCall('/api/admin/rtp'),

  setRTP: (rtp_percentage) => apiCall('/api/admin/rtp', {
    method: 'POST',
    body: JSON.stringify({ rtp_percentage })
  }),

  getTransactions: (status = 'all', limit = 50) =>
    apiCall(`/api/admin/transactions?status=${status}&limit=${limit}`),

  refund: (transactionId) => apiCall(`/api/admin/refund/${transactionId}`, {
    method: 'POST'
  }),

  getBullsPayBalance: () => apiCall('/api/admin/bullspay/balance'),

  getBullsPayTransactions: (page = 1, limit = 20, status = 'all') =>
    apiCall(`/api/admin/bullspay/transactions?page=${page}&limit=${limit}&status=${status}`),

  getBullsPayWithdrawals: (page = 1, limit = 20, status = 'all') =>
    apiCall(`/api/admin/bullspay/withdrawals?page=${page}&limit=${limit}&status=${status}`),

  getUsers: (limit = 100) => apiCall(`/api/admin/users?limit=${limit}`),

  approveWithdrawal: (id) => apiCall(`/api/admin/withdrawal/approve/${id}`, {
    method: 'POST'
  }),

  rejectWithdrawal: (id, reason) => apiCall(`/api/admin/withdrawal/reject/${id}`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  }),

  getFraudAlerts: (limit = 50, resolved = false) =>
    apiCall(`/api/admin/fraud-alerts?limit=${limit}&resolved=${resolved}`),

  resolveFraudAlert: (id) => apiCall(`/api/admin/fraud-alert/resolve/${id}`, {
    method: 'POST'
  }),

  // Webhooks
  listWebhooks: (page = 1, limit = 20) =>
    apiCall(`/api/admin/webhooks/list?page=${page}&limit=${limit}`),

  createWebhook: (data) => apiCall('/api/admin/webhooks/create', {
    method: 'POST',
    body: JSON.stringify(data)
  }),

  deleteWebhook: (webhookId) => apiCall(`/api/admin/webhooks/delete/${webhookId}`, {
    method: 'DELETE'
  })
};

// Utility functions
function formatMoney(amount) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(amount);
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatCPF(cpf) {
  return cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function showError(message) {
  alert(message);
}

function showSuccess(message) {
  alert(message);
}

// Check if user is authenticated by calling profile endpoint
async function checkAuth() {
  try {
    await AuthAPI.getProfile();
    return true;
  } catch {
    return false;
  }
}

// Check if user is authenticated (synchronous version using sessionStorage cache)
function isAuthenticated() {
  // Check sessionStorage for quick check (this is reset on tab close)
  return sessionStorage.getItem('isAuthenticated') === 'true';
}

// Set authentication status in sessionStorage
function setAuthStatus(status) {
  if (status) {
    sessionStorage.setItem('isAuthenticated', 'true');
  } else {
    sessionStorage.removeItem('isAuthenticated');
  }
}

// Redirect if not authenticated
async function requireAuth() {
  try {
    await AuthAPI.getProfile();
    setAuthStatus(true);
  } catch {
    setAuthStatus(false);
    window.location.href = '/';
  }
}
