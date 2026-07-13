(() => {
  const $ = (id) => document.getElementById(id);

  const MESES = [
    { n: 1, label: 'Ene' }, { n: 2, label: 'Feb' }, { n: 3, label: 'Mar' }, { n: 4, label: 'Abr' },
    { n: 5, label: 'May' }, { n: 6, label: 'Jun' }, { n: 7, label: 'Jul' }, { n: 8, label: 'Ago' },
    { n: 9, label: 'Sep' }, { n: 10, label: 'Oct' }, { n: 11, label: 'Nov' }, { n: 12, label: 'Dic' }
  ];

  /* =============================
   * Helpers auth / club (TOKEN)
   * ============================= */
  function getToken() {
    const t = localStorage.getItem('token');
    if (!t) {
      alert('Tu sesión expiró. Iniciá sesión nuevamente.');
      window.location.href = '/admin.html';
      throw new Error('No token');
    }
    return t;
  }

  function getActiveClubId() {
    const c = localStorage.getItem('activeClubId');
    if (!c) {
      alert('No hay club activo');
      throw new Error('No activeClubId');
    }
    return c;
  }

  async function fetchAuth(url, options = {}) {
  const opts = options || {};
  const headers = Object.assign({}, opts.headers || {});
  headers['Authorization'] = 'Bearer ' + getToken();
  if (opts.json) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, Object.assign({}, opts, { headers }));

  let data = null;
  try { data = await res.json(); } catch { data = null; }

  return { res, data };
}


  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /* =============================
   * Estado
   * ============================= */
  let sociosCache = [];
  let cuotasMap = new Map(); // mes -> monto
  let selectedSocioId = null;
  
let selectedSocioTarifa = null; // { tipo, nombre, monto, fuente }
let actividadesPrecioMap = new Map(); // nombreActividad -> precio_mensual
let actividadesAdicionalesCache = [];
let conceptosSeleccionados = [];
let conceptosBaseSocio = []; // copia completa de conceptos del socio seleccionado


let selectedYear = new Date().getFullYear();
let mesesPagados = new Set();      // meses completos
let mesesParciales = new Set();    // meses con conceptos pendientes
let mesesSeleccionados = new Set();
let detallePagosPorMes = new Map(); // 🔥 CLAVE


  // Ingresos generales
  let tiposIngresoCache = [];
  let ingresosCache = [];

// Responsables / Cuentas
let responsablesCache = [];

// Paginación de PAGOS (tabla de socios)
const PAGOS_PAGE_SIZE = 10;
let pagosRowsAll = [];
let pagosPageCurrent = 1;

function getPagoParcialState() {
  const chk = $('pagoParcialChk');
  const input = $('pagoParcialMonto');
  const esParcial = !!(chk && chk.checked);
  const montoStr = input ? input.value.trim() : '';
  const montoNum = montoStr === '' ? NaN : Number(montoStr);
  return { esParcial, montoStr, montoNum };
}

  /* =============================
 * UI (inyectada): botón + tabla ingresos + modal 
 * ============================= */ 
function ensureIngresosUI() {
  // Ya existe en pagos.html (no inyectar nada)
  return;
}

  function openIngresoModal() {
    const modal = $('modalIngreso');
    if (!modal) return;
    if ($('ingresoFecha')) $('ingresoFecha').value = todayISO();
    if ($('ingresoMonto')) $('ingresoMonto').value = '';
    if ($('ingresoObs')) $('ingresoObs').value = '';
    modal.classList.remove('hidden');
  }

  function closeIngresoModal() {
    $('modalIngreso')?.classList.add('hidden');
  }

  function moneyARS(n) {
    try {
      return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(n || 0));
    } catch {
      return `$ ${Number(n || 0).toFixed(2)}`;
    }
  }


function getSocioTarifa(socio) {
  if (!socio) return null;

  // 🚫 Miembro de Grupo Familiar: no debería pagarse desde acá
  if (socio.es_miembro_plan_familiar === true) {
    return {
      tipo: 'grupo_familiar_miembro',
      nombre: 'Pertenece a Grupo Familiar',
      monto: 0,
      fuente: 'grupo_familiar_miembro'
    };
  }

  // 👑 Jefe/a de Grupo Familiar: usar siempre la actividad "Grupo Familiar"
  if (socio.es_jefe_plan_familiar === true) {
    const nombre = 'Grupo Familiar';
    const monto = Number(actividadesPrecioMap.get('Grupo Familiar') ?? 0) || 0;
    return {
      tipo: 'grupo_familiar',
      nombre,
      monto,
      fuente: 'grupo_familiar'
    };
  }

  // Excepción de cuota
  const exId = socio.excepcion_cuota_id ? socio.excepcion_cuota_id : null;
  if (exId) {
    const nombre = socio.excepcion_cuota_nombre || 'Excepción';
    const monto = Number(socio.excepcion_cuota_monto ?? 0) || 0;
    return {
      tipo: 'excepcion',
      nombre,
      monto,
      fuente: 'excepcion'
    };
  }

  // Actividad normal
  const act = String(socio.actividad || '').trim();
  const monto = Number(actividadesPrecioMap.get(act) ?? 0) || 0;

  return {
    tipo: 'actividad',
    nombre: act || 'Sin actividad',
    monto,
    fuente: 'actividad'
  };
}

