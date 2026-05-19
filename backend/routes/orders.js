// routes/orders.js — SAP B1 9.3, DocEntry generado manualmente
const router              = require('express').Router();
const auth                = require('../middleware/auth');
const { query, sql, getPool } = require('../config/db');
const mssql               = require('mssql');

router.use(auth);

// Obtiene el próximo DocEntry disponible
async function getNextDocEntry(transaction) {
  const req = new mssql.Request(transaction);
  const res = await req.query(`
    SELECT ISNULL(MAX(DocEntry),0) + 1 AS NextDocEntry
    FROM (
      SELECT DocEntry FROM ORDR
      UNION ALL SELECT DocEntry FROM OINV
      UNION ALL SELECT DocEntry FROM OPCH
      UNION ALL SELECT DocEntry FROM ORCT
    ) T
  `);
  return res.recordset[0].NextDocEntry;
}

// GET /api/orders?top=20&cardCode=C001
router.get('/', async (req, res) => {
  try {
    const top      = Math.min(parseInt(req.query.top) || 20, 100);
    const cardCode = (req.query.cardCode || '').trim().toUpperCase();
    const ccFilter = cardCode ? 'AND T0.CardCode = @cardCode' : '';

    const result = await query(`
      SELECT TOP ${top}
        T0.DocEntry, T0.DocNum, T0.CardCode, T0.CardName,
        CONVERT(VARCHAR, T0.DocDate,    23) AS DocDate,
        CONVERT(VARCHAR, T0.DocDueDate, 23) AS DocDueDate,
        T0.DocTotal, T0.DocStatus, T0.Comments
      FROM ORDR T0
      WHERE T0.CANCELED = 'N' ${ccFilter}
      ORDER BY T0.DocDate DESC, T0.DocNum DESC
    `, cardCode ? { cardCode: { type: sql.NVarChar, value: cardCode } } : {});

    res.json(result.recordset.map(o => ({
      docEntry: o.DocEntry, docNum: o.DocNum,
      cardCode: o.CardCode, cardName: o.CardName,
      docDate: o.DocDate,   dueDate: o.DocDueDate,
      total: o.DocTotal,    status: o.DocStatus === 'O' ? 'open' : 'closed',
      comments: o.Comments,
    })));
  } catch (err) { handleError(err, res); }
});

// GET /api/orders/:docEntry
router.get('/:docEntry', async (req, res) => {
  try {
    const docEntry = parseInt(req.params.docEntry);
    const header = await query(`
      SELECT DocEntry, DocNum, CardCode, CardName,
        CONVERT(VARCHAR, DocDate,    23) AS DocDate,
        CONVERT(VARCHAR, DocDueDate, 23) AS DocDueDate,
        DocTotal, VatSum, DocStatus, Comments
      FROM ORDR WHERE DocEntry = @docEntry
    `, { docEntry: { type: sql.Int, value: docEntry } });

    if (!header.recordset.length)
      return res.status(404).json({ error: 'Orden no encontrada' });

    const lines = await query(`
      SELECT LineNum, ItemCode, Dscription AS ItemName,
             Quantity, Price AS UnitPrice, LineTotal, WhsCode
      FROM RDR1 WHERE DocEntry = @docEntry ORDER BY LineNum
    `, { docEntry: { type: sql.Int, value: docEntry } });

    const h = header.recordset[0];
    res.json({
      docEntry: h.DocEntry, docNum: h.DocNum,
      cardCode: h.CardCode, cardName: h.CardName,
      docDate: h.DocDate,   dueDate: h.DocDueDate,
      total: h.DocTotal,    vatTotal: h.VatSum,
      status: h.DocStatus,  comments: h.Comments,
      lines: lines.recordset.map(l => ({
        lineNum: l.LineNum,   itemCode: l.ItemCode,
        itemName: l.ItemName, quantity: l.Quantity,
        unitPrice: l.UnitPrice, lineTotal: l.LineTotal,
        warehouse: l.WhsCode,
      })),
    });
  } catch (err) { handleError(err, res); }
});

