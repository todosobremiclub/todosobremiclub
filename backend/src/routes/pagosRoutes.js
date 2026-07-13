const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// CORS para Flutter Web (similar a noticias/cumples)
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ===============================
// Helper: validar acceso al club (ADMIN)
// ===============================
function requireClubAccess(req, res, next) {
  const { clubId } = req.params;
  const roles = req.user?.roles || [];
  const allowed = roles.some(
    (r) => String(r.club_id) === String(clubId) || r.role === 'superadmin'
  );
  if (!allowed) {
    return res.status(403).json({ ok: false, error: 'No autorizado para este club' });
  }
  next();
}

// ===============================
// Helpers fecha YYYY-MM-DD
// ===============================
function isISODate(d) {
  return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

// ============================================================
// GET /club/:clubId/pagos/resumen?anio=2026
// Solo ADMIN – resumen para la tabla principal
// ============================================================
router.get(
  '/:clubId/pagos/resumen',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    try {
      const { clubId } = req.params;
      const anio = Number(req.query.anio) || new Date().getFullYear();

      const r = await db.query(
        `
        SELECT
          s.id AS socio_id,
          s.numero_socio,
          s.dni,
          s.nombre,
          s.apellido,
          COALESCE(
            ARRAY_AGG(pm.mes ORDER BY pm.mes) FILTER (WHERE pm.mes IS NOT NULL),
            '{}'
          ) AS meses_pagados
        FROM socios s
        LEFT JOIN pagos_mensuales pm
          ON pm.socio_id = s.id
         AND pm.club_id = s.club_id
         AND pm.anio = $2
        WHERE s.club_id = $1 AND s.activo = true
        GROUP BY s.id, s.numero_socio, s.dni, s.nombre, s.apellido
        ORDER BY s.numero_socio ASC
        `,
        [clubId, anio]
      );

      res.json({ ok: true, anio, socios: r.rows });
    } catch (e) {
      console.error('❌ pagos resumen:', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ============================================================
// GET /club/:clubId/pagos/:socioId?anio=2026
// ADMIN: puede ver cualquier socio del club
// APP SOCIO: solo su propio socioId y clubId (recibos)
// ============================================================
router.get('/:clubId/pagos/:socioId', requireAuth, async (req, res) => {
  try {
    const { clubId, socioId } = req.params;
    const anio = Number(req.query.anio) || new Date().getFullYear();
    const roles = req.user?.roles || [];

    const esAdmin = roles.some(
      (r) => String(r.club_id) === String(clubId) || r.role === 'superadmin'
    );

    // =========================
    // CASO ADMIN
    // =========================
    if (esAdmin) {
  const [rAdmin, rClub] = await Promise.all([
    db.query(
      `
SELECT
  id,
  mes,
  monto,
  fecha_pago,
  cuenta,
  detalle_pago,
  monto_total_teorico,
  monto_pagado,
  pago_completo
FROM pagos_mensuales
WHERE club_id = $1 AND socio_id = $2 AND anio = $3
ORDER BY mes ASC      `,
      [clubId, socioId, anio]
    ),
    db.query(
      `
      SELECT transferencia_habilitada
      FROM clubs
      WHERE id = $1
      LIMIT 1
      `,
      [clubId]
    )
  ]);

  const pagosRowsAdmin = rAdmin.rows || [];
  const transferenciaHabilitada = rClub.rowCount
    ? rClub.rows[0].transferencia_habilitada === true
    : false;

  return res.json({
    ok: true,
    anio,
    transferencia_habilitada: transferenciaHabilitada,
    pagos: pagosRowsAdmin,
    mesesPagados: pagosRowsAdmin.map((p) => Number(p.mes)),
  });
}

    // =========================
    // CASO APP SOCIO
    // =========================
    if (!req.user?.socioId) {
      return res.status(403).json({
        ok: false,
        error: 'Token inválido para ver pagos (no es socio ni admin)',
      });
    }

    if (String(req.user.socioId) !== String(socioId)) {
      return res.status(403).json({
        ok: false,
        error: 'No autorizado para ver pagos de otro socio',
      });
    }

    if (req.user.clubId && String(req.user.clubId) !== String(clubId)) {
      return res.status(403).json({
        ok: false,
        error: 'El socio no pertenece a este club',
      });
    }

const rClub = await db.query(
      `
      SELECT transferencia_habilitada
      FROM clubs
      WHERE id = $1
      LIMIT 1
      `,
      [clubId]
    );

    const transferenciaHabilitada = rClub.rowCount
      ? rClub.rows[0].transferencia_habilitada === true
      : false;


    const rSocio = await db.query(
      `
SELECT
  pm.id,
  pm.mes,
  pm.monto,
  pm.fecha_pago,
  pm.cuenta,
  pm.detalle_pago,
  pm.monto_total_teorico,
  pm.monto_pagado,
  pm.pago_completo,
  tp.estado_transferencia
      FROM pagos_mensuales pm
      LEFT JOIN LATERAL (
        SELECT
          CASE
            WHEN estado = 'comprobante_subido' THEN 'en_revision'
            WHEN estado = 'rechazado' THEN 'rechazado'
            ELSE NULL
          END AS estado_transferencia
        FROM transferencias_pago
        WHERE club_id = pm.club_id
          AND socio_id = pm.socio_id
          AND anio = pm.anio
          AND mes = pm.mes
        ORDER BY created_at DESC
        LIMIT 1
      ) tp ON true
      WHERE pm.club_id = $1
        AND pm.socio_id = $2
        AND pm.anio = $3
      ORDER BY pm.mes ASC
      `,
      [clubId, socioId, anio]
    );

    let pagosRows = rSocio.rows || [];

    const now = new Date();
    const anioNow = now.getFullYear();
    const mesNow = now.getMonth() + 1;

    // Solo para el año actual
    if (Number(anio) === Number(anioNow)) {
      const existeMes = pagosRows.some((p) => Number(p.mes) === Number(mesNow));

      if (!existeMes) {
        const rT = await db.query(
          `
          SELECT
            CASE
              WHEN estado = 'comprobante_subido' THEN 'en_revision'
              WHEN estado = 'rechazado' THEN 'rechazado'
              ELSE NULL
            END AS estado_transferencia
          FROM transferencias_pago
          WHERE club_id = $1
            AND socio_id = $2
            AND anio = $3
            AND mes = $4
          ORDER BY created_at DESC
          LIMIT 1
          `,
          [clubId, socioId, anioNow, mesNow]
        );

        pagosRows.push({
          mes: mesNow,
          monto: 0,
          fecha_pago: '',
          cuenta: '',
          pendiente: true,
          estado_transferencia: rT.rowCount
            ? rT.rows[0].estado_transferencia
            : null,
        });
      }
    }

    return res.json({
      ok: true,
      anio,
      pagos: pagosRows,
      mesesPagados: pagosRows
        .filter((p) => !p.pendiente)
        .map((p) => Number(p.mes)),
    });
  } catch (e) {
    console.error('❌ pagos socio:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// POST /club/:clubId/pagos
// body: {
//   socio_id?: uuid,
//   socioId?: uuid,
//   anio: number,
//   meses?: [1..12],
//   mes?: 1..12,
//   fecha_pago?: "YYYY-MM-DD",
//   es_parcial?: boolean,
//   monto_parcial?: number,
//   cuenta?: string,
//   cuenta_id?: uuid
// }

// ============================================================
router.post(
  '/:clubId/pagos',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    try {
      const { clubId } = req.params;
const {
  socio_id,
  socioId,
  anio,
  meses,
  mes,
  fecha_pago,
  es_parcial = false,
  monto_parcial = null,
  cuenta = null,
  cuenta_id = null,
  detalle_pago = [],
  monto_total_teorico = null,
  monto_pagado = null,
  pago_completo = true,
} = req.body ?? {};
const socioIdFinal = socio_id || socioId;

const mesesFinal =
  Array.isArray(meses) && meses.length
    ? meses
    : (mes ? [Number(mes)] : []);

const fechaPagoFinal = fecha_pago || new Date().toISOString().slice(0, 10);


      // Validación básica
if (!socioIdFinal || !anio || mesesFinal.length === 0 || !fechaPagoFinal) {
  return res.status(400).json({ ok: false, error: 'Datos incompletos' });
}

      // Validación específica de pago parcial
      const esParcialBool = es_parcial === true || es_parcial === 'true';
      if (esParcialBool) {
        if (
          monto_parcial === null ||
          monto_parcial === '' ||
          Number.isNaN(Number(monto_parcial)) ||
          Number(monto_parcial) < 0
        ) {
          return res.status(400).json({
            ok: false,
            error: 'Para pago parcial debés indicar un monto_parcial válido (>= 0).',
          });
        }
      }

      // Validar fecha
      if (!isISODate(fechaPagoFinal)) {
        return res.status(400).json({
          ok: false,
          error: 'fecha_pago inválida (use YYYY-MM-DD)',
        });
      }

      // Año y meses
      const anioNum = Number(anio);
const mesesNum = mesesFinal.map(Number).filter((m) => m >= 1 && m <= 12);

if (!anioNum || mesesNum.length === 0) {
  return res.status(400).json({ ok: false, error: 'Año o meses inválidos' });
}

      // ------------------------------
      // Resolver nombre de cuenta
      // ------------------------------
      let cuentaFinal = cuenta;

      if (!cuentaFinal && cuenta_id) {
        try {
          const rCuenta = await db.query(
            `
            SELECT nombre
            FROM responsables_gasto
            WHERE id = $1 AND club_id = $2
            LIMIT 1
            `,
            [cuenta_id, clubId]
          );
          if (rCuenta.rowCount) {
            cuentaFinal = rCuenta.rows[0].nombre;
          }
        } catch (e) {
          console.error('Error resolviendo cuenta desde cuenta_id (pagos)', e);
        }
      }

      // ------------------------------
      // Lógica actividad + precio (actividad o excepción)
      // ------------------------------
      const socioRes = await db.query(
  `
  SELECT
    s.actividad,
    s.excepcion_cuota_id,
    s.nombre,
    s.apellido,
    s.numero_socio,
    EXISTS (
      SELECT 1
      FROM grupos_familiares gf
      WHERE gf.club_id = s.club_id
        AND gf.jefe_socio_id = s.id
        AND gf.activo = true
    ) AS es_jefe_plan_familiar,
    (
      SELECT gf.jefe_socio_id
      FROM grupos_familiares gf
      JOIN grupos_familiares_miembros gfm
        ON gfm.grupo_familiar_id = gf.id
      WHERE gf.club_id = s.club_id
        AND gfm.socio_id = s.id
        AND gf.activo = true
      LIMIT 1
    ) AS grupo_familiar_jefe_id
  FROM socios s
  WHERE s.id = $1
    AND s.club_id = $2
  LIMIT 1
  `,
  [socioIdFinal, clubId]
);


      if (!socioRes.rowCount) {
        return res.status(404).json({ ok: false, error: 'Socio no encontrado' });
      }

      const actividadSocio = socioRes.rows[0].actividad;
const excepcionCuotaId = socioRes.rows[0].excepcion_cuota_id;

const socioNombre = socioRes.rows[0].nombre;
const socioApellido = socioRes.rows[0].apellido;
const socioNumero = socioRes.rows[0].numero_socio;

const esJefePlanFamiliar = socioRes.rows[0].es_jefe_plan_familiar === true;
const grupoFamiliarJefeId = socioRes.rows[0].grupo_familiar_jefe_id || null;

if (grupoFamiliarJefeId && !esJefePlanFamiliar) {
  return res.status(400).json({
    ok: false,
    error: 'No se puede registrar un pago para este socio porque pertenece a un Grupo Familiar. El pago debe registrarse al jefe/a del grupo.'
  });
}

      // Si NO es pago parcial, debe existir actividad o excepción,
// excepto si el socio es jefe/a de Grupo Familiar
if (!actividadSocio && !excepcionCuotaId && !esParcialBool && !esJefePlanFamiliar) {
  return res.status(400).json({
    ok: false,
    error:
      'El socio no tiene actividad ni excepción asignada. Configurá la actividad o la excepción antes de registrar el pago.',
  });
}


      let montoPorMes = 0;

if (esParcialBool) {
  // Pago parcial: el monto viene del front
  montoPorMes = Number(monto_parcial);
} else {
  if (esJefePlanFamiliar) {
  // 🔥 si es jefe/a, cobra la actividad Grupo Familiar
  const rGFPrecio = await db.query(
    `
    SELECT precio_mensual
    FROM actividades
    WHERE club_id = $1
      AND nombre = 'Grupo Familiar'
      AND activo = true
    LIMIT 1
    `,
    [clubId]
  );

  if (!rGFPrecio.rowCount) {
    return res.status(400).json({
      ok: false,
      error: 'El club no tiene configurada la actividad Grupo Familiar. Activala en Configuración antes de registrar el pago.'
    });
  }

  montoPorMes = Number(rGFPrecio.rows[0].precio_mensual) || 0;
}


else if (excepcionCuotaId) {
    // excepción de cuota
    const rExc = await db.query(
      `
      SELECT monto
      FROM excepciones_cuota
      WHERE club_id = $1
        AND id = $2
        AND activo = true
      LIMIT 1
      `,
      [clubId, excepcionCuotaId]
    );

    montoPorMes = rExc.rowCount ? (Number(rExc.rows[0].monto) || 0) : 0;
  } else {
    // actividad normal
    const rPrecio = await db.query(
      `
      SELECT precio_mensual
      FROM actividades
      WHERE club_id = $1
        AND nombre = $2
        AND activo = true
      LIMIT 1
      `,
      [clubId, actividadSocio]
    );

    montoPorMes = rPrecio.rowCount ? (Number(rPrecio.rows[0].precio_mensual) || 0) : 0;
  }
}

      // ------------------------------
      // Insertar pagos mensuales
      // ------------------------------

// ------------------------------
// Resolver a quiénes pagar
// ------------------------------
let sociosAPagar = [
  {
    socio_id: socioIdFinal,
    nombre: socioNombre ?? null,
    apellido: socioApellido ?? null,
    numero_socio: socioNumero ?? null,
    monto: montoPorMes
  }
];

if (esJefePlanFamiliar) {
  const rMiembros = await db.query(
    `
    SELECT
      s.id AS socio_id,
      s.nombre,
      s.apellido,
      s.numero_socio
    FROM grupos_familiares gf
    JOIN grupos_familiares_miembros gfm
      ON gfm.grupo_familiar_id = gf.id
    JOIN socios s
      ON s.id = gfm.socio_id
    WHERE gf.club_id = $1
      AND gf.jefe_socio_id = $2
      AND gf.activo = true
    ORDER BY s.apellido ASC, s.nombre ASC
    `,
    [clubId, socioIdFinal]
  );

  // al jefe/a se le guarda el monto real; a integrantes, monto 0
  sociosAPagar = [
    {
      socio_id: socioIdFinal,
      nombre: socioNombre ?? null,
      apellido: socioApellido ?? null,
      numero_socio: socioNumero ?? null,
      monto: montoPorMes
    },
    ...rMiembros.rows.map((m) => ({
      socio_id: m.socio_id,
      nombre: m.nombre ?? null,
      apellido: m.apellido ?? null,
      numero_socio: m.numero_socio ?? null,
      monto: 0
    }))
  ];
}
await db.query('BEGIN');
const inserted = [];

for (const socioPago of sociosAPagar) {
  for (const mes of mesesNum) {
    const rPrev = await db.query(
      `
      SELECT
        id,
        detalle_pago,
        monto_total_teorico,
        monto_pagado,
        pago_completo
      FROM pagos_mensuales
      WHERE club_id = $1
        AND socio_id = $2
        AND anio = $3
        AND mes = $4
      LIMIT 1
      `,
      [clubId, socioPago.socio_id, anioNum, mes]
    );

    const detalleBase = Array.isArray(detalle_pago) ? detalle_pago : [];
    const totalTeoricoBase = Number(monto_total_teorico ?? socioPago.monto ?? 0) || 0;
    const montoPagadoBase = Number(monto_pagado ?? socioPago.monto ?? 0) || 0;
    const pagoCompletoBase = pago_completo === true;

    if (!rPrev.rowCount) {
      const rIns = await db.query(
        `
        INSERT INTO pagos_mensuales
        (
          club_id,
          socio_id,
          socio_nombre,
          socio_apellido,
          socio_numero,
          anio,
          mes,
          monto,
          fecha_pago,
          cuenta,
          detalle_pago,
          monto_total_teorico,
          monto_pagado,
          pago_completo
        )
        VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING id, anio, mes, monto, fecha_pago, cuenta, pago_completo
        `,
        [
          clubId,
          socioPago.socio_id,
          socioPago.nombre,
          socioPago.apellido,
          socioPago.numero_socio,
          anioNum,
          mes,
          montoPagadoBase,
          fechaPagoFinal,
          cuentaFinal ?? null,
          JSON.stringify(detalleBase),
          totalTeoricoBase,
          montoPagadoBase,
          pagoCompletoBase
        ]
      );
      if (rIns.rowCount) inserted.push(rIns.rows[0]);
      continue;
    }

    const prev = rPrev.rows[0];

    // Si ya está completo, no se vuelve a tocar
    if (prev.pago_completo === true) {
      continue;
    }

    const prevDetalle = Array.isArray(prev.detalle_pago) ? prev.detalle_pago : [];
    const mergedMap = new Map();

    prevDetalle.forEach((d) => {
      mergedMap.set(`${d.tipo}__${d.nombre}`, {
        tipo: d.tipo,
        nombre: d.nombre,
        monto: Number(d.monto || 0),
        seleccionado: d.seleccionado === true
      });
    });

    detalleBase.forEach((d) => {
      const key = `${d.tipo}__${d.nombre}`;
      const prevItem = mergedMap.get(key);

      if (!prevItem) {
        mergedMap.set(key, {
          tipo: d.tipo,
          nombre: d.nombre,
          monto: Number(d.monto || 0),
          seleccionado: d.seleccionado === true
        });
      } else {
        mergedMap.set(key, {
          tipo: d.tipo,
          nombre: d.nombre,
          monto: Number(d.monto || prevItem.monto || 0),
          seleccionado: prevItem.seleccionado === true || d.seleccionado === true
        });
      }
    });

    const mergedDetalle = Array.from(mergedMap.values());
    const mergedTeorico = Number(prev.monto_total_teorico ?? totalTeoricoBase ?? 0) || 0;
    const mergedPagado = mergedDetalle
      .filter((d) => d.seleccionado === true)
      .reduce((acc, d) => acc + Number(d.monto || 0), 0);

    const mergedCompleto =
      mergedDetalle.length > 0 &&
      mergedDetalle.every((d) => d.seleccionado === true);

    const rUpd = await db.query(
      `
      UPDATE pagos_mensuales
      SET
        monto = $1,
        fecha_pago = $2,
        cuenta = $3,
        detalle_pago = $4,
        monto_total_teorico = $5,
        monto_pagado = $6,
        pago_completo = $7
      WHERE id = $8
      RETURNING id, anio, mes, monto, fecha_pago, cuenta, pago_completo
      `,
      [
        mergedPagado,
        fechaPagoFinal,
        cuentaFinal ?? null,
        JSON.stringify(mergedDetalle),
        mergedTeorico,
        mergedPagado,
        mergedCompleto,
        prev.id
      ]
    );

    if (rUpd.rowCount) inserted.push(rUpd.rows[0]);
  }
}

await db.query('COMMIT');

      return res.json({
        ok: true,
        insertedCount: inserted.length,
        inserted,
      });
    } catch (e) {
      try {
        await db.query('ROLLBACK');
      } catch {}
      console.error('❌ registrar pagos:', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ============================================================
// INGRESOS GENERALES (no asociados a socio)
// ============================================================
router.get(
  '/:clubId/ingresos',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const { desde = '', hasta = '', limit = '200', offset = '0' } = req.query;

    try {
      const where = ['ig.club_id = $1', 'ig.activo = true'];
      const params = [clubId];
      let p = 2;

      if (desde) {
        if (!isISODate(String(desde))) {
          return res.status(400).json({
            ok: false,
            error: 'desde inválido (use YYYY-MM-DD)',
          });
        }
        where.push(`ig.fecha >= $${p++}`);
        params.push(String(desde));
      }

      if (hasta) {
        if (!isISODate(String(hasta))) {
          return res.status(400).json({
            ok: false,
            error: 'hasta inválido (use YYYY-MM-DD)',
          });
        }
        where.push(`ig.fecha <= $${p++}`);
        params.push(String(hasta));
      }

      const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
      const off = Math.max(Number(offset) || 0, 0);

      const qList = `
        SELECT
          ig.id,
          ig.fecha,
          ig.monto,
          ig.observacion,
          ig.tipo_ingreso_id,
          ig.cuenta,
          ti.nombre AS tipo_ingreso
        FROM ingresos_generales ig
        JOIN tipos_ingreso ti ON ti.id = ig.tipo_ingreso_id
        WHERE ${where.join(' AND ')}
        ORDER BY ig.fecha DESC, ig.created_at DESC
        LIMIT $${p++} OFFSET $${p++}
      `;

      const qTotal = `
        SELECT COALESCE(SUM(ig.monto), 0) AS total
        FROM ingresos_generales ig
        WHERE ${where.join(' AND ')}
      `;

      const paramsList = params.slice();
      paramsList.push(lim, off);

      const [rList, rTotal] = await Promise.all([
        db.query(qList, paramsList),
        db.query(qTotal, params),
      ]);

      return res.json({
        ok: true,
        ingresos: rList.rows || [],
        total: Number(rTotal.rows?.[0]?.total || 0),
      });
    } catch (e) {
      console.error('❌ get ingresos:', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

router.post(
  '/:clubId/ingresos',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId } = req.params;
    const {
      tipo_ingreso_id,
      fecha,
      monto,
      observacion,
      cuenta = null,
      cuenta_id = null,
    } = req.body || {};

    try {
      if (!tipo_ingreso_id || !fecha || monto === undefined || monto === null) {
        return res.status(400).json({ ok: false, error: 'Datos incompletos' });
      }
      if (!isISODate(String(fecha))) {
        return res.status(400).json({
          ok: false,
          error: 'fecha inválida (use YYYY-MM-DD)',
        });
      }

      const montoNum = Number(monto);
      if (Number.isNaN(montoNum) || montoNum < 0) {
        return res.status(400).json({ ok: false, error: 'Monto inválido' });
      }

      const rTipo = await db.query(
        `SELECT id FROM tipos_ingreso WHERE id = $1 AND club_id = $2 AND activo = true`,
        [tipo_ingreso_id, clubId]
      );

      if (!rTipo.rowCount) {
        return res.status(400).json({
          ok: false,
          error: 'Tipo de ingreso inexistente o inactivo',
        });
      }

      // Resolver nombre de cuenta
      let cuentaFinal = cuenta;

      if (!cuentaFinal && cuenta_id) {
        try {
          const rCuenta = await db.query(
            `
            SELECT nombre
            FROM responsables_gasto
            WHERE id = $1 AND club_id = $2
            LIMIT 1
            `,
            [cuenta_id, clubId]
          );
          if (rCuenta.rowCount) {
            cuentaFinal = rCuenta.rows[0].nombre;
          }
        } catch (e) {
          console.error('Error resolviendo cuenta desde cuenta_id (ingresos)', e);
        }
      }

      const r = await db.query(
        `
        INSERT INTO ingresos_generales
          (id, club_id, tipo_ingreso_id, fecha, monto, observacion, cuenta, created_at, activo)
        VALUES
          (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), true)
        RETURNING id, club_id, tipo_ingreso_id, fecha, monto, observacion, cuenta, created_at
        `,
        [clubId, tipo_ingreso_id, String(fecha), montoNum, observacion ?? null, cuentaFinal ?? null]
      );

      return res.status(201).json({ ok: true, ingreso: r.rows[0] });
    } catch (e) {
      console.error('❌ create ingreso:', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

router.delete(
  '/:clubId/ingresos/:id',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId, id } = req.params;

    try {
      const r = await db.query(
        `
        UPDATE ingresos_generales
        SET activo = false
        WHERE id = $1 AND club_id = $2
        `,
        [id, clubId]
      );

      if (!r.rowCount) {
        return res.status(404).json({ ok: false, error: 'Ingreso no encontrado' });
      }

      return res.json({ ok: true });
    } catch (e) {
      console.error('❌ delete ingreso:', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ============================================================
// DELETE /club/:clubId/pagos/:pagoId
// ADMIN: elimina un pago mensual (cuota) por ID
// ============================================================
router.delete(
  '/:clubId/pagos/:pagoId',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId, pagoId } = req.params;

    try {
      const r = await db.query(
        `
        DELETE FROM pagos_mensuales
        WHERE id = $1 AND club_id = $2
        `,
        [pagoId, clubId]
      );

      if (!r.rowCount) {
        return res.status(404).json({ ok: false, error: 'Pago no encontrado' });
      }

      return res.json({ ok: true });
    } catch (e) {
      console.error('❌ delete pago mensual:', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

module.exports = router;