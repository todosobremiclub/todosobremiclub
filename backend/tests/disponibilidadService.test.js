// node backend/tests/disponibilidadService.test.js
// Pruebas de la lógica PURA del motor de turnos (no necesita base de datos).
const assert = require('node:assert/strict');
const S = require('../src/services/disponibilidadService');

let ok = 0;
const test = (nombre, fn) => {
  try { fn(); ok++; console.log('  ✔', nombre); }
  catch (e) { console.error('  ✘', nombre, '\n   ', e.message); process.exitCode = 1; }
};

// "Hoy" fijo: miércoles 2026-10-21 10:00 (Argentina)
const AHORA = { fecha: '2026-10-21', min: 10 * 60 };
const cancha = (extra = {}) => ({
  id: 'R1', duracion_turno_min: 60, anticipacion_min_horas: 0, anticipacion_max_dias: 30, ...extra
});
const sem = (dia, d, h, extra = {}) => ({
  id: `d${dia}${d}`, modo: 'disponible', tipo: 'semanal', dia_semana: dia, hora_desde: d, hora_hasta: h, activo: true, ...extra
});
const fecha = (f, d, h, extra = {}) => ({
  id: `f${f}${d}`, modo: 'disponible', tipo: 'fecha', fecha: f, hora_desde: d, hora_hasta: h, activo: true, ...extra
});
const calc = (p) => S.calcularTurnos({ ahora: AHORA, ...p });
const horas = (r, f) => (r.find((d) => d.fecha === f)?.turnos || []).map((t) => `${t.hora_desde}${t.estado === 'libre' ? '' : '*'}`);

console.log('Grilla');
test('lunes 18–23 con turno de 60 → 5 turnos', () => {
  const g = S.generarGrilla({ recurso: cancha(), disponibilidad: [sem(1, '18:00', '23:00')], fecha: '2026-10-26' });
  assert.deepEqual(g.map((s) => S.fmt(s.desde)), ['18:00', '19:00', '20:00', '21:00', '22:00']);
});
test('turno de 90 min en 18–23 → 18:00, 19:30, 21:00 (el que no entra completo no existe)', () => {
  const g = S.generarGrilla({ recurso: cancha({ duracion_turno_min: 90 }), disponibilidad: [sem(1, '18:00', '23:00')], fecha: '2026-10-26' });
  assert.deepEqual(g.map((s) => S.fmt(s.desde)), ['18:00', '19:30', '21:00']);
});
test('una regla semanal de lunes no genera turnos el martes', () => {
  const g = S.generarGrilla({ recurso: cancha(), disponibilidad: [sem(1, '18:00', '20:00')], fecha: '2026-10-27' });
  assert.equal(g.length, 0);
});
test('día específico agrega turnos solo ese día', () => {
  const d = [fecha('2026-11-14', '10:00', '12:00')];
  assert.equal(S.generarGrilla({ recurso: cancha(), disponibilidad: d, fecha: '2026-11-14' }).length, 2);
  assert.equal(S.generarGrilla({ recurso: cancha(), disponibilidad: d, fecha: '2026-11-21' }).length, 0);
});
test('ventanas solapadas (regular 18–23 + día específico 20–23:59) se unifican, sin turnos duplicados', () => {
  const d = [sem(1, '18:00', '23:00'), fecha('2026-10-26', '20:00', '23:59')];
  const g = S.generarGrilla({ recurso: cancha(), disponibilidad: d, fecha: '2026-10-26' });
  assert.deepEqual(g.map((s) => S.fmt(s.desde)), ['18:00', '19:00', '20:00', '21:00', '22:00']);
});
test('ventanas contiguas (14–16 y 16–18) se unifican', () => {
  const d = [sem(6, '14:00', '16:00'), sem(6, '16:00', '18:00')];
  const g = S.generarGrilla({ recurso: cancha({ duracion_turno_min: 120 }), disponibilidad: d, fecha: '2026-10-24' });
  assert.deepEqual(g.map((s) => S.fmt(s.desde)), ['14:00', '16:00']);
});
test('vigencia: la regla semanal no aplica fuera de vigente_desde/vigente_hasta', () => {
  const d = [sem(1, '18:00', '19:00', { vigente_desde: '2026-11-01', vigente_hasta: '2026-11-30' })];
  assert.equal(S.generarGrilla({ recurso: cancha(), disponibilidad: d, fecha: '2026-10-26' }).length, 0);
  assert.equal(S.generarGrilla({ recurso: cancha(), disponibilidad: d, fecha: '2026-11-02' }).length, 1);
  assert.equal(S.generarGrilla({ recurso: cancha(), disponibilidad: d, fecha: '2026-12-07' }).length, 0);
});
test('reglas inactivas se ignoran', () => {
  const d = [sem(1, '18:00', '19:00', { activo: false })];
  assert.equal(S.generarGrilla({ recurso: cancha(), disponibilidad: d, fecha: '2026-10-26' }).length, 0);
});

