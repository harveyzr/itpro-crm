const express = require('express');
const router = express.Router();
const { query } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

// GET /api/search?q=term&types=prospects,customers,tickets
router.get('/', authMiddleware, (req, res) => {
  const { q, types } = req.query;
  if (!q || q.trim().length < 2) return res.json([]);

  const search = `%${q.trim()}%`;
  const includeTypes = types ? types.split(',') : ['prospects', 'customers', 'tickets'];
  const results = [];

  // Search prospect notes
  if (includeTypes.includes('prospects')) {
    const prospectNotes = query(`
      SELECT n.*, p.company, p.contact, p.status as entity_status, 'prospect_note' as result_type
      FROM notes n
      JOIN prospects p ON n.entity_id = p.id
      WHERE n.entity_type = 'prospect' AND (n.text LIKE ? OR p.company LIKE ? OR p.contact LIKE ?)
      ORDER BY n.date DESC LIMIT 50`, [search, search, search]);
    results.push(...prospectNotes.map(r => ({
      type: 'Prospect Note', company: r.company, contact: r.contact,
      note: r.text, date: r.date, noteType: r.type,
      entityType: 'prospect', entityId: r.entity_id, status: r.entity_status
    })));

    // Search prospect fields directly
    const prospects = query(`
      SELECT * FROM prospects
      WHERE company LIKE ? OR contact LIKE ? OR email LIKE ? OR phone LIKE ? OR industry LIKE ?
      ORDER BY created_at DESC LIMIT 20`, [search, search, search, search, search]);
    prospects.forEach(p => {
      if (!results.find(r => r.entityId === p.id)) {
        results.push({
          type: 'Prospect', company: p.company, contact: p.contact,
          note: `Status: ${p.status}${p.industry ? ' · ' + p.industry : ''}${p.value ? ' · ' + p.value : ''}`,
          date: p.created_at, noteType: '🎯',
          entityType: 'prospect', entityId: p.id, status: p.status
        });
      }
    });
  }

  // Search customer notes
  if (includeTypes.includes('customers')) {
    const customerNotes = query(`
      SELECT n.*, c.company, c.contact, c.tier as entity_status, 'customer_note' as result_type
      FROM notes n
      JOIN customers c ON n.entity_id = c.id
      WHERE n.entity_type = 'customer' AND (n.text LIKE ? OR c.company LIKE ? OR c.contact LIKE ?)
      ORDER BY n.date DESC LIMIT 50`, [search, search, search]);
    results.push(...customerNotes.map(r => ({
      type: 'Customer Note', company: r.company, contact: r.contact,
      note: r.text, date: r.date, noteType: r.type,
      entityType: 'customer', entityId: r.entity_id, status: r.entity_status
    })));

    // Search customer fields directly
    const customers = query(`
      SELECT * FROM customers
      WHERE company LIKE ? OR contact LIKE ? OR email LIKE ? OR phone LIKE ? OR industry LIKE ?
      ORDER BY created_at DESC LIMIT 20`, [search, search, search, search, search]);
    customers.forEach(c => {
      if (!results.find(r => r.entityId === c.id)) {
        results.push({
          type: 'Customer', company: c.company, contact: c.contact,
          note: `Tier: ${c.tier}${c.industry ? ' · ' + c.industry : ''}${c.value ? ' · ' + c.value : ''}`,
          date: c.created_at, noteType: '🏢',
          entityType: 'customer', entityId: c.id, status: c.tier
        });
      }
    });
  }

  // Search tickets
  if (includeTypes.includes('tickets')) {
    const tickets = query(`
      SELECT t.*, c.company as customer_company
      FROM tickets t LEFT JOIN customers c ON t.customer_id = c.id
      WHERE t.subject LIKE ? OR t.description LIKE ? OR t.category LIKE ?
        OR c.company LIKE ? OR t.customer_name LIKE ?
      ORDER BY t.created_at DESC LIMIT 30`, [search, search, search, search, search]);

    // Also search ticket updates
    const ticketUpdates = query(`
      SELECT tu.*, t.subject, t.status as ticket_status, t.customer_id,
             c.company as customer_company, t.customer_name
      FROM ticket_updates tu
      JOIN tickets t ON tu.ticket_id = t.id
      LEFT JOIN customers c ON t.customer_id = c.id
      WHERE tu.note LIKE ?
      ORDER BY tu.created_at DESC LIMIT 20`, [search]);

    tickets.forEach(t => {
      results.push({
        type: 'Ticket', company: t.customer_company || t.customer_name || 'External',
        contact: t.category, note: t.subject + (t.description ? ' — ' + t.description : ''),
        date: t.created_at, noteType: `🎫 ${t.status}`,
        entityType: 'ticket', entityId: t.id, status: t.status
      });
    });

    ticketUpdates.forEach(u => {
      if (!results.find(r => r.entityId === u.ticket_id && r.type === 'Ticket')) {
        results.push({
          type: 'Ticket Update', company: u.customer_company || u.customer_name || 'External',
          contact: u.subject, note: u.note,
          date: u.created_at, noteType: `🔄 ${u.ticket_status}`,
          entityType: 'ticket', entityId: u.ticket_id, status: u.ticket_status
        });
      }
    });
  }

  // Sort by date descending
  results.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  res.json(results.slice(0, 100));
});

module.exports = router;