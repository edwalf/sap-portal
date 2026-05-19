// server.js
// Servidor principal del SAP Portal Backend
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const { testConnection } = require('./config/sap');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middlewares ───────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS: en producción reemplaza '*' por tu dominio
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limit: máx 100 req / 15 min por IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Demasiadas solicitudes, intenta en 15 minutos' },
});
app.use('/api', limiter);

// ── Rutas API ─────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/orders',    require('./routes/orders'));
app.use('/api/customers', require('./routes/customers'));

// ── Ping SAP (diagnóstico) ────────────────────────────────────
app.get('/api/sap/ping', async (req, res) => {
  try {
    const info = await testConnection();
    res.json(info);
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

// ── Sirve la PWA (frontend estático) ─────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Arranque ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 SAP Portal corriendo en http://localhost:${PORT}`);
  console.log(`   SAP Host: ${process.env.SAP_HOST}:${process.env.SAP_PORT}`);
  console.log(`   Company:  ${process.env.SAP_COMPANY}\n`);

  // Prueba conexión SAP al arrancar (no bloquea si falla)
  testConnection()
    .then((info) => console.log(`✅ Conexión SAP OK — ${info.company}`))
    .catch((err) => console.warn(`⚠️  SAP no disponible al arrancar: ${err.message}`));
});