function renderTarifaInfo() {
  const el = $('socioTarifaInfo');
  if (!el) return;

  if (!selectedSocioId || !selectedSocioTarifa) {
    el.textContent = '';
    return;
  }

  const t = selectedSocioTarifa;

  if (t.tipo === 'grupo_familiar_miembro') {
    el.textContent = 'Este socio pertenece a un Grupo Familiar. El pago debe registrarse al jefe/a del grupo.';
    return;
  }

  if (t.tipo === 'grupo_familiar') {
    el.textContent = `Grupo Familiar: ${t.nombre} — ${moneyARS(t.monto)} por mes`;
    return;
  }

  if (t.tipo === 'excepcion') {
    el.textContent = `Excepción: ${t.nombre} — ${moneyARS(t.monto)} por mes`;
    return;
  }

  el.textContent = `Actividad: ${t.nombre} — ${moneyARS(t.monto)} por mes`;
}

function buildConceptosParaSocio(socio) {
  if (!socio) return [];

  const conceptos = [];

  // Base (actividad / excepción / grupo familiar)
  if (selectedSocioTarifa) {
    conceptos.push({
      tipo: 'base',
      nombre: selectedSocioTarifa.nombre,
      monto: Number(selectedSocioTarifa.monto ?? 0) || 0,
      seleccionado: true
    });
  }

  // Actividades adicionales guardadas en el socio
  let adicionales = [];
  try {
    adicionales = socio.actividades_adicionales
      ? JSON.parse(socio.actividades_adicionales)
      : [];
  } catch {
    adicionales = [];
  }

  adicionales.forEach((nombre) => {
    const item = actividadesAdicionalesCache.find(
      (a) => String(a.nombre).trim() === String(nombre).trim()
    );

    conceptos.push({
      tipo: 'adicional',
      nombre: String(nombre),
      monto: Number(item?.precio_mensual ?? 0) || 0,
      seleccionado: true
    });
  });

  return conceptos;
}

function getConceptosPendientesDelMes(mesNum) {
  const detalle = detallePagosPorMes.get(Number(mesNum)) || [];

  if (!detalle.length) {
    return conceptosBaseSocio.map(c => ({ ...c }));
  }

  const pendientes = conceptosBaseSocio.filter((conceptoBase) => {
    const itemPrevio = detalle.find(
      (d) =>
        String(d.tipo) === String(conceptoBase.tipo) &&
        String(d.nombre).trim() === String(conceptoBase.nombre).trim()
    );

    // Si no existe en detalle previo, se considera pendiente
    if (!itemPrevio) return true;

    // Si existe pero estaba seleccionado=false, sigue pendiente
    return itemPrevio.seleccionado === false;
  });

  return pendientes.map((c) => ({
    ...c,
    seleccionado: true
  }));
}


async function selectSocio(s) {
  selectedSocioTarifa = getSocioTarifa(s);

  // 🚫 bloquear miembro de Grupo Familiar desde UI
  if (selectedSocioTarifa?.tipo === 'grupo_familiar_miembro') {
    selectedSocioId = null;

    const inp = $('socioSeleccionadoNombre');
    if (inp) inp.value = `${s.apellido} ${s.nombre} - ${s.dni}`;

    renderTarifaInfo();
    renderConceptosPago([]);
    $('modalElegirSocio')?.classList.add('hidden');
    await refreshMesesPagados();
    renderMesesGrid();
    return;
  }

  selectedSocioId = s.id;

  const inp = $('socioSeleccionadoNombre');
  if (inp) inp.value = `${s.apellido} ${s.nombre} - ${s.dni}`;

  renderTarifaInfo();

  await loadActividadesAdicionales();

  const conceptos = buildConceptosParaSocio(s);
  conceptosBaseSocio = conceptos.map(c => ({ ...c })); // ✅ guardar copia base completa
  renderConceptosPago(conceptosBaseSocio);

  $('modalElegirSocio')?.classList.add('hidden');
  await refreshMesesPagados();
  renderMesesGrid();
}

async function openPagoForSocioId(socioId) {
  if (!socioId) return;

  // Asegura que haya socios cargados
  if (!sociosCache || sociosCache.length === 0) {
    await loadSociosAll();
  }

  // Asegura cuentas cargadas
  await loadResponsables();
  fillCuentasSelects();

  const socio = sociosCache.find((s) =>
    String(s.id) === String(socioId) ||
    String(s.socio_id) === String(socioId)
  );

  if (!socio) {
    alert('No se encontró el socio seleccionado para registrar el pago.');
    return;
  }

  openModal();
  await selectSocio(socio);
}

window.openPagoForSocioId = openPagoForSocioId;

  /* =============================
   * Cargas (socios/pagos)
   * ============================= */
  async function loadSociosAll() {
    const clubId = getActiveClubId();
    const { res, data } = await fetchAuth(`/club/${clubId}/socios?activo=1&limit=2000&offset=0`);
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error cargando socios');
    sociosCache = data.socios || [];
  }

  async function loadCuotas() {
    const clubId = getActiveClubId();
    const { res, data } = await fetchAuth(`/club/${clubId}/config/cuotas`);
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error cargando cuotas');
    cuotasMap = new Map((data.cuotas || []).map(c => [Number(c.mes), Number(c.monto)]));
  }


async function loadActividadesConfig() {
  const clubId = getActiveClubId();
  const { res, data } = await fetchAuth(`/club/${clubId}/config/actividades`);
  if (!res.ok || !data.ok) {
    console.warn(data?.error || 'Error cargando actividades (para precios)');
    actividadesPrecioMap = new Map();
    return;
  }
  actividadesPrecioMap = new Map(
    (data.actividades || []).map(a => [
      String(a.nombre || '').trim(),
      Number(a.precio_mensual ?? 0) || 0
    ])
  );
}

