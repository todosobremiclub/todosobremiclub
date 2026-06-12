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

      const tipoTxt = (p.tipo === 'foto')
        ? 'Actualización de foto'
        : 'Alta';

      tr.innerHTML = `
        <td>
          <img class="pend-mini"
               src="${p.foto_url || '/img/user-placeholder.png'}"
               onerror="this.src='/img/user-placeholder.png'"/>
        </td>
        <td><b>${p.apellido || ''} ${p.nombre || ''}</b></td>
        <td>${p.dni || ''}</td>
        <td>${tipoTxt}</td>
        <td>${p.actividad || ''}</td>
        <td>${p.categoria || ''}</td>
        <td>${p.telefono || ''}</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-primary" data-act="accept">
            ${p.tipo === 'foto' ? 'Aplicar foto' : 'Aceptar'}
          </button>
          <button class="btn btn-secondary"
                  data-act="reject"
                  style="background:#ef4444;border-color:#ef4444;color:#fff;">
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
      const estadoTxt = (t.estado === 'comprobante_subido') ? 'Con comprobante' : 'Iniciada';

      const comprobanteHtml = t.comprobante_url
        ? `<a href="${t.comprobante_url}" target="_blank" rel="noopener">Ver</a>`
        : (t.comprobante_texto ? 'Texto' : '—');

      tr.innerHTML = `
  <td>${socioLabel}</td>
  <td>${periodo}</td>
  <td>${moneyArs(t.monto_esperado)}</td>

  <td style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">
    ${t.referencia || '—'}
  </td>

  <td>${t.fecha_formateada || '—'}</td>

  <td>
    ${t.comprobante_texto ? t.comprobante_texto : '—'}
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
    const { res, data } = await fetchAuth(`/club/${clubId}/payments/transfer/pending?estado=all`);
    if (!res.ok || !data.ok) {
      console.warn('No se pudieron cargar transferencias:', data.error);
      renderTransferPendientes([]);
      return;
    }
    renderTransferPendientes(data.items || []);
  }

  // =========================
  // EVENTOS / ACCIONES (UNA SOLA VEZ)
  // =========================
  function bindOnce() {
    const root = document.getElementById('pendientes-section');
    if (!root || root.dataset.bound === '1') return;
    root.dataset.bound = '1';

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
        const tipo = btn.textContent.toLowerCase().includes('foto') ? 'foto' : 'alta';
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
    });
  }

  // =========================
  // INIT
  // =========================
  async function initPendientesSection() {
    bindOnce();
    await loadSociosPendientes();
    await loadTransferPendientes();
  }

  window.initPendientesSection = initPendientesSection;

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('pendientes-section')) {
      initPendientesSection();
    }
  });
})();