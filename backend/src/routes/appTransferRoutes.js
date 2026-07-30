const express = require('express');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const { uploadImageBuffer } = require('../utils/uploadToFirebase');

const router = express.Router();

// ======================================================
// CORS (para Flutter Web localhost) — opcional si ya está global
// ======================================================
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

// ======================================================
// Helpers
// ======================================================
function getSocioId(req) {
  return req.user?.socioId || req.user?.socio_id || req.user?.socioID || null;
}
function getClubId(req) {
  return req.user?.clubId || req.user?.club_id || req.user?.clubID || null;
}
function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseAdicionalesSocio(raw) {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr.map((x) => String(x).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Devuelve todos los conceptos que el socio TIENE contratados
 * (base + adicionales), con su monto cada uno.
 * Si el socio es miembro (no jefe) de un grupo familiar, no tiene
 * concepto "base" propio (lo paga el jefe del grupo).
 */
async function getConceptosDisponibles(clubId, socioId) {
  const rSoc = await db.query(
    `SELECT id, actividad, excepcion_cuota_id,
            actividades_adicionales,
            es_jefe_plan_familiar, es_miembro_plan_familiar
     FROM socios
     WHERE id=$1 AND club_id=$2
     LIMIT 1`,
    [socioId, clubId]
  );
  if (!rSoc.rowCount) return null;
  const socio = rSoc.rows[0];

  const conceptos = [];

  if (!socio.es_miembro_plan_familiar) {
    let montoBase = 0;
    let nombreBase = socio.actividad || 'Cuota';

    if (socio.es_jefe_plan_familiar) {
      const rGf = await db.query(
        `SELECT precio_mensual FROM actividades
         WHERE club_id=$1 AND nombre='Grupo Familiar' AND activo=true LIMIT 1`,
        [clubId]
      );
      montoBase = rGf.rowCount ? Number(rGf.rows[0].precio_mensual) || 0 : 0;
      nombreBase = 'Grupo Familiar';
    } else if (socio.excepcion_cuota_id) {
      const rExc = await db.query(
        `SELECT nombre, monto FROM excepciones_cuota
         WHERE club_id=$1 AND id=$2 AND activo=true LIMIT 1`,
        [clubId, socio.excepcion_cuota_id]
      );
      montoBase = rExc.rowCount ? Number(rExc.rows[0].monto) || 0 : 0;
      nombreBase = rExc.rowCount ? rExc.rows[0].nombre : nombreBase;
    } else {
      const act = String(socio.actividad || '').trim();
      if (act) {
        const rAct = await db.query(
          `SELECT precio_mensual FROM actividades
           WHERE club_id=$1 AND nombre=$2 AND activo=true LIMIT 1`,
          [clubId, act]
        );
        montoBase = rAct.rowCount ? Number(rAct.rows[0].precio_mensual) || 0 : 0;
      }
    }

    conceptos.push({ tipo: 'base', nombre: nombreBase, monto: montoBase });
  }

  const nombresAdicionales = parseAdicionalesSocio(socio.actividades_adicionales);
  for (const nombre of nombresAdicionales) {
    const rAd = await db.query(
      `SELECT precio_mensual FROM actividades_adicionales
       WHERE club_id=$1 AND nombre=$2 AND activo=true LIMIT 1`,
      [clubId, nombre]
    );
    const monto = rAd.rowCount ? Number(rAd.rows[0].precio_mensual) || 0 : 0;
    conceptos.push({ tipo: 'adicional', nombre, monto });
  }

  return conceptos;
}

// ======================================================
// POST /app/payments/transfer/start
// body: { anio, mes }
// ======================================================
router.post('/payments/transfer/start', requireAuth, async (req, res) => {
  try {
    const clubId = getClubId(req);
    const socioId = getSocioId(req);

    if (!clubId || !socioId) {
      return res.status(401).json({
        ok: false,
        error: 'Token inválido para la app (faltan clubId/socioId en el JWT)'
      });
    }

    const { anio, mes } = req.body || {};
    const anioNum = Number(anio);
    const mesNum = Number(mes);

    if (!Number.isFinite(anioNum) || anioNum < 2000 || anioNum > 2100) {
      return res.status(400).json({ ok: false, error: 'Año inválido' });
    }
    if (!Number.isFinite(mesNum) || mesNum < 1 || mesNum > 12) {
      return res.status(400).json({ ok: false, error: 'Mes inválido' });
    }

    // Si ya existe pago confirmado en pagos_mensuales, no dejamos iniciar transferencia
    const rYaPago = await db.query(
      `SELECT id
       FROM pagos_mensuales
       WHERE club_id=$1 AND socio_id=$2 AND anio=$3 AND mes=$4
       LIMIT 1`,
      [clubId, socioId, anioNum, mesNum]
    );
    if (rYaPago.rowCount) {
      return res.status(400).json({ ok: false, error: 'Ese mes ya figura como pagado' });
    }

    // Si ya existe intento activo para ese período, no crear otro
    const rActivo = await db.query(
      `SELECT id, estado
       FROM transferencias_pago
       WHERE club_id=$1 AND socio_id=$2 AND anio=$3 AND mes=$4
         AND estado IN ('iniciado','comprobante_subido')
       ORDER BY created_at DESC
       LIMIT 1`,
      [clubId, socioId, anioNum, mesNum]
    );

if (rActivo.rowCount) {
      const activo = rActivo.rows[0];

      if (activo.estado === 'comprobante_subido') {
        return res.json({
          ok: true,
          transferenciaId: activo.id,
          estado: 'en_revision',
          reuse: true
        });
      }

      // Reutilizamos el intento, pero igual necesitamos calcular
      // los conceptos disponibles para que la app pueda mostrarlos
      const conceptosReuse = await getConceptosDisponibles(clubId, socioId);

      return res.json({
        ok: true,
        transferenciaId: activo.id,
        estado: 'iniciado',
        conceptosDisponibles: conceptosReuse || [],
        reuse: true
      });
    }

    // Obtener numero_socio
    const rSoc = await db.query(
      `SELECT numero_socio FROM socios WHERE id=$1 AND club_id=$2 LIMIT 1`,
      [socioId, clubId]
    );
    if (!rSoc.rowCount) {
      return res.status(404).json({ ok: false, error: 'Socio no encontrado' });
    }
    const numeroSocio = rSoc.rows[0].numero_socio;
    if (!numeroSocio) {
      return res.status(400).json({ ok: false, error: 'El socio no tiene numero_socio' });
    }

    // Calcular monto TOTAL sugerido (base + TODOS los adicionales contratados)
    const conceptos = await getConceptosDisponibles(clubId, socioId);
    if (!conceptos) {
      return res.status(404).json({ ok: false, error: 'Socio no encontrado' });
    }

    let montoTotal = conceptos.reduce((acc, c) => acc + (Number(c.monto) || 0), 0);

    if (!Number.isFinite(montoTotal) || montoTotal <= 0) {
      const rClub = await db.query(
        `SELECT valor_mensual FROM clubs WHERE id=$1 LIMIT 1`,
        [clubId]
      );
      montoTotal = rClub.rowCount ? (Number(rClub.rows[0].valor_mensual) || 0) : 0;
    }

    if (!Number.isFinite(montoTotal) || montoTotal <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'No se pudo determinar el monto mensual (actividad/excepción/adicionales/valor_mensual)'
      });
    }

    // Generar referencia base: TSMC-<numero_socio>-<YYYYMM>
    const referenciaBase = `TSMC-${numeroSocio}-${anioNum}${pad2(mesNum)}`;

    const rRef = await db.query(
      `SELECT 1 FROM transferencias_pago WHERE referencia = $1 LIMIT 1`,
      [referenciaBase]
    );

    const referencia = rRef.rowCount
      ? `${referenciaBase}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
      : referenciaBase;

    // Crear intento (monto_esperado acá es el TOTAL sugerido; se recalcula en /proof)
    const rIns = await db.query(
      `INSERT INTO transferencias_pago
       (club_id, socio_id, anio, mes, referencia, monto_esperado, estado)
       VALUES ($1,$2,$3,$4,$5,$6,'iniciado')
       RETURNING id, referencia, monto_esperado, estado`,
      [clubId, socioId, anioNum, mesNum, referencia, montoTotal]
    );

    const nuevo = rIns.rows[0];

    return res.json({
      ok: true,
      referencia: nuevo.referencia,
      monto: Number(nuevo.monto_esperado),
      conceptosDisponibles: conceptos,
      estado: 'transferencia_iniciada',
      ya_existia: false
    });
  } catch (err) {
    console.error('❌ /payments/transfer/start error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ======================================================
// POST /app/payments/transfer/proof
// body: {
//   anio, mes,
//   cuentaOrigen: string (obligatorio),
//   comprobante_url?, comprobante_texto?, comprobante_base64?, comprobante_mimetype? (opcionales),
//   comentario?: string,
//   pagarBase: boolean,
//   adicionalesAPagar: string[] (nombres de adicionales que está pagando)
// }
// ======================================================
router.post('/payments/transfer/proof', requireAuth, async (req, res) => {
  try {
    const clubId = getClubId(req);
    const socioId = getSocioId(req);

    if (!clubId || !socioId) {
      return res.status(401).json({
        ok: false,
        error: 'Token inválido para la app (faltan clubId/socioId)'
      });
    }

    const {
      anio,
      mes,
      comprobante_url,
      comprobante_texto,
      comprobante_base64,
      comprobante_mimetype,
      cuentaOrigen,
      comentario,
      pagarBase,
      adicionalesAPagar
    } = req.body || {};

    const anioNum = Number(anio);
    const mesNum = Number(mes);

    if (!Number.isFinite(anioNum) || anioNum < 2000 || anioNum > 2100) {
      return res.status(400).json({ ok: false, error: 'Año inválido' });
    }
    if (!Number.isFinite(mesNum) || mesNum < 1 || mesNum > 12) {
      return res.status(400).json({ ok: false, error: 'Mes inválido' });
    }
    if (!cuentaOrigen || !String(cuentaOrigen).trim()) {
      return res.status(400).json({ ok: false, error: 'Indicá la cuenta desde la que transferiste' });
    }

    const listaAdicionales = Array.isArray(adicionalesAPagar)
      ? adicionalesAPagar.map((x) => String(x).trim()).filter(Boolean)
      : [];

    if (!pagarBase && listaAdicionales.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Seleccioná al menos un concepto que estés pagando'
      });
    }

    // Verificar que no esté ya pagado
    const rYaPago = await db.query(
      `SELECT id
       FROM pagos_mensuales
       WHERE club_id=$1 AND socio_id=$2 AND anio=$3 AND mes=$4
       LIMIT 1`,
      [clubId, socioId, anioNum, mesNum]
    );
    if (rYaPago.rowCount) {
      return res.status(400).json({
        ok: false,
        error: 'Ese mes ya figura como pagado'
      });
    }

    // Buscar intento activo (iniciado o ya con comprobante)
    const rIntento = await db.query(
      `SELECT id, estado
       FROM transferencias_pago
       WHERE club_id=$1 AND socio_id=$2 AND anio=$3 AND mes=$4
         AND estado IN ('iniciado','comprobante_subido')
       ORDER BY created_at DESC
       LIMIT 1`,
      [clubId, socioId, anioNum, mesNum]
    );

    if (!rIntento.rowCount) {
      return res.status(400).json({
        ok: false,
        error: 'No hay una transferencia iniciada para ese período. Volvé a la pantalla anterior para generar una nueva.'
      });
    }

    const intentoId = rIntento.rows[0].id;

    if (rIntento.rows[0].estado === 'comprobante_subido') {
      return res.json({ ok: true, estado: 'en_revision', transferenciaId: intentoId });
    }

    // Si vino el comprobante como base64, lo subimos a Storage acá
    let comprobanteUrlFinal = comprobante_url || null;
    if (!comprobanteUrlFinal && comprobante_base64) {
      try {
        const buffer = Buffer.from(comprobante_base64, 'base64');
        const up = await uploadImageBuffer({
          buffer,
          mimetype: comprobante_mimetype || 'image/jpeg',
          originalname: 'comprobante-transferencia.jpg',
          folder: `clubs/${clubId}/comprobantes`
        });
        comprobanteUrlFinal = up.url;
      } catch (upErr) {
        console.error('❌ error subiendo comprobante', upErr);
        // seguimos sin comprobante, no es obligatorio
      }
    }

    // Calcular detalle_pago + monto real según lo que el socio declaró que paga
    const conceptosDisponibles = await getConceptosDisponibles(clubId, socioId);
    if (!conceptosDisponibles) {
      return res.status(404).json({ ok: false, error: 'Socio no encontrado' });
    }

    const detallePago = [];
    let montoReal = 0;

    for (const c of conceptosDisponibles) {
      let seleccionado = false;
      if (c.tipo === 'base' && pagarBase) seleccionado = true;
      if (c.tipo === 'adicional' && listaAdicionales.includes(c.nombre)) seleccionado = true;

      if (seleccionado) {
        detallePago.push({ tipo: c.tipo, nombre: c.nombre, monto: c.monto, seleccionado: true });
        montoReal += Number(c.monto) || 0;
      }
    }

    if (detallePago.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Los conceptos seleccionados no corresponden a este socio'
      });
    }

    // Es parcial si no cubrió TODOS los conceptos disponibles del socio
    const esParcial = detallePago.length < conceptosDisponibles.length;

    // Actualizar intento con todos los datos declarados
    await db.query(
      `UPDATE transferencias_pago
       SET
         comprobante_url = COALESCE($1, comprobante_url),
         comprobante_texto = COALESCE($2, comprobante_texto),
         cuenta_origen = $3,
         comentario = $4,
         detalle_pago = $5::jsonb,
         es_parcial = $6,
         monto_esperado = $7,
         estado = 'comprobante_subido',
         updated_at = now()
       WHERE id = $8`,
      [
        comprobanteUrlFinal,
        comprobante_texto || null,
        String(cuentaOrigen).trim(),
        comentario ? String(comentario).trim() : null,
        JSON.stringify(detallePago),
        esParcial,
        montoReal,
        intentoId
      ]
    );

    return res.json({
      ok: true,
      estado: 'en_revision',
      montoInformado: montoReal,
      esParcial
    });
  } catch (err) {
    console.error('❌ /payments/transfer/proof error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ======================================================
// GET /app/club/transferencia-config
// Devuelve CVU / Alias / Titular del club para la app
// ======================================================
router.get('/club/transferencia-config', requireAuth, async (req, res) => {
  try {
    const clubId = req.user.clubId;

    const r = await db.query(`
      SELECT
        transferencia_habilitada,
        transferencia_cvu,
        transferencia_alias,
        transferencia_titular
      FROM clubs
      WHERE id = $1
      LIMIT 1
    `, [clubId]);

    if (!r.rowCount) {
      return res.json({
        ok: true,
        transferencia_habilitada: false,
        alias: '',
        cvu: '',
        titular: '',
      });
    }

    const club = r.rows[0];

    return res.json({
      ok: true,
      transferencia_habilitada: club.transferencia_habilitada === true,
      alias: club.transferencia_alias || '',
      cvu: club.transferencia_cvu || '',
      titular: club.transferencia_titular || '',
    });

  } catch (err) {
    console.error('❌ /app/club/transferencia-config error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;