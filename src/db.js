import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Configuração SSL para Render
const sslConfig = () => {
  // Se for localhost (desenvolvimento), não usa SSL
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('localhost')) {
    return false;
  }

  // Em produção (Render), força SSL sem validar certificado
  return {
    rejectUnauthorized: false
  };
};

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig()
});

pool.on('error', (err) => {
  console.error('Erro inesperado no pool de conexões', err);
});

export async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Tabela de usuários
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        cpf VARCHAR(11) UNIQUE NOT NULL,
        balance DECIMAL(12,2) DEFAULT 0 NOT NULL CHECK (balance >= 0),
        rollover_required DECIMAL(12,2) DEFAULT 0 NOT NULL CHECK (rollover_required >= 0),
        first_deposit_made BOOLEAN DEFAULT FALSE,
        is_admin BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Adicionar coluna first_deposit_made se não existir
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS first_deposit_made BOOLEAN DEFAULT FALSE;
      EXCEPTION
        WHEN duplicate_column THEN NULL;
      END $$;
    `);

    // Tabela de transações
    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(20) NOT NULL CHECK (type IN ('deposit', 'withdrawal')),
        amount DECIMAL(12,2) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'canceled', 'chargeback', 'expired', 'pending_approval', 'approved', 'rejected')),
        gateway_id TEXT,
        gateway_data JSONB,
        pix_qr_code TEXT,
        pix_qr_code_base64 TEXT,
        pix_key_type VARCHAR(20),
        pix_key TEXT,
        expires_at TIMESTAMPTZ,
        admin_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Colunas extras
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
        ALTER TABLE transactions ADD COLUMN IF NOT EXISTS admin_notes TEXT;
      EXCEPTION
        WHEN duplicate_column THEN NULL;
      END $$;
    `);

    // Constraint de status
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_status_check;
        ALTER TABLE transactions ADD CONSTRAINT transactions_status_check 
          CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'canceled', 'chargeback', 'expired', 'pending_approval', 'approved', 'rejected'));
      EXCEPTION
        WHEN others THEN NULL;
      END $$;
    `);

    // Índices
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
      CREATE INDEX IF NOT EXISTS idx_transactions_gateway_id ON transactions(gateway_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
    `);

    // Tabela de rodadas de jogo
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_rounds (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        game_type VARCHAR(50) NOT NULL DEFAULT 'scratch_card',
        bet_amount DECIMAL(12,2) NOT NULL,
        prize_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        multiplier DECIMAL(6,2),
        result_data JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_game_rounds_user_id ON game_rounds(user_id);
      CREATE INDEX IF NOT EXISTS idx_game_rounds_created_at ON game_rounds(created_at DESC);
    `);

    // Configurações
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL,
        description TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      INSERT INTO settings (key, value, description)
      VALUES ('rtp_percentage', '95.0', 'Return to Player percentage for scratch cards')
      ON CONFLICT (key) DO NOTHING
    `);

    // Alertas de fraude
    await client.query(`
      CREATE TABLE IF NOT EXISTS fraud_alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        alert_type VARCHAR(50) NOT NULL,
        severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
        description TEXT NOT NULL,
        metadata JSONB,
        resolved BOOLEAN DEFAULT FALSE,
        resolved_by UUID REFERENCES users(id),
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_fraud_alerts_user_id ON fraud_alerts(user_id);
      CREATE INDEX IF NOT EXISTS idx_fraud_alerts_severity ON fraud_alerts(severity);
      CREATE INDEX IF NOT EXISTS idx_fraud_alerts_resolved ON fraud_alerts(resolved);
      CREATE INDEX IF NOT EXISTS idx_fraud_alerts_created_at ON fraud_alerts(created_at DESC);
    `);

    // Função updated_at
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);

    // Triggers
    await client.query(`
      DROP TRIGGER IF EXISTS update_users_updated_at ON users;
      CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_transactions_updated_at ON transactions;
      CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      DROP TRIGGER IF EXISTS update_settings_updated_at ON settings;
      CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    await client.query('COMMIT');
    console.log('✅ Database initialized successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function getSetting(key) {
  const result = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return result.rows[0]?.value || null;
}

export async function setSetting(key, value, description = null) {
  await pool.query(
    `INSERT INTO settings (key, value, description)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = $2, description = COALESCE($3, settings.description)`,
    [key, value, description]
  );
}
