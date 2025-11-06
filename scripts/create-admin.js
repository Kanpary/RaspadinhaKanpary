import bcrypt from 'bcrypt';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const SALT_ROUNDS = 10;

async function createAdmin() {
  try {
    const adminData = {
      username: 'admin',
      email: process.env.ADMIN_EMAIL || 'admin@kr.com',
      password: process.env.ADMIN_PASSWORD || 'Admin@123',
      cpf: '00000000000',
    };

    const existingAdmin = await pool.query('SELECT id FROM users WHERE email = $1', [adminData.email]);
    
    const passwordHash = await bcrypt.hash(adminData.password, SALT_ROUNDS);

    if (existingAdmin.rows.length > 0) {
      await pool.query(
        `UPDATE users SET password_hash = $1, username = $2, is_admin = true WHERE email = $3`,
        [passwordHash, adminData.username, adminData.email]
      );
      console.log('✓ Credenciais do admin atualizadas com sucesso!');
    } else {
      await pool.query(
        `INSERT INTO users (username, email, password_hash, cpf, balance, is_admin, rollover_required) 
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [adminData.username, adminData.email, passwordHash, adminData.cpf, 0, true, 0]
      );
      console.log('✓ Usuário admin criado com sucesso!');
    }

    console.log('');
    console.log('Credenciais de acesso:');
    console.log('Email:', adminData.email);
    console.log('');
    console.log('IMPORTANTE: Mantenha suas credenciais seguras!');
  } catch (error) {
    console.error('Erro ao criar admin:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createAdmin();
