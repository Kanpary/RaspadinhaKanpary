import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, pool, getSetting, setSetting } from './db.js';
import { registerUser, loginUser, getUserById, updateUserBalance, updateRollover, applyFirstDepositRollover } from './auth.js';
import { authMiddleware, adminMiddleware, errorHandler } from './middleware.js';
import { playScratchCard, ALLOWED_BETS } from './gameEngine.js';
import * as BullsPay from './bullspay.js';
import { isValidWebhookSource } from './bullspay.js';
import { checkUserFraud, getFraudAlerts, resolveFraudAlert } from './fraud.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middlewares
app.use(cors({
  origin: process.env.FRONTEND_URL || true,
  credentials: true
}));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'web')));

// ========== AUTENTICAÇÃO ==========

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000
};

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { username, email, password, cpf } = req.body;
    const result = await registerUser({ username, email, password, cpf });
    
    res.cookie('token', result.token, cookieOptions);
    res.json({ success: true, user: result.user });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await loginUser({ email, password });
    
    res.cookie('token', result.token, cookieOptions);
    res.json({ success: true, user: result.user });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/profile', authMiddleware, async (req, res, next) => {
  try {
    const user = await getUserById(req.user.userId);
    res.json({ success: true, user });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  });
  res.json({ success: true, message: 'Logout realizado com sucesso' });
});

// ========== WALLET ==========

