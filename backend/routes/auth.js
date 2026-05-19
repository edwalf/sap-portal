// routes/auth.js
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');

// Carga usuarios desde .env: "user1:hash1,user2:hash2"
function getUsers() {
  const raw = process.env.PORTAL_USERS || '';
  const users = {};
  raw.split(',').forEach((entry) => {
    const [username, ...hashParts] = entry.trim().split(':');
    if (username) users[username.trim()] = hashParts.join(':').trim();
  });
  return users;
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  const users = getUsers();
  const hash  = users[username.toLowerCase()];
  if (!hash)
    return res.status(401).json({ error: 'Credenciales incorrectas' });

  const ok = await bcrypt.compare(password, hash);
  if (!ok)
    return res.status(401).json({ error: 'Credenciales incorrectas' });

  const token = jwt.sign(
    { username: username.toLowerCase(), loginAt: Date.now() },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  res.json({ token, username: username.toLowerCase(), expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
});

// POST /api/auth/logout  (el cliente simplemente descarta el token)
router.post('/logout', (req, res) => res.json({ ok: true }));

module.exports = router;
