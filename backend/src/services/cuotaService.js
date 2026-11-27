const db = require('../db');

// 🔒 Fuente ÚNICA de la cuota mensual de un socio (calculada en el servidor).
// La usan GET /club/:clubId/pagos/:socioId (meses pendientes) y Mercado Pago
// (/mp/preference y webhook): el monto NUNCA debe venir del cliente.
// ===============================
// Helper: monto de cuota mensual "base" de un socio
// (misma lógica de resolución de precio que usa POST /:clubId/pagos:
// actividad asignada, excepción de cuota, o jefe de Grupo Familiar).
// Se usa para completar el campo "monto" de los meses PENDIENTES que
// arma GET /:clubId/pagos/:socioId (antes venían siempre en 0, lo que
// rompía la generación de la preferencia de pago de Mercado Pago,
// que exige monto_por_mes > 0).
// Un socio que es miembro (no jefe) de un Grupo Familiar no paga la
// cuota base por su cuenta, así que devuelve 0 correctamente.
// ===============================
async function resolverMontoCuotaSocio(clubId, socioId) {
  const r = await db.query(
    `
    SELECT
      s.actividad,
      s.excepcion_cuota_id,
      s.actividades_adicionales,
      CASE WHEN gf_jefe.id IS NOT NULL THEN true ELSE false END AS es_jefe_plan_familiar,
      CASE WHEN gf_miembro.id IS NOT NULL THEN true ELSE false END AS es_miembro_plan_familiar
    FROM socios s
    LEFT JOIN grupos_familiares gf_jefe
      ON gf_jefe.club_id = s.club_id
     AND gf_jefe.jefe_socio_id = s.id
     AND gf_jefe.activo = true
    LEFT JOIN grupos_familiares_miembros gfm
      ON gfm.socio_id = s.id
    LEFT JOIN grupos_familiares gf_miembro
      ON gf_miembro.id = gfm.grupo_familiar_id
     AND gf_miembro.activo = true
    WHERE s.id = $1
      AND s.club_id = $2
    LIMIT 1
    `,
    [socioId, clubId]
  );

  if (!r.rowCount) return 0;

  const {
    actividad,
    excepcion_cuota_id,
    actividades_adicionales,
    es_jefe_plan_familiar,
    es_miembro_plan_familiar
  } = r.rows[0];

  let total = 0;

  // Cuota base — no aplica si el socio es MIEMBRO (no jefe) de un Grupo
  // Familiar, porque esa cuota la paga el jefe del grupo.
  if (!es_miembro_plan_familiar) {
    if (es_jefe_plan_familiar === true) {
      const rGF = await db.query(
        `SELECT precio_mensual FROM actividades
         WHERE club_id = $1 AND nombre = 'Grupo Familiar' AND activo = true LIMIT 1`,
        [clubId]
      );
      total += rGF.rowCount ? (Number(rGF.rows[0].precio_mensual) || 0) : 0;
    } else if (excepcion_cuota_id) {
      const rExc = await db.query(
        `SELECT monto FROM excepciones_cuota
         WHERE club_id = $1 AND id = $2 AND activo = true LIMIT 1`,
        [clubId, excepcion_cuota_id]
      );
      total += rExc.rowCount ? (Number(rExc.rows[0].monto) || 0) : 0;
    } else if (actividad) {
      const rPrecio = await db.query(
        `SELECT precio_mensual FROM actividades
         WHERE club_id = $1 AND nombre = $2 AND activo = true LIMIT 1`,
        [clubId, actividad]
      );
      total += rPrecio.rowCount ? (Number(rPrecio.rows[0].precio_mensual) || 0) : 0;
    }
  }

  // ✅ NUEVO: actividades adicionales contratadas por el socio (mismo
  // criterio que ya usa /app/payments/transfer/start en
  // appTransferRoutes.js). Antes esta función solo devolvía la cuota base,
  // por eso el pago con Mercado Pago no tenía en cuenta los adicionales.
  let nombresAdicionales = [];
  try {
    const arr = actividades_adicionales
      ? (typeof actividades_adicionales === 'string'
          ? JSON.parse(actividades_adicionales)
          : actividades_adicionales)
      : [];
    nombresAdicionales = Array.isArray(arr)
      ? arr.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
  } catch {
    nombresAdicionales = [];
  }

  for (const nombre of nombresAdicionales) {
    const rAd = await db.query(
      `SELECT precio_mensual FROM actividades_adicionales
       WHERE club_id = $1 AND nombre = $2 AND activo = true LIMIT 1`,
      [clubId, nombre]
    );
    total += rAd.rowCount ? (Number(rAd.rows[0].precio_mensual) || 0) : 0;
  }

  return total;
}

module.exports = { resolverMontoCuotaSocio };