app.get('/api/wallet/balance', authMiddleware, async (req, res, next) => {
  try {
    const user = await getUserById(req.user.userId);
    res.json({ 
      success: true, 
      balance: user.balance,
      rollover_required: user.rollover_required || 0
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/wallet/transactions', authMiddleware, async (req, res, next) => {
  try {
    const { limit = 20 } = req.query;
    
    const result = await pool.query(
      `SELECT id, type, amount, status, created_at 
       FROM transactions 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [req.user.userId, parseInt(limit)]
    );
    
    res.json({ success: true, transactions: result.rows });
  } catch (error) {
    next(error);
  }
});

// ========== DEPÓSITOS ==========

app.post('/api/deposit/create', authMiddleware, async (req, res, next) => {
  try {
    const { amount } = req.body;
    const user = await getUserById(req.user.userId);
    
    if (!amount || amount < 6) {
      return res.status(400).json({ error: 'Valor mínimo de depósito é R$ 6,00' });
    }

    // Criar transação na BullsPay
    const transaction = await BullsPay.createTransaction({
      amount: parseFloat(amount),
      buyerName: user.username,
      buyerEmail: user.email,
      buyerDocument: user.cpf,
      buyerPhone: '',
      externalId: `dep_${user.id}_${Date.now()}`
    });

    // Calcular expiração (5 minutos a partir de agora)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Salvar no banco de dados
    const result = await pool.query(
      `INSERT INTO transactions (user_id, type, amount, status, gateway_id, gateway_data, pix_qr_code, pix_qr_code_base64, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        user.id,
        'deposit',
        amount,
        transaction.status,
        transaction.unic_id,
        JSON.stringify(transaction.raw),
        transaction.qr_code_text,
        transaction.qr_code_base64,
        expiresAt
      ]
    );

    res.json({
      success: true,
      transaction: result.rows[0],
      qr_code: transaction.qr_code_text,
      qr_code_base64: transaction.qr_code_base64,
      payment_url: transaction.payment_url,
      expires_at: expiresAt
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/deposit/check/:transactionId', authMiddleware, async (req, res, next) => {
  try {
    const { transactionId } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM transactions WHERE id = $1 AND user_id = $2',
      [transactionId, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }

    const transaction = result.rows[0];
    
    // Verificar se expirou (5 minutos)
    if (transaction.expires_at && new Date() > new Date(transaction.expires_at) && transaction.status === 'pending') {
      await pool.query(
        'UPDATE transactions SET status = $1, updated_at = NOW() WHERE id = $2',
        ['expired', transaction.id]
      );
      transaction.status = 'expired';
      return res.json({ success: true, status: 'expired', transaction, message: 'Depósito expirado' });
    }
    
    // Se já foi pago ou expirou, retornar status
    if (['paid', 'expired'].includes(transaction.status)) {
      return res.json({ success: true, status: transaction.status, transaction });
    }

    // Verificar status na BullsPay
    const bullsPayTransactions = await BullsPay.listTransactions({ id: transaction.gateway_id, limit: 1 });
    
    if (bullsPayTransactions.transactions.length > 0) {
      const bullsPayTx = bullsPayTransactions.transactions[0];
      
      // Se o status mudou, atualizar no banco
      if (bullsPayTx.status !== transaction.status) {
        await pool.query(
          'UPDATE transactions SET status = $1, gateway_data = $2, updated_at = NOW() WHERE id = $3',
          [bullsPayTx.status, JSON.stringify(bullsPayTx), transaction.id]
        );

        // Se foi pago, creditar saldo
        if (bullsPayTx.status === 'paid') {
          await updateUserBalance(req.user.userId, transaction.amount, 'add');
          
          // Aplicar rollover de forma atômica apenas se for o primeiro depósito
          const rolloverApplied = await applyFirstDepositRollover(req.user.userId, transaction.amount);
          
          if (rolloverApplied) {
            console.log(`Primeiro depósito! Rollover de R$ ${transaction.amount} aplicado para usuário ${req.user.userId}`);
          }
        }

        transaction.status = bullsPayTx.status;
      }
    }

    res.json({ success: true, status: transaction.status, transaction });
  } catch (error) {
    next(error);
  }
});

// ========== SAQUES ==========

app.post('/api/withdrawal/create', authMiddleware, async (req, res, next) => {
  try {
    let { amount, pixKeyType, pixKey } = req.body;
    const user = await getUserById(req.user.userId);
    
    if (!amount || amount < 10) {
      return res.status(400).json({ error: 'Valor mínimo de saque é R$ 10,00' });
    }

    if (user.balance < amount) {
      return res.status(400).json({ error: 'Saldo insuficiente' });
    }

    if (user.rollover_required > 0) {
      return res.status(400).json({ 
        error: `Você precisa apostar mais R$ ${user.rollover_required.toFixed(2)} antes de sacar. Complete o rollover jogando!` 
      });
    }

    // Auto-preencher chave PIX se não fornecida
    if (!pixKey || pixKey.trim() === '') {
      if (pixKeyType === 'cpf') {
        pixKey = user.cpf;
      } else if (pixKeyType === 'email') {
        pixKey = user.email;
      }
    }

    if (!pixKey) {
      return res.status(400).json({ error: 'Chave PIX é obrigatória' });
    }

    // Verificar fraude antes de permitir saque
    const fraudCheck = await checkUserFraud(user.id);
    
    // Deduzir saldo
    await updateUserBalance(user.id, amount, 'subtract');

    // Salvar no banco de dados com status pending_approval (aguardando aprovação manual)
    const result = await pool.query(
      `INSERT INTO transactions (user_id, type, amount, status, pix_key_type, pix_key, admin_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        user.id,
        'withdrawal',
        amount,
        'pending_approval',
        pixKeyType,
        pixKey,
        fraudCheck.riskScore > 50 ? `Alto risco de fraude (Score: ${fraudCheck.riskScore})` : null
      ]
    );

    res.json({ 
      success: true, 
      transaction: result.rows[0],
      message: 'Saque em análise. Você será notificado quando for aprovado.'
    });
  } catch (error) {
    // Se falhar, devolver o saldo
    if (req.user?.userId && amount) {
      try {
        await updateUserBalance(req.user.userId, amount, 'add');
      } catch (rollbackError) {
        console.error('Erro ao devolver saldo:', rollbackError);
      }
    }
    next(error);
  }
});

app.get('/api/withdrawal/check/:transactionId', authMiddleware, async (req, res, next) => {
  try {
    const { transactionId } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM transactions WHERE id = $1 AND user_id = $2',
      [transactionId, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }

    const transaction = result.rows[0];
    
    // Se já foi pago ou falhou, retornar status
    if (['paid', 'failed', 'canceled'].includes(transaction.status)) {
      return res.json({ success: true, status: transaction.status, transaction });
    }

    // Verificar status na BullsPay
    const bullsPayWithdrawals = await BullsPay.listWithdrawals({ id: transaction.gateway_id, limit: 1 });
    
    if (bullsPayWithdrawals.withdrawals.length > 0) {
      const bullsPayWd = bullsPayWithdrawals.withdrawals[0];
      
      // Se o status mudou, atualizar no banco
      if (bullsPayWd.status !== transaction.status) {
        await pool.query(
          'UPDATE transactions SET status = $1, gateway_data = $2, updated_at = NOW() WHERE id = $3',
          [bullsPayWd.status, JSON.stringify(bullsPayWd), transaction.id]
        );

        // Se falhou ou foi cancelado, devolver saldo
        if (['failed', 'canceled'].includes(bullsPayWd.status)) {
          await updateUserBalance(req.user.userId, transaction.amount, 'add');
        }

        transaction.status = bullsPayWd.status;
      }
    }

    res.json({ success: true, status: transaction.status, transaction });
  } catch (error) {
    next(error);
  }
});

// ========== JOGO (RASPADINHA) ==========

app.post('/api/game/scratch', authMiddleware, async (req, res, next) => {
  try {
    const { betAmount } = req.body;
    const betValue = parseFloat(betAmount);
    
    if (!betAmount || !ALLOWED_BETS.includes(parseFloat(betValue.toFixed(2)))) {
      return res.status(400).json({ 
        error: 'Valor de aposta inválido',
        allowed_bets: ALLOWED_BETS
      });
    }

    const result = await playScratchCard(req.user.userId, betValue);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/game/history', authMiddleware, async (req, res, next) => {
  try {
    const { limit = 20 } = req.query;
    
    const result = await pool.query(
      `SELECT id, game_type, bet_amount, prize_amount, multiplier, created_at 
       FROM game_rounds 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [req.user.userId, parseInt(limit)]
    );
    
    res.json({ success: true, rounds: result.rows });
  } catch (error) {
    next(error);
  }
});

// ========== ADMIN ==========

app.get('/api/admin/rtp', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const rtp = await getSetting('rtp_percentage');
    res.json({ success: true, rtp_percentage: parseFloat(rtp) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/rtp', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { rtp_percentage } = req.body;
    
    if (!rtp_percentage || rtp_percentage < 50 || rtp_percentage > 99) {
      return res.status(400).json({ error: 'RTP deve estar entre 50% e 99%' });
    }

    await setSetting('rtp_percentage', rtp_percentage.toString(), 'Return to Player percentage for scratch cards');
    res.json({ success: true, rtp_percentage });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/transactions', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { status = 'all', limit = 50 } = req.query;
    
    let query = `
      SELECT t.*, u.username, u.email 
      FROM transactions t
      JOIN users u ON t.user_id = u.id
    `;
    
    const params = [];
    
    if (status !== 'all') {
      query += ' WHERE t.status = $1';
      params.push(status);
    }
    
    query += ` ORDER BY t.created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));
    
    const result = await pool.query(query, params);
    
    res.json({ success: true, transactions: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/refund/:transactionId', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { transactionId } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM transactions WHERE id = $1',
      [transactionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }

    const transaction = result.rows[0];
    
    if (transaction.type !== 'deposit' || transaction.status !== 'paid') {
      return res.status(400).json({ error: 'Apenas depósitos pagos podem ser reembolsados' });
    }

    // Reembolsar na BullsPay
    await BullsPay.refundTransaction(transaction.gateway_id);

    // Atualizar status no banco
    await pool.query(
      'UPDATE transactions SET status = $1, updated_at = NOW() WHERE id = $2',
      ['refunded', transactionId]
    );

    // Deduzir saldo do usuário
    await updateUserBalance(transaction.user_id, transaction.amount, 'subtract');

    res.json({ success: true, message: 'Transação reembolsada com sucesso' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/bullspay/balance', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const balance = await BullsPay.getBalance();
    res.json(balance);
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/bullspay/transactions', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status = 'all' } = req.query;
    const result = await BullsPay.listTransactions({ 
      page: parseInt(page), 
      limit: parseInt(limit), 
      status 
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/bullspay/withdrawals', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status = 'all' } = req.query;
    const result = await BullsPay.listWithdrawals({ 
      page: parseInt(page), 
      limit: parseInt(limit), 
      status 
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Listar todos os usuários cadastrados
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { limit = 100 } = req.query;
    
    const result = await pool.query(
      `SELECT id, username, email, cpf, balance, rollover_required, first_deposit_made, is_admin, created_at
       FROM users
       ORDER BY created_at DESC
       LIMIT $1`,
      [parseInt(limit)]
    );
    
    res.json({ success: true, users: result.rows });
  } catch (error) {
    next(error);
  }
});

// Aprovar saque
app.post('/api/admin/withdrawal/approve/:id', authMiddleware, adminMiddleware, async (req, res, next) => {
  let transactionData = null;
  
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM transactions WHERE id = $1 AND type = $2',
      [id, 'withdrawal']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Saque não encontrado' });
    }

    transactionData = result.rows[0];
    
    if (transactionData.status !== 'pending_approval') {
      return res.status(400).json({ error: 'Apenas saques pendentes podem ser aprovados' });
    }

    // Verificar saldo BullsPay antes de aprovar o saque
    const bullspayBalance = await BullsPay.getBalance();
    const requiredAmount = Math.round(parseFloat(transactionData.amount) * 100); // Em centavos
    
    if (bullspayBalance.available_balance < requiredAmount) {
      return res.status(400).json({ 
        error: `Saldo insuficiente na BullsPay. Disponível: R$ ${(bullspayBalance.available_balance / 100).toFixed(2)}, Necessário: R$ ${(requiredAmount / 100).toFixed(2)}` 
      });
    }

    // Criar saque na BullsPay agora
    const withdrawal = await BullsPay.requestWithdrawal({
      amount: parseFloat(transactionData.amount),
      pixKeyType: transactionData.pix_key_type,
      pixKey: transactionData.pix_key
    });

    // Atualizar transação com dados da BullsPay
    await pool.query(
      'UPDATE transactions SET status = $1, gateway_id = $2, gateway_data = $3, admin_notes = $4, updated_at = NOW() WHERE id = $5',
      ['approved', withdrawal.unic_id, JSON.stringify(withdrawal.raw), 'Aprovado pelo admin', id]
    );

    res.json({ success: true, message: 'Saque aprovado e processado com sucesso' });
  } catch (error) {
    // Se falhar, devolver saldo ao usuário
    if (transactionData) {
      try {
        await updateUserBalance(transactionData.user_id, transactionData.amount, 'add');
        await pool.query(
          'UPDATE transactions SET status = $1, admin_notes = $2 WHERE id = $3',
          ['failed', 'Falha ao processar na BullsPay: ' + error.message, transactionData.id]
        );
      } catch (rollbackError) {
        console.error('Erro ao reverter saque:', rollbackError);
      }
    }
    next(error);
  }
});

// Rejeitar saque
app.post('/api/admin/withdrawal/reject/:id', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const result = await pool.query(
      'SELECT * FROM transactions WHERE id = $1 AND type = $2',
      [id, 'withdrawal']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Saque não encontrado' });
    }

    const transaction = result.rows[0];
    
    if (transaction.status !== 'pending_approval') {
      return res.status(400).json({ error: 'Apenas saques pendentes podem ser rejeitados' });
    }

    // Devolver saldo ao usuário
    await updateUserBalance(transaction.user_id, transaction.amount, 'add');

    // Atualizar status para rejeitado
    await pool.query(
      'UPDATE transactions SET status = $1, admin_notes = $2, updated_at = NOW() WHERE id = $3',
      ['rejected', reason || 'Rejeitado pelo admin', id]
    );

    res.json({ success: true, message: 'Saque rejeitado e saldo devolvido ao usuário' });
  } catch (error) {
    next(error);
  }
});

// Listar alertas de fraude
app.get('/api/admin/fraud-alerts', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { limit = 50, resolved = 'false' } = req.query;
    const isResolved = resolved === 'true';
    
    const alerts = await getFraudAlerts(parseInt(limit), isResolved);
    res.json({ success: true, alerts });
  } catch (error) {
    next(error);
  }
});

// Resolver alerta de fraude
app.post('/api/admin/fraud-alert/resolve/:id', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    const alert = await resolveFraudAlert(id, req.user.userId);
    res.json({ success: true, alert, message: 'Alerta de fraude resolvido' });
  } catch (error) {
    next(error);
  }
});

// ========== WEBHOOKS MANAGEMENT ==========

// Listar webhooks da BullsPay
app.get('/api/admin/webhooks/list', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const result = await BullsPay.listWebhooks({ 
      page: parseInt(page), 
      limit: parseInt(limit)
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Criar webhook
app.post('/api/admin/webhooks/create', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { url, sendTransactionEvent = true, sendWithdrawEvent = false } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL do webhook é obrigatória' });
    }
    
    const result = await BullsPay.createWebhook({
      url,
      sendTransactionEvent,
      sendWithdrawEvent
    });
    
    res.json({ success: true, data: result, message: 'Webhook criado com sucesso' });
  } catch (error) {
    next(error);
  }
});

// Deletar webhook
app.delete('/api/admin/webhooks/delete/:webhookId', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { webhookId } = req.params;
    const result = await BullsPay.deleteWebhook(webhookId);
    res.json({ success: true, data: result, message: 'Webhook deletado com sucesso' });
  } catch (error) {
    next(error);
  }
});

// ========== WEBHOOKS ==========

app.post('/webhook/bullspay', async (req, res) => {
  try {
    console.log('Webhook BullsPay recebido:', JSON.stringify(req.body, null, 2));
    
    if (!isValidWebhookSource(req)) {
      console.error('Webhook não autenticado - header X-API-Key inválido ou ausente');
      return res.status(401).json({ error: 'Unauthorized - Invalid API key' });
    }
    
    const data = req.body.data;
    
    if (!data || !data.unic_id) {
      return res.json({ ok: true });
    }

    const result = await pool.query(
      'SELECT * FROM transactions WHERE gateway_id = $1',
      [data.unic_id]
    );

    if (result.rows.length === 0) {
      console.log('Transação não encontrada:', data.unic_id);
      return res.json({ ok: true });
    }

    const transaction = result.rows[0];
    const newStatus = data.status;

    await pool.query(
      'UPDATE transactions SET status = $1, gateway_data = $2, updated_at = NOW() WHERE id = $3',
      [newStatus, JSON.stringify(data), transaction.id]
    );

    if (transaction.type === 'deposit' && newStatus === 'paid' && transaction.status !== 'paid') {
      await updateUserBalance(transaction.user_id, transaction.amount, 'add');
      
      // Aplicar rollover de forma atômica apenas se for o primeiro depósito
      const rolloverApplied = await applyFirstDepositRollover(transaction.user_id, transaction.amount);
      
      if (rolloverApplied) {
        console.log(`Webhook: Primeiro depósito! Rollover de R$ ${transaction.amount} aplicado`);
      }
      
      console.log(`Saldo creditado para usuário ${transaction.user_id}: R$ ${transaction.amount}`);
    }

    if (transaction.type === 'withdrawal' && ['failed', 'canceled'].includes(newStatus) && !['failed', 'canceled'].includes(transaction.status)) {
      await updateUserBalance(transaction.user_id, transaction.amount, 'add');
      console.log(`Saldo devolvido para usuário ${transaction.user_id}: R$ ${transaction.amount}`);
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Erro no webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== ROTAS ESTÁTICAS ==========

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'index.html'));
});

// Error handler
app.use(errorHandler);

// Inicializar servidor
async function startServer() {
  try {
    // Inicializar banco de dados
    if (process.env.DATABASE_URL) {
      await initDatabase();
      console.log('✅ Database connected');
    } else {
      console.warn('⚠️  DATABASE_URL not configured. Please create a PostgreSQL database.');
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
