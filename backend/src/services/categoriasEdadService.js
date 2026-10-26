// src/services/categoriasEdadService.js
//
// Categorías deportivas con rango de edad (opcional).
//
// - categorias_deportivas.edad_desde / edad_hasta (inclusivas). Si ambas son NULL,
//   la categoría no es "por edad".
// - socios.categoria es el NOMBRE de la categoría (texto), igual que siempre.
// - socios.categoria_manual = true -> el admin la eligió a mano distinta a la de
//   su edad; el proceso automático NO la toca.
//
// La edad se calcula con la fecha de HOY en Argentina, así el cambio ocurre el
// día del cumpleaños y no unas horas antes/después por la zona horaria del server.

const TZ = 'America/Argentina/Buenos_Aires';
const HOY_SQL = `(NOW() AT TIME ZONE '${TZ}')::date`;

// Normaliza lo que llega del panel: '' / null / undefined -> null, o entero >= 0.
function parseEdad(v, nombreCampo) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 120) {
    const err = new Error(`${nombreCampo} debe ser un número entero entre 0 y 120`);
    err.status = 400;
    throw err;
  }
  return n;
}

// Valida el par desde/hasta y devuelve { desde, hasta } normalizados.
function validarRango(desdeRaw, hastaRaw) {
  const desde = parseEdad(desdeRaw, 'Edad desde');
  const hasta = parseEdad(hastaRaw, 'Edad hasta');
  if (desde !== null && hasta !== null && hasta < desde) {
    const err = new Error('"Edad hasta" no puede ser menor que "Edad desde"');
    err.status = 400;
    throw err;
  }
  return { desde, hasta };
}

// Verifica que el rango no se pisa con otra categoría activa del club.
async function assertSinSuperposicion(db, { clubId, excluirId = null, desde, hasta }) {
  if (desde === null && hasta === null) return; // no es por edad
  const d = desde ?? 0;
  const h = hasta ?? 200;
  const r = await db.query(
    `
    SELECT nombre, edad_desde, edad_hasta
    FROM categorias_deportivas
    WHERE club_id = $1
      AND activo = true
      AND (edad_desde IS NOT NULL OR edad_hasta IS NOT NULL)
      AND ($2::uuid IS NULL OR id <> $2::uuid)
      AND COALESCE(edad_desde, 0) <= $4
      AND $3 <= COALESCE(edad_hasta, 200)
    LIMIT 1
    `,
    [clubId, excluirId, d, h]
  );
  if (r.rowCount) {
    const o = r.rows[0];
    const rango = `${o.edad_desde ?? 0} a ${o.edad_hasta ?? 'más'}`;
    const err = new Error(`El rango de edad se superpone con la categoría "${o.nombre}" (${rango})`);
    err.status = 409;
    throw err;
  }
}

// Nombre de la categoría por edad que le corresponde a esa fecha de nacimiento
// (o null si no tiene fecha, o ninguna categoría con rango lo abarca).
async function categoriaPorEdad(db, clubId, fechaNacimiento) {
  const f = String(fechaNacimiento ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return null;
  const r = await db.query(
    `
    SELECT c.nombre
    FROM categorias_deportivas c
    WHERE c.club_id = $1
      AND c.activo = true
      AND (c.edad_desde IS NOT NULL OR c.edad_hasta IS NOT NULL)
      AND DATE_PART('year', AGE(${HOY_SQL}, $2::date)) >= COALESCE(c.edad_desde, 0)
      AND DATE_PART('year', AGE(${HOY_SQL}, $2::date)) <= COALESCE(c.edad_hasta, 200)
    ORDER BY COALESCE(c.edad_desde, 0) DESC
    LIMIT 1
    `,
    [clubId, f]
  );
  return r.rows[0]?.nombre ?? null;
}

// Decide qué categoría y qué flag manual guardar para un socio que se crea/edita.
//  - Si hay categoría por edad y el admin eligió OTRA -> queda manual.
//  - Si hay categoría por edad y no eligió ninguna -> se usa la automática.
//  - Si no hay categoría por edad -> se respeta lo elegido (como siempre).
async function resolverCategoriaSocio(db, { clubId, fechaNacimiento, categoria }) {
  const elegida = String(categoria ?? '').trim();
  const auto = await categoriaPorEdad(db, clubId, fechaNacimiento);
  if (!auto) return { categoria: elegida, manual: false, auto: null };
  if (!elegida) return { categoria: auto, manual: false, auto };
  return { categoria: elegida, manual: elegida !== auto, auto };
}

// Reasigna la categoría de los socios NO manuales de UN club (o de todos si
// clubId es null) cuya categoría actual no coincide con la de su edad.
// Devuelve la cantidad de socios modificados.
async function recalcularCategoriasPorEdad(db, clubId = null) {
  const r = await db.query(
    `
    UPDATE socios s
    SET categoria = x.nombre
    FROM (
      SELECT s2.id,
             (
               SELECT c.nombre
               FROM categorias_deportivas c
               WHERE c.club_id = s2.club_id
                 AND c.activo = true
                 AND (c.edad_desde IS NOT NULL OR c.edad_hasta IS NOT NULL)
                 AND DATE_PART('year', AGE(${HOY_SQL}, s2.fecha_nacimiento::date)) >= COALESCE(c.edad_desde, 0)
                 AND DATE_PART('year', AGE(${HOY_SQL}, s2.fecha_nacimiento::date)) <= COALESCE(c.edad_hasta, 200)
               ORDER BY COALESCE(c.edad_desde, 0) DESC
               LIMIT 1
             ) AS nombre
      FROM socios s2
      WHERE ($1::uuid IS NULL OR s2.club_id = $1::uuid)
        AND s2.categoria_manual = false
        AND s2.fecha_nacimiento IS NOT NULL
    ) x
    WHERE s.id = x.id
      AND x.nombre IS NOT NULL
      AND s.categoria IS DISTINCT FROM x.nombre
    `,
    [clubId]
  );
  return r.rowCount;
}

module.exports = {
  validarRango,
  assertSinSuperposicion,
  categoriaPorEdad,
  resolverCategoriaSocio,
  recalcularCategoriasPorEdad
};