async function loadActividadesAdicionales() {
  const clubId = getActiveClubId();

  const { res, data } = await fetchAuth(`/club/${clubId}/config/actividades-adicionales`);

  if (!res.ok || !data?.ok) {
    console.warn("Error cargando adicionales");
    actividadesAdicionalesCache = [];
    return;
  }

  actividadesAdicionalesCache = data.actividades ?? [];
}


 async function loadResumen() {
  const clubId = getActiveClubId();
  const q = $('pagosSearch')?.value || '';

  const { res, data } = await fetchAuth(`/club/${clubId}/pagos/resumen?anio=${selectedYear}`);
  if (!res.ok || !data || !data.ok) {
    throw new Error((data && data.error) || 'Error cargando resumen pagos');
  }

  let rows = data.socios || [];
  const qq = q.trim().toLowerCase();
  if (qq) {
    rows = rows.filter(s =>
      (`${s.apellido || ''} ${s.nombre || ''}`.toLowerCase().includes(qq) ||
       String(s.dni || '').includes(qq))
    );
  }

  renderTabla(rows);
}


  // Recibe todas las filas filtradas y prepara la paginación
function renderTabla(rows) {
  pagosRowsAll = rows || [];
  pagosPageCurrent = 1;
  renderTablaPage();
}

// Dibuja SOLO la página actual (10 filas)
function renderTablaPage() {
  const tbody = $('pagosTableBody');
  const pagDiv = $('pagosPagination');
  if (!tbody || !pagDiv) return;

  tbody.innerHTML = '';

  const total = pagosRowsAll.length;
  if (!total) {
    tbody.innerHTML = '<tr><td colspan="3" class="muted">No hay socios para este filtro.</td></tr>';
    pagDiv.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(total / PAGOS_PAGE_SIZE);
  if (pagosPageCurrent > totalPages) pagosPageCurrent = totalPages;

  const start = (pagosPageCurrent - 1) * PAGOS_PAGE_SIZE;
  const end = start + PAGOS_PAGE_SIZE;
  const pageRows = pagosRowsAll.slice(start, end);

pageRows.forEach(s => {
  const tr = document.createElement('tr');
  const socioId = s.socio_id ?? s.id ?? '';

  tr.innerHTML = `
      <td>${s.numero_socio ?? ''}</td>
      <td>${s.nombre ?? ''} ${s.apellido ?? ''}</td>
      <td>
        <button class="btn btn-secondary" data-act="details" data-id="${socioId}">
          Ver detalles
        </button>
      </td>
    `;
  tbody.appendChild(tr);
});

  // Render controles de paginación
  pagDiv.innerHTML = '';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'btn btn-secondary btn-sm';
  prevBtn.textContent = '‹ Anterior';
  prevBtn.disabled = pagosPageCurrent <= 1;
  prevBtn.dataset.page = 'prev';
  pagDiv.appendChild(prevBtn);

  const info = document.createElement('span');
  info.textContent = `Página ${pagosPageCurrent} de ${totalPages}`;
  info.style.fontSize = '12px';
  info.style.color = '#4b5563';
  pagDiv.appendChild(info);

  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn btn-secondary btn-sm';
  nextBtn.textContent = 'Siguiente ›';
  nextBtn.disabled = pagosPageCurrent >= totalPages;
  nextBtn.dataset.page = 'next';
  pagDiv.appendChild(nextBtn);
}

/* =============================
 * Modal Registrar Pago (socios)
 * ============================= */
function openModal() {
  const modal = $('modalPago');
  if (!modal) return;

  selectedSocioId = null;
  mesesPagados.clear();
  mesesParciales.clear();
  mesesSeleccionados.clear();

  selectedSocioTarifa = null;
  renderTarifaInfo();

  conceptosBaseSocio = [];
  conceptosSeleccionados = [];

  const conceptosLista = $('conceptosPagoLista');
  if (conceptosLista) {
    conceptosLista.innerHTML = '<div class="muted">Seleccioná un socio para ver los conceptos.</div>';
  }

  const conceptosResumen = $('conceptosPagoResumen');
  if (conceptosResumen) {
    conceptosResumen.textContent = 'Total teórico: $ 0.00 — Total seleccionado: $ 0.00';
  }

  if ($('modalSocioSearch')) $('modalSocioSearch').value = '';
  if ($('modalFechaPago')) $('modalFechaPago').value = todayISO();
  if ($('modalAnioLabel')) $('modalAnioLabel').textContent = String(selectedYear);

  // Reset estado de pago parcial
  const chkParcial = $('pagoParcialChk');
  const inpParcial = $('pagoParcialMonto');
  if (chkParcial) chkParcial.checked = false;
  if (inpParcial) {
    inpParcial.value = '';
    inpParcial.disabled = true;
  }

  renderSociosList();
  renderMesesGrid(); // esto a su vez llama a renderMontoHint()
  modal.classList.remove('hidden');
}
  function closeModal() {
    $('modalPago')?.classList.add('hidden');
  }

  function renderSociosList() {
  // ... (función tal como la tenés)
}  // ← cierre de renderSociosList

// 🔽 FUNCIÓN FINAL: renderSociosMini 🔽
function renderSociosMini(query) {
  const cont = $('listaSociosMini');
  if (!cont) return;

  const q = String(query || '').toLowerCase();

  const list = sociosCache.filter(s => {
    return (
      String(s.apellido || '').toLowerCase().includes(q) ||
      String(s.nombre || '').toLowerCase().includes(q) ||
      String(s.dni || '').includes(q)
    );
  });

  cont.innerHTML = '';

  list.forEach(s => {
    const b = document.createElement('button');
    b.className = 'navbtn';
    b.style.display = 'block';
    b.style.width = '100%';
    b.style.margin = '4px 0';
    b.type = 'button';

    b.textContent = `${s.apellido} ${s.nombre} - ${s.dni}`;

    b.onclick = async () => {
      await selectSocio(s);
    };

    cont.appendChild(b);
  });
}

// 🔼 FIN DE LA FUNCIÓN NUEVA 🔼


async function refreshMesesPagados() {
  mesesPagados.clear();
  mesesParciales.clear();
  mesesSeleccionados.clear();

  if (!selectedSocioId) return;

  const clubId = getActiveClubId();
  const { res, data } = await fetchAuth(`/club/${clubId}/pagos/${selectedSocioId}?anio=${selectedYear}`);

  if (!res.ok || !data?.ok) {
    console.warn('No se pudieron cargar los pagos del socio');
    return;
  }

  const pagos = data.pagos ?? [];

detallePagosPorMes.clear();

pagos.forEach(p => {
  if (!p.mes) return;

  if (p.detalle_pago) {
    try {
      const parsed = Array.isArray(p.detalle_pago)
        ? p.detalle_pago
        : JSON.parse(p.detalle_pago);

      detallePagosPorMes.set(Number(p.mes), parsed);
    } catch {
      detallePagosPorMes.set(Number(p.mes), []);
    }
  }
});

  pagos.forEach((p) => {
    const mes = Number(p.mes);
    if (!mes) return;

    if (p.pago_completo === false) {
      mesesParciales.add(mes);
    } else if (!p.pendiente) {
      mesesPagados.add(mes);
    }
  });
}

function renderMesesGrid() {
  const grid = $('mesesGrid');
  if (!grid) return;

  grid.innerHTML = '';

  MESES.forEach((m) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = m.label;

    const esCompleto = mesesPagados.has(m.n);
    const esParcial = mesesParciales.has(m.n);
    const estaSeleccionado = mesesSeleccionados.has(m.n);

    if (esCompleto) {
      btn.classList.add('mes-completo');
      btn.innerHTML = `${m.label} ✅`;
      btn.disabled = true;
    } else if (esParcial) {
      btn.classList.add('mes-parcial');
      btn.innerHTML = `${m.label} 🟧`;

      // ✅ tooltip con faltantes del mes
      const detalle = detallePagosPorMes.get(m.n) || [];
      const faltantes = detalle
        .filter((d) => d.seleccionado === false)
        .map((d) => `${d.nombre} (${moneyARS(d.monto)})`);

      if (faltantes.length) {
        btn.title = `Falta pagar:\n${faltantes.join('\n')}`;
      } else {
        btn.title = 'Pago parcial con conceptos pendientes';
      }
    }

    if (estaSeleccionado) {
      btn.style.outline = '3px solid #111827';
      btn.style.outlineOffset = '-3px';
    }

    btn.addEventListener('click', () => {
      if (esCompleto) return;

      // ✅ Si el mes es parcial, mostrar SOLO los conceptos pendientes de ese mes
      if (esParcial) {
        const pendientes = getConceptosPendientesDelMes(m.n);
        renderConceptosPago(pendientes);
      } else {
        // ✅ Si el mes no es parcial, volver a mostrar todos los conceptos base del socio
        renderConceptosPago(conceptosBaseSocio.map(c => ({ ...c })));
      }

      if (mesesSeleccionados.has(m.n)) {
        mesesSeleccionados.delete(m.n);
      } else {
        mesesSeleccionados.add(m.n);
      }

      renderMesesGrid();
      renderMontoHint();
    });

    grid.appendChild(btn);
  });

  renderMontoHint();
}