console.log('Bloqueos');
test('bloqueo todo el día (feriado) ocupa todos los turnos con motivo "bloqueo"', () => {
  const d = [sem(1, '18:00', '20:00'), { id: 'b', modo: 'bloqueado', tipo: 'fecha', fecha: '2026-10-26', hora_desde: null, hora_hasta: null, motivo: 'Feriado', activo: true }];
  const r = calc({ recurso: cancha(), disponibilidad: d, desde: '2026-10-26', hasta: '2026-10-26' });
  assert.deepEqual(horas(r, '2026-10-26'), ['18:00*', '19:00*']);
  assert.equal(r[0].turnos[0].motivo, 'bloqueo');
  assert.equal(r[0].turnos[0].ocupado_por[0].motivo, 'Feriado');
});
test('bloqueo por tramo solo ocupa los turnos que toca', () => {
  const d = [sem(1, '18:00', '22:00'), { id: 'b', modo: 'bloqueado', tipo: 'fecha', fecha: '2026-10-26', hora_desde: '19:30', hora_hasta: '20:30', activo: true }];
  const r = calc({ recurso: cancha(), disponibilidad: d, desde: '2026-10-26', hasta: '2026-10-26' });
  assert.deepEqual(horas(r, '2026-10-26'), ['18:00', '19:00*', '20:00*', '21:00']);
});
test('bloqueo semanal con vigencia (ej. mantenimiento todos los lunes de noviembre)', () => {
  const d = [sem(1, '18:00', '19:00'), { id: 'b', modo: 'bloqueado', tipo: 'semanal', dia_semana: 1, vigente_desde: '2026-11-01', vigente_hasta: '2026-11-30', activo: true }];
  const r = calc({ recurso: cancha(), disponibilidad: d, desde: '2026-10-26', hasta: '2026-11-09' });
  assert.deepEqual(horas(r, '2026-10-26'), ['18:00']);
  assert.deepEqual(horas(r, '2026-11-02'), ['18:00*']);
});

console.log('Reservas');
const disp = [sem(1, '18:00', '21:00')];
test('reserva pendiente y aceptada ocupan el turno; rechazada/cancelada/vencida no', () => {
  const mk = (id, estado, h) => ({ id, estado, fecha: '2026-10-26', hora_desde: h, hora_hasta: S.fmt(S.toMin(h) + 60), socio_id: 's' });
  const r = calc({ recurso: cancha(), disponibilidad: disp, desde: '2026-10-26', hasta: '2026-10-26',
    reservas: [mk('a', 'pendiente', '18:00'), mk('b', 'aceptada', '19:00'), mk('c', 'rechazada', '20:00'), mk('d', 'cancelada', '20:00'), mk('e', 'vencida', '20:00')] });
  assert.deepEqual(horas(r, '2026-10-26'), ['18:00*', '19:00*', '20:00']);
});
test('una reserva de otra fecha no afecta', () => {
  const r = calc({ recurso: cancha(), disponibilidad: disp, desde: '2026-10-26', hasta: '2026-10-26',
    reservas: [{ id: 'a', estado: 'aceptada', fecha: '2026-11-02', hora_desde: '18:00', hora_hasta: '19:00' }] });
  assert.deepEqual(horas(r, '2026-10-26'), ['18:00', '19:00', '20:00']);
});

