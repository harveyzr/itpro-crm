const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'crm.db');

let db = null;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  initSchema();
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function initSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'technician',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS prospects (
      id TEXT PRIMARY KEY,
      company TEXT NOT NULL,
      contact TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      status TEXT DEFAULT 'New Lead',
      value TEXT,
      industry TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      company TEXT NOT NULL,
      contact TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      tier TEXT DEFAULT 'Starter',
      value TEXT,
      industry TEXT,
      start_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      type TEXT,
      date TEXT,
      text TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      subject TEXT NOT NULL,
      priority TEXT DEFAULT 'Medium',
      category TEXT DEFAULT 'Other',
      description TEXT,
      status TEXT DEFAULT 'Open',
      assigned_to TEXT,
      source TEXT DEFAULT 'internal',
      customer_name TEXT,
      customer_email TEXT,
      customer_phone TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ticket_updates (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      status TEXT,
      assigned_to TEXT,
      note TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  saveDb();
}

function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

function get(sql, params = []) {
  const rows = query(sql, params);
  return rows[0] || null;
}

module.exports = { getDb, saveDb, query, run, get };