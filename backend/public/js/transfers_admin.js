(function () {
  const token = () => localStorage.getItem('token') || '';

  const qs = (id) => document.getElementById(id);

  const msgBox = qs('transferMsg');
  const body = qs('transferTableBody');
  const btnReload = qs('btnReloadTransfers');
  const selEstado = qs('trEstado');

  if (!body || !btnReload || !selEstado) return;

  function money(n) {
    try {
      return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(n || 0));
    } catch {
      return `$ ${n}`;
    }
  }

  function showMsg(ok, text) {
    msgBox.className = 'msg ' + (ok ? 'ok' : 'err');
    msgBox.textContent = text;
  }

  async function apiGetPending() {
    const estado = selEstado.value || 'all';
    const url = `/admin/payments/transfer/pending?estado=${encodeURIComponent(estado)}&limit=150&offset=0`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token()}` }
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `Error HTTP ${res.status}`);
    }
    return data.items || [];
  }

  async function apiConfirm(item) {
    const res = await fetch('/admin/payments/transfer/confirm', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        club_id: item.club_id,
        socio_id: item.socio_id,
        anio: item.anio,
        mes: item.mes
      })
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `Error HTTP ${res.status}`);
    }
    return data;
  }

  async function apiReject(transferenciaId) {
    const motivo = prompt('Motivo de rechazo (opcional):') || '';

    const res = await fetch('/admin/payments/transfer/reject', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        transferencia_id: transferenciaId,
        motivo
      })
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `Error HTTP ${res.status}`);
    }
    return data;
  }

  function render(items) {
    body.innerHTML = '';

    if (!items.length) {
      body.innerHTML = `<tr><td colspan="8" style="color:#6b7280; padding:12px;">No hay transferencias pendientes.</td></tr>`;
      return;
    }

    for (const it of items) {
      const socioLabel = `#${it.socio_numero ?? '—'} ${it.socio_apellido ?? ''} ${it.socio_nombre ?? ''}`.trim();
      const comprobante = it.comprobante_url
        ? `<a href="${it.comprobante_url}" target="_blank" rel="noopener">Ver</a>`
        : (it.comprobante_texto ? 'Texto' : '—');

      const estadoTxt = it.estado === 'comprobante_subido' ? 'Con comprobante' : 'Iniciada';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${it.club_nombre ?? '—'}</td>
        <td>${socioLabel}</td>
        <td>${it.mes_label ?? `${it.mes}/${it.anio}`}</td>
        <td>${money(it.monto_esperado)}</td>
        <td style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">
          ${it.referencia ?? '—'}
        </td>
        <td>${estadoTxt}</td>
        <td>${comprobante}</td>
        <td>
          <button class="primary" data-action="confirm">Confirmar</button>
          <button data-action="reject" style="margin-left:8px;">Rechazar</button>
        </td>
      `;

      tr.querySelector('[data-action="confirm"]').addEventListener('click', async () => {
        try {
          showMsg(true, 'Confirmando...');
          await apiConfirm(it);
          showMsg(true, 'Confirmado ✅');
          await load();
        } catch (e) {
          showMsg(false, String(e));
        }
      });

      tr.querySelector('[data-action="reject"]').addEventListener('click', async () => {
        try {
          showMsg(true, 'Rechazando...');
          await apiReject(it.id);
          showMsg(true, 'Rechazado ✅');
          await load();
        } catch (e) {
          showMsg(false, String(e));
        }
      });

      body.appendChild(tr);
    }
  }

  async function load() {
    try {
      showMsg(true, 'Cargando...');
      const items = await apiGetPending();
      render(items);
      showMsg(true, `Listo: ${items.length} transferencias`);
    } catch (e) {
      showMsg(false, `Error: ${e}`);
    }
  }

  btnReload.addEventListener('click', load);
  selEstado.addEventListener('change', load);

  // Carga inicial
  load();
})();