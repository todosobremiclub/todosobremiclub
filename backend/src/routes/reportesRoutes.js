// routes/reportesRoutes.js
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const router = express.Router();

// ===== EXPORT HELPERS =====
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

function sendPDF(res, title, columns, rows) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });

  // Headers
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${String(title).replace(/\s+/g, '_')}.pdf"`
  );

  // Evitar crash si el cliente corta la descarga
  res.on('close', () => {
    try { doc.end(); } catch {}
  });

  // Evitar crash por errores internos de PDFKit
  doc.on('error', (err) => {
    console.error('❌ PDFKit error', err);
    try {
      if (!res.headersSent) res.status(500);
      res.end();
    } catch {}
  });

  doc.pipe(res);

  // ===== TÍTULO =====
  doc.font('Helvetica-Bold').fontSize(16).text(title, { align: 'center' });
  doc.moveDown(1);

  const startX = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // ===== ANCHOS DINÁMICOS (evita NaN) =====
  // Si alguna columna trae width, lo respeta. Si no, reparte equitativo.
  const baseW = Math.floor(pageWidth / Math.max(1, columns.length));
  const colWidths = columns.map(c => {
    const w = Number(c?.width);
    return Number.isFinite(w) && w > 10 ? w : baseW;
  });

  // Ajuste final: que la suma no exceda el ancho del page
  let sumW = colWidths.reduce((a, b) => a + b, 0);
  if (sumW > pageWidth) {
    // Escala proporcionalmente hacia abajo
    const factor = pageWidth / sumW;
    for (let i = 0; i < colWidths.length; i++) {
      colWidths[i] = Math.max(40, Math.floor(colWidths[i] * factor));
    }
  }
  // Rellenar diferencia por redondeo en la última columna
  sumW = colWidths.reduce((a, b) => a + b, 0);
  if (colWidths.length) colWidths[colWidths.length - 1] += (pageWidth - sumW);

  const rowHeight = 16;
  let y = doc.y + 6;

  // ===== HEADER =====
  doc.fontSize(10).font('Helvetica-Bold');
  let x = startX;
  columns.forEach((col, i) => {
    doc.text(String(col.label ?? ''), x, y, { width: colWidths[i], align: 'left' });
    x += colWidths[i];
  });

  y += rowHeight;
  doc.moveTo(startX, y - 4).lineTo(startX + pageWidth, y - 4).stroke();

  // ===== FILAS =====
  const tableFont = columns.length >= 7 ? 8 : 9;
doc.font('Helvetica').fontSize(tableFont);

  rows.forEach((row) => {
    x = startX;
    columns.forEach((col, i) => {
      const value = row?.[col.key] ?? '';
      // Texto acotado para no romper layout
      const txt = String(value);
      doc.text(txt, x, y, {
  width: colWidths[i],
  align: 'left',
  lineBreak: false,
  ellipsis: true
});
      x += colWidths[i];
    });

    y += rowHeight;

    // Salto de página seguro
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = doc.page.margins.top;

      // Repetir header en nueva página
      doc.fontSize(10).font('Helvetica-Bold');
      x = startX;
      columns.forEach((col, i) => {
        doc.text(String(col.label ?? ''), x, y, { width: colWidths[i], align: 'left' });
        x += colWidths[i];
      });
      y += rowHeight;
      doc.moveTo(startX, y - 4).lineTo(startX + pageWidth, y - 4).stroke();

      const tableFont = columns.length >= 7 ? 8 : 9;
doc.font('Helvetica').fontSize(tableFont);
    }
  });

  doc.end();
}

async function sendExcel(res, title, columns, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Reporte');

  ws.columns = columns.map(c => ({
    header: c.label,
    key: c.key,
    width: 25
  }));

  rows.forEach(r => ws.addRow(r));

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${title.replace(/\s+/g, '_')}.xlsx"`
  );

  await wb.xlsx.write(res);
  res.end();
}

// ===============================
// Helper: validar acceso al club
// ===============================
function requireClubAccess(req, res, next) {
  const { clubId } = req.params;
  const roles = req.user?.roles ?? [];
  const allowed = roles.some(
    r => String(r.club_id) === String(clubId) || r.role === 'superadmin'
  );
  if (!allowed) {
    return res.status(403).json({ ok: false, error: 'No autorizado para este club' });
  }
  next();
}

