const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "umhlomunye_offline",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "",
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function testDatabaseConnection() {
  const result = await pool.query("SELECT 1 AS connected");
  return result.rows[0]?.connected === 1;
}

module.exports = {
  pool,
  query,
  testDatabaseConnection,
};