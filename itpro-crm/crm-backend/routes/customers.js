const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { stringify } = require('fast-csv');
const { query, run, get } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage() });

// GET /api/customers
router.get('/', authMiddleware, (req, res) => {
  const { search, tier } = req.query;
  let sql = 'SELECT * FROM customers WHERE 1=1';
  const params = [];
  if (search) {
    sql += ' AND (company LIKE ? OR contact LIKE ? OR email LIKE ? OR industry LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  if (tier) { sql += ' AND tier = ?'; params.push(tier); }
  sql += ' ORDER BY created_at DESC';
  const customers = query(sql, params);
  const result = customers.map(c => {
    const noteCount = get('SELECT COUNT(*) as cnt FROM notes WHERE entity_type = ? AND entity_id = ?', ['customer', c.id]);
    const openTickets = get('SELECT COUNT(*) as cnt FROM tickets WHERE customer_id = ? AND status NOT IN (?,?)', [c.id, 'Resolved', 'Closed']);
    return { ...c, note_count: noteCount ? noteCount.cnt : 0, open_tickets: openTickets ? openTickets.cnt : 0 };
  });
  res.json(result);
});

// GET /api/customers/:id
router.get('/:id', authMiddleware, (req, res) => {
  const c = get('SELECT * FROM customers WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Customer not found.' });
  const notes = query('SELECT * FROM notes WHERE entity_type = ? AND entity_id = ? ORDER BY date DESC', ['customer', req.params.id]);
  const tickets = query('SELECT * FROM tickets WHERE customer_id = ? ORDER BY created_at DESC', [req.params.id]);
  res.json({ ...c, notes, tickets });
});

// POST /api/customers
router.post('/', authMiddleware, (req, res) => {
  const { company, contact, email, phone, tier, value, industry, start_date, initialNote } = req.body;
  if (!company || !contact) return res.status(400).json({ error: 'Company and contact name required.' });
  const id = uuidv4();
  const now = new Date().toISOString().split('T')[0];
  run('INSERT INTO customers (id, company, contact, email, phone, tier, value, industry, start_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, company, contact, email || '', phone || '', tier || 'Starter', value || '', industry || '', start_date || now, now, now]);
  if (initialNote) {
    run('INSERT INTO notes (id, entity_type, entity_id, type, date, text, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [uuidv4(), 'customer', id, '📋 Internal Note', now, initialNote, req.user.name]);
  }
  res.status(201).json(get('SELECT * FROM customers WHERE id = ?', [id]));
});

// PUT /api/customers/:id
router.put('/:id', authMiddleware, (req, res) => {
  const c = get('SELECT * FROM customers WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Customer not found.' });
  const { company, contact, email, phone, tier, value, industry, start_date } = req.body;
  const now = new Date().toISOString().split('T')[0];
  run('UPDATE customers SET company=?, contact=?, email=?, phone=?, tier=?, value=?, industry=?, start_date=?, updated_at=? WHERE id=?',
    [company || c.company, contact || c.contact, email ?? c.email, phone ?? c.phone,
     tier || c.tier, value ?? c.value, industry ?? c.industry, start_date || c.start_date, now, req.params.id]);
  res.json(get('SELECT * FROM customers WHERE id = ?', [req.params.id]));
});

// DELETE /api/customers/:id
router.delete('/:id', authMiddleware, (req, res) => {
  const c = get('SELECT * FROM customers WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Customer not found.' });
  run('DELETE FROM customers WHERE id = ?', [req.params.id]);
  run('DELETE FROM notes WHERE entity_type = ? AND entity_id = ?', ['customer', req.params.id]);
  run('DELETE FROM tickets WHERE customer_id = ?', [req.params.id]);
  res.json({ message: 'Customer deleted.' });
});

// POST /api/customers/import/csv
router.post('/import/csv', authMiddleware, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const content = req.file.buffer.toString('utf8');
    const records = parse(content, { columns: true, skip_empty_lines: true, trim: true });
    const now = new Date().toISOString().split('T')[0];
    let imported = 0, skipped = 0;
    const errors = [];
    records.forEach((row, i) => {
      const company = row.company || row.Company || row.COMPANY || '';
      const contact = row.contact || row.Contact || row['Contact Name'] || row.name || row.Name || '';
      if (!company || !contact) { skipped++; errors.push(`Row ${i + 2}: missing company or contact`); return; }
      const id = uuidv4();
      run('INSERT INTO customers (id, company, contact, email, phone, tier, value, industry, start_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, company, contact,
         row.email || row.Email || '',
         row.phone || row.Phone || '',
         row.tier || row.Tier || 'Starter',
         row.value || row.Value || row['Contract Value'] || '',
         row.industry || row.Industry || '',
         row.start_date || row['Start Date'] || now,
         now, now]);
      imported++;
    });
    res.json({ imported, skipped, errors, total: records.length });
  } catch (err) {
    res.status(400).json({ error: 'CSV parse error: ' + err.message });
  }
});

// GET /api/customers/export/csv
router.get('/export/csv', authMiddleware, (req, res) => {
  const customers = query('SELECT * FROM customers ORDER BY created_at DESC');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="customers.csv"');
  const csvStream = stringify({ headers: true });
  csvStream.pipe(res);
  customers.forEach(c => csvStream.write({
    ID: c.id, Company: c.company, Contact: c.contact, Email: c.email,
    Phone: c.phone, Tier: c.tier, Value: c.value, Industry: c.industry,
    'Start Date': c.start_date, 'Created At': c.created_at
  }));
  csvStream.end();
});

// GET /api/customers/:id/notes
router.get('/:id/notes', authMiddleware, (req, res) => {
  const notes = query('SELECT * FROM notes WHERE entity_type = ? AND entity_id = ? ORDER BY date DESC', ['customer', req.params.id]);
  res.json(notes);
});

// POST /api/customers/:id/notes
router.post('/:id/notes', authMiddleware, (req, res) => {
  const { type, date, text } = req.body;
  if (!text) return res.status(400).json({ error: 'Note text required.' });
  const id = uuidv4();
  const now = new Date().toISOString().split('T')[0];
  run('INSERT INTO notes (id, entity_type, entity_id, type, date, text, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, 'customer', req.params.id, type || '📋 Internal Note', date || now, text, req.user.name]);
  res.status(201).json(get('SELECT * FROM notes WHERE id = ?', [id]));
});

// DELETE /api/customers/:id/notes/:noteId
router.delete('/:id/notes/:noteId', authMiddleware, (req, res) => {
  run('DELETE FROM notes WHERE id = ? AND entity_id = ?', [req.params.noteId, req.params.id]);
  res.json({ message: 'Note deleted.' });
});

module.exports = router;