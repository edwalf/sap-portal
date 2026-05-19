// routes/inventory.js
// Columnas verificadas en SAP B1 9.3 — OITM, OITW, OWHS
const router         = require('express').Router();
const auth           = require('../middleware/auth');
const { query, sql } = require('../config/db');

router.use(auth);

// GET /api/inventory/item/:code
router.get('/item/:code', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const result = await query(`
      SELECT
        T0.ItemCode,
        T0.ItemName,
        T0.OnHand      AS TotalStock,
        T0.IsCommited  AS Committed,
        T0.OnOrder,
        T0.SalUnitMsr  AS SalesUnit,
        T2.WhsCode,
        T1.WhsName,
        T2.OnHand      AS WhsStock,
        T2.IsCommited  AS WhsCommitted,
        T2.OnOrder     AS WhsOnOrder,
        (T2.OnHand - T2.IsCommited) AS Available
      FROM OITM T0
      LEFT JOIN OITW T2 ON T0.ItemCode = T2.ItemCode
      LEFT JOIN OWHS T1 ON T2.WhsCode  = T1.WhsCode
      WHERE T0.ItemCode = @code
        AND T0.Deleted  = 'N'
        AND T0.SellItem = 'Y'
    `, { code: { type: sql.NVarChar, value: code } });

    if (!result.recordset.length)
      return res.status(404).json({ error: 'Artículo no encontrado' });

    const first = result.recordset[0];
    res.json({
      code:       first.ItemCode,
      name:       first.ItemName,
      totalStock: first.TotalStock,
      committed:  first.Committed,
      onOrder:    first.OnOrder,
      unit:       first.SalesUnit || 'UND',
      warehouses: result.recordset
        .filter(r => r.WhsCode)
        .map(r => ({
          warehouse: r.WhsCode,
          name:      r.WhsName,
          inStock:   r.WhsStock,
          committed: r.WhsCommitted,
          onOrder:   r.WhsOnOrder,
          available: r.Available,
        })),
    });
  } catch (err) { handleError(err, res); }
});

// GET /api/inventory/search?q=TEXTO&warehouse=01
router.get('/search', async (req, res) => {
  try {
    const q  = (req.query.q  || '').trim();
    const wh = (req.query.warehouse || '').trim();
    if (!q) return res.status(400).json({ error: 'Parámetro q requerido' });

    const whFilter = wh ? 'AND T2.WhsCode = @wh' : '';

    const result = await query(`
      SELECT TOP 50
        T0.ItemCode,
        T0.ItemName,
        T0.OnHand      AS TotalStock,
        T0.SalUnitMsr  AS SalesUnit,
        T2.WhsCode,
        T1.WhsName,
        T2.OnHand      AS WhsStock,
        (T2.OnHand - T2.IsCommited) AS Available
      FROM OITM T0
      LEFT JOIN OITW T2 ON T0.ItemCode = T2.ItemCode
      LEFT JOIN OWHS T1 ON T2.WhsCode  = T1.WhsCode
      WHERE T0.Deleted  = 'N'
        AND T0.SellItem = 'Y'
        AND (T0.ItemCode LIKE @q OR T0.ItemName LIKE @q)
        ${whFilter}
      ORDER BY T0.ItemCode
    `, {
      q: { type: sql.NVarChar, value: `%${q}%` },
      ...(wh ? { wh: { type: sql.NVarChar, value: wh } } : {}),
    });

    res.json(groupItems(result.recordset));
  } catch (err) { handleError(err, res); }
});

// GET /api/inventory/all?warehouse=01&top=100
router.get('/all', async (req, res) => {
  try {
    const wh  = (req.query.warehouse || '').trim();
    const top = Math.min(parseInt(req.query.top) || 100, 500);
    const whFilter = wh ? 'AND T2.WhsCode = @wh' : '';

    const result = await query(`
      SELECT TOP ${top}
        T0.ItemCode,
        T0.ItemName,
        T0.OnHand      AS TotalStock,
        T0.SalUnitMsr  AS SalesUnit,
        T2.WhsCode,
        T1.WhsName,
        T2.OnHand      AS WhsStock,
        (T2.OnHand - T2.IsCommited) AS Available
      FROM OITM T0
      LEFT JOIN OITW T2 ON T0.ItemCode = T2.ItemCode
      LEFT JOIN OWHS T1 ON T2.WhsCode  = T1.WhsCode
      WHERE T0.Deleted  = 'N'
        AND T0.SellItem = 'Y'
        ${whFilter}
      ORDER BY T0.ItemCode
    `, wh ? { wh: { type: sql.NVarChar, value: wh } } : {});

    res.json(groupItems(result.recordset));
  } catch (err) { handleError(err, res); }
});

// GET /api/inventory/warehouses
router.get('/warehouses', async (req, res) => {
  try {
    const result = await query(`
      SELECT WhsCode, WhsName
      FROM OWHS
      WHERE Inactive = 'N'
      ORDER BY WhsCode
    `);
    res.json(result.recordset.map(w => ({ code: w.WhsCode, name: w.WhsName })));
  } catch (err) { handleError(err, res); }
});

function groupItems(rows) {
  const map = {};
  rows.forEach(r => {
    if (!map[r.ItemCode]) {
      map[r.ItemCode] = {
        code:       r.ItemCode,
        name:       r.ItemName,
        totalStock: r.TotalStock,
        unit:       r.SalesUnit || 'UND',
        warehouses: [],
      };
    }
    if (r.WhsCode) {
      map[r.ItemCode].warehouses.push({
        warehouse: r.WhsCode,
        name:      r.WhsName,
        inStock:   r.WhsStock,
        available: r.Available,
      });
    }
  });
  return Object.values(map);
}

function handleError(err, res) {
  console.error('[Inventory Error]', err.message);
  res.status(500).json({ error: err.message });
}

module.exports = router;

// GET /api/inventory/price/:code?priceList=1
// Devuelve precio de lista de un artículo desde ITM1
router.get('/price/:code', async (req, res) => {
  try {
    const code      = req.params.code.toUpperCase();
    const priceList = parseInt(req.query.priceList) || 1;

    const result = await query(`
      SELECT
        T0.ItemCode,
        T0.ItemName,
        T0.SalUnitMsr AS SalesUnit,
        T1.Price
      FROM OITM T0
      LEFT JOIN ITM1 T1 ON T0.ItemCode = T1.ItemCode AND T1.PriceList = @priceList
      WHERE T0.ItemCode = @code AND T0.Deleted = 'N' AND T0.SellItem = 'Y'
    `, {
      code:      { type: sql.NVarChar, value: code },
      priceList: { type: sql.Int,      value: priceList },
    });

    if (!result.recordset.length)
      return res.status(404).json({ error: 'Artículo no encontrado' });

    const r = result.recordset[0];
    res.json({
      code:  r.ItemCode,
      name:  r.ItemName,
      unit:  r.SalesUnit || 'UND',
      price: r.Price || 0,
    });
  } catch (err) { handleError(err, res); }
});
