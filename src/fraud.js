import { pool } from './db.js';

export async function createFraudAlert(userId, alertType, severity, description, metadata = {}) {
  try {
    const result = await pool.query(
      `INSERT INTO fraud_alerts (user_id, alert_type, severity, description, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, alertType, severity, description, JSON.stringify(metadata)]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Erro ao criar alerta de fraude:', error);
    throw error;
  }
}

export async function checkUserFraud(userId) {
  const alerts = [];
  
  try {
    const user = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    
    if (user.rows.length === 0) {
      return { alerts, riskScore: 0 };
    }

    const userData = user.rows[0];
    let riskScore = 0;

    // 1. Múltiplas contas com mesmo CPF
    const duplicateCPF = await pool.query(
      'SELECT COUNT(*) as count FROM users WHERE cpf = $1',
      [userData.cpf]
    );
    
    if (parseInt(duplicateCPF.rows[0].count) > 1) {
      riskScore += 30;
      alerts.push({
        type: 'multiple_accounts_same_cpf',
        severity: 'high',
        description: `Múltiplas contas com o mesmo CPF detectadas`
      });
      await createFraudAlert(userId, 'multiple_accounts_same_cpf', 'high', 
        `Múltiplas contas detectadas com CPF: ${userData.cpf}`);
    }

    // 2. Padrão suspeito de apostas (sempre ganha ou sempre perde)
    const gameStats = await pool.query(
      `SELECT 
        COUNT(*) as total_games,
        SUM(CASE WHEN prize_amount > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN prize_amount = 0 THEN 1 ELSE 0 END) as losses,
        AVG(prize_amount) as avg_prize,
        MAX(prize_amount) as max_prize
       FROM game_rounds 
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '7 days'`,
      [userId]
    );

    const stats = gameStats.rows[0];
    if (parseInt(stats.total_games) > 20) {
      const winRate = parseInt(stats.wins) / parseInt(stats.total_games);
      
      if (winRate > 0.85) {
        riskScore += 50;
        alerts.push({
          type: 'suspicious_win_rate',
          severity: 'critical',
          description: `Taxa de vitória suspeita: ${(winRate * 100).toFixed(1)}%`
        });
        await createFraudAlert(userId, 'suspicious_win_rate', 'critical',
          `Taxa de vitória de ${(winRate * 100).toFixed(1)}% em ${stats.total_games} jogos`);
      }
    }

    // 3. Depósitos e saques muito rápidos (< 5 minutos)
    const quickWithdrawal = await pool.query(
      `SELECT t1.id, t1.created_at as deposit_time, t2.created_at as withdrawal_time,
              EXTRACT(EPOCH FROM (t2.created_at - t1.created_at)) / 60 as minutes_diff
       FROM transactions t1
       JOIN transactions t2 ON t2.user_id = t1.user_id
       WHERE t1.user_id = $1 
         AND t1.type = 'deposit' 
         AND t1.status = 'paid'
         AND t2.type = 'withdrawal'
         AND t2.created_at > t1.created_at
         AND EXTRACT(EPOCH FROM (t2.created_at - t1.created_at)) < 300
       ORDER BY t1.created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (quickWithdrawal.rows.length > 0) {
      riskScore += 40;
      const diff = quickWithdrawal.rows[0].minutes_diff;
      alerts.push({
        type: 'quick_withdrawal',
        severity: 'high',
        description: `Saque ${diff.toFixed(1)} minutos após depósito`
      });
      await createFraudAlert(userId, 'quick_withdrawal', 'high',
        `Tentativa de saque ${diff.toFixed(1)} minutos após depósito`);
    }

    // 4. Múltiplos depósitos falhados seguidos
    const failedDeposits = await pool.query(
      `SELECT COUNT(*) as count
       FROM transactions
       WHERE user_id = $1 
         AND type = 'deposit'
         AND status = 'failed'
         AND created_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    );

    if (parseInt(failedDeposits.rows[0].count) > 5) {
      riskScore += 20;
      alerts.push({
        type: 'multiple_failed_deposits',
        severity: 'medium',
        description: `${failedDeposits.rows[0].count} depósitos falhados em 24h`
      });
      await createFraudAlert(userId, 'multiple_failed_deposits', 'medium',
        `${failedDeposits.rows[0].count} tentativas de depósito falhadas nas últimas 24h`);
    }

    // 5. Horários suspeitos (madrugada - 2am to 5am)
    const suspiciousHours = await pool.query(
      `SELECT COUNT(*) as count
       FROM game_rounds
       WHERE user_id = $1
         AND EXTRACT(HOUR FROM created_at) BETWEEN 2 AND 5
         AND created_at > NOW() - INTERVAL '7 days'`,
      [userId]
    );

    if (parseInt(suspiciousHours.rows[0].count) > 50) {
      riskScore += 15;
      alerts.push({
        type: 'suspicious_hours',
        severity: 'low',
        description: `${suspiciousHours.rows[0].count} jogos em horário suspeito (2-5 AM)`
      });
    }

    // 6. Valor de apostas inconsistente (aposta muito alta vs saldo)
    const highBets = await pool.query(
      `SELECT COUNT(*) as count, MAX(bet_amount) as max_bet
       FROM game_rounds
       WHERE user_id = $1
         AND bet_amount > $2 * 0.5
         AND created_at > NOW() - INTERVAL '1 day'`,
      [userId, userData.balance]
    );

    if (parseInt(highBets.rows[0].count) > 0 && userData.balance < 100) {
      riskScore += 25;
      alerts.push({
        type: 'high_stakes_low_balance',
        severity: 'medium',
        description: `Apostas altas (R$ ${highBets.rows[0].max_bet}) com saldo baixo`
      });
    }

    // 7. Tentativas de saque sem cumprir rollover
    const rolloverBypass = await pool.query(
      `SELECT COUNT(*) as count
       FROM transactions
       WHERE user_id = $1
         AND type = 'withdrawal'
         AND status IN ('failed', 'canceled')
         AND created_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    );

    if (parseInt(rolloverBypass.rows[0].count) > 3) {
      riskScore += 20;
      alerts.push({
        type: 'rollover_bypass_attempts',
        severity: 'medium',
        description: `${rolloverBypass.rows[0].count} tentativas de saque recusadas em 24h`
      });
    }

    return { alerts, riskScore };
  } catch (error) {
    console.error('Erro ao verificar fraude:', error);
    return { alerts: [], riskScore: 0 };
  }
}

export async function getFraudAlerts(limit = 50, resolved = false) {
  try {
    const result = await pool.query(
      `SELECT f.*, u.username, u.email, u.cpf
       FROM fraud_alerts f
       JOIN users u ON f.user_id = u.id
       WHERE f.resolved = $1
       ORDER BY f.created_at DESC
       LIMIT $2`,
      [resolved, limit]
    );
    return result.rows;
  } catch (error) {
    console.error('Erro ao buscar alertas de fraude:', error);
    throw error;
  }
}

export async function resolveFraudAlert(alertId, adminUserId) {
  try {
    const result = await pool.query(
      `UPDATE fraud_alerts 
       SET resolved = true, resolved_by = $1, resolved_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [adminUserId, alertId]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Erro ao resolver alerta de fraude:', error);
    throw error;
  }
}
