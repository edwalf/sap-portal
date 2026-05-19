// config/db.js
const sql = require('mssql');

const config = {
  server:   process.env.DB_SERVER   || 'localhost',
  database: process.env.DB_NAME     || 'SBO_CIA',
  port:     parseInt(process.env.DB_PORT) || 1433,
  user:     process.env.DB_USER     || 'sa',
  password: process.env.DB_PASSWORD || '',
  options: {
    trustServerCertificate: true,
    enableArithAbort: true,
    encrypt: false,
  },
  pool: {
    max: 10,
    min: 2,
    idleTimeoutMillis: 30000,
  },
  connectionTimeout: 15000,
  requestTimeout:    30000,
};

let pool = null;

async function getPool() {
  if (pool && pool.connected) return pool;
  try {
    pool = await sql.connect(config);
    console.log(`[DB] Conectado a SQL Server — ${config.server}/${config.database}`);
    return pool;
  } catch (err) {
    console.error('[DB] Error de conexión:', err.message);
    throw err;
  }
}

async function query(queryStr, params = {}) {
  const p = await getPool();
  const req = p.request();
  Object.entries(params).forEach(([key, { type, value }]) => {
    req.input(key, type, value);
  });
  return req.query(queryStr);
}

async function testConnection() {
  const p = await getPool();
  const res = await p.request().query(
    'SELECT @@SERVERNAME AS server, DB_NAME() AS db'
  );
  return res.recordset[0];
}

module.exports = { sql, getPool, query, testConnection };
