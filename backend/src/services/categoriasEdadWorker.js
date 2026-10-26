// src/services/categoriasEdadWorker.js
//
// Pasa a cada socio a la categoría que le corresponde por edad (solo si el
// club configuró rangos de edad y el socio no tiene la categoría "a mano").
// Se ejecuta al iniciar el server y después cada 1 hora desde app.js. Como solo
// toca los socios cuya categoría cambió, es liviano y el cambio se ve el mismo
// día del cumpleaños.
const db = require('../db');
const { recalcularCategoriasPorEdad } = require('./categoriasEdadService');

let corriendo = false;

async function procesarCategoriasPorEdad() {
  if (corriendo) return 0;
  corriendo = true;
  try {
    const n = await recalcularCategoriasPorEdad(db, null);
    if (n > 0) console.log(`🏷️ Categorías por edad: ${n} socio(s) actualizado(s)`);
    return n;
  } catch (e) {
    // 42703 / 42P01 = todavía no se corrió la migración: no ensuciamos el log cada hora
    if (e && (e.code === '42703' || e.code === '42P01')) return 0;
    console.error('❌ Worker categorías por edad:', e.message);
    return 0;
  } finally {
    corriendo = false;
  }
}

module.exports = { procesarCategoriasPorEdad };
