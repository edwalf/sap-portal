// routes/customers.js
// Columnas verificadas en SAP B1 9.3 — OCRD
const router         = require('express').Router();
const auth           = require('../middleware/auth');
const { query, sql } = require('../config/db');

router.use(auth);

const FIELDS = `
  CardCode, CardName, Balance, CreditLine,
  Phone1, E_Mail, CntctPrsn, City, Currency,
  validFor, frozenFor
`;

// GET /api/customers/search?q=TEXTO
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Parámetro q requerido' });

    const result = await query(`
      SELECT TOP 20 ${FIELDS}
      FROM OCRD
      WHERE CardType = 'C'
        AND Deleted  = 'N'
        AND (CardCode LIKE @q OR CardName LIKE @q)
      ORDER BY CardName
    `, { q: { type: sql.NVarChar, value: `%${q}%` } });

    res.json(result.recordset.map(mapCustomer));
  } catch (err) { handleError(err, res); }
});

// GET /api/customers/:code
router.get('/:code', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const result = await query(`
      SELECT ${FIELDS}
      FROM OCRD
      WHERE CardCode = @code AND CardType = 'C'
    `, { code: { type: sql.NVarChar, value: code } });

    if (!result.recordset.length)
      return res.status(404).json({ error: 'Cliente no encontrado' });

    res.json(mapCustomer(result.recordset[0]));
  } catch (err) { handleError(err, res); }
});

// GET /api/customers/:code/invoices
router.get('/:code/invoices', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const top  = Math.min(parseInt(req.query.top) || 10, 50);

    const result = await query(`
      SELECT TOP ${top}
        DocEntry, DocNum,
        CONVERT(VARCHAR, DocDate,    23) AS DocDate,
        CONVERT(VARCHAR, DocDueDate, 23) AS DocDueDate,
        DocTotal, PaidToDate,
        (DocTotal - PaidToDate) AS Pending,
        DocStatus
      FROM OINV
      WHERE CardCode = @code AND Canceled = 'N'
      ORDER BY DocDate DESC
    `, { code: { type: sql.NVarChar, value: code } });

    res.json(result.recordset.map(inv => ({
      docEntry: inv.DocEntry,
      docNum:   inv.DocNum,
      docDate:  inv.DocDate,
      dueDate:  inv.DocDueDate,
      total:    inv.DocTotal,
      paid:     inv.PaidToDate,
      pending:  inv.Pending,
      status:   inv.DocStatus === 'O' ? 'Pendiente' : 'Pagada',
    })));
  } catch (err) { handleError(err, res); }
});

function mapCustomer(c) {
  const balance = c.Balance    || 0;
  const limit   = c.CreditLine || 0;
  const used    = limit > 0 ? Math.round((balance / limit) * 100) : 0;
  return {
    code:        c.CardCode,
    name:        c.CardName,
    balance,
    creditLimit: limit,
    available:   limit - balance,
    creditUsed:  used,
    currency:    c.Currency  || 'GTQ',
    contact:     c.CntctPrsn || '',
    phone:       c.Phone1    || '',
    email:       c.E_Mail    || '',
    city:        c.City      || '',
    active:      c.validFor === 'Y' && c.frozenFor !== 'Y',
    status:      balance === 0 ? 'sin_deuda' : used >= 90 ? 'limite_excedido' : 'con_saldo',
  };
}

function handleError(err, res) {
  console.error('[Customers Error]', err.message);
  res.status(500).json({ error: err.message });
}

module.exports = router;
