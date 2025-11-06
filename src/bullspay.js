import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const API_BASE = 'https://api-gateway.bullspay.com.br/api';

function ensureEnv() {
  if (!process.env.BULLSPAY_CLIENT_ID || !process.env.BULLSPAY_API_KEY) {
    throw new Error('BULLSPAY_CLIENT_ID e BULLSPAY_API_KEY devem estar configuradas');
  }
}

function getHeaders() {
  return {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'X-Public-Key': process.env.BULLSPAY_CLIENT_ID,
    'X-Private-Key': process.env.BULLSPAY_API_KEY
  };
}

// ========== TRANSAÇÕES (DEPÓSITOS) ==========

export async function createTransaction({ amount, buyerName, buyerEmail, buyerDocument, buyerPhone = '', externalId, splits = null }) {
  ensureEnv();

  const payload = {
    amount: Math.round(amount * 100), // Converter para centavos
    buyer_infos: {
      buyer_name: buyerName,
      buyer_email: buyerEmail,
      buyer_document: buyerDocument,
      buyer_phone: buyerPhone
    },
    external_id: externalId || `tx_${Date.now()}`,
    payment_method: 'pix'
  };

  // Adicionar splits se fornecido (conforme documentação BullsPay)
  if (splits && Array.isArray(splits) && splits.length > 0) {
    payload.splits = splits;
  }

  const resp = await fetch(`${API_BASE}/transactions/create`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => 'Erro desconhecido');
    throw new Error(`BullsPay error ${resp.status}: ${errorText}`);
  }

  const data = await resp.json();
  
  return {
    success: data.success,
    unic_id: data.data?.payment_data?.id,
    status: data.data?.payment_data?.status || 'pending',
    total_value: data.data?.payment_data?.amount,
    payment_url: data.data?.payment_url,
    qr_code_base64: data.data?.pix_data?.qrcode_base64,
    qr_code_text: data.data?.pix_data?.qrcode,
    created_at: data.data?.payment_data?.created_at,
    raw: data
  };
}

export async function listTransactions({ page = 1, limit = 10, status = 'all', id = '' }) {
  ensureEnv();

  const params = new URLSearchParams({ page: page.toString(), limit: limit.toString(), status });
  if (id) params.append('id', id);

  const resp = await fetch(`${API_BASE}/transactions/list?${params}`, {
    method: 'GET',
    headers: getHeaders()
  });

  if (!resp.ok) {
    throw new Error(`BullsPay error ${resp.status}`);
  }

  const data = await resp.json();
  return {
    success: data.success,
    transactions: data.data?.transactions || [],
    pagination: data.data?.pagination || {}
  };
}

export async function refundTransaction(unicId) {
  ensureEnv();

  const resp = await fetch(`${API_BASE}/transactions/refund/${unicId}`, {
    method: 'PUT',
    headers: getHeaders()
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => 'Erro desconhecido');
    throw new Error(`BullsPay error ${resp.status}: ${errorText}`);
  }

  const data = await resp.json();
  return data;
}

// ========== FORMATAÇÃO DE CHAVES PIX ==========

/**
 * Formata chave PIX de acordo com o tipo, conforme documentação BullsPay
 * CPF/CNPJ: apenas números
 * Email: formato de email
 * Phone: apenas números
 * Random: aceita qualquer formato (chave aleatória)
 */
export function formatPixKey(pixKey, pixKeyType) {
  if (!pixKey) return '';
  
  switch(pixKeyType) {
    case 'cpf':
    case 'cnpj':
    case 'phone':
      return pixKey.replace(/\D/g, '');
    case 'email':
      return pixKey.trim().toLowerCase();
    case 'random':
      return pixKey.trim();
    default:
      return pixKey;
  }
}

// ========== SAQUES (WITHDRAWALS) ==========

