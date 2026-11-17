const { pool } = require('./db');

async function list(ownerEmail, search) {
  if (search) {
    const like = `%${search}%`;
    const [rows] = await pool.execute(
      `SELECT * FROM contacts WHERE owner_email = ? AND (name LIKE ? OR email LIKE ? OR company LIKE ?)
       ORDER BY favorite DESC, name ASC`,
      [ownerEmail, like, like, like]
    );
    return rows;
  }
  const [rows] = await pool.execute(
    `SELECT * FROM contacts WHERE owner_email = ? ORDER BY favorite DESC, name ASC`,
    [ownerEmail]
  );
  return rows;
}

async function create(ownerEmail, { name, email, phone, company, notes }) {
  const [result] = await pool.execute(
    `INSERT INTO contacts (owner_email, name, email, phone, company, notes) VALUES (?, ?, ?, ?, ?, ?)`,
    [ownerEmail, name, email, phone || null, company || null, notes || null]
  );
  return result.insertId;
}

async function update(ownerEmail, id, { name, email, phone, company, notes, favorite }) {
  const [result] = await pool.execute(
    `UPDATE contacts SET name = ?, email = ?, phone = ?, company = ?, notes = ?, favorite = ?
     WHERE id = ? AND owner_email = ?`,
    [name, email, phone || null, company || null, notes || null, favorite ? 1 : 0, id, ownerEmail]
  );
  return result.affectedRows > 0;
}

async function toggleFavorite(ownerEmail, id) {
  const [result] = await pool.execute(
    `UPDATE contacts SET favorite = NOT favorite WHERE id = ? AND owner_email = ?`,
    [id, ownerEmail]
  );
  return result.affectedRows > 0;
}

async function remove(ownerEmail, id) {
  const [result] = await pool.execute(
    `DELETE FROM contacts WHERE id = ? AND owner_email = ?`,
    [id, ownerEmail]
  );
  return result.affectedRows > 0;
}

module.exports = { list, create, update, toggleFavorite, remove };
