// src/services/becadoHistorialService.js
//
// Historial de cambios del campo "becado" de cada socio (ver migración
// 2026-09-30_socio_becado_historial.sql). Se usa para que los reportes que
// dependen de si un socio estaba becado (Cuotas impagas por mes, Monto
// esperado mensual, Esperado vs Recaudado) puedan reconstruir el estado
// de un mes pasado en vez de usar siempre el valor actual de
// socios.becado — así, sacarle/ponerle el tilde de becado hoy no cambia
// lo que esos reportes ya mostraban para meses anteriores.
//
// Uso: se llama desde sociosRoutes.js
//   - al CREAR un socio: registra el valor inicial de becado, vigente
//     desde su fecha de ingreso.
//   - al EDITAR un socio: si el valor de becado cambió respecto al que
//     tenía guardado, registra el cambio vigente desde hoy.
//
// Los reportes (reportesRoutes.js) consultan esta tabla directamente por
// SQL (ver el patrón "COALESCE con subquery a socio_becado_historial" en
// esos endpoints) en vez de pasar por este archivo, porque están armados
// como queries SQL puntuales; este servicio solo se ocupa de GRABAR el
// historial cuando cambia.

const db = require('../db');

/**
 * Registra un estado de "becado" para un socio, vigente desde una fecha.
 * Es "append-only": cada cambio agrega una fila nueva, nunca se pisa el
 * historial previo (así se puede reconstruir cualquier mes pasado).
 *
 * @param {object} params
 * @param {string} params.clubId
 * @param {string} params.socioId
 * @param {boolean} params.becado
 * @param {string} [params.vigenteDesde] - fecha 'YYYY-MM-DD'. Si no se
 *   pasa, se usa la fecha de hoy (CURRENT_DATE en la base).
 * @param {object} [params.client] - cliente/pool de Postgres a usar (por
 *   ejemplo dentro de una transacción ya abierta con BEGIN). Si no se
 *   pasa, se usa la conexión default (db).
 */
async function registrarCambioBecado({ clubId, socioId, becado, vigenteDesde = null, client = null }) {
  const conn = client || db;
  await conn.query(
    `
    INSERT INTO socio_becado_historial (club_id, socio_id, becado, vigente_desde)
    VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE))
    `,
    [clubId, socioId, !!becado, vigenteDesde]
  );
}

module.exports = { registrarCambioBecado };
