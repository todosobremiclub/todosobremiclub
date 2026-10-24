// src/services/agendaRecurrencia.js
//
// Helpers de recurrencia de la Agenda (agenda_actividades), extraídos de
// cumplesRoutes.js para que los usen también las Clases / entrenamientos
// (agendaClasesService.js y la app del socio). Lógica idéntica a la que
// tenía cumplesRoutes.js: las ocurrencias se generan al vuelo, no se guardan.
'use strict';

function mondayOf(d) {
  const day = d.getDay(); // 0=Dom..6=Sab
  const diff = day === 0 ? -6 : 1 - day; // días para llegar al lunes de esa semana
  const r = new Date(d);
  r.setDate(r.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDaysLocal(d, days) {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function addMonthsSafe(d, months) {
  const r = new Date(d);
  const targetDay = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + months);
  const lastDay = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(targetDay, lastDay));
  return r;
}

function addYearsSafe(d, years) {
  return addMonthsSafe(d, years * 12);
}

function fechaISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const MAX_OCURRENCIAS = 400;

/**
 * Genera las fechas (Date, 00:00 local) en que ocurre una actividad
 * dentro del rango [rangeStart, rangeEndExclusive) (strings YYYY-MM-DD).
 * Si la actividad no es recurrente, devuelve [] o [fecha] según corresponda.
 */
function generarOcurrencias(act, rangeStart, rangeEndExclusive) {
  const rangeStartD = new Date(`${rangeStart}T00:00:00`);
  const rangeEndD = new Date(`${rangeEndExclusive}T00:00:00`);
  const anchor = new Date(`${act.fecha_iso}T00:00:00`);
  const tipo = act.recurrencia_tipo;

  if (!tipo) {
    if (anchor >= rangeStartD && anchor < rangeEndD) return [anchor];
    return [];
  }

  const intervalo = Math.max(1, Number(act.recurrencia_intervalo) || 1);
  const hasta = act.recurrencia_hasta ? new Date(`${act.recurrencia_hasta}T00:00:00`) : null;
  const limiteFin = hasta && hasta < rangeEndD ? hasta : addDaysLocal(rangeEndD, -1);

  if (anchor > limiteFin) return [];

  const out = [];

  if (tipo === 'diario') {
    let cursor = new Date(anchor);
    if (cursor < rangeStartD) {
      const diffDias = Math.round((rangeStartD - cursor) / 86400000);
      const pasos = Math.ceil(diffDias / intervalo);
      cursor = addDaysLocal(cursor, pasos * intervalo);
    }
    while (cursor <= limiteFin && cursor < rangeEndD && out.length < MAX_OCURRENCIAS) {
      if (cursor >= rangeStartD) out.push(new Date(cursor));
      cursor = addDaysLocal(cursor, intervalo);
    }
  } else if (tipo === 'semanal') {
    const diasSemana =
      Array.isArray(act.recurrencia_dias_semana) && act.recurrencia_dias_semana.length
        ? act.recurrencia_dias_semana.map(Number)
        : [anchor.getDay()];

    let semanaCursor = mondayOf(anchor);
    while (semanaCursor <= limiteFin && out.length < MAX_OCURRENCIAS) {
      for (const dow of diasSemana) {
        const offset = dow === 0 ? 6 : dow - 1; // lunes=0 .. domingo=6
        const dia = addDaysLocal(semanaCursor, offset);
        if (dia >= anchor && dia <= limiteFin && dia >= rangeStartD && dia < rangeEndD) {
          out.push(dia);
        }
      }
      semanaCursor = addDaysLocal(semanaCursor, intervalo * 7);
    }
    out.sort((a, b) => a - b);
  } else if (tipo === 'mensual') {
    let cursor = new Date(anchor);
    while (cursor <= limiteFin && out.length < MAX_OCURRENCIAS) {
      if (cursor >= rangeStartD && cursor < rangeEndD) out.push(new Date(cursor));
      cursor = addMonthsSafe(cursor, intervalo);
    }
  } else if (tipo === 'anual') {
    let cursor = new Date(anchor);
    while (cursor <= limiteFin && out.length < MAX_OCURRENCIAS) {
      if (cursor >= rangeStartD && cursor < rangeEndD) out.push(new Date(cursor));
      cursor = addYearsSafe(cursor, intervalo);
    }
  }

  return out;
}

module.exports = {
  MAX_OCURRENCIAS, mondayOf, addDaysLocal, addMonthsSafe, addYearsSafe, fechaISO, generarOcurrencias
};