function renderConceptosPago(conceptos) {
  const cont = $('conceptosPagoLista');
  const resumen = $('conceptosPagoResumen');

  if (!cont || !resumen) return;

  cont.innerHTML = '';

  if (!conceptos || conceptos.length === 0) {
    cont.innerHTML = '<div class="muted">Sin conceptos</div>';
    resumen.textContent = 'Total teórico: $ 0.00 — Total seleccionado: $ 0.00';
    conceptosSeleccionados = [];
    return;
  }

  conceptosSeleccionados = conceptos.map((c) => ({ ...c }));

  conceptosSeleccionados.forEach((c, i) => {
    const row = document.createElement('div');
    row.style.padding = '6px 0';
    row.style.borderBottom = '1px solid #ececec';

    row.innerHTML = `
      <label style="display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%;">
        <span style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" data-idx="${i}" ${c.seleccionado ? 'checked' : ''}>
          <span>${c.tipo === 'base' ? 'Base' : 'Adicional'}: ${c.nombre}</span>
        </span>
        <strong>${moneyARS(c.monto)}</strong>
      </label>
    `;

    cont.appendChild(row);
  });

  cont.querySelectorAll('input[type="checkbox"]').forEach((chk) => {
    chk.addEventListener('change', () => {
      const idx = Number(chk.dataset.idx);
      if (Number.isNaN(idx) || !conceptosSeleccionados[idx]) return;
      conceptosSeleccionados[idx].seleccionado = chk.checked;
      calcularTotalesConceptos();
      renderMontoHint();
    });
  });

  calcularTotalesConceptos();
  renderMontoHint();
}

