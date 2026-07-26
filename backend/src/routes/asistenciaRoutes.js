// routes/asistenciaRoutes.js
const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// ===============================
// Chequeo de acceso al club (mismo patrón que pendientesRoutes.js)
// ===============================
function requireClubAccess(req, res, next) {
  const { clubId } = req.params;
  const roles = req.user?.roles ?? [];
  const allowed = roles.some(
    (r) => String(r.club_id) === String(clubId) || r.role === 'superadmin'
  );
  if (!allowed) return res.status(403).json({ ok: false, error: 'No autorizado para este club' });
  next();
}

// ============================================================
// GET /club/:clubId/asistencia/socios-filtrados
// Trae los socios activos que matchean Actividad + Categoría
// (+ Actividad adicional, si se envía) para armar el listado
// de "convocados" en el formulario de asistencia.
//
// Query params:
//   - actividad          (obligatorio)
//   - categoria          (obligatorio)
//   - actividadAdicional (opcional)
// ============================================================
router.get('/:clubId/asistencia/socios-filtrados', requireAuth, requireClubAccess, async (req, res) => {
  try {
    const { clubId } = req.params;
    const {
      actividad = '',
      categoria = '',
      actividadAdicional = '',
      anioNacimiento = ''
    } = req.query;

    if (!actividad.trim() || !categoria.trim()) {
      return res.status(400).json({ ok: false, error: 'Faltan actividad y/o categoría' });
    }

    const where = ['s.club_id = $1', 's.activo = true'];
    const params = [clubId];
    let p = 2;

    where.push(`s.actividad = $${p++}`);
    params.push(actividad);

    where.push(`s.categoria = $${p++}`);
    params.push(categoria);

    // actividades_adicionales se guarda como JSON string (array de nombres),
    // p.ej. '["Natación","Pileta"]'. El operador jsonb "?" chequea si el
    // valor existe como elemento del array.
    if (actividadAdicional.trim()) {
      where.push(`
        s.tiene_actividades_adicionales = true
        AND s.actividades_adicionales IS NOT NULL
        AND s.actividades_adicionales::jsonb ? $${p++}
      `);
      params.push(actividadAdicional);
    }

    // Filtro opcional por año de nacimiento (útil cuando la categoría
    // sola no alcanza para distinguir, p.ej. categorías por edad).
    if (anioNacimiento && String(anioNacimiento).trim()) {
      where.push(`EXTRACT(YEAR FROM s.fecha_nacimiento) = $${p++}`);
      params.push(Number(anioNacimiento));
    }


    const q = `
      SELECT
        s.id,
        s.numero_socio,
        s.dni,
        s.nombre,
        s.apellido,
        s.categoria,
        s.actividad,
        s.foto_url
      FROM socios s
      WHERE ${where.join(' AND ')}
      ORDER BY s.apellido ASC, s.nombre ASC
    `;

    const r = await db.query(q, params);

    res.json({ ok: true, socios: r.rows });
  } catch (e) {
    console.error('❌ asistencia socios-filtrados', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// POST /club/:clubId/asistencia
// Crea un evento (entrenamiento o partido) y guarda el detalle
// de asistencia: convocados (presentes/ausentes de la categoría
// del formulario) + invitados (socios de otra categoría/actividad
// que también participaron ese día).
//
// body:
// {
//   tipo: 'entrenamiento' | 'partido',
//   actividad, actividadAdicional (opcional), categoria, fecha,
//   convocados: [ { socioId, presente: true|false }, ... ],
//   invitados:  [ { socioId }, ... ]   (opcional, siempre quedan presentes)
// }
// ============================================================
router.post('/:clubId/asistencia', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const {
    tipo,
    actividad,
    actividadAdicional = null,
    categoria,
    fecha,
    convocados = [],
    invitados = []
  } = req.body ?? {};

  try {
    // ===== Validaciones básicas =====
    if (!['entrenamiento', 'partido'].includes(tipo)) {
      return res.status(400).json({ ok: false, error: 'Tipo inválido (entrenamiento|partido)' });
    }
    if (!actividad?.trim() || !categoria?.trim() || !fecha) {
      return res.status(400).json({ ok: false, error: 'Faltan actividad, categoría y/o fecha' });
    }
    if (!Array.isArray(convocados) || convocados.length === 0) {
      return res.status(400).json({ ok: false, error: 'No hay socios convocados para guardar' });
    }

    const convocadosIds = convocados.map(c => c.socioId).filter(Boolean);
    const invitadosIds = (invitados || []).map(i => i.socioId).filter(Boolean);
    const todosIds = [...new Set([...convocadosIds, ...invitadosIds])];

    if (todosIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'No se recibieron socios válidos' });
    }

    // Traemos la categoría real de cada socio (no confiamos en lo que
    // manda el cliente) y de paso validamos que pertenezcan al club.
    const rSocios = await db.query(
      `SELECT id, categoria FROM socios WHERE club_id = $1 AND id = ANY($2::uuid[])`,
      [clubId, todosIds]
    );

    const categoriaPorSocio = new Map(rSocios.rows.map(s => [String(s.id), s.categoria]));

    if (categoriaPorSocio.size !== todosIds.length) {
      return res.status(400).json({ ok: false, error: 'Alguno de los socios no pertenece a este club' });
    }

    await db.query('BEGIN');

    // ===== 1) Cabecera del evento =====
    const rEvento = await db.query(
      `INSERT INTO asistencia_eventos
        (club_id, tipo, actividad, actividad_adicional, categoria, fecha, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [clubId, tipo, actividad.trim(), actividadAdicional?.trim() || null, categoria.trim(), fecha, req.user?.userId || req.user?.id || null]
    );
    const eventoId = rEvento.rows[0].id;

    // ===== 2) Convocados (presentes o ausentes, categoría = la del formulario) =====
    for (const c of convocados) {
      if (!c?.socioId) continue;

      await db.query(
        `INSERT INTO asistencia_detalle
          (evento_id, socio_id, categoria_socio, origen, presente)
         VALUES ($1,$2,$3,'convocado',$4)`,
        [eventoId, c.socioId, categoriaPorSocio.get(String(c.socioId)) || categoria.trim(), !!c.presente]
      );
    }

    // ===== 3) Invitados (de otra categoría, siempre presentes) =====
    for (const i of (invitados || [])) {
      if (!i?.socioId) continue;

      await db.query(
        `INSERT INTO asistencia_detalle
          (evento_id, socio_id, categoria_socio, origen, presente)
         VALUES ($1,$2,$3,'invitado',true)`,
        [eventoId, i.socioId, categoriaPorSocio.get(String(i.socioId)) || null]
      );
    }

    await db.query('COMMIT');

    res.json({ ok: true, eventoId });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}

    if (e.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Un socio quedó duplicado en el mismo evento' });
    }
    console.error('❌ asistencia POST', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// DELETE /club/:clubId/asistencia/:eventoId
// Elimina un evento de asistencia (y su detalle, por CASCADE).
// ============================================================
router.delete('/:clubId/asistencia/:eventoId', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, eventoId } = req.params;

  try {
    const r = await db.query(
      `DELETE FROM asistencia_eventos WHERE id = $1 AND club_id = $2 RETURNING id`,
      [eventoId, clubId]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Evento no encontrado' });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('❌ asistencia DELETE evento', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// POST /club/:clubId/asistencia/:eventoId/socio
// Agrega un socio que se olvidaron de cargar en un evento ya
// guardado. Si su categoría coincide con la del evento queda como
// 'convocado', si no, como 'invitado'.
// body: { socioId, presente = true }
// ============================================================
router.post('/:clubId/asistencia/:eventoId/socio', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, eventoId } = req.params;
  const { socioId, presente = true } = req.body ?? {};

  try {
    if (!socioId) {
      return res.status(400).json({ ok: false, error: 'Falta socioId' });
    }

    const rEvento = await db.query(
      `SELECT id, categoria FROM asistencia_eventos WHERE id = $1 AND club_id = $2`,
      [eventoId, clubId]
    );
    if (!rEvento.rowCount) {
      return res.status(404).json({ ok: false, error: 'Evento no encontrado' });
    }

    const rSocio = await db.query(
      `SELECT id, categoria FROM socios WHERE id = $1 AND club_id = $2`,
      [socioId, clubId]
    );
    if (!rSocio.rowCount) {
      return res.status(400).json({ ok: false, error: 'El socio no pertenece a este club' });
    }

    const categoriaEvento = rEvento.rows[0].categoria;
    const categoriaSocio = rSocio.rows[0].categoria;
    const origen = categoriaSocio === categoriaEvento ? 'convocado' : 'invitado';

    const r = await db.query(
      `INSERT INTO asistencia_detalle
        (evento_id, socio_id, categoria_socio, origen, presente)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id`,
      [eventoId, socioId, categoriaSocio, origen, !!presente]
    );

    res.json({ ok: true, detalleId: r.rows[0].id, origen });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Este socio ya está cargado en este evento' });
    }
    console.error('❌ asistencia POST agregar socio', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;