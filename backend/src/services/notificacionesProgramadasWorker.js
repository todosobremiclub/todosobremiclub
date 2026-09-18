// src/services/notificacionesProgramadasWorker.js
// ✅ NUEVO: worker de notificaciones programadas.
// Lo llama periódicamente app.js (setInterval), no es un endpoint HTTP.
// Cada vez que corre:
//   1) Busca en notificaciones_programadas las que están activas y cuya
//      proxima_ejecucion ya llegó.
//   2) Para cada una, la envía con crearYEnviarNotificacion() (mismo
//      código que usa el botón "Guardar y enviar" del panel).
//   3) Si es tipo_repeticion = 'una_vez', la desactiva (ya cumplió su función).
//      Si es 'mensual', recalcula proxima_ejecucion para el mes siguiente.
const db = require('../db');
const { crearYEnviarNotificacion } = require('./notificacionesService');
const { calcularProximaEjecucionMensual } = require('../routes/notificacionesRoutes');

async function procesarNotificacionesProgramadas() {
  let r;
  try {
    r = await db.query(
      `
      SELECT id, club_id, titulo, cuerpo, data, canal, tipo_repeticion, dia_mes, hora
      FROM notificaciones_programadas
      WHERE activo = true
        AND proxima_ejecucion <= NOW()
      ORDER BY proxima_ejecucion ASC
      LIMIT 200
      `
    );
  } catch (e) {
    console.error('❌ notificacionesProgramadasWorker (SELECT)', e);
    return;
  }

  if (!r.rowCount) return;

  console.log(`🔔 Procesando ${r.rowCount} notificación(es) programada(s)...`);

  for (const prog of r.rows) {
    try {
      await crearYEnviarNotificacion({
        clubId: prog.club_id,
        titulo: prog.titulo,
        cuerpo: prog.cuerpo,
        data: prog.data,
        canal: prog.canal,
      });

      if (prog.tipo_repeticion === 'una_vez') {
        await db.query(
          `UPDATE notificaciones_programadas
           SET activo = false, ultima_ejecucion = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [prog.id]
        );
      } else {
        const proxima = calcularProximaEjecucionMensual(prog.dia_mes, prog.hora, new Date());
        await db.query(
          `UPDATE notificaciones_programadas
           SET ultima_ejecucion = NOW(), proxima_ejecucion = $2, updated_at = NOW()
           WHERE id = $1`,
          [prog.id, proxima]
        );
      }

      console.log(`✅ Notificación programada #${prog.id} (club ${prog.club_id}) enviada`);
    } catch (e) {
      console.error(`❌ Error enviando notificación programada #${prog.id}`, e);
      // No la desactivamos: se va a reintentar en la próxima pasada del worker
      // (cada 5 minutos), hasta que se envíe con éxito o un admin la cancele.
    }
  }
}

module.exports = { procesarNotificacionesProgramadas };