console.log('Abonos');
const abono = (extra = {}) => ({ id: 'AB1', estado: 'activo', dia_semana: 1, hora_desde: '19:00', hora_hasta: '20:00', vigente_desde: '2026-10-01', vigente_hasta: null, nombre_externo: 'Los Pibes', ...extra });
test('abono sin fecha de fin ocupa el turno TODAS las semanas', () => {
  const r = calc({ recurso: cancha(), disponibilidad: disp, abonos: [abono()], desde: '2026-10-26', hasta: '2026-11-16' });
  for (const f of ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']) {
    assert.deepEqual(horas(r, f), ['18:00', '19:00*', '20:00'], f);
  }
  assert.equal(r[0].turnos[1].motivo, 'abono');
});
test('abono muy a futuro (años adelante) sigue ocupando (sin fecha de fin)', () => {
  const r = S.calcularTurnos({ recurso: cancha({ anticipacion_max_dias: 3650 }), disponibilidad: disp, abonos: [abono()],
    desde: '2028-03-06', hasta: '2028-03-06', ahora: AHORA, aplicarAnticipacion: false });
  assert.deepEqual(horas(r, '2028-03-06'), ['18:00', '19:00*', '20:00']);
});
test('excepción (vacaciones) libera el turno solo en esas fechas', () => {
  const r = calc({ recurso: cancha(), disponibilidad: disp, abonos: [abono()],
    excepcionesAbono: [{ abono_id: 'AB1', fecha_desde: '2026-11-02', fecha_hasta: '2026-11-09' }],
    desde: '2026-10-26', hasta: '2026-11-16' });
  assert.deepEqual(horas(r, '2026-10-26'), ['18:00', '19:00*', '20:00']);
  assert.deepEqual(horas(r, '2026-11-02'), ['18:00', '19:00', '20:00']);
  assert.deepEqual(horas(r, '2026-11-09'), ['18:00', '19:00', '20:00']);
  assert.deepEqual(horas(r, '2026-11-16'), ['18:00', '19:00*', '20:00']);
});
test('abono dado de baja con vigente_hasta: libre después de esa fecha (inclusive hasta ese día)', () => {
  const r = calc({ recurso: cancha(), disponibilidad: disp, abonos: [abono({ vigente_hasta: '2026-11-02' })], desde: '2026-10-26', hasta: '2026-11-09' });
  assert.deepEqual(horas(r, '2026-11-02'), ['18:00', '19:00*', '20:00']);
  assert.deepEqual(horas(r, '2026-11-09'), ['18:00', '19:00', '20:00']);
});
test('abono con vigente_desde futuro todavía no ocupa', () => {
  const r = calc({ recurso: cancha(), disponibilidad: disp, abonos: [abono({ vigente_desde: '2026-11-09' })], desde: '2026-10-26', hasta: '2026-11-09' });
  assert.deepEqual(horas(r, '2026-11-02'), ['18:00', '19:00', '20:00']);
  assert.deepEqual(horas(r, '2026-11-09'), ['18:00', '19:00*', '20:00']);
});
test('abono de otro día de la semana no afecta', () => {
  const r = calc({ recurso: cancha(), disponibilidad: [sem(1, '18:00', '21:00'), sem(2, '18:00', '21:00')], abonos: [abono({ dia_semana: 2 })], desde: '2026-10-26', hasta: '2026-10-27' });
  assert.deepEqual(horas(r, '2026-10-26'), ['18:00', '19:00', '20:00']);
  assert.deepEqual(horas(r, '2026-10-27'), ['18:00', '19:00*', '20:00']);
});
test('abono de 21:30–22:30 (no alineado) bloquea los dos turnos que toca', () => {
  const r = calc({ recurso: cancha(), disponibilidad: [sem(1, '20:00', '23:00')], abonos: [abono({ hora_desde: '20:30', hora_hasta: '21:30' })], desde: '2026-10-26', hasta: '2026-10-26' });
  assert.deepEqual(horas(r, '2026-10-26'), ['20:00*', '21:00*', '22:00']);
});
test('abono dado de baja (estado) no ocupa', () => {
  const r = calc({ recurso: cancha(), disponibilidad: disp, abonos: [abono({ estado: 'baja' })], desde: '2026-10-26', hasta: '2026-10-26' });
  assert.deepEqual(horas(r, '2026-10-26'), ['18:00', '19:00', '20:00']);
});
test('el feriado bloqueado gana sobre el abono (no hay turno ese día)', () => {
  const d = [...disp, { id: 'b', modo: 'bloqueado', tipo: 'fecha', fecha: '2026-11-02', activo: true, motivo: 'Feriado' }];
  const r = calc({ recurso: cancha(), disponibilidad: d, abonos: [abono()], desde: '2026-11-02', hasta: '2026-11-02' });
  assert.equal(r[0].turnos.every((t) => t.estado === 'ocupado'), true);
  assert.equal(r[0].turnos[1].motivo, 'bloqueo');
});