// Helper común para año (default año actual)
function getYearFromQuery(q) {
  const n = Number(q?.anio);
  const now = new Date();
  return n && n >= 2000 && n <= 2100 ? n : now.getFullYear();
}
// ===============================
// 1) Socios por Actividad / Categoría
// Vista principal: SOLO por Actividad (retraído)
// El detalle por Categoría se obtiene desde /detalle
// ===============================
router.get('/:clubId/reportes/socios-actividad-categoria', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;

  try {
    // 1) Obtener totales por ACTIVIDAD
    const r = await db.query(
      `
      SELECT
        COALESCE(actividad, 'Sin actividad') AS actividad,
        COUNT(*) AS total
      FROM socios
      WHERE club_id = $1
        AND activo = true
      GROUP BY actividad
      ORDER BY actividad
      `,
      [clubId]
    );

    // Formato de salida para tabla dinámica
    const rows = r.rows.map(row => ({
      actividad: row.actividad,
      cantidad: Number(row.total),
      // Esto le sirve al front para saber que tiene detalle
      _hasChildren: true    
    }));

    res.json({
      ok: true,
      title: 'Socios por Actividad',
      description: 'Total de socios activos agrupados por actividad. Hacé clic para ver categorías dentro de cada actividad.',
      columns: [
        { key: 'actividad', label: 'Actividad' },
        { key: 'cantidad', label: 'Total' }
      ],
      rows
    });

  } catch (e) {
    console.error('❌ reporte socios-actividad-categoria', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// DETALLE: Socios por Actividad → Categorías
// ===============================
router.get('/:clubId/reportes/socios-actividad-categoria/detalle', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const actividad = req.query.actividad ?? '';

  try {
    const r = await db.query(
      `
      SELECT
        COALESCE(categoria, 'Sin categoría') AS categoria,
        COUNT(*) AS cantidad
      FROM socios
      WHERE club_id = $1
        AND activo = true
        AND COALESCE(actividad, 'Sin actividad') = $2
      GROUP BY categoria
      ORDER BY categoria
      `,
      [clubId, actividad]
    );

    res.json({
      ok: true,
      rows: r.rows
    });

  } catch (e) {
    console.error('❌ detalle socios-actividad-categoria', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// EXPORT: Socios por Actividad / Categoría (MES o AÑO)
// Endpoints:
//  - /club/:clubId/reportes/socios-actividad-categoria/export/pdf?anio=2026&mes=4&modo=actividades
//  - /club/:clubId/reportes/socios-actividad-categoria/export/excel?anio=2026&modo=categorias&actividad=Futbol
// Parámetros:
//  - anio (obligatorio)
//  - mes  (opcional: si viene => exporta por mes; si no => por año)
//  - modo = "actividades" | "categorias"  (opcional; default "actividades")
//  - actividad (solo si modo="categorias")
// ============================================================

function endOfPeriodISO(anio, mes) {
  const y = Number(anio);
  if (!y || y < 2000 || y > 2100) return null;

  if (mes) {
    const m = Number(mes);
    if (!m || m < 1 || m > 12) return null;
    const lastDay = new Date(y, m, 0); // último día del mes
    return lastDay.toISOString().slice(0, 10);
  }

  return `${y}-12-31`; // fin de año
}

async function getSociosActCatExportData(clubId, q) {
  const { anio, mes, modo = 'actividades', actividad = '' } = q;
  const cutoff = endOfPeriodISO(anio, mes);
  if (!cutoff) throw new Error('Parámetros inválidos: anio obligatorio y mes opcional (1-12)');

  const periodoLabel = mes
    ? `${anio}-${String(mes).padStart(2, '0')}`
    : String(anio);

  // 📌 Si modo = categorias, devolvemos categorías dentro de UNA actividad
  if (String(modo).toLowerCase() === 'categorias') {
    const act = String(actividad || '').trim();
    const actFinal = act || 'Sin actividad';

    const r = await db.query(
      `
      SELECT
        COALESCE(categoria, 'Sin categoría') AS categoria,
        COUNT(*)::int AS cantidad
      FROM socios
      WHERE club_id = $1
        AND activo = true
        AND (fecha_ingreso IS NULL OR fecha_ingreso::date <= $2::date)
        AND COALESCE(actividad, 'Sin actividad') = $3
      GROUP BY categoria
      ORDER BY categoria
      `,
      [clubId, cutoff, actFinal]
    );

    return {
      title: `Socios por Categoría (${actFinal}) ${periodoLabel}`,
      columns: [
        { key: 'categoria', label: 'Categoría' },
        { key: 'cantidad', label: 'Cantidad' }
      ],
      rows: r.rows
    };
  }

  // 📌 Default: modo = actividades
  const r = await db.query(
    `
    SELECT
      COALESCE(actividad, 'Sin actividad') AS actividad,
      COUNT(*)::int AS cantidad
    FROM socios
    WHERE club_id = $1
      AND activo = true
      AND (fecha_ingreso IS NULL OR fecha_ingreso::date <= $2::date)
    GROUP BY actividad
    ORDER BY actividad
    `,
    [clubId, cutoff]
  );

  return {
    title: `Socios por Actividad ${periodoLabel}`,
    columns: [
      { key: 'actividad', label: 'Actividad' },
      { key: 'cantidad', label: 'Cantidad' }
    ],
    rows: r.rows
  };
}

// PDF
router.get(
  '/:clubId/reportes/socios-actividad-categoria/export/pdf',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    try {
      const { clubId } = req.params;

      const data =
        (req.query.extra === 'actual' || !req.query.anio)
          ? await getSociosActCatActualDetalle(clubId, req.query)
          : await getSociosActCatExportData(clubId, req.query);

      // ✅ PDF usa sendPDF
      sendPDF(res, data.title, data.columns, data.rows);
    } catch (e) {
      console.error('❌ export pdf socios-actividad-categoria', e);
      res.status(400).json({ ok: false, error: e.message });
    }
  }
);

// EXCEL
router.get(
  '/:clubId/reportes/socios-actividad-categoria/export/excel',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    try {
      const { clubId } = req.params;

      const data =
        (req.query.extra === 'actual' || !req.query.anio)
          ? await getSociosActCatActualDetalle(clubId, req.query)
          : await getSociosActCatExportData(clubId, req.query);

      await sendExcel(res, data.title, data.columns, data.rows);
    } catch (e) {
      console.error('❌ export excel socios-actividad-categoria', e);
      res.status(400).json({ ok: false, error: e.message });
    }
  }
);

async function getSociosActCatActualDetalle(clubId, q) {
  const { modo = 'actividades', actividad = '' } = q;

  let where = ['club_id = $1', 'activo = true'];
  let params = [clubId];
  let p = 2;

  if (modo === 'categorias' && actividad) {
    where.push(`actividad = $${p++}`);
    params.push(actividad);
  }

  const qSocios = `
    SELECT
      apellido,
      nombre,
      dni,
      actividad,
      categoria
    FROM socios
    WHERE ${where.join(' AND ')}
    ORDER BY actividad, categoria, apellido, nombre
  `;

  const r = await db.query(qSocios, params);

  return {
    title: 'Socios por Actividad y Categoría (Actual)',
    columns: [
      { key: 'apellido', label: 'Apellido' },
      { key: 'nombre', label: 'Nombre' },
      { key: 'dni', label: 'DNI' },
      { key: 'actividad', label: 'Actividad' },
      { key: 'categoria', label: 'Categoría' },
    ],
    rows: r.rows,
  };
}
// ===============================
// 2) Socios nuevos x fecha de ingreso x AÑO
// GET /club/:clubId/reportes/socios-nuevos-mes
// ===============================
router.get('/:clubId/reportes/socios-nuevos-mes', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;

  try {
    const r = await db.query(
      `
      SELECT
        EXTRACT(YEAR FROM fecha_ingreso)::int AS anio,
        COUNT(*) AS total
      FROM socios
      WHERE club_id = $1
        AND fecha_ingreso IS NOT NULL
      GROUP BY anio
      ORDER BY anio
      `,
      [clubId]
    );

    // Cada año tendrá flecha (_hasChildren) para desplegar meses
    const rows = r.rows.map(row => ({
      anio: row.anio,
      cantidad: Number(row.total),
      _hasChildren: true
    }));

    res.json({
      ok: true,
      title: 'Socios nuevos por año',
      description: 'Cantidad de socios ingresados por año. Hacé clic en un año para ver el detalle por mes.',
      columns: [
        { key: 'anio',     label: 'Año' },
        { key: 'cantidad', label: 'Cantidad' }
      ],
      rows
    });

  } catch (e) {
    console.error('❌ reporte socios-nuevos-mes', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// DETALLE MESES: Socios nuevos por mes dentro de un año
// GET /club/:clubId/reportes/socios-nuevos-mes/meses?anio=2024
// ===============================
router.get('/:clubId/reportes/socios-nuevos-mes/meses', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const anio = Number(req.query.anio);

  if (!anio) {
    return res.status(400).json({ ok: false, error: 'Parametro "anio" es obligatorio' });
  }

  const MESES = [
    'Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
  ];

  try {
    const r = await db.query(
      `
      SELECT
        EXTRACT(MONTH FROM fecha_ingreso)::int AS mes_num,
        COUNT(*) AS cantidad
      FROM socios
      WHERE club_id = $1
        AND fecha_ingreso IS NOT NULL
        AND EXTRACT(YEAR FROM fecha_ingreso) = $2
      GROUP BY mes_num
      ORDER BY mes_num
      `,
      [clubId, anio]
    );

    const rows = r.rows.map(row => ({
      mes: MESES[row.mes_num - 1],
      cantidad: Number(row.cantidad),
      mes_num: row.mes_num        // 👈 NUEVO
    }));

    res.json({ ok: true, rows });

  } catch (e) {
    console.error('❌ detalle meses socios-nuevos-mes', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});


// ===============================
// 3) Ingreso por fecha de pago (AÑO → detalle por MES)
// ===============================
router.get('/:clubId/reportes/ingreso-fecha-pago', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const { desde, hasta } = req.query;

  const MESES = [
    'Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
  ];

  try {
    const where = ['pm.club_id = $1'];
    const params = [clubId];
    let p = 2;

    if (desde) { where.push(`pm.fecha_pago >= $${p++}`); params.push(desde); }
    if (hasta) { where.push(`pm.fecha_pago <= $${p++}`); params.push(hasta); }

    const q = `
      SELECT
        EXTRACT(YEAR FROM pm.fecha_pago)::int AS anio,
        SUM(pm.monto) AS total
      FROM pagos_mensuales pm
      WHERE ${where.join(' AND ')}
      GROUP BY EXTRACT(YEAR FROM pm.fecha_pago)
      ORDER BY EXTRACT(YEAR FROM pm.fecha_pago)
    `;

    const r = await db.query(q, params);

    const rows = r.rows.map(x => ({
      anio: x.anio,
      total: Number(x.total),
      _hasChildren: true
    }));

    res.json({
      ok: true,
      title: 'Ingresos por fecha de pago (por Año)',
      description: 'Hacé clic en un año para ver los montos por mes.',
      columns: [
        { key: 'anio', label: 'Año' },
        { key: 'total', label: 'Total (ARS)' }
      ],
      rows
    });

  } catch (e) {
    console.error('❌ ingreso-fecha-pago', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});
// ===============================
// DETALLE: Ingreso por fecha de pago → meses
// GET /club/:clubId/reportes/ingreso-fecha-pago/meses?anio=2024
// ===============================
router.get('/:clubId/reportes/ingreso-fecha-pago/meses', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const anio = Number(req.query.anio);

  if (!anio) {
    return res.status(400).json({ ok: false, error: 'Falta el parámetro anio' });
  }

  const MESES = [
    'Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
  ];

  try {
    const q = `
      SELECT
        EXTRACT(MONTH FROM pm.fecha_pago)::int AS mes_num,
        SUM(pm.monto) AS total
      FROM pagos_mensuales pm
      WHERE pm.club_id = $1
        AND EXTRACT(YEAR FROM pm.fecha_pago) = $2
      GROUP BY mes_num
      ORDER BY mes_num;
    `;

    const r = await db.query(q, [clubId, anio]);

    const rows = r.rows.map(row => ({
      mes: MESES[row.mes_num - 1],
      total: Number(row.total)
    }));

    res.json({ ok: true, rows });

  } catch (e) {
    console.error('❌ ingreso-fecha-pago/meses', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});


// ===============================
// 4) Ingreso por mes pagado (AÑO → detalle por MES PAGADO)
// ===============================
router.get('/:clubId/reportes/ingreso-mes-pagado', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;

  try {
    const r = await db.query(
      `
      SELECT
        pm.anio AS anio,
        SUM(pm.monto) AS total
      FROM pagos_mensuales pm
      WHERE pm.club_id = $1
      GROUP BY pm.anio
      ORDER BY pm.anio
      `,
      [clubId]
    );

    const rows = r.rows.map(row => ({
      anio: row.anio,
      total: Number(row.total),
      _hasChildren: true
    }));

    res.json({
      ok: true,
      title: 'Ingresos por mes pagado (por Año)',
      description: 'Totales agrupados por año. Hacé clic para ver los montos por mes pagado.',
      columns: [
        { key: 'anio',  label: 'Año' },
        { key: 'total', label: 'Total (ARS)' }
      ],
      rows
    });

  } catch (e) {
    console.error('❌ ingreso-mes-pagado', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// DETALLE: Ingreso por mes pagado → meses
// GET /club/:clubId/reportes/ingreso-mes-pagado/meses?anio=2024
// ===============================
router.get('/:clubId/reportes/ingreso-mes-pagado/meses', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const anio = Number(req.query.anio);

  if (!anio) {
    return res.status(400).json({ ok: false, error: 'Falta parámetro anio' });
  }

  const MESES = [
    'Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
  ];

  try {
    const q = `
      SELECT
        pm.mes AS mes_num,
        SUM(pm.monto) AS total
      FROM pagos_mensuales pm
      WHERE pm.club_id = $1
        AND pm.anio = $2
      GROUP BY mes_num
      ORDER BY mes_num
    `;

    const r = await db.query(q, [clubId, anio]);

    res.json({
      ok: true,
      rows: r.rows.map(row => ({
        mes: MESES[row.mes_num - 1],
        total: Number(row.total)
      }))
    });

  } catch (e) {
    console.error('❌ ingreso-mes-pagado/meses', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// NUEVO: Socios impagos por mes (por AÑO)
// GET /club/:clubId/reportes/impagos-mes?anio=2026
// ===============================
router.get(
  '/:clubId/reportes/impagos-mes',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const anio = getYearFromQuery(req.query); // helper ya definido arriba
    const MESES = [
      'Enero','Febrero','Marzo','Abril','Mayo','Junio',
      'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
    ];

    try {
      const q = `
        WITH meses AS (
          SELECT generate_series(1,12)::int AS mes_num
        ),
        socios_activos AS (
          SELECT id, fecha_ingreso
          FROM socios
          WHERE club_id = $1
            AND activo = true
        ),
        base AS (
          -- Para cada socio activo y cada mes del año, determinamos si debería pagar
          SELECT
            m.mes_num,
            s.id AS socio_id
          FROM meses m
          CROSS JOIN socios_activos s
          WHERE
            s.fecha_ingreso IS NULL
            OR EXTRACT(YEAR FROM s.fecha_ingreso) < $2
            OR (
              EXTRACT(YEAR FROM s.fecha_ingreso) = $2
              AND EXTRACT(MONTH FROM s.fecha_ingreso) <= m.mes_num
            )
        ),
        pagos AS (
          SELECT socio_id, mes AS mes_num
          FROM pagos_mensuales
          WHERE club_id = $1
            AND anio = $2
        )
        SELECT
          b.mes_num,
          COUNT(*) AS cantidad
        FROM base b
        LEFT JOIN pagos p
          ON p.socio_id = b.socio_id
         AND p.mes_num = b.mes_num
        WHERE p.socio_id IS NULL
        GROUP BY b.mes_num
        ORDER BY b.mes_num;
      `;

      const r = await db.query(q, [clubId, anio]);

      // Filtrar meses según fecha actual
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      const rowsRaw = r.rows.map((row) => ({
        anio,
        mes: MESES[row.mes_num - 1],
        cantidad: Number(row.cantidad),
        mes_num: row.mes_num,
      }));

      const rows =
        anio === currentYear
          ? rowsRaw.filter((x) => x.mes_num <= currentMonth)
          : rowsRaw;

      return res.json({
        ok: true,
        title: `Socios impagos por mes`,
        description:
          'Cantidad de socios activos que no registran pago en el mes indicado, considerando la fecha de ingreso (no se muestran meses anteriores al ingreso del socio).',
        columns: [
          { key: 'mes', label: 'Mes' },
          { key: 'cantidad', label: 'Socios sin pago' }
        ],
        rows
      });
    } catch (e) {
      console.error('❌ reporte impagos-mes', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// DETALLE: Socios impagos por mes (paginado)
// GET /club/:clubId/reportes/impagos-mes/detalle?anio=2026&mes=3&limit=20&offset=0
// ===============================
router.get(
  '/:clubId/reportes/impagos-mes/detalle',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const anio = Number(req.query.anio);
    const mes = Number(req.query.mes);
    const limit = Math.min(Number(req.query.limit) || 20, 100); // máx 100
    const offset = Number(req.query.offset) || 0;

    if (!anio || !mes) {
      return res
        .status(400)
        .json({ ok: false, error: 'anio y mes son obligatorios' });
    }

    try {
      const qDetalle = `
        SELECT
          s.id,
          s.numero_socio,
          s.dni,
          s.nombre,
          s.apellido,
          s.actividad,
          s.categoria,
          s.telefono,
          s.fecha_ingreso
        FROM socios s
        LEFT JOIN pagos_mensuales pm
          ON pm.socio_id = s.id
         AND pm.club_id = $1
         AND pm.anio = $2
         AND pm.mes = $3
        WHERE s.club_id = $1
          AND s.activo = true
          -- No contar meses anteriores a la fecha de ingreso
          AND (
            s.fecha_ingreso IS NULL
            OR EXTRACT(YEAR FROM s.fecha_ingreso) < $2
            OR (
              EXTRACT(YEAR FROM s.fecha_ingreso) = $2
              AND EXTRACT(MONTH FROM s.fecha_ingreso) <= $3
            )
          )
          AND pm.id IS NULL
        ORDER BY s.numero_socio ASC
        LIMIT $4 OFFSET $5;
      `;

      const qCount = `
        SELECT COUNT(*) AS total
        FROM socios s
        LEFT JOIN pagos_mensuales pm
          ON pm.socio_id = s.id
         AND pm.club_id = $1
         AND pm.anio = $2
         AND pm.mes = $3
        WHERE s.club_id = $1
          AND s.activo = true
          AND (
            s.fecha_ingreso IS NULL
            OR EXTRACT(YEAR FROM s.fecha_ingreso) < $2
            OR (
              EXTRACT(YEAR FROM s.fecha_ingreso) = $2
              AND EXTRACT(MONTH FROM s.fecha_ingreso) <= $3
            )
          )
          AND pm.id IS NULL;
      `;

      const [rDetalle, rCount] = await Promise.all([
        db.query(qDetalle, [clubId, anio, mes, limit, offset]),
        db.query(qCount, [clubId, anio, mes])
      ]);

      const total = Number(rCount.rows[0].total);

      return res.json({
        ok: true,
        total,
        limit,
        offset,
        items: rDetalle.rows
      });
    } catch (e) {
      console.error('❌ detalle impagos-mes', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ============================================================
// EXPORT: Cuotas impagas (MES o AÑO)
// PDF:   /club/:clubId/reportes/impagos-mes/export/pdf?anio=2026&mes=4
// EXCEL: /club/:clubId/reportes/impagos-mes/export/excel?anio=2026&mes=4
// Si NO viene mes => resumen anual por mes
// ============================================================

// PDF
router.get(
  '/:clubId/reportes/impagos-mes/export/pdf',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const anio = Number(req.query.anio);
    const mes  = Number(req.query.mes);

    if (!anio) {
      return res.status(400).json({ ok: false, error: 'anio es obligatorio' });
    }

    try {
      // =========================
      // CASO AÑO: resumen por mes
      // =========================
      if (!mes) {
        const MESES = [
          'Enero','Febrero','Marzo','Abril','Mayo','Junio',
          'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
        ];

        const q = `
          WITH meses AS (
            SELECT generate_series(1,12)::int AS mes_num
          ),
          socios_activos AS (
            SELECT id, fecha_ingreso
            FROM socios
            WHERE club_id = $1
              AND activo = true
          ),
          base AS (
            SELECT
              m.mes_num,
              s.id AS socio_id
            FROM meses m
            CROSS JOIN socios_activos s
            WHERE
              s.fecha_ingreso IS NULL
              OR EXTRACT(YEAR FROM s.fecha_ingreso) < $2
              OR (
                EXTRACT(YEAR FROM s.fecha_ingreso) = $2
                AND EXTRACT(MONTH FROM s.fecha_ingreso) <= m.mes_num
              )
          ),
          pagos AS (
            SELECT socio_id, mes AS mes_num
            FROM pagos_mensuales
            WHERE club_id = $1
              AND anio = $2
          )
          SELECT
            b.mes_num,
            COUNT(*)::int AS cantidad
          FROM base b
          LEFT JOIN pagos p
            ON p.socio_id = b.socio_id
           AND p.mes_num = b.mes_num
          WHERE p.socio_id IS NULL
          GROUP BY b.mes_num
          ORDER BY b.mes_num;
        `;

        const r = await db.query(q, [clubId, anio]);
        const rows = r.rows.map(x => ({
          mes: MESES[x.mes_num - 1],
          cantidad: x.cantidad
        }));

        return sendPDF(
          res,
          `Cuotas_impagas_${anio}`,
          [
            { key: 'mes', label: 'Mes' },
            { key: 'cantidad', label: 'Socios sin pago' }
          ],
          rows
        );
      }

      // =========================
      // CASO MES: detalle de socios impagos
      // =========================
      if (mes < 1 || mes > 12) {
        return res.status(400).json({ ok: false, error: 'mes inválido (1-12)' });
      }

      const q = `
        SELECT
          s.numero_socio,
          s.dni,
          s.apellido,
          s.nombre,
          s.actividad,
          s.categoria,
          s.telefono,
          s.fecha_ingreso
        FROM socios s
        LEFT JOIN pagos_mensuales pm
          ON pm.socio_id = s.id
         AND pm.club_id = $1
         AND pm.anio = $2
         AND pm.mes = $3
        WHERE s.club_id = $1
          AND s.activo = true
          AND (
            s.fecha_ingreso IS NULL
            OR EXTRACT(YEAR FROM s.fecha_ingreso) < $2
            OR (
              EXTRACT(YEAR FROM s.fecha_ingreso) = $2
              AND EXTRACT(MONTH FROM s.fecha_ingreso) <= $3
            )
          )
          AND pm.id IS NULL
        ORDER BY s.numero_socio ASC
      `;

      const r = await db.query(q, [clubId, anio, mes]);

const rows = r.rows.map(s => ({
  ...s,
  fecha_ingreso: s.fecha_ingreso
    ? new Date(s.fecha_ingreso).toISOString().slice(0, 10) // yyyy-mm-dd
    : ''
}));

return sendPDF(
  res,
  `Cuotas_impagas_${anio}-${String(mes).padStart(2, '0')}`,
  [
    { key:'numero_socio', label:'N° Socio', width: 55 },
    { key:'dni',          label:'DNI',     width: 70 },
    { key:'apellido',     label:'Apellido',width: 85 },
    { key:'nombre',       label:'Nombre',  width: 85 },
    { key:'actividad',    label:'Actividad',width: 70 },
    { key:'categoria',    label:'Categoría',width: 70 },
    { key:'telefono',     label:'Teléfono', width: 75 },
    { key:'fecha_ingreso',label:'Fecha ing.',width: 60 }
  ],
  rows
);

    } catch (e) {
      console.error('❌ export pdf impagos-mes', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// EXCEL
router.get(
  '/:clubId/reportes/impagos-mes/export/excel',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const anio = Number(req.query.anio);
    const mes  = Number(req.query.mes);

    if (!anio) {
      return res.status(400).json({ ok: false, error: 'anio es obligatorio' });
    }

    try {
      // =========================
      // CASO AÑO: resumen por mes
      // =========================
      if (!mes) {
        const MESES = [
          'Enero','Febrero','Marzo','Abril','Mayo','Junio',
          'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
        ];

        const q = `
          WITH meses AS (
            SELECT generate_series(1,12)::int AS mes_num
          ),
          socios_activos AS (
            SELECT id, fecha_ingreso
            FROM socios
            WHERE club_id = $1
              AND activo = true
          ),
          base AS (
            SELECT
              m.mes_num,
              s.id AS socio_id
            FROM meses m
            CROSS JOIN socios_activos s
            WHERE
              s.fecha_ingreso IS NULL
              OR EXTRACT(YEAR FROM s.fecha_ingreso) < $2
              OR (
                EXTRACT(YEAR FROM s.fecha_ingreso) = $2
                AND EXTRACT(MONTH FROM s.fecha_ingreso) <= m.mes_num
              )
          ),
          pagos AS (
            SELECT socio_id, mes AS mes_num
            FROM pagos_mensuales
            WHERE club_id = $1
              AND anio = $2
          )
          SELECT
            b.mes_num,
            COUNT(*)::int AS cantidad
          FROM base b
          LEFT JOIN pagos p
            ON p.socio_id = b.socio_id
           AND p.mes_num = b.mes_num
          WHERE p.socio_id IS NULL
          GROUP BY b.mes_num
          ORDER BY b.mes_num;
        `;

        const r = await db.query(q, [clubId, anio]);
        const rows = r.rows.map(x => ({
          mes: MESES[x.mes_num - 1],
          cantidad: x.cantidad
        }));

        // ✅ FIX CLAVE: en EXCEL debe ser sendExcel (no sendPDF)
        return sendExcel(
          res,
          `Cuotas_impagas_${anio}`,
          [
            { key: 'mes', label: 'Mes' },
            { key: 'cantidad', label: 'Socios sin pago' }
          ],
          rows
        );
      }

      // =========================
      // CASO MES: detalle de socios impagos
      // =========================
      if (mes < 1 || mes > 12) {
        return res.status(400).json({ ok: false, error: 'mes inválido (1-12)' });
      }

      const q = `
        SELECT
          s.numero_socio,
          s.dni,
          s.apellido,
          s.nombre,
          s.actividad,
          s.categoria,
          s.telefono,
          s.fecha_ingreso
        FROM socios s
        LEFT JOIN pagos_mensuales pm
          ON pm.socio_id = s.id
         AND pm.club_id = $1
         AND pm.anio = $2
         AND pm.mes = $3
        WHERE s.club_id = $1
          AND s.activo = true
          AND (
            s.fecha_ingreso IS NULL
            OR EXTRACT(YEAR FROM s.fecha_ingreso) < $2
            OR (
              EXTRACT(YEAR FROM s.fecha_ingreso) = $2
              AND EXTRACT(MONTH FROM s.fecha_ingreso) <= $3
            )
          )
          AND pm.id IS NULL
        ORDER BY s.numero_socio ASC
      `;

      const r = await db.query(q, [clubId, anio, mes]);

      return sendExcel(
        res,
        `Cuotas_impagas_${anio}-${String(mes).padStart(2, '0')}`,
        [
          { key: 'numero_socio', label: 'N° Socio' },
          { key: 'dni',          label: 'DNI' },
          { key: 'apellido',     label: 'Apellido' },
          { key: 'nombre',       label: 'Nombre' },
          { key: 'actividad',    label: 'Actividad' },
          { key: 'categoria',    label: 'Categoría' },
          { key: 'telefono',     label: 'Teléfono' },
          { key: 'fecha_ingreso',label: 'Fecha ingreso' }
        ],
        r.rows
      );

    } catch (e) {
      console.error('❌ export excel impagos-mes', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// 5) Ingresos vs Gastos por año (cuotas + otros ingresos)
// ===============================
router.get('/:clubId/reportes/ingresos-vs-gastos',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;

    try {
      const q = `
        WITH cuotas AS (
          SELECT
            EXTRACT(YEAR FROM pm.fecha_pago)::int AS anio,
            SUM(pm.monto) AS total
          FROM pagos_mensuales pm
          WHERE pm.club_id = $1
          GROUP BY EXTRACT(YEAR FROM pm.fecha_pago)
        ),
        otros AS (
          SELECT
            EXTRACT(YEAR FROM ig.fecha)::int AS anio,
            SUM(ig.monto) AS total
          FROM ingresos_generales ig
          WHERE ig.club_id = $1
            AND ig.activo = true
          GROUP BY EXTRACT(YEAR FROM ig.fecha)
        ),
        ingresos AS (
          SELECT
            COALESCE(c.anio, o.anio) AS anio,
            COALESCE(c.total, 0) + COALESCE(o.total, 0) AS total_ingresos
          FROM cuotas c
          FULL OUTER JOIN otros o
            ON o.anio = c.anio
        ),
        gastos AS (
          SELECT
            EXTRACT(YEAR FROM g.periodo)::int AS anio,
            SUM(g.monto) AS total_gastos
          FROM gastos g
          WHERE g.club_id = $1
            AND g.activo = true
          GROUP BY EXTRACT(YEAR FROM g.periodo)
        )
        SELECT
          COALESCE(i.anio, g.anio) AS anio,
          COALESCE(i.total_ingresos, 0) AS ingresos,
          COALESCE(g.total_gastos, 0)   AS gastos
        FROM ingresos i
        FULL OUTER JOIN gastos g
          ON g.anio = i.anio
        ORDER BY anio;
      `;

      const r = await db.query(q, [clubId]);

      const rows = r.rows.map(row => ({
        anio: row.anio,
        ingresos: Number(row.ingresos),
        gastos: Number(row.gastos),
        _hasChildren: true
      }));

      res.json({
        ok: true,
        title: 'Ingresos vs Gastos por año',
        description: 'Totales anuales de ingresos y gastos. Hacé clic en un año para ver el detalle por mes.',
        columns: [
          { key: 'anio',     label: 'Año' },
          { key: 'ingresos', label: 'Ingresos (ARS)' },
          { key: 'gastos',   label: 'Gastos (ARS)' }
        ],
        rows
      });

    } catch (e) {
      console.error('❌ ingresos-vs-gastos (anual)', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);


// ===============================
// DETALLE: Ingresos vs Gastos → meses
// GET /club/:clubId/reportes/ingresos-vs-gastos/meses?anio=2024
// ===============================
router.get(
  '/:clubId/reportes/ingresos-vs-gastos/meses',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const anio = Number(req.query.anio);

    if (!anio) {
      return res.status(400).json({ ok: false, error: 'Falta parámetro anio' });
    }

    const MESES = [
      'Enero','Febrero','Marzo','Abril','Mayo','Junio',
      'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
    ];

    try {
      const q = `
        WITH cuotas AS (
          SELECT
            EXTRACT(MONTH FROM pm.fecha_pago)::int AS mes_num,
            SUM(pm.monto) AS total
          FROM pagos_mensuales pm
          WHERE pm.club_id = $1
            AND EXTRACT(YEAR FROM pm.fecha_pago) = $2
          GROUP BY EXTRACT(MONTH FROM pm.fecha_pago)
        ),
        otros AS (
          SELECT
            EXTRACT(MONTH FROM ig.fecha)::int AS mes_num,
            SUM(ig.monto) AS total
          FROM ingresos_generales ig
          WHERE ig.club_id = $1
            AND ig.activo = true
            AND EXTRACT(YEAR FROM ig.fecha) = $2
          GROUP BY EXTRACT(MONTH FROM ig.fecha)
        ),
        ingresos AS (
          SELECT
            COALESCE(c.mes_num, o.mes_num) AS mes_num,
            COALESCE(c.total, 0) + COALESCE(o.total, 0) AS total_ingresos
          FROM cuotas c
          FULL OUTER JOIN otros o
            ON o.mes_num = c.mes_num
        ),
        gastos AS (
          SELECT
            EXTRACT(MONTH FROM g.periodo)::int AS mes_num,
            SUM(g.monto) AS total_gastos
          FROM gastos g
          WHERE g.club_id = $1
            AND g.activo = true
            AND EXTRACT(YEAR FROM g.periodo) = $2
          GROUP BY EXTRACT(MONTH FROM g.periodo)
        )
        SELECT
          COALESCE(i.mes_num, g.mes_num) AS mes_num,
          COALESCE(i.total_ingresos, 0) AS ingresos,
          COALESCE(g.total_gastos, 0) AS gastos
        FROM ingresos i
        FULL OUTER JOIN gastos g
          ON g.mes_num = i.mes_num
        ORDER BY mes_num;
      `;

      const r = await db.query(q, [clubId, anio]);

      res.json({
        ok: true,
        rows: r.rows.map(row => ({
          mes: MESES[row.mes_num - 1],
          ingresos: Number(row.ingresos),
          gastos: Number(row.gastos)
        }))
      });

    } catch (e) {
      console.error('❌ ingresos-vs-gastos/meses', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

async function getIngresosPorTipo(clubId, { desde, hasta }) {
  const where = ['pm.club_id = $1'];
  const params = [clubId];
  let p = 2;

  if (desde) {
    where.push(`pm.fecha_pago >= $${p++}`);
    params.push(desde);
  }
  if (hasta) {
    where.push(`pm.fecha_pago <= $${p++}`);
    params.push(hasta);
  }

  const q = `
    WITH cuotas AS (
      SELECT
        'Cuotas'::text AS tipo,
        SUM(pm.monto) AS total
      FROM pagos_mensuales pm
      WHERE ${where.join(' AND ')}
      GROUP BY tipo
    ),
    otros AS (
      SELECT
        COALESCE(ti.nombre, 'Otros') AS tipo,
        SUM(ig.monto) AS total
      FROM ingresos_generales ig
      LEFT JOIN tipos_ingreso ti ON ti.id = ig.tipo_ingreso_id
      WHERE ig.club_id = $1
        AND ig.activo = true
        ${desde ? `AND ig.fecha >= $${p++}` : ''}
        ${hasta ? `AND ig.fecha <= $${p++}` : ''}
      GROUP BY tipo
    ),
    unidos AS (
      SELECT * FROM cuotas
      UNION ALL
      SELECT * FROM otros
    )
    SELECT tipo, SUM(total) AS total
    FROM unidos
    GROUP BY tipo
    ORDER BY tipo;
  `;

  const r = await db.query(q, params);
  return r.rows;
}

// ============================================================
// EXPORT: Ingresos por Tipo (RANGO DE FECHAS)
// ============================================================

// PDF
router.get(
  '/:clubId/reportes/ingresos-por-tipo/export/pdf',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;

    const rows = await getIngresosPorTipo(clubId, req.query);

    sendPDF(
      res,
      'Ingresos_por_Tipo',
      [
        { key: 'tipo', label: 'Tipo' },
        { key: 'total', label: 'Total (ARS)' }
      ],
      rows
    );
  }
);

// EXCEL
router.get(
  '/:clubId/reportes/ingresos-por-tipo/export/excel',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;

    const rows = await getIngresosPorTipo(clubId, req.query);

    await sendExcel(
      res,
      'Ingresos_por_Tipo',
      [
        { key: 'tipo', label: 'Tipo' },
        { key: 'total', label: 'Total (ARS)' }
      ],
      rows
    );
  }
);


// ===============================
// Ingresos por Tipo de ingreso (vista por AÑO)
// GET /club/:clubId/reportes/ingresos-por-tipo
// ===============================
router.get(
  '/:clubId/reportes/ingresos-por-tipo',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;

    try {
      const q = `
  WITH cuotas AS (
    SELECT
      EXTRACT(YEAR FROM pm.fecha_pago)::int AS anio,
      'Cuotas'::text AS tipo,
      SUM(pm.monto) AS total
    FROM pagos_mensuales pm
    WHERE pm.club_id = $1
    GROUP BY EXTRACT(YEAR FROM pm.fecha_pago)
  ),
  otros AS (
    SELECT
      EXTRACT(YEAR FROM ig.fecha)::int AS anio,
      COALESCE(ti.nombre, 'Otros') AS tipo,
      SUM(ig.monto) AS total
    FROM ingresos_generales ig
    LEFT JOIN tipos_ingreso ti ON ti.id = ig.tipo_ingreso_id
    WHERE ig.club_id = $1
      AND ig.activo = true
    GROUP BY EXTRACT(YEAR FROM ig.fecha), tipo
  ),
  unificados AS (
    SELECT * FROM cuotas
    UNION ALL
    SELECT * FROM otros
  )
  SELECT
    anio,
    SUM(total) AS total_ingresos
  FROM unificados
  GROUP BY anio
  ORDER BY anio;
`;

      const r = await db.query(q, [clubId]);

      const rows = r.rows.map(row => ({
        anio: row.anio,
        ingresos: Number(row.total_ingresos),
        _hasChildren: true
      }));

      res.json({
        ok: true,
        title: 'Ingresos por Tipo de ingreso',
        description:
          'Totales agrupados por año. Hacé clic en un año para ver los montos por mes.',
        columns: [
          { key: 'anio',     label: 'Año' },
          { key: 'ingresos', label: 'Total (ARS)' }
        ],
        rows
      });

    } catch (e) {
      console.error('❌ ingresos-por-tipo', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// DETALLE: Ingresos por Tipo → MESES
// GET /club/:clubId/reportes/ingresos-por-tipo/meses?anio=2024
// ===============================
router.get(
  '/:clubId/reportes/ingresos-por-tipo/meses',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const anio = Number(req.query.anio);

    if (!anio)
      return res.status(400).json({ ok: false, error: 'Falta parámetro anio' });

    const MESES = [
      'Enero','Febrero','Marzo','Abril','Mayo','Junio',
      'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
    ];

    try {
      const q = `
  WITH cuotas AS (
    SELECT
      EXTRACT(MONTH FROM pm.fecha_pago)::int AS mes,
      'Cuotas'::text AS tipo,
      SUM(pm.monto) AS total
    FROM pagos_mensuales pm
    WHERE pm.club_id = $1 AND pm.anio = $2
    GROUP BY EXTRACT(MONTH FROM pm.fecha_pago)
  ),
  otros AS (
    SELECT
      EXTRACT(MONTH FROM ig.fecha)::int AS mes,
      COALESCE(ti.nombre, 'Otros') AS tipo,
      SUM(ig.monto) AS total
    FROM ingresos_generales ig
    LEFT JOIN tipos_ingreso ti ON ti.id = ig.tipo_ingreso_id
    WHERE ig.club_id = $1
      AND ig.activo = true
      AND EXTRACT(YEAR FROM ig.fecha) = $2
    GROUP BY EXTRACT(MONTH FROM ig.fecha), tipo
  ),
  unidos AS (
    SELECT * FROM cuotas
    UNION ALL
    SELECT * FROM otros
  )
  SELECT
    mes,
    SUM(total) AS total_mes
  FROM unidos
  GROUP BY mes
  ORDER BY mes;
`;

      const r = await db.query(q, [clubId, anio]);

      res.json({
        ok: true,
        rows: r.rows.map(row => ({
          mes: MESES[row.mes - 1],
          total: Number(row.total_mes),
          mes_num: row.mes,
          _hasChildren: true
        }))
      });

    } catch (e) {
      console.error('❌ ingresos-por-tipo/meses', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);


// ===============================
// DETALLE: Ingresos por Tipo → TIPOS dentro del mes
// GET /club/:clubId/reportes/ingresos-por-tipo/tipos?anio=2024&mes=3
// ===============================
router.get(
  '/:clubId/reportes/ingresos-por-tipo/tipos',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const anio = Number(req.query.anio);
    const mes  = Number(req.query.mes);

    if (!anio || !mes)
      return res.status(400).json({ ok: false, error: 'Faltan parámetros' });

    try {
      const q = `
        WITH cuotas AS (
  SELECT
    'Cuotas'::text AS tipo,
    SUM(pm.monto) AS total
  FROM pagos_mensuales pm
  WHERE pm.club_id = $1
    AND pm.fecha_pago IS NOT NULL
    AND EXTRACT(YEAR  FROM pm.fecha_pago) = $2
    AND EXTRACT(MONTH FROM pm.fecha_pago) = $3
  GROUP BY tipo
),

        otros AS (
          SELECT
            COALESCE(ti.nombre, 'Otros') AS tipo,
            SUM(ig.monto) AS total
          FROM ingresos_generales ig
          LEFT JOIN tipos_ingreso ti ON ti.id = ig.tipo_ingreso_id
          WHERE ig.club_id = $1
            AND ig.activo = true
            AND EXTRACT(YEAR FROM ig.fecha) = $2
            AND EXTRACT(MONTH FROM ig.fecha) = $3
          GROUP BY tipo
        ),
        unidos AS (
          SELECT * FROM cuotas
          UNION ALL
          SELECT * FROM otros
        )
        SELECT tipo, SUM(total) AS total
        FROM unidos
        GROUP BY tipo
        ORDER BY tipo;
      `;

      const r = await db.query(q, [clubId, anio, mes]);

      res.json({ ok: true, rows: r.rows });

    } catch (e) {
      console.error('❌ ingresos-por-tipo/tipos', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// Gastos por Tipo de gasto (vista por AÑO)
// GET /club/:clubId/reportes/gastos-por-tipo
// ===============================
router.get(
  '/:clubId/reportes/gastos-por-tipo',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;

    try {
      const q = `
        SELECT
          EXTRACT(YEAR FROM g.periodo)::int AS anio,
          SUM(g.monto) AS total
        FROM gastos g
        WHERE g.club_id = $1
          AND g.activo = true
        GROUP BY EXTRACT(YEAR FROM g.periodo)
        ORDER BY anio;
      `;

      const r = await db.query(q, [clubId]);

      const rows = r.rows.map(row => ({
        anio: row.anio,
        total: Number(row.total),
        _hasChildren: true
      }));

      res.json({
        ok: true,
        title: 'Gastos por Tipo de gasto',
        description: 'Totales anuales de gastos. Hacé clic en un año para ver los montos por mes.',
        columns: [
          { key: 'anio',  label: 'Año' },
          { key: 'total', label: 'Total (ARS)' }
        ],
        rows
      });
    } catch (e) {
      console.error('❌ reporte gastos-por-tipo (anual)', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// DETALLE: Gastos por Tipo → MESES
// GET /club/:clubId/reportes/gastos-por-tipo/meses?anio=2024
// ===============================
router.get(
  '/:clubId/reportes/gastos-por-tipo/meses',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const anio = Number(req.query.anio);

    if (!anio) {
      return res.status(400).json({ ok: false, error: 'Falta parámetro anio' });
    }

    const MESES = [
      'Enero','Febrero','Marzo','Abril','Mayo','Junio',
      'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
    ];

    try {
      const q = `
        SELECT
          EXTRACT(MONTH FROM g.periodo)::int AS mes,
          SUM(g.monto) AS total
        FROM gastos g
        WHERE g.club_id = $1
          AND g.activo = true
          AND EXTRACT(YEAR FROM g.periodo) = $2
        GROUP BY EXTRACT(MONTH FROM g.periodo)
        ORDER BY mes;
      `;

      const r = await db.query(q, [clubId, anio]);

      res.json({
        ok: true,
        rows: r.rows.map(row => ({
          mes: MESES[row.mes - 1],
          total: Number(row.total),
          mes_num: row.mes,
          _hasChildren: true
        }))
      });
    } catch (e) {
      console.error('❌ gastos-por-tipo/meses', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// DETALLE: Gastos por Tipo → TIPOS dentro del mes
// GET /club/:clubId/reportes/gastos-por-tipo/tipos?anio=2024&mes=3
// ===============================
router.get(
  '/:clubId/reportes/gastos-por-tipo/tipos',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const anio = Number(req.query.anio);
    const mes  = Number(req.query.mes);

    if (!anio || !mes) {
      return res.status(400).json({ ok: false, error: 'Faltan parámetros' });
    }

    try {
      const q = `
        SELECT
          COALESCE(tg.nombre, 'Sin tipo') AS tipo_gasto,
          SUM(g.monto) AS total
        FROM gastos g
        LEFT JOIN tipos_gasto tg ON tg.id = g.tipo_gasto_id
        WHERE g.club_id = $1
          AND g.activo = true
          AND EXTRACT(YEAR FROM g.periodo) = $2
          AND EXTRACT(MONTH FROM g.periodo) = $3
        GROUP BY COALESCE(tg.nombre, 'Sin tipo')
        ORDER BY tipo_gasto;
      `;

      const r = await db.query(q, [clubId, anio, mes]);

      res.json({ ok: true, rows: r.rows });
    } catch (e) {
      console.error('❌ gastos-por-tipo/tipos', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);
// ===============================
// Gastos por Responsable por mes (vista por AÑO)
// GET /club/:clubId/reportes/gastos-responsable-mes
// ===============================
router.get(
  '/:clubId/reportes/gastos-responsable-mes',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;

    try {
      const q = `
        SELECT
          EXTRACT(YEAR FROM g.periodo)::int AS anio,
          SUM(g.monto) AS total
        FROM gastos g
        WHERE g.club_id = $1
          AND g.activo = true
        GROUP BY EXTRACT(YEAR FROM g.periodo)
        ORDER BY anio;
      `;

      const r = await db.query(q, [clubId]);

      const rows = r.rows.map(row => ({
        anio: row.anio,
        total: Number(row.total),
        _hasChildren: true
      }));

      res.json({
        ok: true,
        title: 'Gastos por Responsable por mes',
        description: 'Totales anuales de gastos. Hacé clic en un año para ver los montos por mes.',
        columns: [
          { key: 'anio',  label: 'Año' },
          { key: 'total', label: 'Total (ARS)' }
        ],
        rows
      });
    } catch (e) {
      console.error('❌ reporte gastos-responsable-mes (anual)', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }	
);

// ===============================
// DETALLE: Gastos por Responsable → MESES
// GET /club/:clubId/reportes/gastos-responsable-mes/meses?anio=2024
// ===============================
router.get(
  '/:clubId/reportes/gastos-responsable-mes/meses',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const anio = Number(req.query.anio);

    if (!anio) {
      return res.status(400).json({ ok: false, error: 'Falta parámetro anio' });
    }

    const MESES = [
      'Enero','Febrero','Marzo','Abril','Mayo','Junio',
      'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
    ];

    try {
      const q = `
        SELECT
          EXTRACT(MONTH FROM g.periodo)::int AS mes,
          SUM(g.monto) AS total
        FROM gastos g
        WHERE g.club_id = $1
          AND g.activo = true
          AND EXTRACT(YEAR FROM g.periodo) = $2
        GROUP BY EXTRACT(MONTH FROM g.periodo)
        ORDER BY mes;
      `;

      const r = await db.query(q, [clubId, anio]);

      res.json({
        ok: true,
        rows: r.rows.map(row => ({
          mes: MESES[row.mes - 1],
          total: Number(row.total),
          mes_num: row.mes,
          _hasChildren: true
        }))
      });
    } catch (e) {
      console.error('❌ gastos-responsable-mes/meses', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// DETALLE: Gastos por Responsable → RESPONSABLES dentro del mes
// GET /club/:clubId/reportes/gastos-responsable-mes/responsables?anio=2024&mes=3
// ===============================
router.get(
  '/:clubId/reportes/gastos-responsable-mes/responsables',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const anio = Number(req.query.anio);
    const mes  = Number(req.query.mes);

    if (!anio || !mes) {
      return res.status(400).json({ ok: false, error: 'Faltan parámetros' });
    }

    try {
      const q = `
        SELECT
          COALESCE(rg.nombre, 'Sin responsable') AS responsable,
          SUM(g.monto) AS total
        FROM gastos g
        LEFT JOIN responsables_gasto rg ON rg.id = g.responsable_id
        WHERE g.club_id = $1
          AND g.activo = true
          AND EXTRACT(YEAR FROM g.periodo) = $2
          AND EXTRACT(MONTH FROM g.periodo) = $3
        GROUP BY COALESCE(rg.nombre, 'Sin responsable')
        ORDER BY responsable;
      `;

      const r = await db.query(q, [clubId, anio, mes]);

      res.json({ ok: true, rows: r.rows });
    } catch (e) {
      console.error('❌ gastos-responsable-mes/responsables', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ============================================================
// DETALLES DE REPORTES
// ------------------------------------------------------------
// Todas devuelven:
// { ok:true, rows:[... ] }
// y pueden ser usadas por el modal de detalle en reportes.js
// ============================================================


// 1) DETALLE: socios por actividad
// GET /club/:clubId/reportes/socios-actividad/detalle?actividad=Fútbol&activo=1
router.get('/:clubId/reportes/socios-actividad/detalle', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const { actividad = '', activo = '' } = req.query;

  try {
    const where = ['club_id = $1'];
    const params = [clubId];
    let p = 2;

    if (actividad) {
      where.push(`actividad = $${p++}`);
      params.push(actividad);
    }
    if (activo !== '') {
      where.push(`activo = $${p++}`);
      params.push(activo === '1');
    }

    const q = `
      SELECT
        id,
        numero_socio,
        dni,
        nombre,
        apellido,
        actividad,
        categoria,
        telefono,
        fecha_ingreso
      FROM socios
      WHERE ${where.join(' AND ')}
      ORDER BY actividad, apellido, nombre
    `;

    const r = await db.query(q, params);
    res.json({ ok: true, rows: r.rows });
  } catch (e) {
    console.error('❌ detalle socios-actividad', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});


// 2) DETALLE: socios por actividad / categoría
// GET /club/:clubId/reportes/socios-actividad-categoria/detalle?actividad=Fútbol&categoria=Menores&activo=1
router.get('/:clubId/reportes/socios-actividad-categoria/detalle', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const { actividad = '', categoria = '', activo = '' } = req.query;

  try {
    const where = ['club_id = $1'];
    const params = [clubId];
    let p = 2;

    if (actividad) {
      where.push(`actividad = $${p++}`);
      params.push(actividad);
    }
    if (categoria) {
      where.push(`categoria = $${p++}`);
      params.push(categoria);
    }
    if (activo !== '') {
      where.push(`activo = $${p++}`);
      params.push(activo === '1');
    }

    const q = `
      SELECT
        id,
        numero_socio,
        dni,
        nombre,
        apellido,
        actividad,
        categoria,
        telefono,
        fecha_ingreso
      FROM socios
      WHERE ${where.join(' AND ')}
      ORDER BY actividad, categoria, apellido, nombre
    `;

    const r = await db.query(q, params);
    res.json({ ok: true, rows: r.rows });
  } catch (e) {
    console.error('❌ detalle socios-actividad-categoria', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});


// 3) DETALLE: socios nuevos por mes (fecha_ingreso)
// GET /club/:clubId/reportes/socios-nuevos-mes/detalle?anio=2026&mes=3
router.get('/:clubId/reportes/socios-nuevos-mes/detalle', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const anio = Number(req.query.anio);
  const mes = Number(req.query.mes);

  if (!anio || !mes) {
    return res.status(400).json({ ok: false, error: 'anio y mes son obligatorios' });
  }

  try {
    const q = `
      SELECT
        id,
        numero_socio,
        dni,
        nombre,
        apellido,
        actividad,
        categoria,
        telefono,
        fecha_ingreso
      FROM socios
      WHERE club_id = $1
        AND fecha_ingreso IS NOT NULL
        AND EXTRACT(YEAR FROM fecha_ingreso) = $2
        AND EXTRACT(MONTH FROM fecha_ingreso) = $3
      ORDER BY fecha_ingreso, apellido, nombre
    `;
    const r = await db.query(q, [clubId, anio, mes]);
    res.json({ ok: true, rows: r.rows });
  } catch (e) {
    console.error('❌ detalle socios-nuevos-mes', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});


// 4) DETALLE: ingreso por fecha de pago
// GET /club/:clubId/reportes/ingreso-fecha-pago/detalle?fecha=2026-03-01&actividad=Fútbol&categoria=Mayores
router.get('/:clubId/reportes/ingreso-fecha-pago/detalle', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const { fecha, actividad = '', categoria = '' } = req.query;

  if (!fecha) {
    return res.status(400).json({ ok: false, error: 'fecha es obligatoria' });
  }

  try {
    const where = ['pm.club_id = $1', 'pm.fecha_pago::date = $2::date'];
    const params = [clubId, fecha];
    let p = 3;

    if (actividad) {
      where.push(`s.actividad = $${p++}`);
      params.push(actividad);
    }
    if (categoria) {
      where.push(`s.categoria = $${p++}`);
      params.push(categoria);
    }

    const q = `
      SELECT
        pm.id,
        pm.anio,
        pm.mes,
        pm.monto,
        pm.fecha_pago,
        s.numero_socio,
        s.dni,
        s.nombre,
        s.apellido,
        s.actividad,
        s.categoria
      FROM pagos_mensuales pm
      JOIN socios s ON s.id = pm.socio_id
      WHERE ${where.join(' AND ')}
      ORDER BY s.apellido, s.nombre, pm.mes
    `;
    const r = await db.query(q, params);
    res.json({ ok: true, rows: r.rows });
  } catch (e) {
    console.error('❌ detalle ingreso-fecha-pago', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});


// 5) DETALLE: ingreso por mes pagado
// GET /club/:clubId/reportes/ingreso-mes-pagado/detalle?anio=2026&mes=3&actividad=Fútbol&categoria=Mayores
router.get('/:clubId/reportes/ingreso-mes-pagado/detalle', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const anio = Number(req.query.anio);
  const mes = Number(req.query.mes);
  const { actividad = '', categoria = '' } = req.query;

  if (!anio || !mes) {
    return res.status(400).json({ ok: false, error: 'anio y mes son obligatorios' });
  }

  try {
    const where = ['pm.club_id = $1', 'pm.anio = $2', 'pm.mes = $3'];
    const params = [clubId, anio, mes];
    let p = 4;

    if (actividad) {
      where.push(`s.actividad = $${p++}`);
      params.push(actividad);
    }
    if (categoria) {
      where.push(`s.categoria = $${p++}`);
      params.push(categoria);
    }

    const q = `
      SELECT
        pm.id,
        pm.anio,
        pm.mes,
        pm.monto,
        pm.fecha_pago,
        s.numero_socio,
        s.dni,
        s.nombre,
        s.apellido,
        s.actividad,
        s.categoria
      FROM pagos_mensuales pm
      JOIN socios s ON s.id = pm.socio_id
      WHERE ${where.join(' AND ')}
      ORDER BY s.apellido, s.nombre
    `;
    const r = await db.query(q, params);
    res.json({ ok: true, rows: r.rows });
  } catch (e) {
    console.error('❌ detalle ingreso-mes-pagado', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});


// 6) DETALLE: ingresos vs gastos por mes
// GET /club/:clubId/reportes/ingresos-vs-gastos/detalle?anio=2026&mes=3&tipo=ingresos|gastos|todos
router.get('/:clubId/reportes/ingresos-vs-gastos/detalle', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const anio = Number(req.query.anio);
  const mes = Number(req.query.mes);
  const tipo = (req.query.tipo || 'todos').toString().toLowerCase();

  if (!anio || !mes) {
    return res.status(400).json({ ok: false, error: 'anio y mes son obligatorios' });
  }

  try {
    const result = {};

    if (tipo === 'ingresos' || tipo === 'todos') {
      const qIngCuotas = `
  SELECT
    'Cuota'::text AS origen,
    pm.id,
    pm.anio,
    pm.mes,
    pm.monto,
    pm.fecha_pago,
    COALESCE(pm.socio_numero, s.numero_socio) AS numero_socio,
    COALESCE(pm.socio_nombre, s.nombre)       AS nombre,
    COALESCE(pm.socio_apellido, s.apellido)   AS apellido,
    s.actividad,
    s.categoria
  FROM pagos_mensuales pm
  LEFT JOIN socios s ON s.id = pm.socio_id
  WHERE pm.club_id = $1
  AND pm.anio = $2
  AND pm.mes = $3
`;

      const qIngOtros = `
        SELECT
          COALESCE(ti.nombre, 'Otro ingreso') AS origen,
          ig.id,
          EXTRACT(YEAR FROM ig.fecha)::int AS anio,
          EXTRACT(MONTH FROM ig.fecha)::int AS mes,
          ig.monto,
          ig.fecha AS fecha_pago,
          NULL::int AS numero_socio,
          NULL::text AS nombre,
          NULL::text AS apellido,
          NULL::text AS actividad,
          NULL::text AS categoria
        FROM ingresos_generales ig
        LEFT JOIN tipos_ingreso ti ON ti.id = ig.tipo_ingreso_id
        WHERE ig.club_id = $1
          AND ig.activo = true
          AND EXTRACT(YEAR FROM ig.fecha) = $2
          AND EXTRACT(MONTH FROM ig.fecha) = $3
      `;

      const [rCuotas, rOtros] = await Promise.all([
        db.query(qIngCuotas, [clubId, anio, mes]),
        db.query(qIngOtros, [clubId, anio, mes])
      ]);

      result.ingresos = rCuotas.rows.concat(rOtros.rows);
    }

    if (tipo === 'gastos' || tipo === 'todos') {
      const qGastos = `
        SELECT
          g.id,
          g.periodo,
          g.fecha_gasto,
          g.monto,
          g.descripcion,
          COALESCE(tg.nombre, 'Sin tipo') AS tipo_gasto,
          COALESCE(rg.nombre, 'Sin responsable') AS responsable
        FROM gastos g
        LEFT JOIN tipos_gasto tg ON tg.id = g.tipo_gasto_id
        LEFT JOIN responsables_gasto rg ON rg.id = g.responsable_id
        WHERE g.club_id = $1
          AND g.activo = true
          AND EXTRACT(YEAR FROM g.periodo) = $2
          AND EXTRACT(MONTH FROM g.periodo) = $3
        ORDER BY g.fecha_gasto
      `;
      const rGastos = await db.query(qGastos, [clubId, anio, mes]);
      result.gastos = rGastos.rows;
    }

    res.json({ ok: true, rows: result });
  } catch (e) {
    console.error('❌ detalle ingresos-vs-gastos', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// EXPORT: Ingresos vs Gastos (DETALLE POR RANGO DE FECHAS) – EXCEL
// GET /club/:clubId/reportes/ingresos-vs-gastos/export/excel?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Columnas: Fecha | Tipo (Ingreso/Gasto) | Tipo de Ingreso/Gasto | Monto | Cuenta | Observación
// Incluye: ingresos_generales + pagos_mensuales (cuotas) + gastos
// ============================================================

function isISODate(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

async function getMovsIngGastoRange(clubId, desde, hasta) {
  const q = `
    SELECT * FROM (
      -- Ingresos generales
      SELECT
        ig.fecha::date AS fecha,
        'Ingreso'::text AS tipo,
        COALESCE(ti.nombre, 'Otro ingreso') AS tipo_item,
        ig.monto::numeric AS monto,
        COALESCE(ig.cuenta, '') AS cuenta,
        COALESCE(ig.observacion, '') AS observacion
      FROM ingresos_generales ig
      LEFT JOIN tipos_ingreso ti ON ti.id = ig.tipo_ingreso_id
      WHERE ig.club_id = $1
        AND ig.activo = true
        AND ig.fecha::date >= $2::date
        AND ig.fecha::date <= $3::date

      UNION ALL

      -- Cuotas sociales (pagos mensuales)
      SELECT
        pm.fecha_pago::date AS fecha,
        'Ingreso'::text AS tipo,
        'Cuota social'::text AS tipo_item,
        pm.monto::numeric AS monto,
        COALESCE(pm.cuenta, '') AS cuenta,
        (
          'Socio: ' ||
          TRIM(
            COALESCE(pm.socio_apellido, s.apellido, '') || ' ' ||
            COALESCE(pm.socio_nombre, s.nombre, '')
          ) ||
          CASE
            WHEN COALESCE(pm.socio_numero, s.numero_socio) IS NULL THEN ''
            ELSE ' (#' || COALESCE(pm.socio_numero, s.numero_socio) || ')'
          END ||
          ' - Cuota ' || pm.mes || '/' || pm.anio
        )::text AS observacion
      FROM pagos_mensuales pm
      LEFT JOIN socios s ON s.id = pm.socio_id
      WHERE pm.club_id = $1
        AND pm.fecha_pago IS NOT NULL
        AND pm.fecha_pago::date >= $2::date
        AND pm.fecha_pago::date <= $3::date

      UNION ALL

      -- Gastos
      SELECT
        g.fecha_gasto::date AS fecha,
        'Gasto'::text AS tipo,
        COALESCE(tg.nombre, 'Sin tipo') AS tipo_item,
        g.monto::numeric AS monto,
        COALESCE(g.cuenta, rg.nombre, 'Sin cuenta') AS cuenta,
        COALESCE(g.descripcion, '') AS observacion
      FROM gastos g
      LEFT JOIN tipos_gasto tg ON tg.id = g.tipo_gasto_id
      LEFT JOIN responsables_gasto rg ON rg.id = g.responsable_id
      WHERE g.club_id = $1
        AND g.activo = true
        AND g.fecha_gasto::date >= $2::date
        AND g.fecha_gasto::date <= $3::date
    ) t
    ORDER BY fecha ASC, tipo ASC, tipo_item ASC;
  `;

  const r = await db.query(q, [clubId, desde, hasta]);
  return r.rows || [];
}

router.get(
  '/:clubId/reportes/ingresos-vs-gastos/export/excel',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    try {
      const { clubId } = req.params;
      const { desde = '', hasta = '' } = req.query;

      if (!isISODate(desde) || !isISODate(hasta)) {
        return res.status(400).json({
          ok: false,
          error: 'Parámetros inválidos. Use desde y hasta con formato YYYY-MM-DD'
        });
      }

      if (desde > hasta) {
        return res.status(400).json({
          ok: false,
          error: 'La fecha "desde" no puede ser mayor que "hasta"'
        });
      }

      const rows = await getMovsIngGastoRange(clubId, desde, hasta);

      return sendExcel(
        res,
        `Ingresos_vs_Gastos_Detalle_${desde}_a_${hasta}`,
        [
          { key: 'fecha', label: 'Fecha' },
          { key: 'tipo', label: 'Tipo (Ingreso/Gasto)' },
          { key: 'tipo_item', label: 'Tipo de Ingreso/Gasto' },
          { key: 'monto', label: 'Monto' },
          { key: 'cuenta', label: 'Cuenta' },
          { key: 'observacion', label: 'Observación' }
        ],
        rows
      );
    } catch (e) {
      console.error('❌ export excel ingresos-vs-gastos rango', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);


// 7) DETALLE: ingresos por tipo (incluye cuotas)
// GET /club/:clubId/reportes/ingresos-por-tipo/detalle?anio=2026&tipo=Cuotas|Cantina|Sponsor...
router.get('/:clubId/reportes/ingresos-por-tipo/detalle', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const anio = Number(req.query.anio);
  const tipo = (req.query.tipo || '').toString();

  if (!anio || !tipo) {
    return res.status(400).json({ ok: false, error: 'anio y tipo son obligatorios' });
  }

  try {
    if (tipo === 'Cuotas') {
      // detalle de pagos mensuales
      const q = `
        SELECT
          pm.id,
          pm.anio,
          pm.mes,
          pm.monto,
          pm.fecha_pago,
          s.numero_socio,
          s.dni,
          s.nombre,
          s.apellido,
          s.actividad,
          s.categoria
        FROM pagos_mensuales pm
        JOIN socios s ON s.id = pm.socio_id
        WHERE pm.club_id = $1
          AND pm.anio = $2
        ORDER BY pm.anio, pm.mes, s.apellido, s.nombre
      `;
      const r = await db.query(q, [clubId, anio]);
      return res.json({ ok: true, rows: r.rows });
    }

    // otros tipos: ingresos_generales
    const qOtros = `
      SELECT
        ig.id,
        ig.fecha,
        ig.monto,
        ig.observacion,
        COALESCE(ti.nombre, 'Otro ingreso') AS tipo_ingreso
      FROM ingresos_generales ig
      LEFT JOIN tipos_ingreso ti ON ti.id = ig.tipo_ingreso_id
      WHERE ig.club_id = $1
        AND ig.activo = true
        AND EXTRACT(YEAR FROM ig.fecha) = $2
        AND COALESCE(ti.nombre, 'Otro ingreso') = $3
      ORDER BY ig.fecha DESC
    `;
    const r2 = await db.query(qOtros, [clubId, anio, tipo]);
    res.json({ ok: true, rows: r2.rows });
  } catch (e) {
    console.error('❌ detalle ingresos-por-tipo', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});


// 8) DETALLE: gastos por tipo de gasto
// GET /club/:clubId/reportes/gastos-por-tipo/detalle?anio=2026&tipo_gasto=Luz
router.get('/:clubId/reportes/gastos-por-tipo/detalle', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const anio = Number(req.query.anio);
  const tipo_gasto = (req.query.tipo_gasto || '').toString();

  if (!anio || !tipo_gasto) {
    return res.status(400).json({ ok: false, error: 'anio y tipo_gasto son obligatorios' });
  }

  try {
    const q = `
      SELECT
        g.id,
        g.periodo,
        g.fecha_gasto,
        g.monto,
        g.descripcion,
        COALESCE(tg.nombre, 'Sin tipo') AS tipo_gasto,
        COALESCE(rg.nombre, 'Sin responsable') AS responsable
      FROM gastos g
      LEFT JOIN tipos_gasto tg ON tg.id = g.tipo_gasto_id
      LEFT JOIN responsables_gasto rg ON rg.id = g.responsable_id
      WHERE g.club_id = $1
        AND g.activo = true
        AND EXTRACT(YEAR FROM g.periodo) = $2
        AND COALESCE(tg.nombre, 'Sin tipo') = $3
      ORDER BY g.periodo, g.fecha_gasto
    `;
    const r = await db.query(q, [clubId, anio, tipo_gasto]);
    res.json({ ok: true, rows: r.rows });
  } catch (e) {
    console.error('❌ detalle gastos-por-tipo', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});


// 9) DETALLE: gastos por responsable x mes
// GET /club/:clubId/reportes/gastos-responsable-mes/detalle?anio=2026&mes=3&responsable=Juan%20Pérez
router.get('/:clubId/reportes/gastos-responsable-mes/detalle', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const anio = Number(req.query.anio);
  const mes = Number(req.query.mes);
  const responsable = (req.query.responsable || '').toString();

  if (!anio || !mes || !responsable) {
    return res.status(400).json({ ok: false, error: 'anio, mes y responsable son obligatorios' });
  }

  try {
    const q = `
      SELECT
        g.id,
        g.periodo,
        g.fecha_gasto,
        g.monto,
        g.descripcion,
        COALESCE(tg.nombre, 'Sin tipo') AS tipo_gasto,
        COALESCE(rg.nombre, 'Sin responsable') AS responsable
      FROM gastos g
      LEFT JOIN tipos_gasto tg ON tg.id = g.tipo_gasto_id
      LEFT JOIN responsables_gasto rg ON rg.id = g.responsable_id
      WHERE g.club_id = $1
        AND g.activo = true
        AND EXTRACT(YEAR FROM g.periodo) = $2
        AND EXTRACT(MONTH FROM g.periodo) = $3
        AND COALESCE(rg.nombre, 'Sin responsable') = $4
      ORDER BY g.fecha_gasto
    `;
    const r = await db.query(q, [clubId, anio, mes, responsable]);
    res.json({ ok: true, rows: r.rows });
  } catch (e) {
    console.error('❌ detalle gastos-responsable-mes', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});
// ===============================
// Ingresos totales por responsable (cuenta)
// Suma ingresos_generales + pagos_mensuales
// GET /club/:clubId/reportes/ingresos-por-responsable?anio=2026&mes=3
// ===============================
router.get(
  '/:clubId/reportes/ingresos-por-responsable',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const anio = Number(req.query.anio);
    const mes  = Number(req.query.mes);

    if (!anio || !mes) {
      return res.status(400).json({ ok: false, error: 'anio y mes son obligatorios' });
    }

    try {
      // 1) Ingresos generales (manuales)
      const q1 = `
        SELECT 
          COALESCE(ig.cuenta, 'Sin cuenta') AS responsable,
          SUM(ig.monto) AS total
        FROM ingresos_generales ig
        WHERE ig.club_id = $1 
          AND ig.activo = true
          AND EXTRACT(YEAR FROM ig.fecha) = $2
          AND EXTRACT(MONTH FROM ig.fecha) = $3
        GROUP BY COALESCE(ig.cuenta, 'Sin cuenta')
      `;

      // 2) Cuotas sociales (pagos_mensuales)
      const q2 = `
        SELECT 
          COALESCE(pm.cuenta, 'Sin cuenta') AS responsable,
          SUM(pm.monto) AS total
        FROM pagos_mensuales pm
        WHERE pm.club_id = $1
          AND pm.fecha_pago IS NOT NULL
          AND EXTRACT(YEAR FROM pm.fecha_pago) = $2
          AND EXTRACT(MONTH FROM pm.fecha_pago) = $3
        GROUP BY COALESCE(pm.cuenta, 'Sin cuenta')
      `;

      const [r1, r2] = await Promise.all([
        db.query(q1, [clubId, anio, mes]),
        db.query(q2, [clubId, anio, mes])
      ]);

      // Unificar resultados
      const map = new Map();

      const acumular = (rows) => {
        rows.forEach(row => {
          const responsable = row.responsable;
          const total = Number(row.total || 0);
          map.set(responsable, (map.get(responsable) || 0) + total);
        });
      };

      acumular(r1.rows || []);
      acumular(r2.rows || []);

      const rows = Array.from(map.entries())
        .map(([responsable, total]) => ({ responsable, total }))
        .sort((a, b) => a.responsable.localeCompare(b.responsable));

      return res.json({ ok: true, rows });

    } catch (e) {
      console.error('❌ ingresos-por-responsable', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// INGRESOS VS GASTOS POR RESPONSABLE (MES)  (resumen)
// GET /club/:clubId/reportes/ingresos-vs-gastos-por-responsable?anio=2026&mes=3
// ===============================
router.get(
  '/:clubId/reportes/ingresos-vs-gastos-por-responsable',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const anio = Number(req.query.anio);
    const mes = Number(req.query.mes);

    if (!anio || !mes) {
      return res.status(400).json({
        ok: false,
        error: 'anio y mes son obligatorios'
      });
    }

    try {
      const qIng1 = `
        SELECT COALESCE(ig.cuenta,'Sin cuenta') AS responsable,
               SUM(ig.monto) AS total
        FROM ingresos_generales ig
        WHERE ig.club_id = $1
          AND ig.activo = true
          AND EXTRACT(YEAR FROM ig.fecha) = $2
          AND EXTRACT(MONTH FROM ig.fecha) = $3
        GROUP BY COALESCE(ig.cuenta,'Sin cuenta')
      `;

      const qIng2 = `
        SELECT COALESCE(pm.cuenta,'Sin cuenta') AS responsable,
               SUM(pm.monto) AS total
        FROM pagos_mensuales pm
        WHERE pm.club_id = $1
          AND pm.fecha_pago IS NOT NULL
          AND EXTRACT(YEAR FROM pm.fecha_pago) = $2
          AND EXTRACT(MONTH FROM pm.fecha_pago) = $3
        GROUP BY COALESCE(pm.cuenta,'Sin cuenta')
      `;

      const qGas = `
        SELECT COALESCE(rg.nombre,'Sin responsable') AS responsable,
               SUM(g.monto) AS total
        FROM gastos g
        LEFT JOIN responsables_gasto rg ON rg.id = g.responsable_id
        WHERE g.club_id = $1
          AND g.activo = true
          AND EXTRACT(YEAR FROM g.periodo) = $2
          AND EXTRACT(MONTH FROM g.periodo) = $3
        GROUP BY COALESCE(rg.nombre,'Sin responsable')
      `;

      const [rIng1, rIng2, rGas] = await Promise.all([
        db.query(qIng1, [clubId, anio, mes]),
        db.query(qIng2, [clubId, anio, mes]),
        db.query(qGas,  [clubId, anio, mes])
      ]);

      const map = new Map();

      const acum = (resp, field, val) => {
        if (!map.has(resp)) {
          map.set(resp, { responsable: resp, ingresos: 0, gastos: 0 });
        }
        map.get(resp)[field] += Number(val || 0);
      };

      (rIng1.rows || []).forEach(r => acum(r.responsable, 'ingresos', r.total));
      (rIng2.rows || []).forEach(r => acum(r.responsable, 'ingresos', r.total));
      (rGas.rows  || []).forEach(r => acum(r.responsable, 'gastos',   r.total));

      const rows = Array.from(map.values()).map(r => ({
        ...r,
        resultado: r.ingresos - r.gastos
      }));

      return res.json({ ok: true, rows });

    } catch (e) {
      console.error('❌ ingresos-vs-gastos-por-responsable', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// D) DETALLE: ingresos vs gastos por responsable (para clicks)
// GET /club/:clubId/reportes/ingresos-vs-gastos-por-responsable/detalle?anio=2026&mes=4&responsable=Efectivo&tipo=ingresos|gastos|todos
// ===============================
router.get(
  '/:clubId/reportes/ingresos-vs-gastos-por-responsable/detalle',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const anio = Number(req.query.anio);
    const mes = Number(req.query.mes);
    const responsable = String(req.query.responsable || '');
    const tipo = String(req.query.tipo || 'todos').toLowerCase();

    if (!anio || !mes || !responsable) {
      return res.status(400).json({ ok: false, error: 'anio, mes y responsable son obligatorios' });
    }

    try {
      const result = {};

      // INGRESOS (responsable = cuenta)
      if (tipo === 'ingresos' || tipo === 'todos') {
        const qIngGen = `
          SELECT
            COALESCE(ti.nombre,'Otro ingreso') AS tipo_item,
            'ingreso'::text AS tipo,
            to_char(ig.fecha,'YYYY-MM') AS periodo,
            ig.monto::numeric AS monto,
            COALESCE(ig.observacion,'') AS descripcion
          FROM ingresos_generales ig
          LEFT JOIN tipos_ingreso ti ON ti.id = ig.tipo_ingreso_id
          WHERE ig.club_id = $1
            AND ig.activo = true
            AND EXTRACT(YEAR FROM ig.fecha) = $2
            AND EXTRACT(MONTH FROM ig.fecha) = $3
            AND COALESCE(ig.cuenta,'Sin cuenta') = $4
        `;

        const qCuotas = `
          SELECT
            'Cuotas'::text AS tipo_item,
            'ingreso'::text AS tipo,
            to_char(pm.fecha_pago,'YYYY-MM') AS periodo,
            pm.monto::numeric AS monto,
            ('Cuota ' || pm.mes || '/' || pm.anio)::text AS descripcion
          FROM pagos_mensuales pm
          WHERE pm.club_id = $1
            AND pm.fecha_pago IS NOT NULL
            AND EXTRACT(YEAR FROM pm.fecha_pago) = $2
            AND EXTRACT(MONTH FROM pm.fecha_pago) = $3
            AND COALESCE(pm.cuenta,'Sin cuenta') = $4
        `;

        const [rA, rB] = await Promise.all([
          db.query(qIngGen, [clubId, anio, mes, responsable]),
          db.query(qCuotas, [clubId, anio, mes, responsable]),
        ]);

        result.ingresos = (rA.rows || []).concat(rB.rows || []);
      }

      // GASTOS (responsable = responsables_gasto.nombre)
      if (tipo === 'gastos' || tipo === 'todos') {
        const qGas = `
          SELECT
            COALESCE(tg.nombre,'Sin tipo') AS tipo_item,
            'gasto'::text AS tipo,
            to_char(g.periodo,'YYYY-MM') AS periodo,
            g.monto::numeric AS monto,
            COALESCE(g.descripcion,'') AS descripcion
          FROM gastos g
          LEFT JOIN tipos_gasto tg ON tg.id = g.tipo_gasto_id
          LEFT JOIN responsables_gasto rg ON rg.id = g.responsable_id
          WHERE g.club_id = $1
            AND g.activo = true
            AND EXTRACT(YEAR FROM g.periodo) = $2
            AND EXTRACT(MONTH FROM g.periodo) = $3
            AND COALESCE(rg.nombre,'Sin responsable') = $4
        `;

        const rG = await db.query(qGas, [clubId, anio, mes, responsable]);
        result.gastos = rG.rows || [];
      }

      return res.json({ ok: true, rows: result });

    } catch (e) {
      console.error('❌ ingresos-vs-gastos-por-responsable/detalle', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ============================================================
// EXPORT: Ingresos vs Gastos por responsable (MES o AÑO)
// PDF:   /club/:clubId/reportes/ingresos-vs-gastos-por-responsable/export/pdf?anio=2026&mes=4
// EXCEL: /club/:clubId/reportes/ingresos-vs-gastos-por-responsable/export/excel?anio=2026&mes=4
// Si NO viene mes => exporta TODO el año
// Columnas: Tipo ingreso/gasto | Tipo | Periodo | Monto | Descripción
// ============================================================

async function getMovsIngGastoPorRespExport(clubId, anio, mesOrNull) {
  const mes = mesOrNull ? Number(mesOrNull) : null;

  const q = `
    SELECT * FROM (
      SELECT
        COALESCE(ti.nombre, 'Otro ingreso') AS tipo_item,
        'ingreso'::text AS tipo,
        to_char(ig.fecha, 'YYYY-MM') AS periodo,
        ig.monto::numeric AS monto,
        COALESCE(ig.observacion, '') AS descripcion
      FROM ingresos_generales ig
      LEFT JOIN tipos_ingreso ti ON ti.id = ig.tipo_ingreso_id
      WHERE ig.club_id = $1
        AND ig.activo = true
        AND EXTRACT(YEAR FROM ig.fecha) = $2
        AND ($3::int IS NULL OR EXTRACT(MONTH FROM ig.fecha) = $3::int)

      UNION ALL

      SELECT
        'Cuotas'::text AS tipo_item,
        'ingreso'::text AS tipo,
        to_char(pm.fecha_pago, 'YYYY-MM') AS periodo,
        pm.monto::numeric AS monto,
        ('Cuota ' || pm.mes || '/' || pm.anio)::text AS descripcion
      FROM pagos_mensuales pm
      WHERE pm.club_id = $1
        AND pm.fecha_pago IS NOT NULL
        AND EXTRACT(YEAR FROM pm.fecha_pago) = $2
        AND ($3::int IS NULL OR EXTRACT(MONTH FROM pm.fecha_pago) = $3::int)

      UNION ALL

      SELECT
        COALESCE(tg.nombre, 'Sin tipo') AS tipo_item,
        'gasto'::text AS tipo,
        to_char(g.periodo, 'YYYY-MM') AS periodo,
        g.monto::numeric AS monto,
        COALESCE(g.descripcion, '') AS descripcion
      FROM gastos g
      LEFT JOIN tipos_gasto tg ON tg.id = g.tipo_gasto_id
      WHERE g.club_id = $1
        AND g.activo = true
        AND EXTRACT(YEAR FROM g.periodo) = $2
        AND ($3::int IS NULL OR EXTRACT(MONTH FROM g.periodo) = $3::int)
    ) t
    ORDER BY periodo, tipo, tipo_item, descripcion;
  `;

  const r = await db.query(q, [clubId, anio, mes]);
  return r.rows || [];
}

// PDF export
router.get(
  '/:clubId/reportes/ingresos-vs-gastos-por-responsable/export/pdf',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    try {
      const { clubId } = req.params;
      const anio = Number(req.query.anio);
      const mes  = req.query.mes ? Number(req.query.mes) : null;

      if (!anio) return res.status(400).json({ ok:false, error:'anio es obligatorio' });
      if (mes !== null && (mes < 1 || mes > 12)) return res.status(400).json({ ok:false, error:'mes inválido (1-12)' });

      const rowsRaw = await getMovsIngGastoPorRespExport(clubId, anio, mes);
      const rows = rowsRaw.map(r => ({
        ...r,
        monto: Number(r.monto || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      }));

      return sendPDF(
        res,
        `Ingresos_vs_Gastos_por_responsable_${anio}${mes ? '-' + String(mes).padStart(2,'0') : ''}`,
        [
          { key:'tipo_item',   label:'Tipo ingreso/gasto', width: 170 },
          { key:'tipo',        label:'Tipo',              width: 55  },
          { key:'periodo',     label:'Periodo',           width: 70  },
          { key:'monto',       label:'Monto',             width: 70  },
          { key:'descripcion', label:'Descripción',       width: 180 }
        ],
        rows
      );
    } catch (e) {
      console.error('❌ export pdf ingresos-vs-gastos-por-responsable', e);
      return res.status(500).json({ ok:false, error: e.message });
    }
  }
);

// EXCEL export
router.get(
  '/:clubId/reportes/ingresos-vs-gastos-por-responsable/export/excel',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    try {
      const { clubId } = req.params;
      const anio = Number(req.query.anio);
      const mes  = req.query.mes ? Number(req.query.mes) : null;

      if (!anio) return res.status(400).json({ ok:false, error:'anio es obligatorio' });
      if (mes !== null && (mes < 1 || mes > 12)) return res.status(400).json({ ok:false, error:'mes inválido (1-12)' });

      const rows = await getMovsIngGastoPorRespExport(clubId, anio, mes);

      return sendExcel(
        res,
        `Ingresos_vs_Gastos_por_responsable_${anio}${mes ? '-' + String(mes).padStart(2,'0') : ''}`,
        [
          { key:'tipo_item',   label:'Tipo ingreso/gasto' },
          { key:'tipo',        label:'Tipo' },
          { key:'periodo',     label:'Periodo' },
          { key:'monto',       label:'Monto' },
          { key:'descripcion', label:'Descripción' }
        ],
        rows
      );
    } catch (e) {
      console.error('❌ export excel ingresos-vs-gastos-por-responsable', e);
      return res.status(500).json({ ok:false, error: e.message });
    }
  }
);

// ============================================================
// NUEVO: DETALLE POR MES PARA RANKING / CUENTAS / IG RESP
// ============================================================

// A) DETALLE: ingresos por tipo dentro del MES
// GET /club/:clubId/reportes/ingresos-por-tipo/detalle-mes?anio=2026&mes=4&tipo=Cuotas
router.get(
  '/:clubId/reportes/ingresos-por-tipo/detalle-mes',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const anio = Number(req.query.anio);
    const mes = Number(req.query.mes);
    const tipo = (req.query.tipo || '').toString();

    if (!anio || !mes || !tipo) {
      return res.status(400).json({ ok: false, error: 'anio, mes y tipo son obligatorios' });
    }

    try {
      // Si es Cuotas -> pagos_mensuales por fecha_pago (igual que tu ranking)
      if (tipo === 'Cuotas') {
  const q = `
    SELECT
      pm.id,
      pm.fecha_pago AS fecha,
      ('Cuota ' || pm.mes || '/' || pm.anio)::text AS descripcion,
      pm.cuenta,
      pm.monto
    FROM pagos_mensuales pm
    WHERE pm.club_id = $1
      AND pm.fecha_pago IS NOT NULL
      AND EXTRACT(YEAR FROM pm.fecha_pago) = $2
      AND EXTRACT(MONTH FROM pm.fecha_pago) = $3
    ORDER BY pm.fecha_pago ASC
  `;
  const r = await db.query(q, [clubId, anio, mes]);
  return res.json({ ok: true, rows: r.rows });
}

      // Otros tipos -> ingresos_generales por fecha del mes
      const qOtros = `
        SELECT
          ig.id,
          ig.fecha,
          ig.monto,
          ig.observacion,
          ig.cuenta,
          COALESCE(ti.nombre, 'Otro ingreso') AS tipo
        FROM ingresos_generales ig
        LEFT JOIN tipos_ingreso ti ON ti.id = ig.tipo_ingreso_id
        WHERE ig.club_id = $1
          AND ig.activo = true
          AND EXTRACT(YEAR FROM ig.fecha) = $2
          AND EXTRACT(MONTH FROM ig.fecha) = $3
          AND COALESCE(ti.nombre, 'Otro ingreso') = $4
        ORDER BY ig.fecha DESC;
      `;
      const r2 = await db.query(qOtros, [clubId, anio, mes, tipo]);
      return res.json({ ok: true, rows: r2.rows });
    } catch (e) {
      console.error('❌ ingresos-por-tipo/detalle-mes', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// B) DETALLE: gastos por tipo dentro del MES
// GET /club/:clubId/reportes/gastos-por-tipo/detalle-mes?anio=2026&mes=4&tipo_gasto=Luz
router.get(
  '/:clubId/reportes/gastos-por-tipo/detalle-mes',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const anio = Number(req.query.anio);
    const mes = Number(req.query.mes);
    const tipo_gasto = (req.query.tipo_gasto || '').toString();

    if (!anio || !mes || !tipo_gasto) {
      return res.status(400).json({ ok: false, error: 'anio, mes y tipo_gasto son obligatorios' });
    }

    try {
      const q = `
        SELECT
          g.id,
          g.periodo,
          g.fecha_gasto,
          g.monto,
          g.descripcion,
          COALESCE(tg.nombre, 'Sin tipo') AS tipo_gasto,
          COALESCE(rg.nombre, 'Sin responsable') AS responsable
        FROM gastos g
        LEFT JOIN tipos_gasto tg ON tg.id = g.tipo_gasto_id
        LEFT JOIN responsables_gasto rg ON rg.id = g.responsable_id
        WHERE g.club_id = $1
          AND g.activo = true
          AND EXTRACT(YEAR FROM g.periodo) = $2
          AND EXTRACT(MONTH FROM g.periodo) = $3
          AND COALESCE(tg.nombre, 'Sin tipo') = $4
        ORDER BY g.fecha_gasto;
      `;
      const r = await db.query(q, [clubId, anio, mes, tipo_gasto]);
      return res.json({ ok: true, rows: r.rows });
    } catch (e) {
      console.error('❌ gastos-por-tipo/detalle-mes', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// C) DETALLE: ingresos por responsable (en tu modelo "responsable" = cuenta)
// GET /club/:clubId/reportes/ingresos-por-responsable/detalle?anio=2026&mes=4&cuenta=Efectivo
router.get(
  '/:clubId/reportes/ingresos-por-responsable/detalle',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const anio = Number(req.query.anio);
    const mes = Number(req.query.mes);
    const cuenta = (req.query.cuenta || '').toString();

    if (!anio || !mes || !cuenta) {
      return res.status(400).json({ ok: false, error: 'anio, mes y cuenta son obligatorios' });
    }

    try {
      // ingresos_generales del mes
      const q1 = `
        SELECT
          ig.id,
          ig.fecha,
          ig.monto,
          ig.observacion AS descripcion,
          COALESCE(ig.cuenta, 'Sin cuenta') AS cuenta,
          'Ingreso general'::text AS origen
        FROM ingresos_generales ig
        WHERE ig.club_id = $1
          AND ig.activo = true
          AND EXTRACT(YEAR FROM ig.fecha) = $2
          AND EXTRACT(MONTH FROM ig.fecha) = $3
          AND COALESCE(ig.cuenta, 'Sin cuenta') = $4
        ORDER BY ig.fecha DESC;
      `;

      // cuotas pagadas en el mes (por fecha_pago)
      const q2 = `
  SELECT
    pm.id,
    pm.fecha_pago AS fecha,
    pm.monto,
    ('Cuota ' || pm.mes || '/' || pm.anio)::text AS descripcion,
    COALESCE(pm.cuenta, 'Sin cuenta') AS cuenta,

    -- ✅ socio_nombre “a prueba de borrado”
    (
      COALESCE(pm.socio_apellido, s.apellido, '') || ' ' ||
      COALESCE(pm.socio_nombre,  s.nombre,  '') ||
      CASE
        WHEN COALESCE(pm.socio_numero, s.numero_socio) IS NULL THEN ''
        ELSE ' (#' || COALESCE(pm.socio_numero, s.numero_socio) || ')'
      END
    )::text AS socio_nombre,

    'Cuotas'::text AS origen
  FROM pagos_mensuales pm
  LEFT JOIN socios s ON s.id = pm.socio_id
  WHERE pm.club_id = $1
  AND pm.fecha_pago IS NOT NULL
  AND EXTRACT(YEAR FROM pm.fecha_pago) = $2
  AND EXTRACT(MONTH FROM pm.fecha_pago) = $3
  AND COALESCE(pm.cuenta, 'Sin cuenta') = $4
  ORDER BY pm.fecha_pago DESC;
`;

      const [r1, r2] = await Promise.all([
        db.query(q1, [clubId, anio, mes, cuenta]),
        db.query(q2, [clubId, anio, mes, cuenta]),
      ]);

      const rows = r1.rows
        .map(x => ({ ...x, tipo: 'ING', socio: x.socio || null }))
        .concat(r2.rows.map(x => ({ ...x, tipo: 'CUOTA' })));

      return res.json({ ok: true, rows });
    } catch (e) {
      console.error('❌ ingresos-por-responsable/detalle', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// D) DETALLE: ingresos vs gastos por responsable (para clicks en el reporte #7)
// GET /club/:clubId/reportes/ingresos-vs-gastos-por-responsable/detalle?anio=2026&mes=4&responsable=Efectivo&tipo=ingresos|gastos|todos
router.get(
  '/:clubId/reportes/ingresos-vs-gastos-por-responsable/detalle',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const anio = Number(req.query.anio);
    const mes  = Number(req.query.mes);
    const responsable = String(req.query.responsable || '');
    const tipo = String(req.query.tipo || 'todos').toLowerCase();

    if (!anio || !mes || !responsable) {
      return res.status(400).json({ ok: false, error: 'anio, mes y responsable son obligatorios' });
    }

    try {
      const result = {};

      // INGRESOS (responsable = cuenta)
      if (tipo === 'ingresos' || tipo === 'todos') {
        const qIngGen = `
          SELECT
            COALESCE(ti.nombre,'Otro ingreso') AS tipo_item,
            'ingreso'::text AS tipo,
            to_char(ig.fecha,'YYYY-MM') AS periodo,
            ig.monto::numeric AS monto,
            COALESCE(ig.observacion,'') AS descripcion
          FROM ingresos_generales ig
          LEFT JOIN tipos_ingreso ti ON ti.id = ig.tipo_ingreso_id
          WHERE ig.club_id = $1
            AND ig.activo = true
            AND EXTRACT(YEAR FROM ig.fecha) = $2
            AND EXTRACT(MONTH FROM ig.fecha) = $3
            AND COALESCE(ig.cuenta,'Sin cuenta') = $4
          ORDER BY ig.fecha DESC
        `;

        const qCuotas = `
          SELECT
            'Cuotas'::text AS tipo_item,
            'ingreso'::text AS tipo,
            to_char(pm.fecha_pago,'YYYY-MM') AS periodo,
            pm.monto::numeric AS monto,
            ('Cuota ' || pm.mes || '/' || pm.anio)::text AS descripcion
          FROM pagos_mensuales pm
          WHERE pm.club_id = $1
            AND pm.fecha_pago IS NOT NULL
            AND EXTRACT(YEAR FROM pm.fecha_pago) = $2
            AND EXTRACT(MONTH FROM pm.fecha_pago) = $3
            AND COALESCE(pm.cuenta,'Sin cuenta') = $4
          ORDER BY pm.fecha_pago DESC
        `;

        const [rA, rB] = await Promise.all([
          db.query(qIngGen, [clubId, anio, mes, responsable]),
          db.query(qCuotas, [clubId, anio, mes, responsable])
        ]);

        result.ingresos = (rA.rows || []).concat(rB.rows || []);
      }

      // GASTOS (responsable = responsables_gasto.nombre)
      if (tipo === 'gastos' || tipo === 'todos') {
        const qGas = `
          SELECT
            COALESCE(tg.nombre,'Sin tipo') AS tipo_item,
            'gasto'::text AS tipo,
            to_char(g.periodo,'YYYY-MM') AS periodo,
            g.monto::numeric AS monto,
            COALESCE(g.descripcion,'') AS descripcion
          FROM gastos g
          LEFT JOIN tipos_gasto tg ON tg.id = g.tipo_gasto_id
          LEFT JOIN responsables_gasto rg ON rg.id = g.responsable_id
          WHERE g.club_id = $1
            AND g.activo = true
            AND EXTRACT(YEAR FROM g.periodo) = $2
            AND EXTRACT(MONTH FROM g.periodo) = $3
            AND COALESCE(rg.nombre,'Sin responsable') = $4
          ORDER BY g.fecha_gasto DESC
        `;

        const rG = await db.query(qGas, [clubId, anio, mes, responsable]);
        result.gastos = rG.rows || [];
      }

      return res.json({ ok: true, rows: result });

    } catch (e) {
      console.error('❌ ingresos-vs-gastos-por-responsable/detalle', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ============================================================
// EXPORT: Ingresos vs Gastos por responsable (MES o AÑO)
// PDF:   /club/:clubId/reportes/ingresos-vs-gastos-por-responsable/export/pdf?anio=2026&mes=4
// EXCEL: /club/:clubId/reportes/ingresos-vs-gastos-por-responsable/export/excel?anio=2026&mes=4
// Si NO viene mes => exporta TODO el año
// Columnas: Tipo ingreso/gasto | Tipo | Periodo | Monto | Descripción
// ============================================================

async function getMovsIngGastoPorRespExport(clubId, anio, mesOrNull) {
  const mes = mesOrNull ? Number(mesOrNull) : null;

  const q = `
    SELECT * FROM (
      SELECT
        COALESCE(ti.nombre, 'Otro ingreso') AS tipo_item,
        'ingreso'::text AS tipo,
        to_char(ig.fecha, 'YYYY-MM') AS periodo,
        ig.monto::numeric AS monto,
        COALESCE(ig.observacion, '') AS descripcion
      FROM ingresos_generales ig
      LEFT JOIN tipos_ingreso ti ON ti.id = ig.tipo_ingreso_id
      WHERE ig.club_id = $1
        AND ig.activo = true
        AND EXTRACT(YEAR FROM ig.fecha) = $2
        AND ($3::int IS NULL OR EXTRACT(MONTH FROM ig.fecha) = $3::int)

      UNION ALL

      SELECT
        'Cuotas'::text AS tipo_item,
        'ingreso'::text AS tipo,
        to_char(pm.fecha_pago, 'YYYY-MM') AS periodo,
        pm.monto::numeric AS monto,
        ('Cuota ' || pm.mes || '/' || pm.anio)::text AS descripcion
      FROM pagos_mensuales pm
      WHERE pm.club_id = $1
        AND pm.fecha_pago IS NOT NULL
        AND EXTRACT(YEAR FROM pm.fecha_pago) = $2
        AND ($3::int IS NULL OR EXTRACT(MONTH FROM pm.fecha_pago) = $3::int)

      UNION ALL

      SELECT
        COALESCE(tg.nombre, 'Sin tipo') AS tipo_item,
        'gasto'::text AS tipo,
        to_char(g.periodo, 'YYYY-MM') AS periodo,
        g.monto::numeric AS monto,
        COALESCE(g.descripcion, '') AS descripcion
      FROM gastos g
      LEFT JOIN tipos_gasto tg ON tg.id = g.tipo_gasto_id
      WHERE g.club_id = $1
        AND g.activo = true
        AND EXTRACT(YEAR FROM g.periodo) = $2
        AND ($3::int IS NULL OR EXTRACT(MONTH FROM g.periodo) = $3::int)
    ) t
    ORDER BY periodo, tipo, tipo_item, descripcion;
  `;

  const r = await db.query(q, [clubId, anio, mes]);
  return r.rows || [];
}

// PDF export
router.get(
  '/:clubId/reportes/ingresos-vs-gastos-por-responsable/export/pdf',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    try {
      const { clubId } = req.params;
      const anio = Number(req.query.anio);
      const mes  = req.query.mes ? Number(req.query.mes) : null;

      if (!anio) return res.status(400).json({ ok:false, error:'anio es obligatorio' });
      if (mes !== null && (mes < 1 || mes > 12)) {
        return res.status(400).json({ ok:false, error:'mes inválido (1-12)' });
      }

      const rowsRaw = await getMovsIngGastoPorRespExport(clubId, anio, mes);
      const rows = rowsRaw.map(r => ({
        ...r,
        monto: Number(r.monto || 0).toLocaleString('es-AR', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
      }));

      return sendPDF(
        res,
        `Ingresos_vs_Gastos_por_responsable_${anio}${mes ? '-' + String(mes).padStart(2,'0') : ''}`,
        [
          { key:'tipo_item',   label:'Tipo ingreso/gasto', width: 170 },
          { key:'tipo',        label:'Tipo',              width: 55  },
          { key:'periodo',     label:'Periodo',           width: 70  },
          { key:'monto',       label:'Monto',             width: 70  },
          { key:'descripcion', label:'Descripción',       width: 180 }
        ],
        rows
      );

    } catch (e) {
      console.error('❌ export pdf ingresos-vs-gastos-por-responsable', e);
      return res.status(500).json({ ok:false, error: e.message });
    }
  }
);

// EXCEL export
router.get(
  '/:clubId/reportes/ingresos-vs-gastos-por-responsable/export/excel',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    try {
      const { clubId } = req.params;
      const anio = Number(req.query.anio);
      const mes  = req.query.mes ? Number(req.query.mes) : null;

      if (!anio) return res.status(400).json({ ok:false, error:'anio es obligatorio' });
      if (mes !== null && (mes < 1 || mes > 12)) {
        return res.status(400).json({ ok:false, error:'mes inválido (1-12)' });
      }

      const rows = await getMovsIngGastoPorRespExport(clubId, anio, mes);

      return sendExcel(
        res,
        `Ingresos_vs_Gastos_por_responsable_${anio}${mes ? '-' + String(mes).padStart(2,'0') : ''}`,
        [
          { key:'tipo_item',   label:'Tipo ingreso/gasto' },
          { key:'tipo',        label:'Tipo' },
          { key:'periodo',     label:'Periodo' },
          { key:'monto',       label:'Monto' },
          { key:'descripcion', label:'Descripción' }
        ],
        rows
      );

    } catch (e) {
      console.error('❌ export excel ingresos-vs-gastos-por-responsable', e);
      return res.status(500).json({ ok:false, error: e.message });
    }
  }
);

module.exports = router;