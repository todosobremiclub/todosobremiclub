const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { uploadImageBuffer } = require('../utils/uploadToFirebase');
const { initFirebase } = require('../config/firebaseAdmin');
const multer = require('multer');
const ExcelJS = require('exceljs');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB (Excel)
});

// Upload para adjuntos de socio (máx 10 MB por archivo)
const uploadAdjunto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

const router = express.Router();

// ======================================
// GRUPO FAMILIAR HELPERS
// ======================================

async function getGrupoByJefe({ clubId, jefeSocioId }) {
  const r = await db.query(
    `
    SELECT id
    FROM grupos_familiares
    WHERE club_id = $1
      AND jefe_socio_id = $2
      AND activo = true
    LIMIT 1
    `,
    [clubId, jefeSocioId]
  );
  return r.rows[0] ?? null;
}


// ===============================
// Helper: validar acceso al club
// ===============================
function requireClubAccess(req, res, next) {
  const { clubId } = req.params;
  const roles = req.user?.roles || [];
  const allowed = roles.some(
    r => String(r.club_id) === String(clubId) || r.role === 'superadmin'
  );
  if (!allowed) {
    return res.status(403).json({ ok: false, error: 'No autorizado para este club' });
  }
  next();
}

// ===============================
// Helper: validar Excepción de Cuota
// ===============================
async function assertValidExcepcionCuota({ clubId, excepcionCuotaId }) {
  if (!excepcionCuotaId) return; // null/undefined => OK

  const r = await db.query(
    `
    SELECT id
    FROM excepciones_cuota
    WHERE id = $1
      AND club_id = $2
      AND activo = true
    LIMIT 1
    `,
    [excepcionCuotaId, clubId]
  );

  if (!r.rowCount) {
    const err = new Error('Excepción de cuota inválida');
    err.statusCode = 400;
    throw err;
  }
}

// ===============================
// Helpers Firebase delete
// ===============================
function extractFirebaseObjectPath(url) {
  try {
    const u = new URL(url);
    const marker = '/o/';
    const i = u.pathname.indexOf(marker);
    if (i < 0) return null;
    return decodeURIComponent(u.pathname.slice(i + marker.length));
  } catch {
    return null;
  }
}

async function deleteFirebaseObjectByUrl(url) {
  const objectPath = extractFirebaseObjectPath(url);
  if (!objectPath) return;
  const admin = initFirebase();
  if (!admin) return;
  const bucket = admin.storage().bucket();
  await bucket.file(objectPath).delete({ ignoreNotFound: true });
}

