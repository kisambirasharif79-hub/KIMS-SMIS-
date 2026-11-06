require('dotenv').config();
const mysql = require('mysql2/promise');

const fs = require('node:fs');
const path = require('node:path');

const dbName = process.env.DB_NAME || 'KIMS_db';

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: dbName,
 ssl: process.env.DB_SSL === 'true'
  ? {
      ca: fs.readFileSync(path.join(__dirname, '..', 'ca.pem')),
      rejectUnauthorized: true
    }
  : undefined,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
  queueLimit: 0,
  charset: 'utf8mb4'
});

function prepareQuery(sql, params = []) {
  let query = sql;
  let values = params;
  let extraValues = [];
  if (/ANY\s*\(\s*\$2::text\[\]\s*\)/i.test(query)) {
    const permissionIds = Array.isArray(params[1]) ? params[1] : [];
    query = query.replace(/id\s*=\s*ANY\s*\(\s*\$2::text\[\]\s*\)/i,
      permissionIds.length ? `id IN (${permissionIds.map(() => '?').join(', ')})` : '1 = 0');
    values = [params[0]];
    extraValues = permissionIds;
  }

  query = query
    .replace(/::jsonb/gi, '')
    .replace(/::text\[\]/gi, '')
    .replace(/\bjsonb_agg\s*\(/gi, 'JSON_ARRAYAGG(')
    .replace(/\bjsonb_build_object\s*\(/gi, 'JSON_OBJECT(')
    .replace(/now\(\)\s*\+\s*interval\s*'1 hour'/gi, 'DATE_ADD(NOW(), INTERVAL 1 HOUR)')
    .replace(/now\(\)\s*-\s*interval\s*'30 days'/gi, 'DATE_SUB(NOW(), INTERVAL 30 DAY)');

  const orderedValues = [];
  query = query.replace(/\$(\d+)/g, (placeholder, number) => {
    const index = Number(number) - 1;
    if (index < 0 || index >= values.length) {
      throw new Error(`SQL placeholder ${placeholder} has no matching value.`);
    }
    orderedValues.push(values[index]);
    return '?';
  });

  return { sql: query, params: [...orderedValues, ...extraValues] };
}

function parseJsonColumns(rows) {
  for (const row of rows) {
    for (const key of ['data', 'users']) {
      if (typeof row[key] === 'string') {
        try {
          row[key] = JSON.parse(row[key]);
        } catch {
          throw new Error(`Database returned invalid JSON in the ${key} column.`);
        }
      }
    }
  }
  return rows;
}

function wrapConnection(connection) {
  return {
    async query(sql, params = []) {
      const prepared = prepareQuery(sql, params);
      try {
        const [result] = await connection.query(prepared.sql, prepared.params);
        const rows = Array.isArray(result) ? parseJsonColumns(result) : [];
        return {
          rows,
          rowCount: Array.isArray(result) ? rows.length : result.affectedRows || 0,
          insertId: Array.isArray(result) ? undefined : result.insertId
        };
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') error.code = '23505';
        throw error;
      }
    },
    release() {
      connection.release();
    }
  };
}

module.exports = {
  async query(sql, params = []) {
    const prepared = prepareQuery(sql, params);
    try {
      const [result] = await pool.query(prepared.sql, prepared.params);
      const rows = Array.isArray(result) ? parseJsonColumns(result) : [];
      return {
        rows,
        rowCount: Array.isArray(result) ? rows.length : result.affectedRows || 0,
        insertId: Array.isArray(result) ? undefined : result.insertId
      };
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') error.code = '23505';
      throw error;
    }
  },
  async connect() {
    return wrapConnection(await pool.getConnection());
  },
  end() {
    return pool.end();
  }
};
