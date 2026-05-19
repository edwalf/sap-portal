// routes/inventory.js
// Consulta existencias en SAP Business One Service Layer
// Endpoints relevantes:
//   GET /b1s/v1/Items('CODE')                  — un artículo
//   GET /b1s/v1/Items?$filter=...              — búsqueda
//   GET /b1s/v1/ItemWarehouseInfoCollection    — stock por almacén

const router    = require('express').Router();
const auth      = require('../middleware/auth');
const { sapClient } = require('../config/sap');

// Todos los endpoints requieren JWT
router.use(auth);

// ── GET /api/inventory/item/:code ──────────────────────────────
// Devuelve datos + stock total del artículo
router.get('/item/:code', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();

    // Datos del artículo
    const { data: item } = await sapClient.get(
      `/Items('${encodeURIComponent(code)}')?$select=ItemCode,ItemName,QuantityOnStock,OnOrder,IsCommited,SalesUnit,PriceList,ItemWarehouseInfoCollection`
    );

    const result = {
      code:       item.ItemCode,
      name:       item.ItemName,
      totalStock: item.QuantityOnStock,
      onOrder:    item.OnOrder,
      committed:  item.IsCommited,
      unit:       item.SalesUnit || 'UND',
      warehouses: (item.ItemWarehouseInfoCollection || []).map((wh) => ({
        warehouse: wh.WarehouseCode,
        inStock:   wh.InStock,
        committed: wh.Committed,
        ordered:   wh.Ordered,
        available: wh.InStock - wh.Committed,
      })),
    };

    res.json(result);
  } catch (err) {
    handleSapError(err, res);
  }
});

// ── GET /api/inventory/search?q=TEXTO&warehouse=01 ────────────
// Busca artículos por código o nombre parcial
router.get('/search', async (req, res) => {
  try {
    const q  = (req.query.q  || '').trim();
    const wh = (req.query.warehouse || '').trim();

    if (!q) return res.status(400).json({ error: 'Parámetro q requerido' });

    // SAP OData filter: contains en ItemCode o ItemName
    const filter = `contains(ItemCode,'${q}') or contains(ItemName,'${q}')`;
    const select = 'ItemCode,ItemName,QuantityOnStock,SalesUnit,ItemWarehouseInfoCollection';

    const { data } = await sapClient.get(
      `/Items?$filter=${encodeURIComponent(filter)}&$select=${select}&$top=50`
    );

    let items = (data.value || []).map((item) => ({
      code:       item.ItemCode,
      name:       item.ItemName,
      totalStock: item.QuantityOnStock,
      unit:       item.SalesUnit || 'UND',
      warehouses: (item.ItemWarehouseInfoCollection || []).map((wh) => ({
        warehouse: wh.WarehouseCode,
        inStock:   wh.InStock,
        available: wh.InStock - wh.Committed,
      })),
    }));

    // Filtrar por almacén si se especificó
    if (wh) {
      items = items.map((item) => ({
        ...item,
        warehouses: item.warehouses.filter((w) => w.warehouse === wh),
      })).filter((item) => item.warehouses.length > 0);
    }

    res.json(items);
  } catch (err) {
    handleSapError(err, res);
  }
});

// ── GET /api/inventory/all?warehouse=01&top=100 ───────────────
// Lista todos los artículos (paginado, máx 200)
router.get('/all', async (req, res) => {
  try {
    const wh  = (req.query.warehouse || '').trim();
    const top = Math.min(parseInt(req.query.top) || 100, 200);

    const select = 'ItemCode,ItemName,QuantityOnStock,SalesUnit,ItemWarehouseInfoCollection';
    const filter = 'QuantityOnStock ge 0'; // Solo artículos de venta
    const { data } = await sapClient.get(
      `/Items?$filter=${encodeURIComponent(filter)}&$select=${select}&$top=${top}&$orderby=ItemCode asc`
    );

    let items = (data.value || []).map((item) => ({
      code:       item.ItemCode,
      name:       item.ItemName,
      totalStock: item.QuantityOnStock,
      unit:       item.SalesUnit || 'UND',
      warehouses: (item.ItemWarehouseInfoCollection || []).map((w) => ({
        warehouse: w.WarehouseCode,
        inStock:   w.InStock,
        available: w.InStock - w.Committed,
      })),
    }));

    if (wh) {
      items = items.map((i) => ({
        ...i,
        warehouses: i.warehouses.filter((w) => w.warehouse === wh),
      })).filter((i) => i.warehouses.length > 0);
    }

    res.json(items);
  } catch (err) {
    handleSapError(err, res);
  }
});

function handleSapError(err, res) {
  console.error('[SAP Inventory Error]', err.response?.data || err.message);
  const status = err.response?.status || 500;
  const msg    = err.response?.data?.error?.message?.value || err.message || 'Error SAP';
  res.status(status).json({ error: msg });
}

module.exports = router;