// ======================================
// GET grupo familiar de un socio (jefe)
// ======================================
router.get('/:clubId/grupo-familiar/:socioId', requireAuth, requireClubAccess, async (req, res) => {
  try {
    const { clubId, socioId } = req.params;

    const rGrupo = await db.query(
      `
      SELECT id, jefe_socio_id
      FROM grupos_familiares
      WHERE club_id = $1
        AND jefe_socio_id = $2
        AND activo = true
      LIMIT 1
      `,
      [clubId, socioId]
    );

    if (!rGrupo.rowCount) {
      return res.json({ ok: true, grupo: null, miembros: [] });
    }

    const grupoId = rGrupo.rows[0].id;

    const rMiembros = await db.query(
      `
      SELECT s.id, s.nombre, s.apellido, s.numero_socio
      FROM grupos_familiares_miembros gm
      JOIN socios s ON s.id = gm.socio_id
      WHERE gm.grupo_familiar_id = $1
      `,
      [grupoId]
    );

    res.json({
      ok: true,
      grupo: rGrupo.rows[0],
      miembros: rMiembros.rows
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ======================================
// CREAR / ACTUALIZAR GRUPO FAMILIAR
// ======================================
router.post('/:clubId/grupo-familiar', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  const { jefeSocioId, miembros } = req.body;

  try {
    // 1. buscar grupo existente
    let grupo = await getGrupoByJefe({ clubId, jefeSocioId });

    // 2. crear si no existe
    if (!grupo) {
      const rNew = await db.query(
        `
        INSERT INTO grupos_familiares (id, club_id, jefe_socio_id, activo, created_at, updated_at)
        VALUES (gen_random_uuid(), $1, $2, true, NOW(), NOW())
        RETURNING id
        `,
        [clubId, jefeSocioId]
      );
      grupo = rNew.rows[0];
    }

    const grupoId = grupo.id;

    // 3. limpiar miembros anteriores
    await db.query(
      `DELETE FROM grupos_familiares_miembros WHERE grupo_familiar_id = $1`,
      [grupoId]
    );

    // 4. insertar nuevos miembros
    for (const socioId of (miembros || [])) {
      if (socioId === jefeSocioId) continue;

      await db.query(
        `
        INSERT INTO grupos_familiares_miembros (id, grupo_familiar_id, socio_id, created_at)
        VALUES (gen_random_uuid(), $1, $2, NOW())
        `,
        [grupoId, socioId]
      );
    }

    res.json({ ok: true });

  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ======================================
// ELIMINAR GRUPO FAMILIAR
// ======================================
router.delete('/:clubId/grupo-familiar/:jefeSocioId', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, jefeSocioId } = req.params;

  try {
    await db.query(`
      UPDATE grupos_familiares
      SET activo = false, updated_at = NOW()
      WHERE club_id = $1
        AND jefe_socio_id = $2
    `, [clubId, jefeSocioId]);

    res.json({ ok: true });

  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// LISTAR / BUSCAR / FILTRAR (+ pago_al_dia)
// ===============================
router.get('/:clubId/socios', requireAuth, requireClubAccess, async (req, res) => {
  try {
    const { clubId } = req.params;
    const {
      search = '',
      categoria = '',
      actividad = '',
      activo = '',
      anio = '',
      limit = '200',
      offset = '0'
    } = req.query;

    const where = ['s.club_id = $1'];
    const params = [clubId];
    let p = 2;

    if (activo !== '') {
      where.push(`s.activo = $${p++}`);
      params.push(activo === '1');
    }

    if (categoria) {
      where.push(`s.categoria = $${p++}`);
      params.push(categoria);
    }

    if (actividad) {
      where.push(`s.actividad = $${p++}`);
      params.push(actividad);
    }

    if (anio) {
      where.push(`EXTRACT(YEAR FROM s.fecha_nacimiento) = $${p++}`);
      params.push(Number(anio));
    }

    if (search) {
      where.push(`(
        s.nombre ILIKE $${p} OR
        s.apellido ILIKE $${p} OR
        s.dni ILIKE $${p}
      )`);
      params.push(`%${search}%`);
      p++;
    }

    const q = `
      SELECT
        s.id,
        s.club_id,
        s.numero_socio,
        s.dni,
        s.nombre,
        s.apellido,
        s.es_menor,
        s.tutor_nombre,
        s.categoria,
        s.actividad,
        s.telefono,
        s.direccion,
        s.email,
        s.fecha_nacimiento,
        s.fecha_ingreso,
        s.activo,
        s.becado,
        s.tiene_actividades_adicionales,
        s.actividades_adicionales,
        s.excepcion_cuota_id,
        ec.nombre AS excepcion_cuota_nombre,
        ec.monto AS excepcion_cuota_monto,
        s.foto_url,
        s.created_at,
        s.updated_at,

COALESCE(gf_jefe.id, gf_miembro.id) AS grupo_familiar_id,
CASE WHEN gf_jefe.id IS NOT NULL THEN true ELSE false END AS es_jefe_plan_familiar,
CASE WHEN gf_miembro.id IS NOT NULL THEN true ELSE false END AS es_miembro_plan_familiar,
gf_miembro.jefe_socio_id AS grupo_familiar_jefe_id,
CASE
  WHEN gf_jefe.id IS NOT NULL THEN 'jefe'
  WHEN gf_miembro.id IS NOT NULL THEN 'miembro'
  ELSE 'ninguno'
END AS tipo_grupo_familiar,

DATE_PART('year', AGE(s.fecha_nacimiento))::int AS edad,
        EXTRACT(YEAR FROM s.fecha_nacimiento)::int AS anio_nacimiento,
-- ✅ Detecta si TODOS los pagos son completos
(
  SELECT BOOL_AND(pm.pago_completo)
  FROM pagos_mensuales pm
  WHERE pm.socio_id = s.id
    AND pm.club_id = s.club_id
) AS pago_completo,

-- ✅ Detecta si HAY pagos parciales
(
  SELECT COUNT(*) > 0
  FROM pagos_mensuales pm
  WHERE pm.socio_id = s.id
    AND pm.club_id = s.club_id
    AND pm.pago_completo = false
) AS tiene_pagos_parciales,

CASE
  WHEN s.becado = true THEN true
  ELSE
    COALESCE((
      SELECT MAX((pm.anio::int * 100) + (pm.mes::int))
      FROM pagos_mensuales pm
      WHERE pm.club_id = s.club_id
        AND pm.socio_id = s.id
    ), 0) >=
    CASE
      -- ✅ Si estamos ANTES o IGUAL al día límite → exigimos mes anterior
      WHEN EXTRACT(DAY FROM CURRENT_DATE)::int <= COALESCE(c.payment_due_day, 31)
      THEN
        CASE
          WHEN EXTRACT(MONTH FROM CURRENT_DATE)::int = 1
          THEN ((EXTRACT(YEAR FROM CURRENT_DATE)::int - 1) * 100) + 12
          ELSE (EXTRACT(YEAR FROM CURRENT_DATE)::int * 100) + (EXTRACT(MONTH FROM CURRENT_DATE)::int - 1)
        END

      -- ✅ Si estamos DESPUÉS del día límite → exigimos mes actual
      ELSE
        (EXTRACT(YEAR FROM CURRENT_DATE)::int * 100) + EXTRACT(MONTH FROM CURRENT_DATE)::int
    END
END AS pago_al_dia

      FROM socios s
      LEFT JOIN excepciones_cuota ec
        ON ec.id = s.excepcion_cuota_id
       AND ec.club_id = s.club_id
      LEFT JOIN clubs c
        ON c.id = s.club_id
LEFT JOIN grupos_familiares gf_jefe
  ON gf_jefe.club_id = s.club_id
 AND gf_jefe.jefe_socio_id = s.id
 AND gf_jefe.activo = true

LEFT JOIN grupos_familiares_miembros gfm
  ON gfm.socio_id = s.id

LEFT JOIN grupos_familiares gf_miembro
  ON gf_miembro.id = gfm.grupo_familiar_id
 AND gf_miembro.activo = true
      WHERE ${where.join(' AND ')}
      ORDER BY s.numero_socio ASC
      LIMIT $${p++} OFFSET $${p++}
    `;

    params.push(Number(limit), Number(offset));

    const qCount = `
      SELECT COUNT(*)::int AS total
      FROM socios s
      WHERE ${where.join(' AND ')}
    `;

    const rCount = await db.query(qCount, params.slice(0, params.length - 2));
    const total = rCount.rows[0]?.total ?? 0;

    const r = await db.query(q, params);


const socios = r.rows || [];

// 1. calcular mes exigible (MISMA lógica que SQL)
const now = new Date();
const diaHoy = now.getDate();
const mesActual = now.getMonth() + 1;
const anioActual = now.getFullYear();
const paymentDueDay = Number(socios[0]?.payment_due_day ?? 31);

let mesExigible = mesActual;
let anioExigible = anioActual;

if (diaHoy <= paymentDueDay) {
  if (mesActual === 1) {
    mesExigible = 12;
    anioExigible = anioActual - 1;
  } else {
    mesExigible = mesActual - 1;
  }
}

// 2. traer pagos del mes exigible
const rPagos = await db.query(`
  SELECT socio_id, detalle_pago, pago_completo
  FROM pagos_mensuales
  WHERE club_id = $1 AND anio = $2 AND mes = $3
`, [clubId, anioExigible, mesExigible]);

const pagosMap = new Map();

for (const p of rPagos.rows) {
  const key = String(p.socio_id);
  if (!pagosMap.has(key)) pagosMap.set(key, []);
  pagosMap.get(key).push(p);
}

function parseDetalle(d) {
  try {
    return Array.isArray(d) ? d : JSON.parse(d || '[]');
  } catch {
    return [];
  }
}

// 3. recalcular estado
const sociosFinal = socios.map(s => {

  const pagosPropios = pagosMap.get(String(s.id)) || [];
  const detallePropio = pagosPropios.flatMap(x => parseDetalle(x.detalle_pago));

  const jefeId = s.grupo_familiar_jefe_id;
  const esMiembro = s.es_miembro_plan_familiar === true;

  let baseCubierta = false;

  if (s.becado) {
    baseCubierta = true;
  } else if (esMiembro && jefeId) {
    const pagosJefe = pagosMap.get(String(jefeId)) || [];
    const detalleJefe = pagosJefe.flatMap(x => parseDetalle(x.detalle_pago));

    baseCubierta = detalleJefe.some(d => d.tipo === 'base' && d.seleccionado === true);
  } else {
    baseCubierta = detallePropio.some(d => d.tipo === 'base' && d.seleccionado === true);
  }

  let adicionalesConfig = [];
  try {
    adicionalesConfig = JSON.parse(s.actividades_adicionales || '[]');
  } catch {}

  const adicionalesPagados = new Set(
    detallePropio
      .filter(d => d.tipo === 'adicional' && d.seleccionado === true)
      .map(d => String(d.nombre).trim())
  );

  const faltanAdicionales = adicionalesConfig.some(x => !adicionalesPagados.has(String(x).trim()));

  let pagoAlDia = false;
  let esParcial = false;

  if (!baseCubierta) {
    pagoAlDia = false;
    esParcial = false;
  } else if (faltanAdicionales) {
    pagoAlDia = false;
    esParcial = true;
  } else {
    pagoAlDia = true;
    esParcial = false;
  }

  return {
    ...s,
    pago_al_dia: pagoAlDia,
    tiene_pagos_parciales: esParcial,
    pago_completo: pagoAlDia && !esParcial
  };
});

    res.json({
      ok: true,
      socios: sociosFinal,
      total,
      limit: Number(limit),
      offset: Number(offset)
    });
  } catch (e) {
    console.error('❌ list socios', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// ESTADO ADJUNTOS / COMENTARIO – RESUMEN PARA TABLA
// GET /club/:clubId/socios/estados
// ===============================
router.get('/:clubId/socios/estados', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
  try {
    const q = `
  SELECT
    s.id AS socio_id,

    -- Tiene adjuntos?
    (COUNT(a.id) > 0) AS tiene_adjuntos,

    -- Tiene comentario en adjuntos O en comentarios independientes?
    (
      SUM(
        CASE
          WHEN a.comentario IS NOT NULL AND btrim(a.comentario) <> '' THEN 1
          ELSE 0
        END
      )
      +
      SUM(
        CASE
          WHEN c.comentario IS NOT NULL AND btrim(c.comentario) <> '' THEN 1
          ELSE 0
        END
      )
    ) > 0 AS tiene_comentario

  FROM socios s
  LEFT JOIN socios_adjuntos a
    ON a.socio_id = s.id
   AND a.club_id = s.club_id
  LEFT JOIN socios_comentarios c
    ON c.socio_id = s.id
   AND c.club_id = s.club_id

  WHERE s.club_id = $1
  GROUP BY s.id
  ORDER BY s.numero_socio;
`;

    const r = await db.query(q, [clubId]);
    res.json({ ok: true, estados: r.rows });
  } catch (e) {
    console.error('❌ estados socios (adjuntos/comentario)', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// DESCARGAR PLANTILLA EXCEL (CARGA MASIVA)
// GET /club/:clubId/socios/template.xlsx
// ===============================
router.get('/:clubId/socios/template.xlsx', requireAuth, requireClubAccess, async (req, res) => {
  try {
    const { clubId } = req.params;

    // traer opciones para dropdowns
    const [rActs, rCats] = await Promise.all([
      db.query(
        `SELECT nombre FROM actividades WHERE club_id = $1 AND activo = true ORDER BY nombre ASC`,
        [clubId]
      ),
      db.query(
        `SELECT nombre FROM categorias_deportivas WHERE club_id = $1 AND activo = true ORDER BY nombre ASC`,
        [clubId]
      )
    ]);

    const actividades = (rActs.rows || []).map(x => x.nombre).filter(Boolean);
    const categorias = (rCats.rows || []).map(x => x.nombre).filter(Boolean);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Todo Sobre mi Club';

    // Hoja principal
    const ws = wb.addWorksheet('Socios');

    // Columnas (todos los campos del modal, menos foto)
    ws.columns = [
      { header: 'numero_socio', key: 'numero_socio', width: 14 },
      { header: 'dni', key: 'dni', width: 14 },
      { header: 'nombre', key: 'nombre', width: 18 },
      { header: 'apellido', key: 'apellido', width: 18 },
      { header: 'actividad', key: 'actividad', width: 22 },
      { header: 'categoria', key: 'categoria', width: 22 },
      { header: 'telefono', key: 'telefono', width: 16 },
      { header: 'direccion', key: 'direccion', width: 26 },
{ header: 'email', key: 'email', width: 26 },
      { header: 'fecha_nacimiento (DD/MM/AAAA)', key: 'fecha_nacimiento', width: 22 },
      { header: 'fecha_ingreso (DD/MM/AAAA)', key: 'fecha_ingreso', width: 22 },
      { header: 'activo (SI/NO)', key: 'activo', width: 14 },
      { header: 'becado (SI/NO)', key: 'becado', width: 14 }
    ];

    // Header style
    ws.getRow(1).font = { bold: true };
    ws.autoFilter = { from: 'A1', to: 'M1' };

    // Hoja oculta para listas
    const lists = wb.addWorksheet('Listas');
    lists.state = 'veryHidden';

    // cargar listas
    lists.getCell('A1').value = 'ACTIVIDADES';
    actividades.forEach((v, i) => (lists.getCell(`A${i + 2}`).value = v));

    lists.getCell('B1').value = 'CATEGORIAS';
    categorias.forEach((v, i) => (lists.getCell(`B${i + 2}`).value = v));

    // Rangos para validación (hasta 500 filas)
    const maxRows = 500;
    const actRange = actividades.length ? `Listas!$A$2:$A$${actividades.length + 1}` : null;
    const catRange = categorias.length ? `Listas!$B$2:$B$${categorias.length + 1}` : null;

    // Validaciones: actividad (col E) y categoria (col F)
    for (let r = 2; r <= maxRows + 1; r++) {
      if (actRange) {
        ws.getCell(`E${r}`).dataValidation = {
          type: 'list',
          allowBlank: false,
          formulae: [actRange],
          showErrorMessage: true,
          errorTitle: 'Valor inválido',
          error: 'Seleccioná una actividad del menú.'
        };
      }
      if (catRange) {
        ws.getCell(`F${r}`).dataValidation = {
          type: 'list',
          allowBlank: false,
          formulae: [catRange],
          showErrorMessage: true,
          errorTitle: 'Valor inválido',
          error: 'Seleccioná una categoría del menú.'
        };
      }

      // activo (SI/NO) = columna L
ws.getCell(`L${r}`).dataValidation = {
  type: 'list',
  allowBlank: true,
  formulae: ['"SI,NO"']
};

// becado (SI/NO) = columna M
ws.getCell(`M${r}`).dataValidation = {
  type: 'list',
  allowBlank: true,
  formulae: ['"SI,NO"']
};
    }

    // Nota en fila 2 (opcional, no rompe import)
    ws.getCell('N1').value = 'NOTA';
    ws.getCell('N2').value =
      'Dejá numero_socio vacío para autogenerar. Fechas en formato DD/MM/AAAA.';

    // Descargar
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="socios_${clubId}.xlsx"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('❌ template socios excel', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// IMPORTAR EXCEL (CARGA MASIVA)
// ===============================
router.post(
  '/:clubId/socios/import.xlsx',
  requireAuth,
  requireClubAccess,
  upload.single('file'),
  async (req, res) => {
    const { clubId } = req.params;
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ ok: false, error: 'Falta archivo Excel (file)' });
      }

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(req.file.buffer);

      // Preferimos hoja "Socios", si no existe tomamos la primera
      const ws = wb.getWorksheet('Socios') || wb.worksheets[0];
      if (!ws) return res.status(400).json({ ok: false, error: 'Excel inválido: no hay hoja' });

      // 1) Traer DNIs y numeros existentes del club
      const rExist = await db.query(
        `SELECT numero_socio, dni FROM socios WHERE club_id = $1`,
        [clubId]
      );
      const dniExist = new Set(
        (rExist.rows || []).map(x => String(x.dni ?? '').trim()).filter(Boolean)
      );
      const numExist = new Set(
        (rExist.rows || []).map(x => String(x.numero_socio ?? '').trim()).filter(Boolean)
      );

      // 2) Leer filas (desde fila 2)
      const rows = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        rows.push({ rowNumber, row });
      });

      // 3) Obtener next_socio_num para autogenerar
      await db.query(
        `INSERT INTO club_counters (club_id, next_socio_num) VALUES ($1, 1)
         ON CONFLICT (club_id) DO NOTHING`,
        [clubId]
      );
      const rCounter = await db.query(
        `SELECT next_socio_num FROM club_counters WHERE club_id = $1 LIMIT 1`,
        [clubId]
      );
      let nextNum = Number(rCounter.rows?.[0]?.next_socio_num ?? 1);

      const errors = [];
      const toInsert = [];

      // helpers
      const norm = v => String(v ?? '').trim();
      const onlyDigits = v => String(v ?? '').replace(/\D+/g, '');
      const parseBoolSI = (v, defVal) => {
        const s = norm(v).toUpperCase();
        if (!s) return defVal;
        if (s === 'SI' || s === 'S' || s === 'TRUE' || s === '1') return true;
        if (s === 'NO' || s === 'N' || s === 'FALSE' || s === '0') return false;
        return defVal;
      };

      function pad2(n) {
        return String(n).padStart(2, '0');
      }

      function dateToISO(d) {
        const yyyy = d.getFullYear();
        const mm = pad2(d.getMonth() + 1);
        const dd = pad2(d.getDate());
        return `${yyyy}-${mm}-${dd}`;
      }

      function excelSerialToISO(serial) {
        const n = Number(serial);
        if (!Number.isFinite(n)) return null;
        const ms = Math.round((n - 25569) * 86400 * 1000);
        const d = new Date(ms);
        if (Number.isNaN(d.getTime())) return null;
        return dateToISO(d);
      }

      function parseExcelDateToISO(value) {
        if (value === null || value === undefined || value === '') return null;

        if (typeof value === 'object' && value && value.text) {
          value = value.text;
        }

        if (value instanceof Date && !Number.isNaN(value.getTime())) {
          return dateToISO(value);
        }

        if (typeof value === 'number') {
          return excelSerialToISO(value);
        }

        const s = String(value).trim();

        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

        let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) {
          let a = Number(m[1]);
          let b = Number(m[2]);
          const yyyy = Number(m[3]);

          let dd, mm;
          if (b > 12) {
            mm = a;
            dd = b;
          } else if (a > 12) {
            dd = a;
            mm = b;
          } else {
            dd = a;
            mm = b;
          }

          if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
          return `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
        }

        m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (m) {
          const dd = Number(m[1]);
          const mm = Number(m[2]);
          const yyyy = Number(m[3]);
          if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
          return `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
        }

        return null;
      }

      // 4) Validar y preparar inserts
      for (const r of rows) {
        const rowNumber = r.rowNumber;
        const row = r.row;

        let numero = norm(row.getCell(1).value);
        const dniRaw = norm(row.getCell(2).value);
        const dni = onlyDigits(dniRaw);
        const nombre = norm(row.getCell(3).value);
        const apellido = norm(row.getCell(4).value);
        const actividad = norm(row.getCell(5).value);
        const categoria = norm(row.getCell(6).value);
        const telefono = norm(row.getCell(7).value);          // G
const direccion = norm(row.getCell(8).value);         // H
const email = norm(row.getCell(9).value);             // I
const fecha_nacimiento_raw = row.getCell(10).value;   // J
const fecha_ingreso_raw = row.getCell(11).value;      // K
const activo = parseBoolSI(row.getCell(12).value, true);   // L
const becado = parseBoolSI(row.getCell(13).value, false);  // M


        if (!dni || dni.length < 7) {
          errors.push({
            row: rowNumber,
            error: 'DNI inválido o vacío',
            dni: dniRaw,
            numero_socio: numero
          });
          continue;
        }
        if (!nombre || !apellido || !actividad || !categoria || !fecha_nacimiento_raw) {
          errors.push({
            row: rowNumber,
            error:
              'Faltan campos obligatorios (nombre/apellido/actividad/categoria/fecha_nacimiento)',
            dni,
            numero_socio: numero
          });
          continue;
        }

        const fnISO = parseExcelDateToISO(fecha_nacimiento_raw);
        if (!fnISO) {
          errors.push({
            row: rowNumber,
            error: 'fecha_nacimiento inválida (usar DD/MM/AAAA)',
            dni,
            numero_socio: numero
          });
          continue;
        }

        let fiISO = null;
        if (fecha_ingreso_raw) {
          fiISO = parseExcelDateToISO(fecha_ingreso_raw);
          if (!fiISO) {
            errors.push({
              row: rowNumber,
              error: 'fecha_ingreso inválida (usar DD/MM/AAAA)',
              dni,
              numero_socio: numero
            });
            continue;
          }
        }

        if (dniExist.has(dni)) {
          errors.push({
            row: rowNumber,
            error: 'DNI ya existe en el club',
            dni,
            numero_socio: numero
          });
          continue;
        }

        if (!numero) {
          while (numExist.has(String(nextNum))) nextNum++;
          numero = String(nextNum);
          nextNum++;
        }

        if (numExist.has(String(numero))) {
          errors.push({
            row: rowNumber,
            error: 'Número de socio ya existe en el club',
            dni,
            numero_socio: numero
          });
          continue;
        }

        dniExist.add(dni);
        numExist.add(String(numero));

        toInsert.push({
  numero_socio: Number(numero),
  dni,
  nombre,
  apellido,
  actividad,
  categoria,
  telefono: telefono ?? null,
  direccion: direccion ?? null,
  email: email ?? null,
  fecha_nacimiento: fnISO,
  fecha_ingreso: fiISO,
  activo,
  becado
});
      }

      // 5) Insertar uno por uno
let insertedCount = 0;

for (const s of toInsert) {
  try {
    const rIns = await db.query(
      `INSERT INTO socios (
        club_id, numero_socio, dni, nombre, apellido,
        telefono, direccion, email,
        fecha_nacimiento, fecha_ingreso,
        activo, becado, categoria, actividad
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,
        $9,$10,
        $11,$12,$13,$14
      ) RETURNING id`,
      [
        clubId,
        s.numero_socio,
        s.dni,
        s.nombre,
        s.apellido,
        s.telefono,
        s.direccion,
        s.email,
        s.fecha_nacimiento,
        s.fecha_ingreso,
        s.activo,
        s.becado,
        s.categoria,
        s.actividad
      ]
    );

    if (rIns.rowCount) insertedCount++;
  } catch (e) {
    errors.push({
      row: null,
      error: e.code === '23505' ? 'Duplicado (DB)' : e.message,
      dni: s.dni,
      numero_socio: s.numero_socio
    });
  }
}

      await db.query(
        `UPDATE club_counters SET next_socio_num = $2 WHERE club_id = $1`,
        [clubId, nextNum]
      );

      return res.json({
        ok: true,
        insertedCount,
        errorCount: errors.length,
        errors
      });
    } catch (e) {
      console.error('❌ import socios excel', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// CREAR SOCIO
// ===============================
router.post('/:clubId/socios', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;
const {
  numero_socio,
  dni,
  nombre,
  apellido,
  telefono,
  direccion,
  email,
  fecha_nacimiento,
  fecha_ingreso,
  activo = true,
  becado = false,
  categoria,
  actividad,
  excepcion_cuota_id = null,
  es_menor = false,
  tutor_nombre = null,
  tiene_actividades_adicionales = false,
  actividades_adicionales = null
} = req.body ?? {};

  try {
    if (!dni || !nombre || !apellido || !fecha_nacimiento || !categoria || !actividad) {
      return res.status(400).json({
        ok: false,
        error: 'Completá DNI, Nombre, Apellido, Categoría, Actividad y Fecha de nacimiento.'
      });
    }

if (es_menor && !String(tutor_nombre || '').trim()) {
      return res.status(400).json({
        ok: false,
        error: 'Si el socio es menor, completá el nombre del padre/madre/tutor.'
      });
    }

// ✅ Validar excepción (si viene)
await assertValidExcepcionCuota({ clubId, excepcionCuotaId: excepcion_cuota_id });


    await db.query('BEGIN');

    await db.query(
      `
      INSERT INTO club_counters (club_id, next_socio_num)
      VALUES ($1, 1)
      ON CONFLICT (club_id) DO NOTHING
      `,
      [clubId]
    );

    let nro = numero_socio;
    if (!nro) {
      const rNum = await db.query(
        `
        UPDATE club_counters
        SET next_socio_num = next_socio_num + 1
        WHERE club_id = $1
        RETURNING (next_socio_num - 1) AS numero
        `,
        [clubId]
      );
      nro = rNum.rows[0].numero;
    }

const r = await db.query(
  `
  INSERT INTO socios (
    club_id,
    numero_socio,
    dni,
    nombre,
    apellido,
    telefono,
    direccion,
    email,
    fecha_nacimiento,
    fecha_ingreso,
    activo,
    becado,
    categoria,
    actividad,
    excepcion_cuota_id,
    es_menor,
    tutor_nombre,
    tiene_actividades_adicionales,
    actividades_adicionales
  )
  VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
  )
  RETURNING *
  `,
  [
    clubId,
    nro,
    String(dni),
    String(nombre),
    String(apellido),
    telefono ?? null,
    direccion ?? null,
    email ?? null,
    fecha_nacimiento,
    fecha_ingreso ?? null,
    !!activo,
    !!becado,
    String(categoria),
    String(actividad),
    (excepcion_cuota_id ?? null),
    !!es_menor,
    (tutor_nombre ?? null),
    !!tiene_actividades_adicionales,
    (actividades_adicionales ?? null)
  ]
);

    await db.query('COMMIT');
    res.json({ ok: true, socio: r.rows[0] });
  } catch (e) {
    try {
      await db.query('ROLLBACK');
    } catch {}
    console.error('❌ create socio', e);
    if (e.code === '23505') {
      return res
        .status(409)
        .json({ ok: false, error: 'DNI o Nº de socio ya existe en este club' });
    }
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// EDITAR SOCIO
// ===============================
router.put('/:clubId/socios/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
const {
  numero_socio,
  dni,
  nombre,
  apellido,
  telefono,
  direccion,
  email,
  fecha_nacimiento,
  fecha_ingreso,
  activo,
  becado,
  categoria,
  actividad,
  excepcion_cuota_id = null,
  es_menor,
  tutor_nombre,
  tiene_actividades_adicionales = false,
  actividades_adicionales = null
} = req.body ?? {};

  try {
if (es_menor && !String(tutor_nombre || '').trim()) {
      return res.status(400).json({
        ok: false,
        error: 'Si el socio es menor, completá el nombre del padre/madre/tutor.'
      });
    }

await assertValidExcepcionCuota({ clubId, excepcionCuotaId: excepcion_cuota_id });

const r = await db.query(
  `
  UPDATE socios SET
    numero_socio = $1,
    dni = $2,
    nombre = $3,
    apellido = $4,
    telefono = $5,
    direccion = $6,
    email = $7,
    fecha_nacimiento = $8,
    fecha_ingreso = $9,
    activo = $10,
    becado = $11,
    categoria = $12,
    actividad = $13,
    excepcion_cuota_id = $14,
    es_menor = $15,
    tutor_nombre = $16,
    tiene_actividades_adicionales = $17,
    actividades_adicionales = $18
  WHERE id = $19 AND club_id = $20
  RETURNING *
  `,
  [
    numero_socio,
    dni,
    nombre,
    apellido,
    telefono ?? null,
    direccion ?? null,
    email ?? null,
    fecha_nacimiento,
    fecha_ingreso ?? null,
    !!activo,
    !!becado,
    categoria,
    actividad,
    (excepcion_cuota_id ?? null),
    !!es_menor,
    (tutor_nombre ?? null),
    !!tiene_actividades_adicionales,
    (actividades_adicionales ?? null),
    id,
    clubId,
  ]
);


    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Socio no encontrado' });
    }



    res.json({ ok: true, socio: r.rows[0] });
  } catch (e) {
    console.error('❌ update socio', e);
    if (e.code === '23505') {
      return res
        .status(409)
        .json({ ok: false, error: 'DNI o Nº de socio ya existe en este club' });
    }
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// ELIMINAR SOCIO
// ===============================
router.delete('/:clubId/socios/:id', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  try {
    const r = await db.query(
      `DELETE FROM socios WHERE id = $1 AND club_id = $2`,
      [id, clubId]
    );
    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Socio no encontrado' });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('❌ delete socio', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// SUBIR / REEMPLAZAR FOTO (borra la anterior)
// ===============================
router.post('/:clubId/socios/:id/foto', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId, id } = req.params;
  const { base64, mimetype, filename } = req.body ?? {};

  try {
    if (!base64 || !mimetype) {
      return res.status(400).json({ ok: false, error: 'Falta base64 o mimetype' });
    }

    const prev = await db.query(
      `SELECT foto_url FROM socios WHERE id=$1 AND club_id=$2`,
      [id, clubId]
    );
    if (!prev.rowCount) {
      return res.status(404).json({ ok: false, error: 'Socio no encontrado' });
    }

    const oldUrl = prev.rows[0].foto_url;

    const buffer = Buffer.from(base64, 'base64');
    const up = await uploadImageBuffer({
      buffer,
      mimetype,
      originalname: filename || 'socio.jpg',
      folder: `clubs/${clubId}/socios`
    });

    const r = await db.query(
      `UPDATE socios SET foto_url=$1 WHERE id=$2 AND club_id=$3 RETURNING id, foto_url`,
      [up.url, id, clubId]
    );

    if (oldUrl && oldUrl !== up.url) {
      try {
        await deleteFirebaseObjectByUrl(oldUrl);
      } catch (err) {
        console.warn('⚠️ No se pudo borrar la foto anterior:', err.message);
      }
    }

    res.json({ ok: true, socio: r.rows[0] });
  } catch (e) {
    console.error('❌ upload/replace foto socio', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===============================
// ADJUNTOS DE SOCIO – LISTAR
// ===============================
router.get(
  '/:clubId/socios/:id/adjuntos',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId, id: socioId } = req.params;

    try {
      const r = await db.query(
        `
        SELECT
          id,
          filename,
          mimetype,
          size_bytes,
          comentario,
          url,
          created_at
        FROM socios_adjuntos
        WHERE club_id = $1 AND socio_id = $2
        ORDER BY created_at DESC
        `,
        [clubId, socioId]
      );

      res.json({ ok: true, adjuntos: r.rows });
    } catch (e) {
      console.error('❌ list socios_adjuntos', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// ADJUNTOS DE SOCIO – SUBIR
// ===============================
router.post(
  '/:clubId/socios/:id/adjuntos',
  requireAuth,
  requireClubAccess,
  uploadAdjunto.single('file'),
  async (req, res) => {
    const { clubId, id: socioId } = req.params;
    const comentario = (req.body?.comentario || '').toString().trim();

    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, error: 'Falta archivo (file)' });
      }

      const { buffer, mimetype, originalname, size } = req.file;

      const up = await uploadImageBuffer({
        buffer,
        mimetype,
        originalname,
        folder: `clubs/${clubId}/socios-adjuntos`
      });

      const r = await db.query(
        `
        INSERT INTO socios_adjuntos (
          club_id,
          socio_id,
          url,
          filename,
          mimetype,
          size_bytes,
          comentario
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7
        )
        RETURNING
          id,
          club_id,
          socio_id,
          url,
          filename,
          mimetype,
          size_bytes,
          comentario,
          created_at
        `,
        [clubId, socioId, up.url, originalname, mimetype, size, comentario || null]
      );

      res.status(201).json({ ok: true, adjunto: r.rows[0] });
    } catch (e) {
      console.error('❌ upload socio adjunto', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// ADJUNTOS DE SOCIO – ELIMINAR
// ===============================
router.delete(
  '/:clubId/socios/:id/adjuntos/:adjuntoId',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId, id: socioId, adjuntoId } = req.params;

    try {
      const prev = await db.query(
        `SELECT url FROM socios_adjuntos WHERE id = $1 AND club_id = $2 AND socio_id = $3`,
        [adjuntoId, clubId, socioId]
      );

      if (!prev.rowCount) {
        return res.status(404).json({ ok: false, error: 'Adjunto no encontrado' });
      }

      const url = prev.rows[0].url;

      await db.query(
        `DELETE FROM socios_adjuntos WHERE id = $1 AND club_id = $2 AND socio_id = $3`,
        [adjuntoId, clubId, socioId]
      );

      try {
        await deleteFirebaseObjectByUrl(url);
      } catch (err) {
        console.warn('⚠️ No se pudo borrar archivo adjunto de Firebase:', err.message);
      }

      res.json({ ok: true });
    } catch (e) {
      console.error('❌ delete socio adjunto', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// COMENTARIOS DE SOCIO – LISTAR
// GET /club/:clubId/socios/:id/comentarios
// ===============================
router.get(
  '/:clubId/socios/:id/comentarios',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId, id: socioId } = req.params;
    try {
      const q = `
        SELECT
          id,
          comentario,
          created_at
        FROM socios_comentarios
        WHERE club_id = $1 AND socio_id = $2
        ORDER BY created_at DESC
      `;
      const r = await db.query(q, [clubId, socioId]);
      return res.json({ ok: true, comentarios: r.rows });
    } catch (e) {
      console.error('❌ Error listando comentarios', e);
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
);

// ===============================
// COMENTARIOS DE SOCIO – CREAR
// POST /club/:clubId/socios/:id/comentarios
// ===============================
router.post(
  '/:clubId/socios/:id/comentarios',
  requireAuth,
  requireClubAccess,
  async (req, res) => {
    const { clubId, id: socioId } = req.params;
    const comentario = (req.body?.comentario || '').trim();

    if (!comentario) {
      return res.status(400).json({
        ok: false,
        error: 'El comentario no puede estar vacío.'
      });
    }

    try {
      const q = `
        INSERT INTO socios_comentarios (club_id, socio_id, comentario)
        VALUES ($1, $2, $3)
        RETURNING id, comentario, created_at
      `;
      const r = await db.query(q, [clubId, socioId, comentario]);

      return res.json({ ok: true, comentario: r.rows[0] });
    } catch (e) {
      console.error('❌ Error guardando comentario', e);
      return res.status(500).json({
        ok: false,
        error: e.message
      });
    }
  }
);

// ===============================
// EXPORT EXCEL (.xlsx)
// ===============================
router.get('/:clubId/socios/export.xlsx', requireAuth, requireClubAccess, async (req, res) => {
  const { clubId } = req.params;

 function fmtDateDDMMYYYY(value) {
  if (!value) return '';

  const date = new Date(value);
  if (isNaN(date.getTime())) return '';

  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();

  return `${d}/${m}/${y}`;
}


  try {
    const r = await db.query(
      `
      SELECT
        numero_socio,
        dni,
        nombre,
        apellido,
        categoria,
        actividad,
        telefono,
        direccion,
        email,
        fecha_nacimiento,
        fecha_ingreso,
        activo,
        becado,
        foto_url
      FROM socios
      WHERE club_id = $1
      ORDER BY numero_socio ASC
      `,
      [clubId]
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Todo Sobre mi Club';

    const ws = wb.addWorksheet('Socios');

    ws.columns = [
  { header: 'N° socio', key: 'numero_socio', width: 12 },
  { header: 'DNI', key: 'dni', width: 14 },
  { header: 'Nombre', key: 'nombre', width: 18 },
  { header: 'Apellido', key: 'apellido', width: 18 },
  { header: 'Categoría', key: 'categoria', width: 18 },
  { header: 'Actividad', key: 'actividad', width: 22 },
  { header: 'Teléfono', key: 'telefono', width: 16 },
  { header: 'Dirección', key: 'direccion', width: 28 },
  { header: 'Email', key: 'email', width: 28 },
  { header: 'Fecha nacimiento', key: 'fecha_nacimiento', width: 16 },
  { header: 'Fecha ingreso', key: 'fecha_ingreso', width: 16 },
  { header: 'Activo', key: 'activo', width: 10 },
  { header: 'Becado', key: 'becado', width: 10 }
];


    ws.getRow(1).font = { bold: true };
    ws.autoFilter = { from: 'A1', to: 'M1' };

    for (const row of r.rows) {
      ws.addRow({
        numero_socio: row.numero_socio ?? '',
        dni: row.dni ?? '',
        nombre: row.nombre ?? '',
        apellido: row.apellido ?? '',
        categoria: row.categoria ?? '',
        actividad: row.actividad ?? '',
        telefono: row.telefono ?? '',
        direccion: row.direccion ?? '',
        email: row.email ?? '',
        fecha_nacimiento: fmtDateDDMMYYYY(row.fecha_nacimiento),
        fecha_ingreso: fmtDateDDMMYYYY(row.fecha_ingreso),
        activo: row.activo ? 'Sí' : 'No',
        becado: row.becado ? 'Sí' : 'No'
        
      });
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="socios_${clubId}.xlsx"`
    );

    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('❌ export socios xlsx', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;