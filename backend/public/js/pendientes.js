(() => {
  const $ = (id) => document.getElementById(id);

  function getToken() {
    const t = localStorage.getItem('token');
    if (!t) {
      alert('Tu sesión expiró.');
      window.location.href = '/admin.html';
      throw new Error('No token');
    }
    return t;
  }

  function getActiveClubId() {
    const c = localStorage.getItem('activeClubId');
    if (!c) {
      alert('No hay club activo');
      window.location.href = '/club.html';
      throw new Error('No activeClubId');
    }
    return c;
  }

  async function fetchAuth(url, options = {}) {
    const headers = options.headers ?? {};
    headers['Authorization'] = 'Bearer ' + getToken();
    if (options.json) headers['Content-Type'] = 'application/json';

    const { json, ...rest } = options;
    const res = await fetch(url, { ...rest, headers });
    const data = await res.json().catch(() => ({
      ok: false,
      error: 'Respuesta inválida'
    }));
    return { res, data };
  }

  // =========================
// PENDIENTES SOCIOS (EXISTENTE)
// =========================
function renderSociosPendientes(items) {
  const tbody = $('pendientesTableBody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!items.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="muted">
          No hay postulaciones pendientes.
        </td>
      </tr>
    `;
    return;
  }

  items.forEach(p => {
    const tr = document.createElement('tr');
    tr.dataset.id = p.id;
    tr.dataset.tipo = p.tipo || 'alta';

    const tipoTxt = (p.tipo === 'foto')
      ? 'Actualización de foto'
      : (p.tipo === 'actualizacion')
        ? 'Actualizar Información'
        : 'Alta';

    // ✅ ACA ESTÁ LA CLAVE (faltaba esto)
    const fotoHtml = p.foto_url
      ? `<img 
           src="${p.foto_url}" 
           class="pend-mini" 
           style="cursor:pointer;" 
           onclick="window.open('${p.foto_url}','_blank')"
         />`
      : '—';

    tr.innerHTML = `
      <td>${fotoHtml}</td>
      <td><b>${p.apellido || ''} ${p.nombre || ''}</b></td>
      <td>${p.dni || ''}</td>
      <td>${tipoTxt}</td>
      <td>${p.actividad || ''}</td>
      <td>${p.categoria || ''}</td>
      <td>${p.telefono || ''}</td>
      <td style="white-space:nowrap;">
        <button class="btn-ok" data-act="accept">
          ${p.tipo === 'foto' ? 'Aplicar foto' : (p.tipo === 'actualizacion' ? 'Revisar cambios' : 'Aceptar')}
        </button>

        <button
          data-act="reject"
          style="background:#ef4444;border-color:#ef4444;color:#fff;padding:6px 12px;border-radius:8px;">
          Rechazar
        </button>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

  async function loadSociosPendientes() {
    const clubId = getActiveClubId();
    const { res, data } = await fetchAuth(`/club/${clubId}/pendientes`);
    if (!res.ok || !data.ok) {
      alert(data.error || 'Error cargando pendientes');
      return;
    }
    renderSociosPendientes(data.items || []);
  }

  // =========================
  // MODAL COMPARACIÓN (tipo='actualizacion')
  // =========================
  const CAMPOS_COMPARACION = [
    ['nombre', 'Nombre'],
    ['apellido', 'Apellido'],
    ['actividad', 'Actividad'],
    ['categoria', 'Categoría'],
    ['telefono', 'Teléfono'],
    ['email', 'Email'],
    ['direccion', 'Dirección'],
    ['ciudad', 'Ciudad'], // ✅ NUEVO
    ['provincia', 'Provincia'], // ✅ NUEVO
    ['fecha_nacimiento', 'Fecha de nacimiento'],
    ['obra_social', 'Obra social / Prepaga'], // ✅ NUEVO
    ['obra_social_numero', 'N° de afiliado'] // ✅ NUEVO
  ];

  function mostrarModalComparacion(pendiente, actual) {
    return new Promise((resolve) => {
      const overlay = $('modalComparacionOverlay');
      const body = $('modalComparacionBody');

      // Fallback por si el HTML del modal no está presente todavía
      if (!overlay || !body) {
        resolve(confirm('¿Confirmar la actualización de los datos del socio? El número de socio no cambia.'));
        return;
      }

      const filas = CAMPOS_COMPARACION.map(([key, label]) => {
        const valorActual = actual ? (actual[key] ?? '') : '';
        const valorNuevo = pendiente ? (pendiente[key] ?? '') : '';
        const distinto = String(valorActual || '').trim() !== String(valorNuevo || '').trim();

        return `
          <tr${distinto ? ' style="background:#fef9c3;"' : ''}>
            <td><b>${label}</b></td>
            <td>${valorActual || '—'}</td>
            <td style="text-align:center;">${distinto ? '➡️' : ''}</td>
            <td>${distinto ? `<b>${valorNuevo || '—'}</b>` : (valorNuevo || '—')}</td>
          </tr>
        `;
      }).join('');

      body.innerHTML = `
        <p class="muted" style="margin-top:0;">
          N° de socio <b>#${actual?.numero_socio ?? '—'}</b>. El número de socio se mantiene sin cambios.
        </p>
        <div class="table-wrapper">
          <table class="socios-table" style="width:100%;">
            <thead>
              <tr><th>Campo</th><th>Dato actual</th><th></th><th>Dato nuevo</th></tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>
        </div>
      `;

      overlay.style.display = 'flex';

      const btnConfirm = $('modalComparacionConfirm');
      const btnCancel = $('modalComparacionCancel');

      function cerrar(resultado) {
        overlay.style.display = 'none';
        btnConfirm.removeEventListener('click', onConfirm);
        btnCancel.removeEventListener('click', onCancel);
        resolve(resultado);
      }
      function onConfirm() { cerrar(true); }
      function onCancel() { cerrar(false); }

      btnConfirm.addEventListener('click', onConfirm);
      btnCancel.addEventListener('click', onCancel);
    });
  }

  // =========================
  // TRANSFERENCIAS PENDIENTES (NUEVO)
  // =========================
  function moneyArs(n) {
    try {
      return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(n || 0));
    } catch {
      return `$ ${n}`;
    }
  }

  function renderTransferPendientes(items) {
    const tbody = $('transferPendientesBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!items.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="muted">
            No hay transferencias pendientes.
          </td>
        </tr>
      `;
      return;
    }

items.forEach(t => {
      const tr = document.createElement('tr');
      tr.dataset.id = t.id;

      const socioLabel = `#${t.numero_socio ?? '—'} ${t.apellido ?? ''} ${t.nombre ?? ''}`.trim();
      const periodo = `${t.mes}/${t.anio}`;

      // Comprobante: si es una imagen, la mostramos como miniatura clickeable
      const esImagen = t.comprobante_url && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(t.comprobante_url);
      const comprobanteHtml = esImagen
        ? `<img src="${t.comprobante_url}" class="pend-mini" style="cursor:pointer;" onclick="window.open('${t.comprobante_url}','_blank')" />`
        : (t.comprobante_url
            ? `<a href="${t.comprobante_url}" target="_blank" rel="noopener">Ver</a>`
            : '—');

      // Detalle: qué está pagando (base/adicional) + si es parcial
      let detalleConceptos = '';
      try {
        const detalle = typeof t.detalle_pago === 'string' ? JSON.parse(t.detalle_pago) : t.detalle_pago;
        if (Array.isArray(detalle) && detalle.length) {
          detalleConceptos = detalle.map(c => c.nombre).join(', ');
        }
      } catch {}

      const parcialBadge = t.es_parcial
        ? `<span style="background:#f59e0b;color:#fff;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;">Parcial</span>`
        : '';

tr.innerHTML = `
  <td>${socioLabel}</td>
  <td>${periodo}</td>
  <td>${moneyArs(t.monto_esperado)} ${parcialBadge}</td>

  <td>${t.fecha_formateada || '—'}</td>

  <td>${comprobanteHtml}</td>

  <td>
    <div><b>Concepto:</b> ${detalleConceptos || '—'}</div>
    <div><b>Cuenta origen:</b> ${t.cuenta_origen || '—'}</div>
    ${t.comentario ? `<div><b>Comentario:</b> ${t.comentario}</div>` : ''}
    ${t.comprobante_texto ? `<div><b>Nota:</b> ${t.comprobante_texto}</div>` : ''}
  </td>

  <td style="white-space:nowrap;">
    <button class="btn-ok" data-act="t_confirm">
      Aceptar
    </button>

    <button class="btn btn-secondary"
            data-act="t_reject"
            style="background:#ef4444;border-color:#ef4444;color:#fff;">
      Rechazar
    </button>
  </td>
`;

      tbody.appendChild(tr);
    });
  }

  async function loadTransferPendientes() {
    const clubId = getActiveClubId();
    // Solo mostramos transferencias con comprobante ya enviado por el socio
    // (estado 'comprobante_subido'). El estado 'iniciado' se crea apenas el
    // socio toca "Informar transferencia realizada" (antes de completar el
    // formulario y tocar "Enviar"), y todavía no tiene cuenta de origen ni
    // conceptos declarados, así que no debe aparecer acá como algo para
    // Aceptar/Rechazar.
    const { res, data } = await fetchAuth(`/club/${clubId}/payments/transfer/pending?estado=comprobante_subido`);
    if (!res.ok || !data.ok) {
      console.warn('No se pudieron cargar transferencias:', data.error);
      renderTransferPendientes([]);
      return;
    }
    renderTransferPendientes(data.items || []);
  }

  // =========================
  // RESERVAS DE TIENDA (NUEVO)
  // =========================
  function escapeHtmlPend(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function formatDateISOToDMY_pend(iso) {
    if (!iso) return '';
    const s = String(iso).slice(0, 10);
    const [y, m, d] = s.split('-');
    if (!y || !m || !d) return s;
    return `${d}/${m}/${y}`;
  }

  function reservaImgHtml(r) {
    return r.producto_imagen_url
      ? `<img src="${escapeHtmlPend(r.producto_imagen_url)}" class="pend-mini" style="cursor:pointer;" onclick="window.open('${escapeHtmlPend(r.producto_imagen_url)}','_blank')" />`
      : '—';
  }

  function reservaSocioLabel(r) {
    if (!r.socio_id) {
      return r.nombre_referencia ? `${escapeHtmlPend(r.nombre_referencia)} (no socio)` : 'No socio';
    }
    return `#${r.numero_socio ?? '—'} ${escapeHtmlPend(r.socio_apellido ?? '')} ${escapeHtmlPend(r.socio_nombre ?? '')}`.trim();
  }

  // ✅ Cuántas líneas comparten cada pedido_id (carrito con varios
  // productos) — se usa SOLO para mostrar un badge de contexto ("Pedido con
  // N productos"). La gestión (aceptar/rechazar/retirar/pago/eliminar) es
  // individual por línea, así que esto ya no afecta qué botones o inputs
  // se muestran.
  function contarLineasPorPedido(items) {
    const mapa = new Map();
    items.forEach(r => mapa.set(r.pedido_id, (mapa.get(r.pedido_id) || 0) + 1));
    return mapa;
  }

  function renderReservasTiendaPendientes(items) {
    const tbody = $('reservasTiendaPendientesBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="muted">No hay reservas de tienda pendientes.</td></tr>`;
      return;
    }

    const lineasPorPedido = contarLineasPorPedido(items);

    items.forEach(r => {
      const tr = document.createElement('tr');
      // ✅ Gestión individual por línea: se usa el id de la reserva (no el
      // pedido_id) como identificador de la fila. Aceptar/rechazar actúan
      // solo sobre este producto, aunque haya venido de un carrito con
      // varios productos.
      tr.dataset.id = r.id;

      const cantidadPedida = Number(r.cantidad) || 1;
      const esCarritoMultiple = (lineasPorPedido.get(r.pedido_id) || 1) > 1;
      const nombreConTalle = r.talle
        ? `${escapeHtmlPend(r.producto_nombre)} <span class="muted">(talle ${escapeHtmlPend(r.talle)})</span>`
        : escapeHtmlPend(r.producto_nombre);
      const badgePedido = esCarritoMultiple
        ? `<div style="font-size:10.5px; color:#2563eb; margin-top:2px;">🛒 Parte de un pedido con varios productos — se gestiona por separado</div>`
        : '';

      const cantidadHtml = `
        <input type="number" class="tw-cantidad-entregar" data-cantidad-original="${cantidadPedida}"
               min="1" max="${cantidadPedida}" step="1" value="${cantidadPedida}"
               style="width:64px; padding:5px 6px; border-radius:8px; border:1px solid #ccc; font-size:13px;">
        <div style="font-size:10.5px; color:#6b7280; margin-top:2px;">de ${cantidadPedida} pedidas</div>
      `;

      tr.innerHTML = `
        <td>${reservaImgHtml(r)}</td>
        <td><b>${nombreConTalle}</b>${badgePedido}</td>
        <td>${reservaSocioLabel(r)}</td>
        <td>${cantidadHtml}</td>
        <td>${formatDateISOToDMY_pend(r.created_at)}</td>
        <td style="white-space:nowrap;">
          <button class="btn-ok" data-act="r_aceptar">Aceptar</button>
          <button data-act="r_rechazar" style="background:#ef4444;border-color:#ef4444;color:#fff;padding:6px 12px;border-radius:8px;">Rechazar</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ✅ NUEVO: estado de pago de una reserva de tienda.
  const ESTADOS_PAGO = [
    ['sin_pago', 'Falta de pago'],
    ['parcial', 'Adelanto / seña'],
    ['pagado', 'Pago completo'],
  ];

  function moneyArsCompacto(n) {
    return moneyArs(n); // ya definido más arriba en este archivo
  }

  function pagoLabelTexto(estadoPago, monto, formaPago) {
    if (estadoPago === 'parcial') {
      const cuentaTxt = formaPago ? ` · ${formaPago}` : '';
      return `Abonado: ${moneyArsCompacto(monto)}${cuentaTxt}`;
    }
    if (estadoPago === 'pagado') {
      return formaPago ? `Pagado · ${formaPago}` : 'Pagado';
    }
    return '';
  }

  function estadoPagoSelectHtml(r) {
    const actual = r.estado_pago || 'sin_pago';
    const monto = Number(r.monto_pagado || 0);
    const opciones = ESTADOS_PAGO
      .map(([val, label]) => `<option value="${val}"${val === actual ? ' selected' : ''}>${label}</option>`)
      .join('');
    const textoLabel = pagoLabelTexto(actual, monto, r.forma_pago);
    const montoLabelHtml = textoLabel
      ? `<div class="tw-monto-pagado-label">${escapeHtmlPend(textoLabel)}</div>`
      : '';
    return `
      <select class="tw-estado-pago-select" data-act="r_estado_pago" data-estado="${actual}" data-monto="${monto}">
        ${opciones}
      </select>
      ${montoLabelHtml}
    `;
  }

  // ✅ NUEVO: modal que pide el monto (solo para "parcial") y siempre la
  // cuenta / forma de pago (misma lista que se usa para cargar un pago de
  // cuota o un ingreso general: /club/:clubId/config/responsables).
  // Devuelve { monto, cuentaId } o null si el admin canceló.
  function pedirDetallePago({ clubId, requiereMonto, montoSugerido }) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('modalEstadoPagoOverlay');
      if (!overlay) {
        const monto = requiereMonto ? prompt('Monto abonado:', montoSugerido || '') : null;
        if (requiereMonto && monto === null) return resolve(null);
        resolve({ monto: requiereMonto ? Number(monto) : null, cuentaId: null });
        return;
      }

      const montoWrap = document.getElementById('modalEstadoPagoMontoWrap');
      const montoInput = document.getElementById('modalEstadoPagoMonto');
      const cuentaSelect = document.getElementById('modalEstadoPagoCuenta');
      const btnConfirm = document.getElementById('modalEstadoPagoConfirm');
      const btnCancel = document.getElementById('modalEstadoPagoCancel');

      montoWrap.style.display = requiereMonto ? '' : 'none';
      montoInput.value = montoSugerido || '';
      cuentaSelect.innerHTML = '<option value="">Cargando cuentas...</option>';

      overlay.style.display = 'flex';

      fetchAuth(`/club/${clubId}/config/responsables`).then(({ res, data }) => {
        const cuentas = (res.ok && data.ok) ? (data.responsables || []) : [];
        cuentaSelect.innerHTML = cuentas.length
          ? cuentas.map(c => `<option value="${c.id}">${escapeHtmlPend(c.nombre)}</option>`).join('')
          : '<option value="">(no hay cuentas configuradas)</option>';
      });

      function cerrar(resultado) {
        overlay.style.display = 'none';
        btnConfirm.removeEventListener('click', onConfirm);
        btnCancel.removeEventListener('click', onCancel);
        resolve(resultado);
      }

      function onConfirm() {
        if (!cuentaSelect.value) {
          alert('Seleccioná la cuenta / forma de pago.');
          return;
        }
        if (requiereMonto) {
          const montoNum = Number(String(montoInput.value).replace(',', '.'));
          if (!Number.isFinite(montoNum) || montoNum <= 0) {
            alert('Ingresá un monto válido, mayor a 0.');
            return;
          }
          cerrar({ monto: montoNum, cuentaId: cuentaSelect.value });
        } else {
          cerrar({ monto: null, cuentaId: cuentaSelect.value });
        }
      }
      function onCancel() { cerrar(null); }

      btnConfirm.addEventListener('click', onConfirm);
      btnCancel.addEventListener('click', onCancel);
    });
  }

  // ✅ NUEVO: maneja el cambio de estado de pago. Para "Adelanto / seña" y
  // "Pago completo" pide, con un modal, el monto (solo para seña) y siempre
  // la cuenta / forma de pago (mismo contrato que tienda.js).
  async function manejarCambioEstadoPago(select) {
    const tr = select.closest('tr');
    const rowId = tr?.dataset?.id;
    if (!rowId) return;

    const clubId = getActiveClubId();
    const nuevoEstado = select.value;
    const estadoAnterior = select.dataset.estado;
    const montoAnterior = select.dataset.monto || '0';

    const body = { estado_pago: nuevoEstado };

    if (nuevoEstado === 'parcial' || nuevoEstado === 'pagado') {
      const detalle = await pedirDetallePago({
        clubId,
        requiereMonto: nuevoEstado === 'parcial',
        montoSugerido: montoAnterior && montoAnterior !== '0' ? montoAnterior : '',
      });
      if (!detalle) {
        select.value = estadoAnterior;
        return;
      }
      if (nuevoEstado === 'parcial') body.monto_pagado = detalle.monto;
      body.cuenta_id = detalle.cuentaId;
    }

    const { res, data } = await fetchAuth(
      `/club/${clubId}/tienda/reservas/${rowId}/estado-pago`,
      { method: 'PATCH', json: true, body: JSON.stringify(body) }
    );

    if (!res.ok || !data.ok) {
      alert(data.error || 'Error actualizando el estado de pago');
      select.value = estadoAnterior;
      return;
    }

    // ✅ Cobro individual por producto: esta reserva (línea) es la única
    // afectada, así que solo actualizamos su propio select/label.
    const reservaActualizada = data.reserva;

    select.value = reservaActualizada.estado_pago;
    select.dataset.estado = reservaActualizada.estado_pago;
    select.dataset.monto = String(reservaActualizada.monto_pagado ?? 0);

    const wrapper = select.parentElement;
    const labelPrevio = wrapper?.querySelector('.tw-monto-pagado-label');
    if (labelPrevio) labelPrevio.remove();
    const textoLabel = pagoLabelTexto(reservaActualizada.estado_pago, reservaActualizada.monto_pagado, reservaActualizada.forma_pago);
    if (textoLabel) {
      const div = document.createElement('div');
      div.className = 'tw-monto-pagado-label';
      div.textContent = textoLabel;
      select.insertAdjacentElement('afterend', div);
    }
  }

  function renderReservasTiendaARetirar(items) {
    const tbody = $('reservasTiendaARetirarBody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="muted">No hay reservas esperando retiro.</td></tr>`;
      return;
    }

    const lineasPorPedido = contarLineasPorPedido(items);

    items.forEach(r => {
      const tr = document.createElement('tr');
      // ✅ "Marcar retirado" ya no se bloquea por falta de pago (se puede
      // entregar igual, con aviso — ver el click handler más abajo).
      // Gestión individual por línea: se usa el id de la reserva, no el
      // pedido_id — el botón entrega solo este producto.
      tr.dataset.id = r.id;

      const esCarritoMultiple = (lineasPorPedido.get(r.pedido_id) || 1) > 1;
      const nombreConTalle = r.talle
        ? `${escapeHtmlPend(r.producto_nombre)} <span class="muted">(talle ${escapeHtmlPend(r.talle)})</span>`
        : escapeHtmlPend(r.producto_nombre);
      const badgePedido = esCarritoMultiple
        ? `<div style="font-size:10.5px; color:#2563eb; margin-top:2px;">🛒 Parte de un pedido con varios productos — se gestiona por separado</div>`
        : '';

      tr.innerHTML = `
        <td>${reservaImgHtml(r)}</td>
        <td><b>${nombreConTalle}</b>${badgePedido}</td>
        <td>${reservaSocioLabel(r)}</td>
        <td>${escapeHtmlPend(r.cantidad)}</td>
        <td>${estadoPagoSelectHtml(r)}</td>
        <td>${escapeHtmlPend(r.mensaje_admin || '—')}</td>
        <td style="white-space:nowrap;">
          <button class="btn-ok" data-act="r_retirado">Marcar retirado</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function loadReservasTienda() {
    const wrapper = $('tiendaReservasWrapper');
    if (!wrapper) return;

    // Solo mostramos este bloque si el club tiene Tienda Online habilitada.
    const habilitada = window.currentClub?.tienda_habilitada === true;
    wrapper.style.display = habilitada ? '' : 'none';
    if (!habilitada) return;

    const clubId = getActiveClubId();

    const { res: resPend, data: dataPend } = await fetchAuth(`/club/${clubId}/tienda/reservas?estado=pendiente`);
    if (!resPend.ok || !dataPend.ok) {
      console.warn('No se pudieron cargar las reservas de tienda pendientes:', dataPend.error);
      renderReservasTiendaPendientes([]);
    } else {
      renderReservasTiendaPendientes(dataPend.reservas || []);
    }

    const { res: resAcept, data: dataAcept } = await fetchAuth(`/club/${clubId}/tienda/reservas?estado=aceptada`);
    if (!resAcept.ok || !dataAcept.ok) {
      console.warn('No se pudieron cargar las reservas de tienda a retirar:', dataAcept.error);
      renderReservasTiendaARetirar([]);
    } else {
      renderReservasTiendaARetirar(dataAcept.reservas || []);
    }
  }

  // =========================
  // EVENTOS / ACCIONES (UNA SOLA VEZ)
  // =========================
  function bindOnce() {
    const root = document.getElementById('pendientes-section');
    if (!root || root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    // ✅ NUEVO: cambio de estado de pago (select) en la tabla "a retirar"
    root.addEventListener('change', async (ev) => {
      const select = ev.target.closest('select[data-act="r_estado_pago"]');
      if (!select) return;
      await manejarCambioEstadoPago(select);
    });

    // Clicks en ambas tablas dentro de la sección
    root.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;

      const tr = btn.closest('tr');
      const rowId = tr?.dataset?.id;
      if (!rowId) return;

      const clubId = getActiveClubId();

      // ======= SOCIOS PENDIENTES =======
      if (btn.dataset.act === 'accept') {
        const tipo = tr.dataset.tipo || 'alta';

        // Actualización de datos de un socio existente: primero mostramos
        // la comparación de datos actuales vs nuevos y pedimos confirmación explícita.
        if (tipo === 'actualizacion') {
          const { res: resCmp, data: cmp } = await fetchAuth(
            `/club/${clubId}/pendientes/${rowId}/comparar`
          );

          if (!resCmp.ok || !cmp.ok) {
            alert(cmp.error || 'No se pudo obtener la comparación de datos');
            return;
          }

          const confirmado = await mostrarModalComparacion(cmp.pendiente, cmp.actual);
          if (!confirmado) return;

          const { res, data } = await fetchAuth(
            `/club/${clubId}/pendientes/${rowId}/aceptar`,
            { method: 'POST' }
          );

          if (!res.ok || !data.ok) {
            alert(data.error || 'Error actualizando los datos del socio');
            return;
          }

          alert(`✅ Datos actualizados. Socio N° ${data.numero_socio}`);
          await loadSociosPendientes();
          window.actualizarBadgePendientes?.();
          return;
        }

        const msg = (tipo === 'foto')
          ? '¿Aceptar solicitud y actualizar la foto del socio?'
          : '¿Aceptar postulación y crear socio?';

        if (!confirm(msg)) return;

        const { res, data } = await fetchAuth(
          `/club/${clubId}/pendientes/${rowId}/aceptar`,
          { method: 'POST' }
        );

        if (!res.ok || !data.ok) {
          alert(data.error || 'Error aceptando');
          return;
        }

        if (data.modo === 'foto') {
          alert(`✅ Foto actualizada. Socio N° ${data.numero_socio}`);
        } else {
          alert(`✅ Aceptado. Socio N° ${data.numero_socio}`);
        }

await loadSociosPendientes();
        window.actualizarBadgePendientes?.();
        return;
      }

      if (btn.dataset.act === 'reject') {
        const motivo = prompt('Motivo de rechazo (opcional):') || null;

        const { res, data } = await fetchAuth(
          `/club/${clubId}/pendientes/${rowId}/rechazar`,
          {
            method: 'POST',
            json: true,
            body: JSON.stringify({ motivo })
          }
        );

        if (!res.ok || !data.ok) {
          alert(data.error || 'Error rechazando');
          return;
        }

        alert('✅ Rechazado');
await loadSociosPendientes();
        window.actualizarBadgePendientes?.();
        return;
      }

      // ======= TRANSFERENCIAS =======
      if (btn.dataset.act === 't_confirm') {
        if (!confirm('¿Confirmar esta transferencia y generar el recibo?')) return;

        const { res, data } = await fetchAuth(
          `/club/${clubId}/payments/transfer/${rowId}/confirm`,
          {
            method: 'POST',
            json: true,
            body: JSON.stringify({
              fecha_pago: new Date().toISOString().slice(0, 10)
            })
          }
        );

        if (!res.ok || !data.ok) {
          alert(data.error || 'Error confirmando transferencia');
          return;
        }

        alert('✅ Transferencia confirmada y recibo generado');
        await loadTransferPendientes();
        return;
      }

      if (btn.dataset.act === 't_reject') {
        const motivo = prompt('Motivo de rechazo (opcional):') || '';

        const { res, data } = await fetchAuth(
          `/club/${clubId}/payments/transfer/${rowId}/reject`,
          {
            method: 'POST',
            json: true,
            body: JSON.stringify({ motivo })
          }
        );

        if (!res.ok || !data.ok) {
          alert(data.error || 'Error rechazando transferencia');
          return;
        }

        alert('✅ Transferencia rechazada');
        await loadTransferPendientes();
        return;
      }

      // ======= RESERVAS DE TIENDA =======
      if (btn.dataset.act === 'r_aceptar') {
        // ✅ Gestión individual por línea/producto: el admin puede reducir la
        // cantidad a entregar de este producto puntual (ej: pidió 2 y solo
        // hay/entregan 1). Lo que se resta vuelve al stock del producto. Si
        // el producto vino de un carrito con varios, los demás productos
        // del mismo pedido se aceptan/rechazan por separado.
        const inputCantidad = tr.querySelector('.tw-cantidad-entregar');
        const body = { mensaje: prompt('Mensaje para el socio (opcional):') || null };
        let cantidadAEntregar = null;
        let cantidadOriginal = null;

        if (inputCantidad) {
          cantidadOriginal = Number(inputCantidad.dataset.cantidadOriginal || 1);
          cantidadAEntregar = Number(inputCantidad.value);
          if (!Number.isInteger(cantidadAEntregar) || cantidadAEntregar < 1 || cantidadAEntregar > cantidadOriginal) {
            alert(`Ingresá una cantidad entre 1 y ${cantidadOriginal}.`);
            return;
          }
          body.cantidad = cantidadAEntregar;
        }

        const { res, data } = await fetchAuth(
          `/club/${clubId}/tienda/reservas/${rowId}/aceptar`,
          { method: 'POST', json: true, body: JSON.stringify(body) }
        );

        if (!res.ok || !data.ok) {
          alert(data.error || 'Error aceptando el producto');
          return;
        }

        if (cantidadAEntregar !== null && cantidadAEntregar < cantidadOriginal) {
          alert(`✅ Producto aceptado por ${cantidadAEntregar} de ${cantidadOriginal} unidades. La diferencia (${cantidadOriginal - cantidadAEntregar}) volvió al stock.`);
        } else {
          alert('✅ Producto aceptado.');
        }
        await loadReservasTienda();
        return;
      }

      if (btn.dataset.act === 'r_rechazar') {
        const mensaje = prompt('Motivo del rechazo (opcional, se le muestra al socio):') || null;

        const { res, data } = await fetchAuth(
          `/club/${clubId}/tienda/reservas/${rowId}/rechazar`,
          { method: 'POST', json: true, body: JSON.stringify({ mensaje }) }
        );

        if (!res.ok || !data.ok) {
          alert(data.error || 'Error rechazando el producto');
          return;
        }

        alert('✅ Producto rechazado');
        await loadReservasTienda();
        return;
      }

      if (btn.dataset.act === 'r_retirado') {
        // ✅ Se permite entregar aunque no esté pagado, pero se avisa antes
        // con un texto explícito (la deuda queda visible en el historial
        // gracias a estado_pago). Gestión individual por línea/producto.
        const selectPago = tr.querySelector('select.tw-estado-pago-select');
        const estadoPagoActual = selectPago?.dataset?.estado || 'sin_pago';

        const mensajeConfirm = estadoPagoActual === 'pagado'
          ? '¿Confirmar que se retiró este producto del club?'
          : '⚠️ Este producto todavía NO está pagado por completo. ¿Confirmás igual la entrega? Va a quedar marcado como retirado con el pago pendiente.';

        if (!confirm(mensajeConfirm)) return;

        const { res, data } = await fetchAuth(
          `/club/${clubId}/tienda/reservas/${rowId}/retirado`,
          { method: 'POST' }
        );

        if (!res.ok || !data.ok) {
          alert(data.error || 'Error marcando el producto como retirado');
          return;
        }

        alert('✅ Producto marcado como retirado');
        await loadReservasTienda();
        return;
      }
    });
  }

  // =========================
  // INIT
  // =========================
  async function initPendientesSection() {
    bindOnce();
    await loadSociosPendientes();
    await loadTransferPendientes();
    await loadReservasTienda();
  }

  window.initPendientesSection = initPendientesSection;

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('pendientes-section')) {
      initPendientesSection();
    }
  });
})();