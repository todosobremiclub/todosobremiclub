(() => {
  const $ = (id) => document.getElementById(id);

  function token() {
    const t = localStorage.getItem('token');
    if (!t) { window.location.href = '/admin.html'; throw new Error('No token'); }
    return t;
  }
  function activeClubId() {
    const c = localStorage.getItem('activeClubId');
    if (!c) { alert('Seleccioná un club primero'); window.location.href = '/club.html'; throw new Error('No club'); }
    return c;
  }
  async function api(path, opt = {}) {
    const headers = opt.headers || {};
    headers['Authorization'] = 'Bearer ' + token();
    if (opt.json) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, { ...opt, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error API');
    return data;
  }

  async function loadCategoriasIntoSelect() {
    // por ahora categorías salen desde socios existentes (hasta que armemos Configuración)
    const clubId = activeClubId();
    const data = await api(`/club/${clubId}/socios`);
    const cats = [...new Set((data.socios || []).map(s => s.categoria))].filter(Boolean).sort();

    const sel = $('filtroCategoria');
    if (!sel) return;
    sel.innerHTML = `<option value="">Todas las categorías</option>`;
    cats.forEach(c => {
      const o = document.createElement('option');
      o.value = c; o.textContent = c;
      sel.appendChild(o);
    });
  }

  function renderRows(socios) {
    const tbody = $('tablaSociosBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    socios.forEach(s => {
      const tr = document.createElement('tr');
      const pagoDot = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#999"></span>`; // estado pago se calcula luego con Pagos
      tr.innerHTML = `
        <td>${pagoDot}</td>
        <td>${s.numero_socio}</td>
        <td>${s.dni}</td>
        <td>${s.nombre}</td>
        <td>${s.apellido}</td>
        <td>${s.categoria}</td>
        <td>${s.telefono || ''}</td>
        <td>${(s.fecha_nacimiento || '').slice(0,10)}</td>
        <td>${s.anio_nacimiento ?? ''}</td>
        <td>${(s.fecha_ingreso || '').slice(0,10)}</td>
        <td><input type="checkbox" disabled ${s.activo ? 'checked':''}></td>
        <td><input type="checkbox" disabled ${s.becado ? 'checked':''}></td>
        <td>${s.foto_url ? `<img src="${s.foto_url}" style="width:34px;height:34px;object-fit:cover;border-radius:6px;">` : '—'}</td>
        <td>
          <button data-act="edit" data-id="${s.id}">✏️</button>
          <button data-act="del" data-id="${s.id}">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    const count = socios.filter(x => x.activo).length;
    const lbl = $('sociosActivosLabel');
    if (lbl) lbl.textContent = `Socios activos: ${count}`;
  }

  async function loadSocios() {
    const clubId = activeClubId();
    const q = new URLSearchParams();

    const search = $('searchBox')?.value?.trim() || '';
    const cat = $('filtroCategoria')?.value || '';
    const anio = $('filtroAnio')?.value || '';
    const verInactivos = $('chkInactivos')?.checked;

    if (search) q.set('search', search);
    if (cat) q.set('categoria', cat);
    if (anio) q.set('anio', anio);

    // si NO tildó ver inactivos => activo=1
    if (!verInactivos) q.set('activo', '1');

    const data = await api(`/club/${clubId}/socios?` + q.toString());
    renderRows(data.socios || []);
  }

  async function crearSocio() {
    const clubId = activeClubId();
    const payload = {
      // numero_socio opcional: si no lo mandás, el backend lo asigna
      numero_socio: $('nuevoNumero')?.value ? Number($('nuevoNumero').value) : null,
      dni: $('nuevoDni').value.trim(),
      nombre: $('nuevoNombre').value.trim(),
      apellido: $('nuevoApellido').value.trim(),
      telefono: $('nuevoTelefono').value.trim() || null,
      fecha_nacimiento: $('nuevoNacimiento').value,
      fecha_ingreso: $('nuevoIngreso').value || null,
      activo: $('nuevoActivo')?.checked ?? true,
      becado: $('nuevoBecado')?.checked ?? false,
      categoria: $('nuevoCategoria').value
    };

    await api(`/club/${clubId}/socios`, { method:'POST', body: JSON.stringify(payload), json:true });
    await loadCategoriasIntoSelect();
    await loadSocios();
  }

  async function borrarSocio(id) {
    const clubId = activeClubId();
    await api(`/club/${clubId}/socios/${id}`, { method:'DELETE' });
    await loadSocios();
  }

  async function exportCSV() {
    const clubId = activeClubId();
    // descarga directa
    window.location.href = `/club/${clubId}/socios/export.csv`;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    // bind acciones
    $('btnBuscar')?.addEventListener('click', loadSocios);
    $('btnExport')?.addEventListener('click', exportCSV);
    $('btnCrearSocio')?.addEventListener('click', async () => {
      try { await crearSocio(); alert('Socio creado'); }
      catch(e) { alert(e.message); }
    });

    $('tablaSociosBody')?.addEventListener('click', async (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      const act = b.dataset.act;
      const id = b.dataset.id;
      if (act === 'del') {
        if (confirm('¿Eliminar socio?')) {
          try { await borrarSocio(id); } catch(e) { alert(e.message); }
        }
      }
      if (act === 'edit') {
        alert('Editar lo implementamos en el siguiente paso (mismo módulo Socios).');
      }
    });

    // carga inicial
    await loadCategoriasIntoSelect();
    await loadSocios();
  });
})();