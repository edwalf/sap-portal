// config/sap.js
// Maneja la sesión con SAP Business One Service Layer
// El Service Layer usa cookies de sesión (B1SESSION) que expiran cada 30 min

const axios = require('axios');
const https = require('https');

// Ignorar certificados self-signed en entornos locales SAP
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const SAP_BASE = `${process.env.SAP_HTTPS === 'true' ? 'https' : 'http'}://${process.env.SAP_HOST}:${process.env.SAP_PORT}/b1s/v1`;

let sessionCookie = null;
let sessionExpiry = null;

// Cliente axios configurado para SAP
const sapClient = axios.create({
  baseURL: SAP_BASE,
  httpsAgent,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

// Interceptor: adjunta la cookie de sesión en cada request
sapClient.interceptors.request.use(async (config) => {
  const cookie = await getSession();
  config.headers['Cookie'] = cookie;
  return config;
});

// Interceptor: si SAP devuelve 401, renueva sesión y reintenta
sapClient.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 401 && !err.config._retry) {
      err.config._retry = true;
      sessionCookie = null;
      sessionExpiry = null;
      const cookie = await login();
      err.config.headers['Cookie'] = cookie;
      return sapClient(err.config);
    }
    return Promise.reject(err);
  }
);

async function login() {
  console.log(`[SAP] Iniciando sesión en ${SAP_BASE}...`);
  const res = await axios.post(
    `${SAP_BASE}/Login`,
    {
      CompanyDB: process.env.SAP_COMPANY,
      UserName:  process.env.SAP_USER,
      Password:  process.env.SAP_PASSWORD,
    },
    { httpsAgent, timeout: 15000 }
  );
  // SAP devuelve la cookie en Set-Cookie
  const raw = res.headers['set-cookie'] || [];
  const b1 = raw.find((c) => c.includes('B1SESSION'));
  if (!b1) throw new Error('SAP no devolvió cookie de sesión');
  sessionCookie = b1.split(';')[0];
  sessionExpiry = Date.now() + 25 * 60 * 1000; // 25 min (SAP expira a 30)
  console.log('[SAP] Sesión iniciada correctamente');
  return sessionCookie;
}

async function getSession() {
  if (!sessionCookie || Date.now() >= sessionExpiry) {
    await login();
  }
  return sessionCookie;
}

async function logout() {
  try {
    if (sessionCookie) {
      await sapClient.post('/Logout');
      sessionCookie = null;
      sessionExpiry = null;
    }
  } catch (_) {}
}

// Prueba de conexión (usada en /api/sap/ping)
async function testConnection() {
  await login();
  const res = await sapClient.get('/CompanyService_GetAdminInfo');
  return {
    ok: true,
    company: res.data?.CompanyName || process.env.SAP_COMPANY,
    version: res.data?.Version || 'SAP B1',
  };
}

module.exports = { sapClient, testConnection, logout, SAP_BASE };
