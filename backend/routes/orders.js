// routes/orders.js
// Crea y consulta órdenes de venta en SAP Business One
// Endpoints SAP:
//   POST /b1s/v1/Orders           — crear orden
//   GET  /b1s/v1/Orders(ID)       — detalle de una orden
//   GET  /b1s/v1/Orders?$filter=  — listar órdenes

const router        = require('express').Router();
const auth          = require('../middleware/auth');
const { sapClient } = require('../config/sap');

router.use(auth);

// ── POST /api/orders ──────────────────────────────────────────
// Crea una nueva orden de venta en SAP
// Body esperado:
// {
//   cardCode: "C-001",
//   docDate:  "2025-05-19",       // YYYY-MM-DD  (opcional, default hoy)
//   docDueDate: "2025-05-26",     // Fecha de entrega
//   comments: "...",
//   lines: [
//     { itemCode: "A-100", quantity: 5, unitPrice: 65.00, warehouseCode: "01" }
//   ]
// }
router.post('/', async (req, res) => {
  try {
    const { cardCode, docDate, docDueDate, comments, lines } = req.body;

    if (!cardCode)              return res.status(400).json({ error: 'cardCode requerido' });
    if (!lines || !lines.length) return res.status(400).json({ error: 'Debe incluir al menos una línea' });

    const today = new Date().toISOString().split('T')[0];

    const sapOrder = {
      CardCode:   cardCode.toUpperCase(),
      DocDate:    docDate    || today,
      DocDueDate: docDueDate || today,
      Comments:   comments  || '',
      DocumentLines: lines.map((l) => ({
        ItemCode:      l.itemCode.toUpperCase(),
        Quantity:      Number(l.quantity),
        UnitPrice:     Number(l.unitPrice),
        WarehouseCode: l.warehouseCode || '01',
        // TaxCode: 'IVA' — descomenta si tu SAP maneja impuestos por línea
      })),
    };

    const { data } = await sapClient.post('/Orders', sapOrder);

    res.status(201).json({
      docEntry:  data.DocEntry,
      docNum:    data.DocNum,
      cardCode:  data.CardCode,
      cardName:  data.CardName,
      docTotal:  data.DocTotal,
      docDate:   data.DocDate,
      docStatus: data.DocumentStatus,
    });
  } catch (err) {
    handleSapError(err, res);
  }
});

// ── GET /api/orders?top=20&cardCode=C-001 ─────────────────────
// Lista órdenes recientes (últimas N, opcionalmente filtradas por cliente)
router.get('/', async (req, res) => {
  try {
    const top      = Math.min(parseInt(req.query.top) || 20, 100);
    const cardCode = (req.query.cardCode || '').trim().toUpperCase();

    const select = 'DocEntry,DocNum,CardCode,CardName,DocDate,DocDueDate,DocTotal,DocumentStatus';
    let filter   = "DocumentStatus eq 'O' or DocumentStatus eq 'C'"; // Abiertas y cerradas
    if (cardCode) filter = `CardCode eq '${cardCode}'`;

    const { data } = await sapClient.get(
      `/Orders?$select=${select}&$filter=${encodeURIComponent(filter)}&$top=${top}&$orderby=DocDate desc`
    );

    const orders = (data.value || []).map((o) => ({
      docEntry:  o.DocEntry,
      docNum:    o.DocNum,
      cardCode:  o.CardCode,
      cardName:  o.CardName,
      docDate:   o.DocDate?.split('T')[0],
      dueDate:   o.DocDueDate?.split('T')[0],
      total:     o.DocTotal,
      status:    o.DocumentStatus === 'O' ? 'open' : 'closed',
    }));

    res.json(orders);
  } catch (err) {
    handleSapError(err, res);
  }
});

// ── GET /api/orders/:docEntry ─────────────────────────────────
// Detalle completo de una orden
router.get('/:docEntry', async (req, res) => {
  try {
    const { data } = await sapClient.get(`/Orders(${req.params.docEntry})`);

    res.json({
      docEntry:  data.DocEntry,
      docNum:    data.DocNum,
      cardCode:  data.CardCode,
      cardName:  data.CardName,
      docDate:   data.DocDate?.split('T')[0],
      dueDate:   data.DocDueDate?.split('T')[0],
      comments:  data.Comments,
      docTotal:  data.DocTotal,
      vatTotal:  data.VatSum,
      status:    data.DocumentStatus,
      lines: (data.DocumentLines || []).map((l) => ({
        lineNum:    l.LineNum,
        itemCode:   l.ItemCode,
        itemDesc:   l.ItemDescription,
        quantity:   l.Quantity,
        unitPrice:  l.UnitPrice,
        lineTotal:  l.LineTotal,
        warehouse:  l.WarehouseCode,
      })),
    });
  } catch (err) {
    handleSapError(err, res);
  }
});

function handleSapError(err, res) {
  console.error('[SAP Orders Error]', err.response?.data || err.message);
  const status = err.response?.status || 500;
  const msg    = err.response?.data?.error?.message?.value || err.message || 'Error SAP';
  res.status(status).json({ error: msg });
}

module.exports = router;