console.log('Clases');
test('una clase en el recurso ocupa sus turnos', () => {
  const r = calc({ recurso: cancha(), disponibilidad: disp, clases: [{ clase_id: 'C1', nombre: 'Escuelita', fecha: '2026-10-26', hora_desde: '18:00', hora_hasta: '19:00' }], desde: '2026-10-26', hasta: '2026-10-26' });
  assert.deepEqual(horas(r, '2026-10-26'), ['18:00*', '19:00', '20:00']);
  assert.equal(r[0].turnos[0].motivo, 'clase');
});
test('expandirClases respeta excepciones (clase cancelada esa fecha) y vigencia', () => {
  const o = S.expandirClases({
    horarios: [{ clase_id: 'C1', nombre: 'Natación', tipo: 'semanal', dia_semana: 1, hora_desde: '18:00', hora_hasta: '19:00', vigente_desde: null, vigente_hasta: null }],
    excepciones: [{ clase_id: 'C1', fecha: '2026-11-02' }], desde: '2026-10-26', hasta: '2026-11-09'
  });
  assert.deepEqual(o.map((x) => x.fecha), ['2026-10-26', '2026-11-09']);
});

console.log('Anticipación');
test('turnos que ya empezaron quedan ocupados ("pasado"); el que empieza justo ahora aún se puede reservar', () => {
  const d = [sem(3, '08:00', '13:00')]; // miércoles = hoy (10:00)
  const r = calc({ recurso: cancha(), disponibilidad: d, desde: '2026-10-21', hasta: '2026-10-21' });
  assert.deepEqual(horas(r, '2026-10-21'), ['08:00*', '09:00*', '10:00', '11:00', '12:00']);
  assert.equal(r[0].turnos[0].motivo, 'pasado');
});
test('anticipacion_min_horas = 2 → no se reserva con menos de 2 hs', () => {
  const d = [sem(3, '08:00', '14:00')];
  const r = calc({ recurso: cancha({ anticipacion_min_horas: 2 }), disponibilidad: d, desde: '2026-10-21', hasta: '2026-10-21' });
  assert.deepEqual(horas(r, '2026-10-21'), ['08:00*', '09:00*', '10:00*', '11:00*', '12:00', '13:00']);
});
test('anticipacion_max_dias = 30 → más allá de 30 días queda "fuera_de_rango"', () => {
  const d = [sem(1, '18:00', '19:00')]; // lunes
  // 2026-11-16 está a 26 días; 2026-11-23 a 33 días
  const r = S.calcularTurnos({ recurso: cancha(), disponibilidad: d, desde: '2026-11-16', hasta: '2026-11-23', ahora: AHORA });
  assert.deepEqual(horas(r, '2026-11-16'), ['18:00']);
  assert.deepEqual(horas(r, '2026-11-23'), ['18:00*']);
  assert.equal(r.find((x) => x.fecha === '2026-11-23').turnos[0].motivo, 'fuera_de_rango');
});
test('aplicarAnticipacion:false (vista del panel) no marca pasado ni lejano', () => {
  const d = [sem(3, '08:00', '10:00')];
  const r = S.calcularTurnos({ recurso: cancha(), disponibilidad: d, desde: '2026-10-21', hasta: '2026-10-21', ahora: AHORA, aplicarAnticipacion: false });
  assert.deepEqual(horas(r, '2026-10-21'), ['08:00', '09:00']);
});

console.log('Validación de turno (lo que hace el servidor al reservar)');
test('turno exacto y libre → ok', () => {
  const v = S.validarTurnoLibre({ ahora: AHORA, recurso: cancha(), disponibilidad: disp }, '2026-10-26', '19:00');
  assert.equal(v.ok, true);
});
test('hora que no coincide con la grilla (19:30) → turno_inexistente', () => {
  const v = S.validarTurnoLibre({ ahora: AHORA, recurso: cancha(), disponibilidad: disp }, '2026-10-26', '19:30');
  assert.deepEqual([v.ok, v.motivo], [false, 'turno_inexistente']);
});
test('día sin disponibilidad → sin_disponibilidad', () => {
  const v = S.validarTurnoLibre({ ahora: AHORA, recurso: cancha(), disponibilidad: disp }, '2026-10-27', '19:00');
  assert.deepEqual([v.ok, v.motivo], [false, 'sin_disponibilidad']);
});
test('turno ya reservado → motivo "reserva"', () => {
  const v = S.validarTurnoLibre({ ahora: AHORA, recurso: cancha(), disponibilidad: disp,
    reservas: [{ id: 'x', estado: 'pendiente', fecha: '2026-10-26', hora_desde: '19:00', hora_hasta: '20:00' }] }, '2026-10-26', '19:00');
  assert.deepEqual([v.ok, v.motivo], [false, 'reserva']);
});

