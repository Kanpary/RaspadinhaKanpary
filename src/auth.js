import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const SALT_ROUNDS = 10;

export async function registerUser({ username, email, password, cpf }) {
  if (!username || !email || !password || !cpf) {
    throw new Error('Todos os campos são obrigatórios');
  }

  const cpfClean = cpf.replace(/\D/g, '');
  if (cpfClean.length !== 11) {
    throw new Error('CPF inválido');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Email inválido');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  try {
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, cpf, balance, rollover_required)
       VALUES ($1, $2, $3, $4, 0, 0)
       RETURNING id, username, email, cpf, is_admin, balance, rollover_required, created_at`,
      [username, email, passwordHash, cpfClean]
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email, isAdmin: user.is_admin }, JWT_SECRET, { expiresIn: '7d' });

    return { user, token };
  } catch (error) {
    if (error.code === '23505') {
      if (error.constraint === 'users_username_key') throw new Error('Nome de usuário já existe');
      if (error.constraint === 'users_email_key') throw new Error('Email já cadastrado');
      if (error.constraint === 'users_cpf_key') throw new Error('CPF já cadastrado');
    }
    throw error;
  }
}

export async function loginUser({ email, password }) {
  if (!email || !password) {
    throw new Error('Email e senha são obrigatórios');
  }

  const result = await pool.query(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );

  if (result.rows.length === 0) {
    throw new Error('Credenciais inválidas');
  }

  const user = result.rows[0];
  const isValid = await bcrypt.compare(password, user.password_hash);

  if (!isValid) {
    throw new Error('Credenciais inválidas');
  }

  const token = jwt.sign({ userId: user.id, email: user.email, isAdmin: user.is_admin }, JWT_SECRET, { expiresIn: '7d' });

  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      cpf: user.cpf,
      is_admin: user.is_admin,
      balance: user.balance,
      rollover_required: user.rollover_required,
      first_deposit_made: user.first_deposit_made,
      created_at: user.created_at
    },
    token
  };
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    throw new Error('Token inválido ou expirado');
  }
}

export async function getUserById(userId) {
  const result = await pool.query(
    'SELECT id, username, email, cpf, is_admin, balance, rollover_required, first_deposit_made, created_at FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    throw new Error('Usuário não encontrado');
  }

  return result.rows[0];
}

export async function updateUserBalance(userId, amount, operation = 'add') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      'SELECT balance FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error('Usuário não encontrado');
    }

    const currentBalance = parseFloat(result.rows[0].balance);
    let newBalance;

    if (operation === 'add') {
      newBalance = currentBalance + parseFloat(amount);
    } else if (operation === 'subtract') {
      newBalance = currentBalance - parseFloat(amount);
      if (newBalance < 0) {
        throw new Error('Saldo insuficiente');
      }
    } else {
      throw new Error('Operação inválida');
    }

    await client.query(
      'UPDATE users SET balance = $1 WHERE id = $2',
      [newBalance, userId]
    );

    await client.query('COMMIT');

    return newBalance;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateRollover(userId, amount, operation = 'add') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      'SELECT rollover_required FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error('Usuário não encontrado');
    }

    const currentRollover = parseFloat(result.rows[0].rollover_required);
    let newRollover;

    if (operation === 'add') {
      newRollover = currentRollover + parseFloat(amount);
    } else if (operation === 'subtract') {
      newRollover = Math.max(0, currentRollover - parseFloat(amount));
    } else {
      throw new Error('Operação inválida');
    }

    await client.query(
      'UPDATE users SET rollover_required = $1 WHERE id = $2',
      [newRollover, userId]
    );

    await client.query('COMMIT');

    return newRollover;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function applyFirstDepositRollover(userId, amount) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Atualizar rollover e marcar first_deposit_made APENAS se ainda não foi feito (atômico)
    const result = await client.query(
      `UPDATE users 
       SET rollover_required = rollover_required + $1, 
           first_deposit_made = true
       WHERE id = $2 AND first_deposit_made = false
       RETURNING rollover_required, first_deposit_made`,
      [parseFloat(amount), userId]
    );

    await client.query('COMMIT');

    // Retornar se o rollover foi aplicado (true) ou se já havia sido aplicado antes (false)
    return result.rows.length > 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
