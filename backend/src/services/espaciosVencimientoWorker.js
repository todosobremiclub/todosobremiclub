// src/services/espaciosVencimientoWorker.js
//
// Pasa a 'vencida' toda reserva de espacios 'pendiente' cuyo turno ya empezó
// (hora Argentina), para que una solicitud sin responder no bloquee el turno
// para siempre. Se ejecuta desde un setInterval en app.js (cada 5 minutos).
const db = require('../db');
const { vencerPendientes } = require('./espaciosReservasService');

let corriendo = false;

async function procesarVencimientosEspacios() {
  if (corriendo) return 0; // evita solapar corridas si una tarda
  corriendo = true;
  try {
    const n = await vencerPendientes(db);
    if (n > 0) console.log(`🏟️ Espacios: ${n} solicitud(es) pendiente(s) vencida(s)`);
    return n;
  } catch (e) {
    // Si todavía no se corrió la migración, no ensuciamos el log cada 5 minutos
    if (e && e.code === '42P01') return 0;
    console.error('❌ Worker vencimiento espacios:', e.message);
    return 0;
  } finally {
    corriendo = false;
  }
}

module.exports = { procesarVencimientosEspacios };