// POST /api/orders
router.post('/', async (req, res) => {
  const { cardCode, docDueDate, comments, lines } = req.body;
  if (!cardCode)      return res.status(400).json({ error: 'cardCode requerido' });
  if (!lines?.length) return res.status(400).json({ error: 'Líneas requeridas' });

  const pool        = await getPool();
  const transaction = new mssql.Transaction(pool);

  try {
    await transaction.begin();

    // 1. Validar cliente
    const bpReq = new mssql.Request(transaction);
    const bpRes = await bpReq
      .input('cardCode', mssql.NVarChar, cardCode.toUpperCase())
      .query(`SELECT CardCode, CardName, Currency FROM OCRD WHERE CardCode = @cardCode AND CardType = 'C'`);
    if (!bpRes.recordset.length) throw new Error(`Cliente ${cardCode} no encontrado`);
    const bp = bpRes.recordset[0];

    // 2. Obtener numerador SAP (DocNum)
    const numReq = new mssql.Request(transaction);
    const numRes = await numReq.query(`
      SELECT TOP 1 NextNumber, Series FROM NNM1
      WHERE ObjectCode = '17' AND Locked = 'N' ORDER BY Series
    `);
    if (!numRes.recordset.length) throw new Error('No se pudo obtener numerador SAP');
    const nextNum = numRes.recordset[0].NextNumber;
    const series  = numRes.recordset[0].Series;

    // 3. Obtener DocEntry
    const docEntry = await getNextDocEntry(transaction);

    // 4. Calcular totales
    const docSubTot = lines.reduce((s, l) => s + (l.quantity * l.unitPrice), 0);
    const vatSum    = Math.round(docSubTot * 0.12 * 100) / 100;
    const docTotal  = Math.round((docSubTot + vatSum) * 100) / 100;
    const today     = new Date().toISOString().split('T')[0];
    const dueDate   = docDueDate || today;

    // 5. Insertar cabecera ORDR
    const hReq = new mssql.Request(transaction);
    await hReq
      .input('docEntry', mssql.Int,      docEntry)
      .input('docNum',   mssql.Int,      nextNum)
      .input('series',   mssql.SmallInt, series)
      .input('cardCode', mssql.NVarChar, bp.CardCode)
      .input('cardName', mssql.NVarChar, bp.CardName)
      .input('docDate',  mssql.DateTime, new Date(today))
      .input('dueDate',  mssql.DateTime, new Date(dueDate))
      .input('comments', mssql.NVarChar, comments || '')
      .input('vatSum',   mssql.Money,    vatSum)
      .input('docTotal', mssql.Money,    docTotal)
      .input('currency', mssql.NVarChar, bp.Currency || 'GTQ')
      .query(`
        INSERT INTO ORDR (
          DocEntry, DocNum, Series, CardCode, CardName,
          DocDate, DocDueDate, TaxDate,
          DocStatus, CANCELED, DocType,
          Comments, DocCur, VatSum, DocTotal,
          ObjType, UserSign
        ) VALUES (
          @docEntry, @docNum, @series, @cardCode, @cardName,
          @docDate, @dueDate, @docDate,
          'O', 'N', 'I',
          @comments, @currency, @vatSum, @docTotal,
          '17', 1
        )
      `);

    // 6. Insertar líneas RDR1
    for (let i = 0; i < lines.length; i++) {
      const l     = lines[i];
      const total = Math.round(l.quantity * l.unitPrice * 100) / 100;
      const lReq  = new mssql.Request(transaction);
      await lReq
        .input('docEntry',  mssql.Int,      docEntry)
        .input('lineNum',   mssql.Int,      i)
        .input('itemCode',  mssql.NVarChar, l.itemCode.toUpperCase())
        .input('qty',       mssql.Money,    l.quantity)
        .input('price',     mssql.Money,    l.unitPrice)
        .input('lineTotal', mssql.Money,    total)
        .input('whsCode',   mssql.NVarChar, l.warehouseCode || '01')
        .query(`
          INSERT INTO RDR1 (
            DocEntry, LineNum, ItemCode,
            Quantity, Price, LineTotal,
            WhsCode, ObjType, LineStatus
          ) VALUES (
            @docEntry, @lineNum, @itemCode,
            @qty, @price, @lineTotal,
            @whsCode, '17', 'O'
          )
        `);
    }

    // 7. Actualizar numerador SAP
    const nReq = new mssql.Request(transaction);
    await nReq
      .input('series', mssql.SmallInt, series)
      .query(`UPDATE NNM1 SET NextNumber = NextNumber + 1 WHERE Series = @series`);

    await transaction.commit();

    res.status(201).json({
      docEntry, docNum: nextNum,
      cardCode: bp.CardCode, cardName: bp.CardName,
      docTotal, status: 'open',
    });

  } catch (err) {
    await transaction.rollback().catch(() => {});
    console.error('[Orders Create Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

function handleError(err, res) {
  console.error('[Orders Error]', err.message);
  res.status(500).json({ error: err.message });
}

module.exports = router;
