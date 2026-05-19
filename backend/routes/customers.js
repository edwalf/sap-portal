// routes/customers.js
// Consulta saldos y datos de socios de negocio (clientes) en SAP B1
// Endpoints SAP:
//   GET /b1s/v1/BusinessPartners('CODE')          — datos + saldo
//   GET /b1s/v1/BusinessPartners?$filter=         — búsqueda

const router        = require('express').Router();
const auth          = require('../middleware/auth');
const { sapClient } = require('../config/sap');

router.use(auth);

// Campos a traer de SAP (evita traer todo el objeto que es muy grande)
const SELECT_FIELDS = [
  'CardCode', 'CardName', 'CardType',
  'Balance', 'CreditLimit', 'DNoteBalance',
  'Phone1', 'EmailAddress', 'ContactPerson',
  'City', 'Country', 'Currency',
  'Valid', 'Frozen',
].join(',');

// ── GET /api/customers/search?q=TEXTO ────────────────────────
// Busca clientes por código o nombre
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Parámetro q requerido' });

    const filter = `CardType eq 'cCustomer' and (contains(CardCode,'${q}') or contains(CardName,'${q}'))`;
    const { data } = await sapClient.get(
      `/BusinessPartners?$filter=${encodeURIComponent(filter)}&$select=${SELECT_FIELDS}&$top=20`
    );

    res.json((data.value || []).map(mapCustomer));
  } catch (err) {
    handleSapError(err, res);
  }
});

// ── GET /api/customers/:code ──────────────────────────────────
// Datos completos + saldo de un cliente específico
router.get('/:code', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const { data } = await sapClient.get(
      `/BusinessPartners('${encodeURIComponent(code)}')?$select=${SELECT_FIELDS}`
    );
    res.json(mapCustomer(data));
  } catch (err) {
    handleSapError(err, res);
  }
});

// ── GET /api/customers/:code/transactions ─────────────────────
// Últimas facturas/notas del cliente (JournalEntries o Invoices)
router.get('/:code/invoices', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const top  = Math.min(parseInt(req.query.top) || 10, 50);

    const filter = `CardCode eq '${code}'`;
    const select = 'DocEntry,DocNum,DocDate,DocDueDate,DocTotal,PaidToDate,DocumentStatus';
    const { data } = await sapClient.get(
      `/Invoices?$filter=${encodeURIComponent(filter)}&$select=${select}&$top=${top}&$orderby=DocDate desc`
    );

    res.json((data.value || []).map((inv) => ({
      docEntry:  inv.DocEntry,
      docNum:    inv.DocNum,
      docDate:   inv.DocDate?.split('T')[0],
      dueDate:   inv.DocDueDate?.split('T')[0],
      total:     inv.DocTotal,
      paid:      inv.PaidToDate,
      pending:   inv.DocTotal - inv.PaidToDate,
      status:    inv.DocumentStatus === 'O' ? 'Pendiente' : 'Pagada',
    })));
  } catch (err) {
    handleSapError(err, res);
  }
});

function mapCustomer(bp) {
  const balance = bp.Balance || 0;
  const limit   = bp.CreditLimit || 0;
  const used    = limit > 0 ? Math.round((balance / limit) * 100) : 0;
  return {
    code:         bp.CardCode,
    name:         bp.CardName,
    balance:      balance,
    creditLimit:  limit,
    available:    limit - balance,
    creditUsed:   used,
    currency:     bp.Currency || 'GTQ',
    contact:      bp.ContactPerson || '',
    phone:        bp.Phone1 || '',
    email:        bp.EmailAddress || '',
    city:         bp.City || '',
    active:       bp.Valid === 'tYES' && bp.Frozen !== 'tYES',
    status:       balance === 0 ? 'sin_deuda' : used >= 90 ? 'limite_excedido' : 'con_saldo',
  };
}

function handleSapError(err, res) {
  console.error('[SAP Customers Error]', err.response?.data || err.message);
  const status = err.response?.status || 500;
  const msg    = err.response?.data?.error?.message?.value || err.message || 'Error SAP';
  res.status(status).json({ error: msg });
}

module.exports = router;