function calcularTotalesConceptos() {
  const resumen = $('conceptosPagoResumen');
  if (!resumen) return;

  let totalTeorico = 0;
  let totalSeleccionado = 0;

  conceptosSeleccionados.forEach(c => {
    totalTeorico += c.monto;
    if (c.seleccionado) {
      totalSeleccionado += c.monto;
    }
  });

  resumen.textContent =
    `Total teórico: ${moneyARS(totalTeorico)} — Total seleccionado: ${moneyARS(totalSeleccionado)}`;
}

  
function renderMontoHint() {
  const el = $('montoHint');
  if (!el) return;

  if (!mesesSeleccionados.size) {
    el.textContent = selectedSocioId
      ? 'Seleccioná uno o más meses para ver el total.'
      : 'Seleccioná un socio para habilitar meses.';
    return;
  }

  let totalConceptos = 0;
  conceptosSeleccionados.forEach((c) => {
    if (c.seleccionado) {
      totalConceptos += Number(c.monto || 0);
    }
  });

  const { esParcial, montoNum } = getPagoParcialState();

  if (esParcial) {
    if (Number.isNaN(montoNum) || montoNum < 0) {
      el.textContent = 'Ingresá un monto parcial válido (>= 0).';
      return;
    }

    const totalParcial = montoNum * mesesSeleccionados.size;
    el.textContent =
      `Total estimado parcial: ${moneyARS(totalParcial)} ` +
      `(${mesesSeleccionados.size} mes/es x ${moneyARS(montoNum)})`;
    return;
  }

  const total = totalConceptos * mesesSeleccionados.size;
  el.textContent =
    `Total estimado: ${moneyARS(total)} ` +
    `(${mesesSeleccionados.size} mes/es x ${moneyARS(totalConceptos)})`;
}

async function savePago() {
  if (!selectedSocioId) return alert('Seleccioná un socio');
  if (!mesesSeleccionados.size) return alert('Seleccioná al menos un mes');

  const fecha = $('modalFechaPago')?.value;
  if (!fecha) return alert('Seleccioná fecha de pago');

  const { esParcial, montoNum } = getPagoParcialState();

  if (esParcial) {
    if (Number.isNaN(montoNum) || montoNum < 0) {
      alert('Ingresá un monto parcial válido (>= 0).');
      return;
    }
  }

  const clubId = getActiveClubId();

  const detallePago = conceptosSeleccionados.map((c) => ({
    tipo: c.tipo,
    nombre: c.nombre,
    monto: Number(c.monto || 0),
    seleccionado: c.seleccionado === true
  }));

  const montoTotalTeorico = conceptosSeleccionados.reduce(
    (acc, c) => acc + Number(c.monto || 0),
    0
  );

  const montoSeleccionadoConceptos = conceptosSeleccionados.reduce(
    (acc, c) => acc + (c.seleccionado ? Number(c.monto || 0) : 0),
    0
  );

  const pagoCompletoPorConceptos =
    conceptosSeleccionados.length > 0 &&
    conceptosSeleccionados.every((c) => c.seleccionado === true);

  const body = {
    socio_id: selectedSocioId,
    anio: selectedYear,
    meses: Array.from(mesesSeleccionados),
    fecha_pago: fecha,
    es_parcial: esParcial,
    detalle_pago: detallePago,
    monto_total_teorico: montoTotalTeorico,
    monto_pagado: esParcial ? Number(montoNum) : montoSeleccionadoConceptos,
    pago_completo: esParcial ? false : pagoCompletoPorConceptos
  };

  const cuentaId = $('pagoCuenta')?.value;
  if (!cuentaId) return alert('Seleccioná una cuenta');

  const cuentaNombre = getCuentaNombreById(cuentaId);
  if (!cuentaNombre) return alert('Cuenta inválida');

  body.cuenta = cuentaNombre;

  if (esParcial) {
    body.monto_parcial = Number(montoNum);
  }

  const btn = $('btnPagoSave');
  if (btn) btn.disabled = true;

  try {
    const { res, data } = await fetchAuth(`/club/${clubId}/pagos`, {
      method: 'POST',
      body: JSON.stringify(body),
      json: true
    });

    if (!res.ok || !data?.ok) {
      alert(data?.error || 'Error guardando pago');
      return;
    }

    alert(`✅ Pagos guardados: ${data.insertedCount}`);
    closeModal();
    await loadResumen();
  } finally {
    if (btn) btn.disabled = false;
  }
}

  /* =============================
   * Modal Detalles (socios)
   * ============================= */
  function mesLabel(num) {
    const m = MESES.find(x => x.n === Number(num));
    return m ? m.label : String(num);
  }

  function openDetallesUI() {
    $('modalPagoDetalles')?.classList.remove('hidden');
  }

  function closeDetallesUI() {
    $('modalPagoDetalles')?.classList.add('hidden');
  }

  function renderDetalleConceptosHTML(detallePago) {
    let detalle = [];

    try {
      detalle = Array.isArray(detallePago)
        ? detallePago
        : JSON.parse(detallePago || '[]');
    } catch {
      detalle = [];
    }

    if (!detalle.length) {
      return '<span class="muted">Sin detalle</span>';
    }

    return `
      <div class="det-conceptos-list">
        ${detalle.map((d) => `
          <div class="det-concepto ${d.seleccionado === true ? 'ok' : 'pending'}">
            <span>${d.seleccionado === true ? '✅' : '⛔'}</span>
            <span class="det-name">${d.nombre}</span>
            <span class="det-amount">${moneyARS(d.monto)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  async function openDetallesModal(socioId) {
    const clubId = getActiveClubId();
    const socio = sociosCache.find(
      s => String(s.id) === String(socioId) || String(s.socio_id) === String(socioId)
    );

    const nombreSocio = socio
      ? `${socio.apellido ?? ''} ${socio.nombre ?? ''}`.trim()
      : `Socio ${socioId}`;

    $('detTitle').textContent = `Pagos de ${nombreSocio}`;
    $('detSub').textContent = `Año: ${selectedYear}`;
    $('detTableBody').innerHTML = '<tr><td colspan="7">Cargando...</td></tr>';
    $('detTotal').textContent = '';

    openDetallesUI();

    const { res, data } = await fetchAuth(`/club/${clubId}/pagos/${socioId}?anio=${selectedYear}`);
    if (!res.ok || !data.ok) {
      $('detTableBody').innerHTML = `<tr><td colspan="7">Error: ${data.error || 'No se pudo cargar'}</td></tr>`;
      return;
    }

    const pagos = data.pagos || [];
    if (!pagos.length) {
      $('detTableBody').innerHTML = '<tr><td colspan="7">No hay pagos registrados para este año.</td></tr>';
      $('detTotal').textContent = 'Total: $ 0.00';
      return;
    }

    let total = 0;
    $('detTableBody').innerHTML = '';
    pagos.forEach(p => {
      total += Number(p.monto || 0);
      const fecha = String(p.fecha_pago || '').slice(0, 10);

      const tr = document.createElement('tr');
      const cuenta = (p.cuenta || '—');

      const estadoHtml = p.pago_completo === true
        ? '<span class="det-estado ok">Completo</span>'
        : '<span class="det-estado partial">Parcial</span>';

      const detalleHtml = renderDetalleConceptosHTML(p.detalle_pago);

      tr.innerHTML = `
        <td><strong>${mesLabel(p.mes)}</strong></td>
        <td>${estadoHtml}</td>
        <td>${moneyARS(p.monto || 0)}</td>
        <td>${fecha || '—'}</td>
        <td>${cuenta}</td>
        <td>${detalleHtml}</td>
        <td style="text-align:right;">
          <button class="btn btn-secondary btn-sm"
                  data-act="del-pago"
                  data-pago-id="${p.id}"
                  data-socio-id="${socioId}">
            🗑️
          </button>
        </td>
      `;
      $('detTableBody').appendChild(tr);
    });

    $('detTotal').textContent = `Total: $ ${total.toFixed(2)}`;
  }

  /* =============================
   * ✅ Ingresos generales (no socios)
   * ============================= */
  function ingresosRangeQS() {
  const desde = `${selectedYear}-01-01`;
  const hasta = `${selectedYear}-12-31`;

  const qs = new URLSearchParams();
  qs.set('desde', desde);
  qs.set('hasta', hasta);
  qs.set('limit', '200');
  qs.set('offset', '0');
  return qs.toString();
}



  async function loadTiposIngreso() {
    const clubId = getActiveClubId();
    const { res, data } = await fetchAuth(`/club/${clubId}/config/tipos-ingreso`);
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error cargando tipos de ingreso');

    tiposIngresoCache = data.tipos || data.items || [];
    const sel = $('ingresoTipo');
    if (sel) {
      if (!tiposIngresoCache.length) {
        sel.innerHTML = `<option value="">(No hay tipos cargados)</option>`;
      } else {
        sel.innerHTML = `<option value="">Seleccionar...</option>` +
          tiposIngresoCache.map(t => `<option value="${t.id}">${t.nombre}</option>`).join('');
      }
    }
  }

async function loadResponsables() {
  const clubId = getActiveClubId();
  const { res, data } = await fetchAuth(`/club/${clubId}/config/responsables`);
  if (!res.ok || !data.ok) {
    console.error('Error cargando responsables', data.error);
    responsablesCache = [];
    return;
  }
  responsablesCache = data.responsables || data.items || [];
}

function fillCuentasSelects() {
  const selects = [
    $('ingresoCuenta'),
    $('pagoCuenta')
  ].filter(Boolean);

  selects.forEach(sel => {
    sel.innerHTML = '<option value="">Seleccionar...</option>';
    responsablesCache.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.nombre;
      sel.appendChild(opt);
    });
  });
}

