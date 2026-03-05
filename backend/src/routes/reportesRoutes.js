// routes/reportesRoutes.js
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const router = express.Router();

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
      cantidad: Number(row.cantidad)
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
        GROUP BY EXTRACT(MONTH FROM pm.fecha_pago)
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
          WHERE pm.club_id = $1 AND pm.anio = $2 AND pm.mes = $3
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
// 7) Gastos por Tipo de gasto
// GET /club/:clubId/reportes/gastos-por-tipo
// ===============================
router.get('/:clubId/reportes/gastos-por-tipo', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;

  const MESES = [
    'Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
  ];

  try {
    const r = await db.query(
      `
      SELECT
        EXTRACT(YEAR FROM g.periodo)::int  AS anio,
        EXTRACT(MONTH FROM g.periodo)::int AS mes_num,
        COALESCE(tg.nombre, 'Sin tipo')    AS tipo_gasto,
        SUM(g.monto)                       AS total
      FROM gastos g
      LEFT JOIN tipos_gasto tg ON tg.id = g.tipo_gasto_id
      WHERE g.club_id = $1
        AND g.activo = true
      GROUP BY anio, mes_num, tipo_gasto
      ORDER BY anio, mes_num, tipo_gasto
      `,
      [clubId]
    );

    const filas = r.rows.map(row => ({
      anio: row.anio,
      mes: MESES[row.mes_num - 1],
      tipo_gasto: row.tipo_gasto,
      total: Number(row.total)
    }));

    res.json({
      ok: true,
      title: 'Gastos por Tipo de gasto',
      description: 'Total de gastos agrupados por año, mes y tipo de gasto.',
      columns: [
        { key: 'anio',       label: 'Año' },
        { key: 'mes',        label: 'Mes' },
        { key: 'tipo_gasto', label: 'Tipo de gasto' },
        { key: 'total',      label: 'Total (ARS)' }
      ],
      rows: filas
    });

  } catch (e) {
    console.error('❌ reporte gastos-por-tipo', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// 8) Gastos por Responsable por mes
// GET /club/:clubId/reportes/gastos-responsable-mes
// ===============================
router.get('/:clubId/reportes/gastos-responsable-mes', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;

  // Meses en nombre completo
  const MESES = [
    'Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
  ];

  try {
    const r = await db.query(
      `
      SELECT
        EXTRACT(YEAR FROM g.periodo)::int AS anio,
        EXTRACT(MONTH FROM g.periodo)::int AS mes_num,
        COALESCE(rg.nombre, 'Sin responsable') AS responsable,
        SUM(g.monto) AS total
      FROM gastos g
      LEFT JOIN responsables_gasto rg ON rg.id = g.responsable_id
      WHERE g.club_id = $1
        AND g.activo = true
      GROUP BY anio, mes_num, responsable
      ORDER BY anio, mes_num, responsable
      `,
      [clubId]
    );

    // Convertir número de mes → nombre completo
    const filas = r.rows.map(row => ({
      anio: row.anio,
      mes: MESES[row.mes_num - 1],
      responsable: row.responsable,
      total: Number(row.total)
    }));

    res.json({
      ok: true,
      title: 'Gastos por Responsable por mes',
      description: 'Total de gastos agrupados por año, mes y responsable.',
      columns: [
        { key: 'anio', label: 'Año' },
        { key: 'mes', label: 'Mes' },
        { key: 'responsable', label: 'Responsable' },
        { key: 'total', label: 'Total (ARS)' }
      ],
      rows: filas
    });

  } catch (e) {
    console.error('❌ reporte gastos-responsable-mes', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});
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
          s.numero_socio,
          s.nombre,
          s.apellido,
          s.actividad,
          s.categoria
        FROM pagos_mensuales pm
        JOIN socios s ON s.id = pm.socio_id
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

module.exports = router;