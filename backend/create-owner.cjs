require('dotenv').config();

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const username = String(process.env.OWNER_USERNAME || '').trim().toLowerCase();
const password = String(process.env.OWNER_PASSWORD || '');
const fullName = String(process.env.OWNER_NAME || 'System Owner').trim();

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be configured.');
if (!/^[a-zA-Z0-9._-]{3,80}$/.test(username)) throw new Error('OWNER_USERNAME must be 3-80 letters, numbers, dots, underscores, or hyphens.');
if (password.length < 12 || password.length > 200) throw new Error('OWNER_PASSWORD must be at least 12 characters.');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function createOwner() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query(
      "SELECT id FROM users WHERE account_type = 'system_owner' LIMIT 1"
    );
    if (exists.rowCount) throw new Error('A System Owner already exists. Refusing to create another.');
    const passwordHash = await bcrypt.hash(password, 12);
    await client.query(
      `INSERT INTO users (full_name, username, password_hash, account_type)
       VALUES ($1, $2, $3, 'system_owner')`,
      [fullName, username, passwordHash]
    );
    await client.query('COMMIT');
    console.log(`System Owner account created for ${username}.`);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') throw new Error('That username is already in use.');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

createOwner().catch(error => {
  console.error('Could not create System Owner:', error.message);
  process.exitCode = 1;
});