function getCuentaNombreById(id) {
  if (!id) return '';
  const r = responsablesCache.find(x => String(x.id) === String(id));
  return r ? r.nombre : '';
}

  async function loadIngresos() {
  ensureIngresosUI();
  const clubId = getActiveClubId();

  const { res, data } = await fetchAuth(`/club/${clubId}/ingresos?${ingresosRangeQS()}`);
  if (!res.ok || !data || !data.ok) {
    throw new Error((data && data.error) || 'Error cargando ingresos');
  }

  ingresosCache = data.ingresos || [];
  renderIngresos(ingresosCache, data.total || 0);
}


  function renderIngresos(rows, total) {
  const tbody = $('ingresosTableBody');
  const totalEl = $('ingresosTotal');
  if (totalEl) totalEl.textContent = moneyARS(total);
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!rows || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">No hay ingresos cargados para este año.</td></tr>`;
    return;
  }

  // Helpers de agrupación YYYY-MM
  const MONTHS_FULL = [
    'Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
  ];
  const ymKey = (iso) => String(iso || '').slice(0, 7); // "YYYY-MM"
  const ymLabel = (key) => {
    const [y, m] = String(key || '').split('-');
    const mi = Number(m) - 1;
    const nombre = MONTHS_FULL[mi] || key;
    return `${nombre} ${y || ''}`.trim();
  };

  // Agrupar por mes/año + subtotal
  const groups = new Map();
  rows.forEach(r => {
    const key = ymKey(r.fecha);
    if (!groups.has(key)) groups.set(key, { items: [], subtotal: 0 });
    const g = groups.get(key);
    g.items.push(r);
    g.subtotal += Number(r.monto || 0);
  });

  // Orden desc por YYYY-MM
  const keys = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));

  keys.forEach((key) => {
    const g = groups.get(key);

    // ✅ Fila encabezado (colapsable) — SOLO mes/año + total
    const trGroup = document.createElement('tr');
    trGroup.dataset.groupHeader = "1";
    trGroup.dataset.group = key;
    trGroup.dataset.open = "0";
    trGroup.style.cursor = "pointer";

    trGroup.innerHTML = `
      <td colspan="5" style="
        background: color-mix(in srgb, var(--color-primary) 8%, #ffffff);
        border-left: 4px solid var(--color-primary);
        font-weight: 800;
        padding: 10px;
      ">
        <span class="ing-group-arrow" style="display:inline-block; width:18px;">▶</span>
        📅 ${ymLabel(key)} — Total: ${moneyARS(g.subtotal)}
      </td>
    `;
    tbody.appendChild(trGroup);

    // ✅ Filas detalle (arrancan OCULTAS)
    g.items.forEach(r => {
      const fecha = String(r.fecha || '').slice(0, 10);
      const tr = document.createElement('tr');
      tr.className = 'ingreso-detalle hidden';
      tr.dataset.group = key;
      tr.innerHTML = `
  <td>${fecha}</td>
  <td><strong>${r.tipo_ingreso || ''}</strong></td>
  <td>${r.observacion || ''}</td>
  <td>${r.cuenta || '—'}</td>
  <td><strong>${moneyARS(r.monto)}</strong></td>
  <td style="text-align:right;">
    <button class="btn btn-secondary" data-act="del-ingreso" data-id="${r.id}">🗑️</button>
  </td>
`;
      tbody.appendChild(tr);
    });
  });
}


