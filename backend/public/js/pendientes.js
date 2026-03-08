(() => {
  const $ = (id) => document.getElementById(id);

  function getToken() {
    const t = localStorage.getItem('token');
    if (!t) { alert('Tu sesión expiró.'); window.location.href='/admin.html'; throw new Error('No token'); }
    return t;
  }
  function getActiveClubId() {
    const c = localStorage.getItem('activeClubId');
    if (!c) { alert('No hay club activo'); window.location.href='/club.html'; throw new Error('No activeClubId'); }
    return c;
  }

  async function fetchAuth(url, options = {}) {
    const headers = options.headers ?? {};
    headers['Authorization'] = 'Bearer ' + getToken();
    if (options.json) headers['Content-Type'] = 'application/json';
    const { json, ...rest } = options;
    const res = await fetch(url, { ...rest, headers });
    const data = await res.json().catch(()=>({ok:false, error:'Respuesta inválida'}));
    return { res, data };
  }

  function render(items){
    const tbody = $('pendientesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!items.length){
      tbody.innerHTML = `<tr><td colspan="7" class="muted">No hay postulaciones pendientes.</td></tr>`;
      return;
    }

    items.forEach(p => {
      const tr = document.createElement('tr');
      tr.dataset.id = p.id;
      tr.innerHTML = `
        <td><img class="pend-mini" src="${p.foto_url || '/img/user-placeholder.png'}" onerror="this.src='/img/user-placeholder.png'"/></td>
        <td><b>${p.apellido || ''} ${p.nombre || ''}</b></td>
        <td>${p.dni || ''}</td>
        <td>${p.actividad || ''}</td>
        <td>${p.categoria || ''}</td>
        <td>${p.telefono || ''}</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-primary" data-act="accept">Aceptar</button>
          <button class="btn btn-secondary" data-act="reject" style="background:#ef4444;border-color:#ef4444;color:#fff;">Rechazar</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  async function load(){
    const clubId = getActiveClubId();
    const { res, data } = await fetchAuth(`/club/${clubId}/pendientes`);
    if (!res.ok || !data.ok) { alert(data.error || 'Error cargando pendientes'); return; }
    render(data.items || []);
  }

  function bindOnce(){
    const root = document.getElementById('pendientes-section');
    if (!root || root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    $('pendientesTableBody')?.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-act]');
      if (!btn) return;
      const tr = btn.closest('tr');
      const id = tr?.dataset?.id;
      if (!id) return;

      const clubId = getActiveClubId();

      if (btn.dataset.act === 'accept'){
        if (!confirm('¿Aceptar postulación y crear socio?')) return;
        const { res, data } = await fetchAuth(`/club/${clubId}/pendientes/${id}/aceptar`, { method:'POST' });
        if (!res.ok || !data.ok) { alert(data.error || 'Error aceptando'); return; }
        alert(`✅ Aceptado. Socio N° ${data.numero_socio}`);
        await load();
        return;
      }

      if (btn.dataset.act === 'reject'){
        const motivo = prompt('Motivo de rechazo (opcional):') || null;
        const { res, data } = await fetchAuth(`/club/${clubId}/pendientes/${id}/rechazar`, {
          method:'POST',
          json:true,
          body: JSON.stringify({ motivo })
        });
        if (!res.ok || !data.ok) { alert(data.error || 'Error rechazando'); return; }
        alert('✅ Rechazado');
        await load();
      }
    });
  }

  async function initPendientesSection(){
    bindOnce();
    await load();
  }

  window.initPendientesSection = initPendientesSection;

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('pendientes-section')) initPendientesSection();
  });
})();