export async function getBalance() {
  ensureEnv();

  const resp = await fetch(`${API_BASE}/withdrawals/balance`, {
    method: 'GET',
    headers: getHeaders()
  });

  if (!resp.ok) {
    throw new Error(`BullsPay error ${resp.status}`);
  }

  const data = await resp.json();
  return {
    success: data.success,
    balance: data.data?.balance || 0,
    available_balance: data.data?.available_balance || 0,
    blocked_balance: data.data?.blocked_balance || 0
  };
}

export async function requestWithdrawal({ amount, pixKeyType, pixKey }) {
  ensureEnv();

  const formattedPixKey = formatPixKey(pixKey, pixKeyType);

  const payload = {
    amount: Math.round(amount * 100), // Converter para centavos
    pix_key_type: pixKeyType,
    pix_key: formattedPixKey
  };

  const resp = await fetch(`${API_BASE}/withdrawals/request`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => 'Erro desconhecido');
    throw new Error(`BullsPay error ${resp.status}: ${errorText}`);
  }

  const data = await resp.json();
  return {
    success: data.success,
    unic_id: data.data?.unic_id,
    status: data.data?.status,
    amount: data.data?.amount,
    pix_key_type: data.data?.pix_key_type,
    pix_key: data.data?.pix_key,
    created_at: data.data?.created_at,
    raw: data
  };
}

export async function listWithdrawals({ page = 1, limit = 10, status = 'all', id = '' }) {
  ensureEnv();

  const params = new URLSearchParams({ page: page.toString(), limit: limit.toString(), status });
  if (id) params.append('id', id);

  const resp = await fetch(`${API_BASE}/withdrawals/list?${params}`, {
    method: 'GET',
    headers: getHeaders()
  });

  if (!resp.ok) {
    throw new Error(`BullsPay error ${resp.status}`);
  }

  const data = await resp.json();
  return {
    success: data.success,
    withdrawals: data.data?.withdrawals || [],
    pagination: data.data?.pagination || {}
  };
}

// ========== WEBHOOK VALIDATION ==========

export function validateWebhookSignature(signature, payload) {
  if (!signature) {
    return false;
  }
  
  const secret = process.env.BULLSPAY_API_KEY;
  const computedSignature = crypto.createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  return signature === computedSignature;
}

export function isValidWebhookSource(req) {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization'];
  
  if (!apiKey) {
    return false;
  }
  
  const expectedKey = process.env.BULLSPAY_API_KEY;
  return apiKey === expectedKey || apiKey === `Bearer ${expectedKey}`;
}

// ========== WEBHOOKS ==========

export async function listWebhooks({ page = 1, limit = 10 }) {
  ensureEnv();

  const params = new URLSearchParams({ page: page.toString(), limit: limit.toString() });

  const resp = await fetch(`${API_BASE}/webhooks/list?${params}`, {
    method: 'GET',
    headers: getHeaders()
  });

  if (!resp.ok) {
    throw new Error(`BullsPay error ${resp.status}`);
  }

  const data = await resp.json();
  return {
    success: data.success,
    webhooks: data.data?.webhooks || [],
    pagination: data.data?.pagination || {}
  };
}

export async function createWebhook({ url, sendTransactionEvent = true, sendWithdrawEvent = false }) {
  ensureEnv();

  const payload = {
    url,
    send_transaction_event: sendTransactionEvent,
    send_withdraw_event: sendWithdrawEvent
  };

  const resp = await fetch(`${API_BASE}/webhooks/create`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => 'Erro desconhecido');
    throw new Error(`BullsPay error ${resp.status}: ${errorText}`);
  }

  const data = await resp.json();
  return data;
}

export async function deleteWebhook(unicId) {
  ensureEnv();

  const resp = await fetch(`${API_BASE}/webhooks/${unicId}`, {
    method: 'DELETE',
    headers: getHeaders()
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => 'Erro desconhecido');
    throw new Error(`BullsPay error ${resp.status}: ${errorText}`);
  }

  const data = await resp.json();
  return data;
}