async function deleteIngreso(id) {
  const clubId = getActiveClubId();
  if (!id) return;

  if (!confirm('¿Eliminar este ingreso?')) return;

  const { res, data } = await fetchAuth(`/club/${clubId}/ingresos/${id}`, {
    method: 'DELETE'
  });

  if (!res.ok || !data.ok) {
    alert(data.error || 'Error eliminando ingreso');
    return;
  }

  await loadIngresos();
}

async function deletePagoMensual(pagoId, socioId) {
  const clubId = getActiveClubId();
  if (!pagoId) return;

  if (!confirm('¿Eliminar esta cuota/pago del mes?')) return;

  const { res, data } = await fetchAuth(`/club/${clubId}/pagos/${pagoId}`, {
    method: 'DELETE'
  });

  if (!res.ok || !data.ok) {
    alert(data.error || 'Error eliminando el pago');
    return;
  }

  // refresca modal + tabla resumen
  await openDetallesModal(socioId);
  await loadResumen();
}

  async function saveIngreso() {
  const clubId = getActiveClubId();

  const tipo   = $('ingresoTipo')?.value;
  const fecha  = $('ingresoFecha')?.value;
  const monto  = $('ingresoMonto')?.value;
  const obs    = $('ingresoObs')?.value || '';
  const cuentaId = $('ingresoCuenta')?.value;

  if (!cuentaId) return alert('Seleccioná una cuenta');

  const cuentaNombre = getCuentaNombreById(cuentaId);
  if (!cuentaNombre) return alert('Cuenta inválida');

  if (!tipo)  return alert('Seleccioná un tipo de ingreso');
  if (!fecha) return alert('Seleccioná una fecha');
  if (monto === '' || monto == null) return alert('Ingresá un monto');

  const montoNum = Number(monto);
  if (Number.isNaN(montoNum) || montoNum < 0) {
    return alert('Monto inválido');
  }

  const btn = $('btnIngresoSave');
  if (btn) btn.disabled = true;

  try {
    const { res, data } = await fetchAuth(`/club/${clubId}/ingresos`, {
      method: 'POST',
      json: true,
      body: JSON.stringify({
        tipo_ingreso_id: tipo,
        fecha,
        monto: montoNum,
        observacion: obs.trim() || null,
        cuenta: cuentaNombre   // 👈 se envía el nombre de la cuenta al backend
      })
    });

    if (!res.ok || !data.ok) {
      alert(data.error || 'Error guardando ingreso');
      return;
    }

    closeIngresoModal();
    await loadIngresos();
    alert('✅ Ingreso registrado');
  } catch (e) {
    console.error(e);
    alert(e.message || 'Error guardando ingreso');
  } finally {
    if (btn) btn.disabled = false;
  }
}


  /* =============================
   * Año selector + bind
   * ============================= */
 function fillAnios() {
  const sel = $('pagosAnioSelect');
  if (!sel) return;

  const current = new Date().getFullYear();

  // Limpia y vuelve a cargar opciones (ej: últimos 6 años)
  sel.innerHTML = '';

  for (let y = current; y >= current - 5; y--) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    sel.appendChild(opt);
  }

  // Deja seleccionado el año activo en el estado global
  sel.value = String(selectedYear);
}


  function setSelectedYear(y) {
    selectedYear = Number(y);
    if ($('modalAnioLabel')) $('modalAnioLabel').textContent = String(selectedYear);
    if ($('pagosAnioSelect')) $('pagosAnioSelect').value = String(selectedYear);
  }

function bindAccordion() {
  const root = document.querySelector('.section-pagos');
  if (!root) return;
  if (root.dataset.accordionBound === '1') return;
  root.dataset.accordionBound = '1';

  root.addEventListener('click', (e) => {
  const header = e.target.closest('.accordion-header');
  if (!header) return;
  if (e.target.closest('button')) return;
  const targetId = header.dataset.target;
  const panel = document.getElementById(targetId);
  const acc = header.closest('.accordion');
  const isOpen = !panel.classList.contains('hidden');
  panel.classList.toggle('hidden', isOpen);
  acc.classList.toggle('open', !isOpen);
});

}

