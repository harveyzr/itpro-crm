require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb, get, run } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../crm-frontend')));

// ── Routes ──────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/prospects', require('./routes/prospects'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/tickets',   require('./routes/tickets'));
app.use('/api/search',    require('./routes/search'));

// ── Health check ────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), version: '1.0.0' });
});

// ── API Docs for public ticket endpoint ─────────────────────
app.get('/api/docs/public-ticket', (req, res) => {
  res.json({
    endpoint: 'POST /api/tickets/public/submit',
    description: 'Submit a support ticket from an external app or website',
    authentication: 'Include header: x-api-key: <your-public-api-key>',
    public_api_key: process.env.PUBLIC_API_KEY || 'itpro-public-key-change-me',
    required_fields: { subject: 'string', customer_name: 'string' },
    optional_fields: {
      description: 'string',
      priority: 'Low | Medium | High | Critical',
      category: 'Network Issue | Hardware Failure | Software Bug | Security Incident | User Access | Backup/Recovery | Performance | New Request | Other',
      customer_email: 'string (used to auto-link to existing customer)',
      customer_phone: 'string'
    },
    example_request: {
      method: 'POST',
      url: 'https://yourcrm.com/api/tickets/public/submit',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'itpro-public-key-change-me' },
      body: {
        subject: 'Cannot connect to VPN',
        description: 'Getting error code 800 when trying to connect',
        priority: 'High',
        category: 'Network Issue',
        customer_name: 'John Smith',
        customer_email: 'john@acmecorp.com',
        customer_phone: '555-1234'
      }
    },
    example_response: {
      success: true,
      ticket_id: 'uuid-here',
      message: 'Your support ticket has been submitted. Our team will be in touch shortly.'
    }
  });
});

// ── Catch-all: serve frontend ────────────────────────────────
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../crm-frontend', 'index.html'));
});

// ── Init DB then start server ────────────────────────────────
async function start() {
  await getDb();

  // Create default admin if no users exist
  const existing = get('SELECT id FROM users LIMIT 1');
  if (!existing) {
    const hashed = await bcrypt.hash('admin123', 10);
    run('INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)',
      [uuidv4(), 'Administrator', 'admin@itpro.com', hashed, 'admin']);
    console.log('✅ Default admin created: admin@itpro.com / admin123');
    console.log('⚠️  Please change the default password after first login!');
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 ITPro CRM running at http://localhost:${PORT}`);
    console.log(`📡 Public ticket API: POST http://localhost:${PORT}/api/tickets/public/submit`);
    console.log(`📖 API docs: http://localhost:${PORT}/api/docs/public-ticket\n`);
  });
}

start().catch(console.error);