import { initDatabase } from '../src/db.js';
import bcrypt from 'bcrypt';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const sslConfig = () => {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('localhost')) {
    return false;
  }
  return {
    rejectUnauthorized: false
  };
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig()
});

const SALT_ROUNDS = 10;

async function initSystem() {
  try {
    console.log('🚀 Iniciando sistema RaspadinhaKanpary...\n');

    // 1. Inicializar banco de dados
    console.log('📊 Inicializando banco de dados...');
    await initDatabase();
    console.log('✅ Banco de dados inicializado!\n');

    // 2. Criar conta admin
    console.log('👤 Criando conta de administrador...');
    const adminData = {
      username: 'admin',
      email: process.env.ADMIN_EMAIL || 'admin@kr.com',
      password: process.env.ADMIN_PASSWORD || 'Admin@123',
      cpf: '00000000000',
    };

    const adminPasswordHash = await bcrypt.hash(adminData.password, SALT_ROUNDS);
    
    const existingAdmin = await pool.query('SELECT id FROM users WHERE email = $1', [adminData.email]);
    
    if (existingAdmin.rows.length > 0) {
      await pool.query(
        'UPDATE users SET password_hash = $1, username = $2, is_admin = true WHERE email = $3',
        [adminPasswordHash, adminData.username, adminData.email]
      );
      console.log('✅ Conta admin atualizada!');
    } else {
      await pool.query(
        `INSERT INTO users (username, email, password_hash, cpf, balance, is_admin, rollover_required) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [adminData.username, adminData.email, adminPasswordHash, adminData.cpf, 0, true, 0]
      );
      console.log('✅ Conta admin criada!');
    }

    // 3. Criar conta de teste
    console.log('\n👥 Criando conta de teste...');
    const testData = {
      username: 'teste500',
      email: 'teste500@example.com',
      password: 'Teste@123',
      cpf: '12345678901',
      balance: 500.00
    };

    const testPasswordHash = await bcrypt.hash(testData.password, SALT_ROUNDS);
    
    const existingTest = await pool.query('SELECT id FROM users WHERE email = $1', [testData.email]);
    
    if (existingTest.rows.length > 0) {
      await pool.query(
        'UPDATE users SET balance = $1, rollover_required = 0, password_hash = $2 WHERE email = $3',
        [testData.balance, testPasswordHash, testData.email]
      );
      console.log('✅ Conta de teste atualizada!');
    } else {
      await pool.query(
        `INSERT INTO users (username, email, password_hash, cpf, balance, rollover_required, first_deposit_made, is_admin) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [testData.username, testData.email, testPasswordHash, testData.cpf, testData.balance, 0, true, false]
      );
      console.log('✅ Conta de teste criada!');
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎉 SISTEMA INICIALIZADO COM SUCESSO!');
    console.log('='.repeat(60));
    console.log('\n📝 CREDENCIAIS DE ACESSO:');
    console.log('\n👑 ADMINISTRADOR:');
    console.log('   Email:    ', adminData.email);
    console.log('   Senha:    ', adminData.password);
    console.log('\n👤 CONTA DE TESTE:');
    console.log('   Email:    ', testData.email);
    console.log('   Senha:    ', testData.password);
    console.log('   Saldo:    ', `R$ ${testData.balance.toFixed(2)}`);
    console.log('   Rollover: ', 'R$ 0,00 (liberado para saque)');
    console.log('\n' + '='.repeat(60));
    console.log('⚠️  GUARDE ESSAS CREDENCIAIS COM SEGURANÇA!');
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('❌ Erro ao inicializar sistema:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initSystem();
