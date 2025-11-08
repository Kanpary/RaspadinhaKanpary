import bcrypt from 'bcrypt';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const SALT_ROUNDS = 10;

async function createTestAccount() {
  try {
    const testData = {
      username: 'teste500',
      email: 'teste500@example.com',
      password: 'Teste@123',
      cpf: '12345678901',
      balance: 500.00
    };

    const passwordHash = await bcrypt.hash(testData.password, SALT_ROUNDS);

    // Verificar se já existe
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [testData.email]);
    
    if (existing.rows.length > 0) {
      // Atualizar saldo
      await pool.query(
        'UPDATE users SET balance = $1, rollover_required = 0 WHERE email = $2',
        [testData.balance, testData.email]
      );
      console.log('✓ Conta de teste atualizada!');
    } else {
      // Criar nova
      await pool.query(
        `INSERT INTO users (username, email, password_hash, cpf, balance, rollover_required, first_deposit_made, is_admin) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [testData.username, testData.email, passwordHash, testData.cpf, testData.balance, 0, true, false]
      );
      console.log('✓ Conta de teste criada com sucesso!');
    }

    console.log('');
    console.log('='.repeat(50));
    console.log('CREDENCIAIS DA CONTA DE TESTE');
    console.log('='.repeat(50));
    console.log('Email:   ', testData.email);
    console.log('Senha:   ', testData.password);
    console.log('Saldo:   ', `R$ ${testData.balance.toFixed(2)}`);
    console.log('Rollover:', 'R$ 0,00 (liberado para saque)');
    console.log('='.repeat(50));
    console.log('');
  } catch (error) {
    console.error('Erro ao criar conta de teste:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createTestAccount();
