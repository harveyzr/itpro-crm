const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query, run, get } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

// GET /api/tickets
router.get('/', authMiddleware, (req, res) => {
  const { search, status, priority, customer_id } = req.query;
  let sql = 'SELECT t.*, c.company as customer_company FROM tickets t LEFT JOIN customers c ON t.customer_id = c.id WHERE 1=1';
  const params = [];
  if (search) {
    sql += ' AND (t.subject LIKE ? OR t.description LIKE ? OR t.category LIKE ? OR c.company LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  if (status) { sql += ' AND t.status = ?'; params.push(status); }
  if (priority) { sql += ' AND t.priority = ?'; params.push(priority); }
  if (customer_id) { sql += ' AND t.customer_id = ?'; params.push(customer_id); }
  sql += ' ORDER BY CASE t.priority WHEN "Critical" THEN 1 WHEN "High" THEN 2 WHEN "Medium" THEN 3 WHEN "Low" THEN 4 END, t.created_at DESC';
  const tickets = query(sql, params);
  const result = tickets.map(t => {
    const updates = query('SELECT * FROM ticket_updates WHERE ticket_id = ? ORDER BY created_at ASC', [t.id]);
    return { ...t, updates };
  });
  res.json(result);
});

// GET /api/tickets/:id
router.get('/:id', authMiddleware, (req, res) => {
  const t = get('SELECT t.*, c.company as customer_company FROM tickets t LEFT JOIN customers c ON t.customer_id = c.id WHERE t.id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Ticket not found.' });
  const updates = query('SELECT * FROM ticket_updates WHERE ticket_id = ? ORDER BY created_at ASC', [req.params.id]);
  res.json({ ...t, updates });
});

// POST /api/tickets — internal creation
router.post('/', authMiddleware, (req, res) => {
  const { customer_id, subject, priority, category, description } = req.body;
  if (!subject) return res.status(400).json({ error: 'Subject required.' });
  if (!customer_id) return res.status(400).json({ error: 'Customer required.' });
  const customer = get('SELECT * FROM customers WHERE id = ?', [customer_id]);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });
  const id = uuidv4();
  const now = new Date().toISOString();
  run('INSERT INTO tickets (id, customer_id, subject, priority, category, description, status, source, customer_name, customer_email, customer_phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, customer_id, subject, priority || 'Medium', category || 'Other', description || '',
     'Open', 'internal', customer.company, customer.email, customer.phone, now, now]);
  const ticket = get('SELECT t.*, c.company as customer_company FROM tickets t LEFT JOIN customers c ON t.customer_id = c.id WHERE t.id = ?', [id]);
  res.status(201).json({ ...ticket, updates: [] });
});

// PUT /api/tickets/:id
router.put('/:id', authMiddleware, (req, res) => {
  const t = get('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Ticket not found.' });
  const { subject, priority, category, description, status, assigned_to } = req.body;
  const now = new Date().toISOString();
  run('UPDATE tickets SET subject=?, priority=?, category=?, description=?, status=?, assigned_to=?, updated_at=? WHERE id=?',
    [subject || t.subject, priority || t.priority, category || t.category,
     description ?? t.description, status || t.status, assigned_to ?? t.assigned_to, now, req.params.id]);
  res.json(get('SELECT * FROM tickets WHERE id = ?', [req.params.id]));
});

// DELETE /api/tickets/:id
router.delete('/:id', authMiddleware, (req, res) => {
  const t = get('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Ticket not found.' });
  run('DELETE FROM tickets WHERE id = ?', [req.params.id]);
  run('DELETE FROM ticket_updates WHERE ticket_id = ?', [req.params.id]);
  res.json({ message: 'Ticket deleted.' });
});

// POST /api/tickets/:id/updates — post a progress update
router.post('/:id/updates', authMiddleware, (req, res) => {
  const { status, assigned_to, note } = req.body;
  if (!note) return res.status(400).json({ error: 'Update note required.' });
  const t = get('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Ticket not found.' });
  const id = uuidv4();
  const now = new Date().toISOString();
  const newStatus = status || t.status;
  const newAssigned = assigned_to ?? t.assigned_to;
  run('INSERT INTO ticket_updates (id, ticket_id, status, assigned_to, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, req.params.id, newStatus, newAssigned, note, req.user.name, now]);
  run('UPDATE tickets SET status=?, assigned_to=?, updated_at=? WHERE id=?',
    [newStatus, newAssigned, now, req.params.id]);
  res.status(201).json(get('SELECT * FROM ticket_updates WHERE id = ?', [id]));
});

// ============================================================
// PUBLIC ENDPOINT — for external apps/websites to submit tickets
// POST /api/tickets/public/submit
// No auth required — secured by API key in header
// ============================================================
router.post('/public/submit', (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    const validKey = process.env.PUBLIC_API_KEY || 'itpro-public-key-change-me';
    if (apiKey !== validKey) return res.status(401).json({ error: 'Invalid API key.' });

    const { subject, description, priority, category, customer_name, customer_email, customer_phone } = req.body;
    if (!subject) return res.status(400).json({ error: 'Subject required.' });
    if (!customer_name) return res.status(400).json({ error: 'Customer name required.' });

    // Try to match to existing customer by email
    let customer_id = null;
    if (customer_email) {
      const existing = get('SELECT id FROM customers WHERE email = ?', [customer_email.toLowerCase()]);
      if (existing) customer_id = existing.id;
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    run('INSERT INTO tickets (id, customer_id, subject, priority, category, description, status, source, customer_name, customer_email, customer_phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, customer_id, subject, priority || 'Medium', category || 'Other',
       description || '', 'Open', 'external', customer_name,
       customer_email || '', customer_phone || '', now, now]);

    res.status(201).json({
      success: true,
      ticket_id: id,
      message: 'Your support ticket has been submitted. Our team will be in touch shortly.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tickets/public/status/:id — customers can check their ticket status
router.get('/public/status/:id', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  const validKey = process.env.PUBLIC_API_KEY || 'itpro-public-key-change-me';
  if (apiKey !== validKey) return res.status(401).json({ error: 'Invalid API key.' });
  const t = get('SELECT id, subject, status, priority, category, created_at, updated_at FROM tickets WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Ticket not found.' });
  res.json(t);
});

module.exports = router;