console.log('Conflictos al crear un abono');
test('detecta reserva futura, otro abono y clase en el mismo horario', () => {
  const c = S.conflictosAbono({
    hoy: '2026-10-21',
    abono: { dia_semana: 4, hora_desde: '21:00', hora_hasta: '22:00', vigente_desde: '2026-10-22', vigente_hasta: null },
    abonosActivos: [{ id: 'X', estado: 'activo', dia_semana: 4, hora_desde: '21:00', hora_hasta: '22:00', vigente_desde: '2026-01-01', vigente_hasta: null, nombre_externo: 'Otro equipo' }],
    reservasFuturas: [
      { id: 'r1', estado: 'aceptada', fecha: '2026-10-29', hora_desde: '21:00', hora_hasta: '22:00' }, // jueves ✔ conflicto
      { id: 'r2', estado: 'aceptada', fecha: '2026-10-30', hora_desde: '21:00', hora_hasta: '22:00' }, // viernes ✘
      { id: 'r3', estado: 'rechazada', fecha: '2026-11-05', hora_desde: '21:00', hora_hasta: '22:00' } // rechazada ✘
    ],
    clasesOcurrencias: [{ clase_id: 'C', nombre: 'Escuelita', fecha: '2026-11-12', hora_desde: '21:30', hora_hasta: '22:30' }]
  });
  assert.deepEqual(c.map((x) => x.tipo).sort(), ['abono', 'clase', 'reserva']);
});
test('sin conflictos → lista vacía; un abono con vigencia que no se cruza no choca', () => {
  const c = S.conflictosAbono({
    hoy: '2026-10-21',
    abono: { dia_semana: 4, hora_desde: '21:00', hora_hasta: '22:00', vigente_desde: '2027-01-01', vigente_hasta: null },
    abonosActivos: [{ id: 'X', estado: 'activo', dia_semana: 4, hora_desde: '21:00', hora_hasta: '22:00', vigente_desde: '2026-01-01', vigente_hasta: '2026-12-31' }],
    reservasFuturas: [], clasesOcurrencias: []
  });
  assert.deepEqual(c, []);
});
test('abonoCoincideConGrilla: 21:00–22:00 sí; 21:30–22:30 no', () => {
  const base = { recurso: cancha(), disponibilidad: [sem(4, '18:00', '23:00')], dia_semana: 4, referencia: '2026-10-21' };
  assert.equal(S.abonoCoincideConGrilla({ ...base, hora_desde: '21:00', hora_hasta: '22:00' }), true);
  assert.equal(S.abonoCoincideConGrilla({ ...base, hora_desde: '21:30', hora_hasta: '22:30' }), false);
});

console.log('Rango y utilidades');
test('rango de más de 31 días → error', () => {
  assert.throws(() => calc({ recurso: cancha(), disponibilidad: disp, desde: '2026-10-01', hasta: '2026-11-15' }), /rango_muy_grande/);
});
test('rango invertido → error', () => {
  assert.throws(() => calc({ recurso: cancha(), disponibilidad: disp, desde: '2026-10-10', hasta: '2026-10-01' }), /rango_invalido/);
});
test('ahoraArgentina convierte UTC a hora local (UTC-3)', () => {
  const a = S.ahoraArgentina(new Date('2026-10-22T01:30:00Z')); // 22:30 del día anterior en Argentina
  assert.deepEqual(a, { fecha: '2026-10-21', min: 22 * 60 + 30 });
});
test('dow: 2026-10-26 es lunes (1) y 2026-10-25 domingo (0)', () => {
  assert.equal(S.dow('2026-10-26'), 1);
  assert.equal(S.dow('2026-10-25'), 0);
});

console.log(`\n${ok} pruebas OK${process.exitCode ? ' — HAY FALLAS' : ''}`);
