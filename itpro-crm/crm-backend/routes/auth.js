const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query, run, get } = require('../db/database');
const { authMiddleware, adminOnly, JWT_SECRET } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

    const user = get('SELECT * FROM users WHERE email = ? AND active = 1', [email.toLowerCase()]);
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password.' });

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  const user = get('SELECT id, name, email, role, created_at FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json(user);
});

// POST /api/auth/change-password
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required.' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });

    const user = get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

    const hashed = await bcrypt.hash(newPassword, 10);
    run('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);
    res.json({ message: 'Password updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/users — admin only
router.get('/users', authMiddleware, adminOnly, (req, res) => {
  const users = query('SELECT id, name, email, role, active, created_at FROM users ORDER BY created_at DESC');
  res.json(users);
});

// POST /api/auth/users — admin only
router.post('/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const existing = get('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existing) return res.status(409).json({ error: 'A user with that email already exists.' });

    const hashed = await bcrypt.hash(password, 10);
    const id = uuidv4();
    run('INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)',
      [id, name, email.toLowerCase(), hashed, role || 'technician']);

    res.status(201).json({ id, name, email: email.toLowerCase(), role: role || 'technician' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/users/:id — admin only
router.put('/users/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, email, role, active, password } = req.body;
    const user = get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    let passwordUpdate = '';
    let params = [];

    if (password && password.length >= 6) {
      const hashed = await bcrypt.hash(password, 10);
      passwordUpdate = ', password = ?';
      params.push(hashed);
    }

    run(`UPDATE users SET name = ?, email = ?, role = ?, active = ?${passwordUpdate} WHERE id = ?`,
      [name || user.name, (email || user.email).toLowerCase(), role || user.role,
       active !== undefined ? (active ? 1 : 0) : user.active, ...params, req.params.id]);

    res.json({ message: 'User updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/auth/users/:id — admin only
router.delete('/users/:id', authMiddleware, adminOnly, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account.' });
  run('UPDATE users SET active = 0 WHERE id = ?', [req.params.id]);
  res.json({ message: 'User deactivated.' });
});

module.exports = router;