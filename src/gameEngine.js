import { pool, getSetting } from './db.js';

export const ALLOWED_BETS = [0.50, 1.00, 1.50, 2.00, 3.00, 5.00, 10.00, 15.00, 20.00, 25.00, 30.00, 35.00, 40.00, 45.00, 50.00];

/**
 * Calcula o prêmio da raspadinha baseado no RTP configurado
 * Quanto maior a aposta, melhores as chances de ganhar
 * @param {number} betAmount - Valor da aposta
 * @param {number} rtpPercentage - RTP em porcentagem (ex: 95.0)
 * @returns {{multiplier: number, prizeAmount: number}}
 */
export function calculateScratchPrize(betAmount, rtpPercentage = 95.0) {
  const random = Math.random();
  
  // Bônus de probabilidade baseado no valor da aposta
  // Apostas maiores têm chances melhores de ganhar
  let bonusChance = 0;
  if (betAmount >= 50) {
    bonusChance = 0.15; // +15% chance para apostas >= R$50
  } else if (betAmount >= 30) {
    bonusChance = 0.12; // +12% chance para apostas >= R$30
  } else if (betAmount >= 20) {
    bonusChance = 0.09; // +9% chance para apostas >= R$20
  } else if (betAmount >= 10) {
    bonusChance = 0.06; // +6% chance para apostas >= R$10
  } else if (betAmount >= 5) {
    bonusChance = 0.03; // +3% chance para apostas >= R$5
  }
  
  // Tabela de probabilidades ajustada com bônus
  // Base: 2% - 10x, 5% - 5x, 15% - 2x, 28% - 1x, 50% - 0x
  let multiplier = 0;
  
  const threshold1 = 0.02 + bonusChance * 0.15;
  const threshold2 = 0.07 + bonusChance * 0.30;
  const threshold3 = 0.22 + bonusChance * 0.40;
  const threshold4 = 0.50 + bonusChance * 0.15;
  
  if (random < threshold1) {
    multiplier = 10; // Chance aumentada para apostas maiores
  } else if (random < threshold2) {
    multiplier = 5;
  } else if (random < threshold3) {
    multiplier = 2;
  } else if (random < threshold4) {
    multiplier = 1;
  }
  // Restante - perda
  
  // Ajusta o multiplicador baseado no RTP configurado
  const rtpFactor = rtpPercentage / 95.0;
  const adjustedMultiplier = multiplier * rtpFactor;
  
  const prizeAmount = betAmount * adjustedMultiplier;
  
  return {
    multiplier: adjustedMultiplier,
    prizeAmount: Math.round(prizeAmount * 100) / 100
  };
}

/**
 * Executa uma rodada de raspadinha
 * @param {string} userId - ID do usuário
 * @param {number} betAmount - Valor da aposta
 * @returns {Promise<{success: boolean, prize: number, finalBalance: number, multiplier: number}>}
 */
export async function playScratchCard(userId, betAmount) {
  if (!ALLOWED_BETS.includes(parseFloat(betAmount.toFixed(2)))) {
    throw new Error('Valor de aposta inválido. Escolha um dos valores permitidos.');
  }

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Buscar usuário e travar registro
    const userResult = await client.query(
      'SELECT id, balance, rollover_required FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error('Usuário não encontrado');
    }

    const user = userResult.rows[0];
    const currentBalance = parseFloat(user.balance);

    if (currentBalance < betAmount) {
      throw new Error('Saldo insuficiente');
    }

    // Obter RTP configurado
    const rtpString = await getSetting('rtp_percentage');
    const rtpPercentage = rtpString ? parseFloat(rtpString) : 95.0;

    // Calcular prêmio
    const { multiplier, prizeAmount } = calculateScratchPrize(betAmount, rtpPercentage);

    // Atualizar saldo
    const newBalance = currentBalance - betAmount + prizeAmount;
    
    // Reduzir rollover pela aposta realizada
    const currentRollover = parseFloat(user.rollover_required || 0);
    const newRollover = Math.max(0, currentRollover - betAmount);
    
    await client.query(
      'UPDATE users SET balance = $1, rollover_required = $2 WHERE id = $3',
      [newBalance, newRollover, userId]
    );

    // Registrar rodada de jogo
    await client.query(
      `INSERT INTO game_rounds (user_id, game_type, bet_amount, prize_amount, multiplier, result_data)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, 'scratch_card', betAmount, prizeAmount, multiplier, JSON.stringify({ rtp: rtpPercentage })]
    );

    await client.query('COMMIT');

    return {
      success: true,
      prize: prizeAmount,
      finalBalance: newBalance,
      multiplier,
      betAmount
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
