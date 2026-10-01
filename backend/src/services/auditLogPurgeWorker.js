// src/services/auditLogPurgeWorker.js
// ✅ NUEVO: worker de retención del log de auditoría (admin_activity_log).
// Lo llama periódicamente app.js (setInterval, mismo patrón que el resto de
// los workers del proyecto — no hay librería de cron instalada). Cada vez
// que corre, borra las filas con más de 3 meses de antigüedad, para que el
// log de ingresos y acciones de los admins nunca guarde más de ese período.
const db = require('../db');

async function purgarAuditLogAntiguo() {
  try {
    const r = await db.query(
      `DELETE FROM admin_activity_log WHERE created_at < NOW() - INTERVAL '3 months'`
    );
    if (r.rowCount) {
      console.log(`🧹 auditLogPurgeWorker: se eliminaron ${r.rowCount} registro(s) de admin_activity_log con más de 3 meses de antigüedad`);
    }
  } catch (e) {
    console.error('❌ auditLogPurgeWorker', e);
  }
}

module.exports = { purgarAuditLogAntiguo };