function bindOnce() {
  const root = document.querySelector('.section-pagos');
  if (!root) return;
  if (root.dataset.bound === '1') return;
  root.dataset.bound = '1';

  $('btnPagoAdd')?.addEventListener('click', openModal);
  $('btnPagoClose')?.addEventListener('click', closeModal);
  $('btnPagoCancel')?.addEventListener('click', closeModal);
  $('btnPagoSave')?.addEventListener('click', savePago);

$('btnIngresoAdd')?.addEventListener('click', openIngresoModal);
$('btnIngresoClose')?.addEventListener('click', closeIngresoModal);
$('btnIngresoCancel')?.addEventListener('click', closeIngresoModal);

$('formIngreso')?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  await saveIngreso();
});


  $('btnAbrirSelectorSocios')?.addEventListener('click', () => {
    $('modalElegirSocio')?.classList.remove('hidden');
    if ($('buscarSocioMini')) $('buscarSocioMini').value = '';
    renderSociosMini('');
  });

  $('btnElegirSocioClose')?.addEventListener('click', () => {
    $('modalElegirSocio')?.classList.add('hidden');
  });

  $('buscarSocioMini')?.addEventListener('input', (e) => {
    renderSociosMini(e.target.value);
  });

  $('pagosSearch')?.addEventListener('input', loadResumen);

  $('btnRefreshPagos')?.addEventListener('click', async () => {
    await loadResumen();
    await loadIngresos();
  });

  $('pagosAnioSelect')?.addEventListener('change', async (e) => {
    const y = Number(e.target.value);
    setSelectedYear(y);
    await loadResumen();
    await loadIngresos();
  });

  $('btnAnioPrev')?.addEventListener('click', async () => {
    setSelectedYear(selectedYear - 1);
    await refreshMesesPagados();
    renderMesesGrid();
    await loadResumen();
    await loadIngresos();
  });

  $('btnAnioNext')?.addEventListener('click', async () => {
    setSelectedYear(selectedYear + 1);
    await refreshMesesPagados();
    renderMesesGrid();
    await loadResumen();
    await loadIngresos();
  });

  $('pagosPagination')?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-page]');
    if (!btn) return;

    const action = btn.dataset.page;
    const total = pagosRowsAll.length;
    const totalPages = Math.ceil(total / PAGOS_PAGE_SIZE);
    if (!totalPages) return;

    if (action === 'prev' && pagosPageCurrent > 1) {
      pagosPageCurrent--;
      renderTablaPage();
    } else if (action === 'next' && pagosPageCurrent < totalPages) {
      pagosPageCurrent++;
      renderTablaPage();
    }
  });

$('pagosTableBody')?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act="details"]');
  if (!btn) return;

  const socioId = btn.dataset.id;
  if (!socioId) return;

  await openDetallesModal(socioId);
});

  const chkParcial = $('pagoParcialChk');
  const inpParcial = $('pagoParcialMonto');

  if (chkParcial) {
    chkParcial.addEventListener('change', () => {
      if (inpParcial) {
        inpParcial.disabled = !chkParcial.checked;
        if (!chkParcial.checked) inpParcial.value = '';
      }
      renderMontoHint();
    });
  }

  if (inpParcial) {
    inpParcial.addEventListener('input', () => {
      renderMontoHint();
    });
  }

$('detTableBody')?.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act="del-pago"]');
  if (!btn) return;

  const pagoId = btn.dataset.pagoId;
  const socioId = btn.dataset.socioId;
  await deletePagoMensual(pagoId, socioId);
});

$('btnDetClose')?.addEventListener('click', () => {
  closeDetallesUI();
});

$('btnDetOk')?.addEventListener('click', () => {
  closeDetallesUI();
});

$('modalPagoDetalles')?.addEventListener('click', (ev) => {
  if (ev.target?.id === 'modalPagoDetalles') closeDetallesUI();
});
}
  async function initPagosSection() {
  // Bind de eventos
  bindOnce();
  bindAccordion(); // acordeones (Pagos / Otros ingresos)

  // 🔹 FORZAR ESTADO INICIAL RETRAÍDO EN TODOS LOS ACORDEONES DE ESTA SECCIÓN
  document.querySelectorAll('.section-pagos .accordion-body').forEach(panel => {
    panel.classList.add('hidden');               // oculta el contenido
    const acc = panel.closest('.accordion');
    if (acc) acc.classList.remove('open');       // quita la clase "open" del acordeón
  });

  // Resto de la inicialización (igual que antes)
  fillAnios();
await Promise.all([
  loadSociosAll(),
  loadCuotas(),
  loadActividadesConfig(),
  loadActividadesAdicionales()   // 🔥 CLAVE
]);
  await loadResumen();

  // Ingresos (debajo)
await loadTiposIngreso().catch(() => {});   // no bloquear si aún no hay tipos
await loadIngresos().catch(() => {});

// Si venimos desde doble click en el ícono de pago de Socios,
// abrimos automáticamente el modal con ese socio seleccionado.
const pendingSocioId = localStorage.getItem('pendingOpenPagoSocioId');

if (pendingSocioId) {
  localStorage.removeItem('pendingOpenPagoSocioId');
  await openPagoForSocioId(pendingSocioId);
}
}

window.initPagosSection = initPagosSection;

document.addEventListener('DOMContentLoaded', () => {
  if (document.querySelector('.section-pagos')) {
    initPagosSection();
  }
});
})();