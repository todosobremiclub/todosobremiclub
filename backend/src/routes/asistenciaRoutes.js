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
// GET /club/:clubId/asistencia/categorias-por-actividad?actividad=X
// Devuelve solo las categorías que efectivamente tienen socios activos
// cargados en esa actividad, para que el selector de Categoría (tanto en
// "Tomar asistencia" como en el Reporte de asistencia) no muestre
// categorías vacías para la actividad elegida.
// ============================================================
router.get('/:clubId/asistencia/categorias-por-actividad', requireAuth, requireClubAccess, async (req, res) => {
  try {
    const { clubId } = req.params;
    const { actividad = '' } = req.query;

    if (!actividad.trim()) {
      return res.status(400).json({ ok: false, error: 'Falta actividad' });
    }

    const r = await db.query(
      `SELECT DISTINCT s.categoria
         FROM socios s
        WHERE s.club_id = $1 AND s.activo = true AND s.actividad = $2
          AND s.categoria IS NOT NULL AND s.categoria <> ''
        ORDER BY s.categoria ASC`,
      [clubId, actividad]
    );

    res.json({ ok: true, categorias: r.rows.map(row => row.categoria) });
  } catch (e) {
    console.error('❌ asistencia categorias-por-actividad', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ============================================================
// GET /club/:clubId/asistencia/anios-por-actividad-categoria?actividad=X&categoria=Y
// Devuelve los años de nacimiento que efectivamente tienen socios activos
// en esa actividad + categoría, para que el filtro de "Año de nacimiento"
// deje de ser un número libre y pase a ser un selector con los años reales.
// ============================================================
router.get('/:clubId/asistencia/anios-por-actividad-categoria', requireAuth, requireClubAccess, async (req, res) => {
  try {
    const { clubId } = req.params;
    const { actividad = '', categoria = '' } = req.query;

    if (!actividad.trim() || !categoria.trim()) {
      return res.status(400).json({ ok: false, error: 'Faltan actividad y/o categoría' });
    }

    const r = await db.query(
      `SELECT DISTINCT EXTRACT(YEAR FROM s.fecha_nacimiento)::int AS anio
         FROM socios s
        WHERE s.club_id = $1 AND s.activo = true
          AND s.actividad = $2 AND s.categoria = $3
          AND s.fecha_nacimiento IS NOT NULL
        ORDER BY anio DESC`,
      [clubId, actividad, categoria]
    );

    res.json({ ok: true, anios: r.rows.map(row => row.anio) });
  } catch (e) {
    console.error('❌ asistencia anios-por-actividad-categoria', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

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
      anioNacimiento = '',
      // ✅ NUEVO: permiten ampliar la búsqueda a más de una categoría / año de
      // nacimiento (por ejemplo, chicos que entrenan/juegan con más de una
      // categoría). Solo se usan para ENCONTRAR socios: la categoría y el año
      // "principales" del evento (arriba) siguen siendo un valor único, así que
      // no afectan en nada a cómo se guarda el evento ni a los reportes que
      // filtran por categoría/año exactos.
      categoriasAdicionales = '',
      aniosAdicionales = ''
    } = req.query;

    if (!actividad.trim() || !categoria.trim()) {
      return res.status(400).json({ ok: false, error: 'Faltan actividad y/o categoría' });
    }

    // Normaliza un query param que puede llegar como CSV ("2012,2011"), como
    // array (si se repite el mismo parámetro en la URL) o vacío, a una lista
    // de strings limpia y sin duplicados.
    function toList(value) {
      const arr = Array.isArray(value) ? value : String(value ?? '').split(',');
      return [...new Set(arr.map((v) => String(v).trim()).filter(Boolean))];
    }

    const where = ['s.club_id = $1', 's.activo = true'];
    const params = [clubId];
    let p = 2;

    where.push(`s.actividad = $${p++}`);
    params.push(actividad);

    // ✅ NUEVO: categoría principal + categorías adicionales (selección múltiple)
    const categorias = [...new Set([categoria.trim(), ...toList(categoriasAdicionales)])];
    where.push(`s.categoria = ANY($${p++})`);
    params.push(categorias);

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

    // Filtro opcional por año de nacimiento (útil cuando la categoría sola no
    // alcanza para distinguir, p.ej. categorías por edad). ✅ NUEVO: admite
    // varios años a la vez (principal + adicionales).
    const anios = [...toList(anioNacimiento), ...toList(aniosAdicionales)]
      .map(Number)
      .filter((n) => Number.isInteger(n));

    if (anios.length) {
      where.push(`EXTRACT(YEAR FROM s.fecha_nacimiento) = ANY($${p++})`);
      params.push(anios);
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
    anioNacimiento = null,
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
        (club_id, tipo, actividad, actividad_adicional, categoria, fecha, anio_nacimiento_convocado, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        clubId, tipo, actividad.trim(), actividadAdicional?.trim() || null, categoria.trim(), fecha,
        anioNacimiento ? Number(anioNacimiento) : null,
        req.user?.userId || req.user?.id || null
      ]
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

// ============================================================
// DELETE /club/:clubId/asistencia/:eventoId/socio/:socioId
// Quita a un socio (convocado o invitado) de un evento de asistencia
// ya guardado, sin borrar el evento completo. Para corregir un alta
// de más o un socio cargado por error, sin tener que eliminar y
// volver a cargar todo el entrenamiento/partido.
// ============================================================
router.delete('/:clubId/asistencia/:eventoId/socio/:socioId', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, eventoId, socioId } = req.params;

  try {
    const rEvento = await db.query(
      `SELECT id FROM asistencia_eventos WHERE id = $1 AND club_id = $2`,
      [eventoId, clubId]
    );
    if (!rEvento.rowCount) {
      return res.status(404).json({ ok: false, error: 'Evento no encontrado' });
    }

    const r = await db.query(
      `DELETE FROM asistencia_detalle WHERE evento_id = $1 AND socio_id = $2 RETURNING id`,
      [eventoId, socioId]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'El socio no estaba cargado en este evento' });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('❌ asistencia DELETE socio de evento', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;