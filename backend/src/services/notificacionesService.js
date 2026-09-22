// src/services/notificacionesService.js
// ✅ NUEVO: lógica compartida de armado de destino + envío de una notificación
// (push FCM y/o WhatsApp), extraída de notificacionesRoutes.js para poder
// reutilizarla tanto en el envío inmediato (POST /:clubId/notificaciones)
// como en el worker de notificaciones programadas
// (notificacionesProgramadasWorker.js). No cambia ningún comportamiento
// existente: es el mismo código que ya vivía en notificacionesRoutes.js.
const db = require('../db');
const { initFirebase } = require('../config/firebaseAdmin');
const { enviarPlantillaWhatsapp } = require('./whatsappService');

// ===============================
// Helper: normalizar texto para nombre de topic FCM
// ⚠️ Esta función debe dar EXACTAMENTE el mismo resultado que
// normalizeForTopic() en push_service.dart (lado app). Si se
// cambia una, hay que cambiar la otra, sino los nombres de topic
// no van a coincidir entre backend y app.
// ===============================
function slugForTopic(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // sacar acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

// ===============================
// Helper: validar destino_tipo (mismos criterios que Noticias)
// ===============================
const DESTINO_TIPOS_VALIDOS = new Set([
  'todos',
  'actividad',
  'categoria',
  'anio_nac',
  'cat_anio',
  'act_cat',
  'falta_pago',
]);

function validateDestino({ destino_tipo, destino_valor1, destino_valor2 }) {
  const tipo = destino_tipo || 'todos';

  if (!DESTINO_TIPOS_VALIDOS.has(tipo)) {
    throw new Error('destino_tipo inválido');
  }
  if (tipo === 'actividad' && !destino_valor1) {
    throw new Error('Falta actividad (destino_valor1)');
  }
  if (tipo === 'categoria' && !destino_valor1) {
    throw new Error('Falta categoría (destino_valor1)');
  }
  if (tipo === 'anio_nac' && !destino_valor1) {
    throw new Error('Falta año de nacimiento (destino_valor1)');
  }
  if (tipo === 'cat_anio' && (!destino_valor1 || !destino_valor2)) {
    throw new Error('Falta categoría o año de nacimiento (destino_valor1 / destino_valor2)');
  }
  if (tipo === 'act_cat' && (!destino_valor1 || !destino_valor2)) {
    throw new Error('Falta actividad o categoría (destino_valor1 / destino_valor2)');
  }
}

// ===============================
// Helper: resolver a qué topic/condición de FCM mandar el push
// según el destino elegido en el panel.
// ===============================
function buildFcmTarget(clubId, destino) {
  const tipo = destino?.destino_tipo || 'todos';
  const v1 = destino?.destino_valor1 || null;
  const v2 = destino?.destino_valor2 || null;

  const topicActividad = (act) => `club_${clubId}_act_${slugForTopic(act)}`;
  const topicCategoria = (cat) => `club_${clubId}_cat_${slugForTopic(cat)}`;
  const topicAnio = (anio) => `club_${clubId}_anio_${slugForTopic(anio)}`;
  const topicFaltaPago = () => `club_${clubId}_faltapago`;

  switch (tipo) {
    case 'actividad':
      return { topic: topicActividad(v1) };
    case 'categoria':
      return { topic: topicCategoria(v1) };
    case 'anio_nac':
      return { topic: topicAnio(v1) };
    case 'act_cat':
      return {
        condition: `'${topicActividad(v1)}' in topics && '${topicCategoria(v2)}' in topics`,
      };
    case 'cat_anio':
      return {
        condition: `'${topicCategoria(v1)}' in topics && '${topicAnio(v2)}' in topics`,
      };
    case 'falta_pago':
      return { topic: topicFaltaPago() };
    default:
      return { topic: `club_${clubId}` };
  }
}

// ===============================
// Helper: enviar push al destino elegido
// (todos / actividad / categoría / año / falta de pago / combinaciones)
// ✅ Incluye clubName en el título y en data
// ===============================
async function sendPushToClubTopic({ clubId, clubName, titulo, cuerpo, notificacionId, data }) {
  const admin = initFirebase();
  if (!admin) throw new Error('Firebase no inicializado (faltan FIREBASE_*)');

  const target = buildFcmTarget(clubId, data);

  // ✅ Título con nombre del club
  // Ej: "Club Atlético — Suspensión por lluvia"
  const titleFinal = clubName
    ? `${String(clubName).trim()} — ${String(titulo ?? '').trim()}`
    : String(titulo ?? '').trim();

  // data en FCM debe ser string
  const message = {
    ...target, // { topic: '...' } o { condition: '...' }
    notification: {
      title: String(titleFinal).slice(0, 120),
      body: String(cuerpo ?? '').slice(0, 200),
    },
    data: {
      type: 'notificacion',
      clubId: String(clubId),
      clubNombre: String(clubName ?? ''), // ✅ NUEVO
      notificacionId: String(notificacionId),
    },
  };

  const messageId = await admin.messaging().send(message);
  return messageId;
}

// ===============================
// Mismo criterio de segmentación que buildFcmTarget, pero como WHERE
// SQL sobre socios (para WhatsApp, que no tiene topics de Firebase). Reutiliza
// el mismo CASE de pago_al_dia que ya existe en sociosRoutes.js (GET
// /:clubId/socios) para que "falta_pago" signifique lo mismo
// en el push y en WhatsApp.
// ===============================
function buildSociosWhereFromDestino(clubId, destino) {
  const tipo = destino?.destino_tipo || 'todos';
  const v1 = destino?.destino_valor1 || null;
  const v2 = destino?.destino_valor2 || null;

  const where = ["s.club_id = $1", "s.activo = true", "s.telefono IS NOT NULL", "s.telefono <> ''"];
  const params = [clubId];
  let p = 2;

  const PAGO_AL_DIA_SQL = `
    CASE
      WHEN s.becado = true THEN true
      WHEN COALESCE(act_dep.modalidad_pago, 'mensual') = 'por_clases' THEN true
      ELSE
        COALESCE((
          SELECT MAX((pm.anio::int * 100) + (pm.mes::int))
          FROM pagos_mensuales pm
          WHERE pm.club_id = s.club_id AND pm.socio_id = s.id
        ), 0) >=
        CASE
          WHEN EXTRACT(DAY FROM CURRENT_DATE)::int <= COALESCE(c.payment_due_day, 31)
          THEN
            CASE
              WHEN EXTRACT(MONTH FROM CURRENT_DATE)::int = 1
              THEN ((EXTRACT(YEAR FROM CURRENT_DATE)::int - 1) * 100) + 12
              ELSE (EXTRACT(YEAR FROM CURRENT_DATE)::int * 100) + (EXTRACT(MONTH FROM CURRENT_DATE)::int - 1)
            END
          ELSE (EXTRACT(YEAR FROM CURRENT_DATE)::int * 100) + EXTRACT(MONTH FROM CURRENT_DATE)::int
        END
    END
  `;

  switch (tipo) {
    case 'actividad':
      where.push(`s.actividad = $${p++}`); params.push(v1); break;
    case 'categoria':
      where.push(`s.categoria = $${p++}`); params.push(v1); break;
    case 'anio_nac':
      where.push(`EXTRACT(YEAR FROM s.fecha_nacimiento) = $${p++}`); params.push(Number(v1)); break;
    case 'act_cat':
      where.push(`s.actividad = $${p++}`); params.push(v1);
      where.push(`s.categoria = $${p++}`); params.push(v2);
      break;
    case 'cat_anio':
      where.push(`s.categoria = $${p++}`); params.push(v1);
      where.push(`EXTRACT(YEAR FROM s.fecha_nacimiento) = $${p++}`); params.push(Number(v2));
      break;
    case 'falta_pago':
      where.push(`NOT (${PAGO_AL_DIA_SQL})`);
      break;
    default:
      break; // 'todos': sin filtro adicional
  }

  const sql = `
    SELECT s.id, s.telefono
    FROM socios s
    LEFT JOIN clubs c ON c.id = s.club_id
    LEFT JOIN actividades act_dep
      ON act_dep.club_id = s.club_id AND act_dep.nombre = s.actividad AND act_dep.activo = true
    WHERE ${where.join(' AND ')}
  `;

  return { sql, params };
}

// ===============================
// ✅ NUEVO: arma y ejecuta el envío completo de una notificación
// (insert en `notificaciones` + push FCM y/o WhatsApp, según canal).
// Es el mismo flujo que ya hacía POST /:clubId/notificaciones "en línea";
// se usa tanto ahí como desde el worker de notificaciones programadas.
// ===============================
async function crearYEnviarNotificacion({ clubId, titulo, cuerpo, data, canal }) {
  // ✅ Traer nombre del club (para mostrar en push)
  const rClub = await db.query(`SELECT name FROM clubs WHERE id = $1 LIMIT 1`, [clubId]);
  const clubName = rClub.rowCount ? rClub.rows[0].name : 'Club';

  const canalFinal = ['app', 'whatsapp', 'ambos'].includes(canal) ? canal : 'app';

  // 1) Insertar en DB
  const rIns = await db.query(
    `
    INSERT INTO notificaciones (club_id, titulo, cuerpo, data, canal, activo, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())
    RETURNING id, club_id, titulo, cuerpo, data, canal, created_at
    `,
    [clubId, titulo.trim(), cuerpo.trim(), data, canalFinal]
  );

  const noti = rIns.rows[0];

  // 2) Enviar push (FCM) — solo si el canal elegido incluye la app
  let messageId = null;
  if (canalFinal === 'app' || canalFinal === 'ambos') {
    messageId = await sendPushToClubTopic({
      clubId,
      clubName,
      titulo: noti.titulo,
      cuerpo: noti.cuerpo,
      notificacionId: noti.id,
      data
    });

    // 3) Guardar metadata de envío
    await db.query(
      `
      UPDATE notificaciones
      SET sent_at = NOW(),
          firebase_message_id = $1,
          updated_at = NOW()
      WHERE id = $2 AND club_id = $3
      `,
      [messageId, noti.id, clubId]
    );
  }

  // 4) Envío por WhatsApp si el canal elegido lo incluye
  let whatsappResumen = null;
  if (canalFinal === 'whatsapp' || canalFinal === 'ambos') {
    const { sql, params: paramsDestino } = buildSociosWhereFromDestino(clubId, data);
    const rSocios = await db.query(sql, paramsDestino);

    let enviados = 0;
    let sinCupo = 0;
    // ✅ NUEVO: antes un fallo que no fuera "sin cupo" (ej: teléfono
    // inválido, error de Meta) quedaba mudo: no sumaba a enviados ni a
    // sinCupo, y el panel solo mostraba "X enviados de Y" sin decir por
    // qué faltaban. Ahora se junta el detalle para mostrarlo en el panel.
    const errores = [];

    for (const s of rSocios.rows) {
      const r = await enviarPlantillaWhatsapp({
        clubId,
        socioId: s.id,
        notificacionId: noti.id,
        tipo: 'notificacion',
        telefono: s.telefono,
        templateName: 'notificacion_club',
        parametros: [clubName, noti.titulo, noti.cuerpo]
      });

      if (r.ok) enviados++;
      else if (r.error === 'El club alcanzó su límite mensual de WhatsApp') {
        sinCupo++;
        break; // corta el loop apenas se agota el cupo, no sigue intentando
      } else {
        errores.push({ socioId: s.id, error: r.error || 'Error desconocido' });
      }
    }

    whatsappResumen = { enviados, sinCupo, total: rSocios.rowCount, errores };

    // Si no se mandó push (canal solo WhatsApp), igual dejamos sent_at
    // seteado para que la notificación no quede como "no enviada".
    if (canalFinal === 'whatsapp') {
      await db.query(
        `UPDATE notificaciones SET sent_at = NOW(), updated_at = NOW() WHERE id = $1 AND club_id = $2`,
        [noti.id, clubId]
      );
    }
  }

  return {
    notificacion: { ...noti, sent_at: new Date().toISOString(), firebase_message_id: messageId },
    whatsappResumen,
  };
}

module.exports = {
  slugForTopic,
  DESTINO_TIPOS_VALIDOS,
  validateDestino,
  buildFcmTarget,
  sendPushToClubTopic,
  buildSociosWhereFromDestino,
  crearYEnviarNotificacion,
};
