const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { stringify } = require('fast-csv');
const { query, run, get } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage() });

// GET /api/prospects
router.get('/', authMiddleware, (req, res) => {
  const { search, status } = req.query;
  let sql = 'SELECT * FROM prospects WHERE 1=1';
  const params = [];
  if (search) {
    sql += ' AND (company LIKE ? OR contact LIKE ? OR email LIKE ? OR industry LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  const prospects = query(sql, params);
  // Attach note counts
  const result = prospects.map(p => {
    const noteCount = get('SELECT COUNT(*) as cnt FROM notes WHERE entity_type = ? AND entity_id = ?', ['prospect', p.id]);
    return { ...p, note_count: noteCount ? noteCount.cnt : 0 };
  });
  res.json(result);
});

// GET /api/prospects/:id
router.get('/:id', authMiddleware, (req, res) => {
  const p = get('SELECT * FROM prospects WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'Prospect not found.' });
  const notes = query('SELECT * FROM notes WHERE entity_type = ? AND entity_id = ? ORDER BY date DESC', ['prospect', req.params.id]);
  res.json({ ...p, notes });
});

// POST /api/prospects
router.post('/', authMiddleware, (req, res) => {
  const { company, contact, email, phone, status, value, industry, initialNote } = req.body;
  if (!company || !contact) return res.status(400).json({ error: 'Company and contact name required.' });
  const id = uuidv4();
  const now = new Date().toISOString().split('T')[0];
  run('INSERT INTO prospects (id, company, contact, email, phone, status, value, industry, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, company, contact, email || '', phone || '', status || 'New Lead', value || '', industry || '', now, now]);
  if (initialNote) {
    run('INSERT INTO notes (id, entity_type, entity_id, type, date, text, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [uuidv4(), 'prospect', id, '📋 Internal Note', now, initialNote, req.user.name]);
  }
  res.status(201).json(get('SELECT * FROM prospects WHERE id = ?', [id]));
});

// PUT /api/prospects/:id
router.put('/:id', authMiddleware, (req, res) => {
  const p = get('SELECT * FROM prospects WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'Prospect not found.' });
  const { company, contact, email, phone, status, value, industry } = req.body;
  const now = new Date().toISOString().split('T')[0];
  run('UPDATE prospects SET company=?, contact=?, email=?, phone=?, status=?, value=?, industry=?, updated_at=? WHERE id=?',
    [company || p.company, contact || p.contact, email ?? p.email, phone ?? p.phone,
     status || p.status, value ?? p.value, industry ?? p.industry, now, req.params.id]);
  res.json(get('SELECT * FROM prospects WHERE id = ?', [req.params.id]));
});

// DELETE /api/prospects/:id
router.delete('/:id', authMiddleware, (req, res) => {
  const p = get('SELECT * FROM prospects WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'Prospect not found.' });
  run('DELETE FROM prospects WHERE id = ?', [req.params.id]);
  run('DELETE FROM notes WHERE entity_type = ? AND entity_id = ?', ['prospect', req.params.id]);
  res.json({ message: 'Prospect deleted.' });
});

// POST /api/prospects/:id/convert — convert to customer
router.post('/:id/convert', authMiddleware, (req, res) => {
  const p = get('SELECT * FROM prospects WHERE id = ?', [req.params.id]);
  if (!p) return res.status(404).json({ error: 'Prospect not found.' });
  const newId = uuidv4();
  const now = new Date().toISOString().split('T')[0];
  run('INSERT INTO customers (id, company, contact, email, phone, tier, value, industry, start_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [newId, p.company, p.contact, p.email, p.phone, 'Starter', p.value, p.industry, now, now, now]);
  // Move notes
  run('UPDATE notes SET entity_type = ?, entity_id = ? WHERE entity_type = ? AND entity_id = ?',
    ['customer', newId, 'prospect', req.params.id]);
  run('DELETE FROM prospects WHERE id = ?', [req.params.id]);
  res.json({ message: 'Converted to customer.', customerId: newId });
});

// POST /api/prospects/import/csv — CSV upload
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
      run('INSERT INTO prospects (id, company, contact, email, phone, status, value, industry, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, company, contact,
         row.email || row.Email || '',
         row.phone || row.Phone || '',
         row.status || row.Status || 'New Lead',
         row.value || row.Value || row['Potential Value'] || '',
         row.industry || row.Industry || '',
         now, now]);
      imported++;
    });

    res.json({ imported, skipped, errors, total: records.length });
  } catch (err) {
    res.status(400).json({ error: 'CSV parse error: ' + err.message });
  }
});

// GET /api/prospects/export/csv
router.get('/export/csv', authMiddleware, (req, res) => {
  const prospects = query('SELECT * FROM prospects ORDER BY created_at DESC');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="prospects.csv"');
  const csvStream = stringify({ headers: true });
  csvStream.pipe(res);
  prospects.forEach(p => csvStream.write({
    ID: p.id, Company: p.company, Contact: p.contact, Email: p.email,
    Phone: p.phone, Status: p.status, Value: p.value, Industry: p.industry,
    'Created At': p.created_at, 'Updated At': p.updated_at
  }));
  csvStream.end();
});

// GET /api/prospects/:id/notes
router.get('/:id/notes', authMiddleware, (req, res) => {
  const notes = query('SELECT * FROM notes WHERE entity_type = ? AND entity_id = ? ORDER BY date DESC', ['prospect', req.params.id]);
  res.json(notes);
});

// POST /api/prospects/:id/notes
router.post('/:id/notes', authMiddleware, (req, res) => {
  const { type, date, text } = req.body;
  if (!text) return res.status(400).json({ error: 'Note text required.' });
  const id = uuidv4();
  const now = new Date().toISOString().split('T')[0];
  run('INSERT INTO notes (id, entity_type, entity_id, type, date, text, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, 'prospect', req.params.id, type || '📋 Internal Note', date || now, text, req.user.name]);
  res.status(201).json(get('SELECT * FROM notes WHERE id = ?', [id]));
});

// DELETE /api/prospects/:id/notes/:noteId
router.delete('/:id/notes/:noteId', authMiddleware, (req, res) => {
  run('DELETE FROM notes WHERE id = ? AND entity_id = ?', [req.params.noteId, req.params.id]);
  res.json({ message: 'Note deleted.' });
});

module.exports = router;