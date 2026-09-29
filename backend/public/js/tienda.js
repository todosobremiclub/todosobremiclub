// public/js/tienda.js
//
// Panel admin: alta/edición/baja de productos de la Tienda Online.
// La gestión de reservas (aceptar / rechazar / retirado) vive en la
// sección "Pendientes" (ver claude/tienda-online-plan.md, paso 5).
(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  // =============================
  // Auth / helpers comunes (mismo patrón que noticias.js)
  // =============================
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
      alert('No hay club activo seleccionado.');
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

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { data = { ok: false, error: text }; }

    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('activeClubId');
      alert('Sesión inválida o expirada.');
      window.location.href = '/admin.html';
      throw new Error('401');
    }

    return { res, data };
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function formatPrecio(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return '—';
    return num.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
  }

  // =============================
  // Estado
  // =============================
  let productosCache = [];
  let categoriasProductoCache = []; // ✅ NUEVO: tipificación de productos (Configuración > Tipos de producto)
  let editingId = null;
  // ✅ NUEVO: hasta 3 fotos por producto. currentImagenUrls[i] es la URL ya
  // guardada en el servidor para ese slot (o null); quitarImagenFlags[i]
  // se pone en true cuando el admin aprieta "Quitar" sobre una foto
  // existente (sin elegir una nueva) — eso viaja como quitar_imagen(_N)
  // al guardar. Elegir un archivo nuevo para un slot cancela el "quitar"
  // pendiente de ese mismo slot.
  const FOTO_SLOTS = [
    { file: '#tiendaImagen', quitarBtn: '#btnTiendaImagenQuitar', thumb: '#tiendaImagenThumb' },
    { file: '#tiendaImagen2', quitarBtn: '#btnTiendaImagen2Quitar', thumb: '#tiendaImagen2Thumb' },
    { file: '#tiendaImagen3', quitarBtn: '#btnTiendaImagen3Quitar', thumb: '#tiendaImagen3Thumb' },
  ];
  let currentImagenUrls = [null, null, null];
  let quitarImagenFlags = [false, false, false];
  let filtroProductos = ''; // ✅ NUEVO: buscador de productos publicados
  let filtroCategoriaProducto = ''; // ✅ NUEVO: filtro por tipo/categoría en "Productos publicados"

  // =============================
  // Helpers imagen (base64)
  // =============================
  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const dataUrl = String(r.result || '');
        const comma = dataUrl.indexOf(',');
        if (comma < 0) return reject(new Error('No se pudo leer la imagen'));
        resolve({
          base64: dataUrl.slice(comma + 1),
          mimetype: file.type || 'image/jpeg',
        });
      };
      r.onerror = () => reject(new Error('Error leyendo archivo'));
      r.readAsDataURL(file);
    });
  }

  // =============================
  // Vista previa en vivo
  // =============================

  // ✅ NUEVO: refresca la miniatura + botón "Quitar" de un slot de foto
  // (0 = principal, 1 y 2 = adicionales), según haya un archivo nuevo
  // elegido, una foto existente, o ninguna de las dos cosas.
  function fotoSlotRefrescarUI(i) {
    const slot = FOTO_SLOTS[i];
    const fileInput = $(slot.file);
    const thumb = $(slot.thumb);
    const btn = $(slot.quitarBtn);
    const hayArchivoNuevo = !!(fileInput?.files?.[0]);
    const urlExistente = (!hayArchivoNuevo && !quitarImagenFlags[i]) ? currentImagenUrls[i] : null;

    if (thumb) {
      if (urlExistente) {
        thumb.src = urlExistente;
        thumb.style.display = 'block';
      } else {
        thumb.removeAttribute('src');
        thumb.style.display = 'none';
      }
    }
    if (btn) {
      const mostrar = hayArchivoNuevo || (!!currentImagenUrls[i] && !quitarImagenFlags[i]);
      btn.style.display = mostrar ? 'inline-flex' : 'none';
    }
  }

  function fotoSlotsRefrescarTodas() {
    FOTO_SLOTS.forEach((_, i) => fotoSlotRefrescarUI(i));
  }

  function setPreviewImg(src) {
    const img = $('#tiendaPreviewImg');
    const placeholder = $('#tiendaPreviewImgPlaceholder');
    if (!img || !placeholder) return;

    if (src) {
      img.src = src;
      img.style.display = 'block';
      placeholder.style.display = 'none';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
      placeholder.style.display = 'flex';
    }
  }

  function updatePreview() {
    const nombre = $('#tiendaNombre')?.value?.trim();
    const precio = $('#tiendaPrecio')?.value;
    const tieneTalles = !!$('#tiendaTieneTalles')?.checked;
    const stock = tieneTalles
      ? $$('.tw-talle-stock').reduce((acc, input) => {
          const n = Number(input.value);
          return acc + (Number.isFinite(n) ? n : 0);
        }, 0)
      : $('#tiendaStock')?.value;

    const previewNombre = $('#tiendaPreviewNombre');
    const previewPrecio = $('#tiendaPreviewPrecio');
    const previewStock = $('#tiendaPreviewStock');

    if (previewNombre) previewNombre.textContent = nombre || 'Nombre del producto';
    if (previewPrecio) previewPrecio.textContent = precio !== '' && precio != null ? formatPrecio(precio) : '$0';
    if (previewStock) {
      const stockNum = Number(stock);
      previewStock.textContent = Number.isFinite(stockNum) && stock !== ''
        ? `Stock disponible: ${stockNum}`
        : 'Sin stock cargado';
    }

    const fileInput = $('#tiendaImagen');
    const file = fileInput?.files?.[0] || null;

    if (file) {
      const reader = new FileReader();
      reader.onload = () => setPreviewImg(String(reader.result || ''));
      reader.readAsDataURL(file);
    } else {
      setPreviewImg(quitarImagenFlags[0] ? null : (currentImagenUrls[0] || null));
    }

    fotoSlotsRefrescarTodas();
  }

  // =============================
  // ✅ NUEVO: builder de talles + stock por talle
  // =============================
  function tiendaTalleFilaHtml(talle = '', stock = '') {
    return `
      <div class="tw-talle-fila" data-talle-fila>
        <input type="text" class="tw-talle-nombre" placeholder="Talle (ej: 38, S, M)" value="${escapeHtml(talle)}" />
        <input type="number" class="tw-talle-stock" min="0" step="1" placeholder="Stock" value="${escapeHtml(String(stock ?? ''))}" />
        <button type="button" class="tw-talle-quitar" title="Quitar talle">✖</button>
      </div>
    `;
  }

  function tiendaTalleAgregarFila(talle = '', stock = '') {
    const cont = $('#tiendaTallesFilas');
    if (!cont) return;
    cont.insertAdjacentHTML('beforeend', tiendaTalleFilaHtml(talle, stock));
    tiendaTallesRecalcularTotal();
  }

  function tiendaTallesRecalcularTotal() {
    const total = $$('.tw-talle-stock').reduce((acc, input) => {
      const n = Number(input.value);
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
    const totalEl = $('#tiendaTallesStockTotal');
    if (totalEl) totalEl.textContent = String(total);
  }

  function tiendaTallesObtenerValores() {
    return $$('#tiendaTallesFilas [data-talle-fila]').map(fila => ({
      talle: fila.querySelector('.tw-talle-nombre')?.value?.trim() || '',
      stock: Number(fila.querySelector('.tw-talle-stock')?.value),
    }));
  }

  function tiendaTallesLimpiar() {
    const cont = $('#tiendaTallesFilas');
    if (cont) cont.innerHTML = '';
    tiendaTallesRecalcularTotal();
  }

  function tiendaTieneTallesActualizarUI() {
    const checked = !!$('#tiendaTieneTalles')?.checked;
    const tallesWrap = $('#tiendaTallesWrap');
    const stockWrap = $('#tiendaStockWrap');
    if (tallesWrap) tallesWrap.style.display = checked ? '' : 'none';
    if (stockWrap) stockWrap.style.display = checked ? 'none' : '';
    if (checked && !$('#tiendaTallesFilas')?.children.length) {
      tiendaTalleAgregarFila();
    }
    updatePreview();
  }

  // =============================
  // Tipificación de productos (Configuración > Tipos de producto)
  // =============================
  async function loadCategoriasProducto() {
    const clubId = getActiveClubId();
    const select = $('#tiendaCategoria');

    try {
      const { res, data } = await fetchAuth(`/club/${clubId}/config/tienda-categorias`);
      categoriasProductoCache = (res.ok && data.ok) ? (data.categorias || []) : [];
    } catch (e) {
      console.error('loadCategoriasProducto:', e);
      categoriasProductoCache = [];
    }

    if (select) {
      const valorActual = select.value;
      select.innerHTML = '<option value="">Sin tipificar</option>' +
        categoriasProductoCache.map(c => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join('');
      select.value = valorActual || '';
    }

    // ✅ NUEVO: pobla también los filtros por tipo de producto de las tablas
    // "Productos publicados" e "Historial de ventas".
    const opcionesFiltro = '<option value="">Todos los tipos</option>' +
      categoriasProductoCache.map(c => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join('');

    const filtroProd = $('#tiendaFiltroCategoriaProducto');
    if (filtroProd) {
      const valorActual = filtroProd.value;
      filtroProd.innerHTML = opcionesFiltro;
      filtroProd.value = valorActual || '';
    }

    const filtroVenta = $('#tiendaFiltroCategoriaVenta');
    if (filtroVenta) {
      const valorActual = filtroVenta.value;
      filtroVenta.innerHTML = opcionesFiltro;
      filtroVenta.value = valorActual || '';
    }
  }

  // =============================
  // Carga / render de productos
  // =============================
  async function loadProductos() {
    const clubId = getActiveClubId();
    const tbody = $('#tiendaTableBody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7">Cargando productos...</td></tr>`;

    try {
      const { res, data } = await fetchAuth(`/club/${clubId}/tienda/productos`);
      if (!res.ok || !data.ok) {
        tbody.innerHTML = `<tr><td colspan="7">Error cargando productos</td></tr>`;
        return;
      }
      productosCache = data.productos || [];
      renderProductosTable();
    } catch (e) {
      console.error('loadProductos:', e);
      tbody.innerHTML = `<tr><td colspan="7">Error cargando productos</td></tr>`;
    }
  }

  // ✅ Filtra por nombre o descripción (sin distinguir mayúsculas) según lo
  // tipeado en #tiendaBuscarProducto, y opcionalmente por tipo/categoría
  // según lo elegido en #tiendaFiltroCategoriaProducto.
  function productosFiltrados() {
    const q = filtroProductos.trim().toLowerCase();
    return productosCache.filter(p => {
      if (filtroCategoriaProducto && String(p.categoria_id ?? '') !== String(filtroCategoriaProducto)) return false;
      if (!q) return true;
      const nombre = (p.nombre || '').toLowerCase();
      const descripcion = (p.descripcion || '').toLowerCase();
      return nombre.includes(q) || descripcion.includes(q);
    });
  }

  function renderProductosTable() {
    const tbody = $('#tiendaTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const productos = productosFiltrados();

    if (!productosCache.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="muted">No hay productos publicados todavía.</td></tr>`;
      return;
    }

    if (!productos.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="muted">No se encontraron productos que coincidan con los filtros aplicados.</td></tr>`;
      return;
    }

    productos.forEach(p => {
      const tr = document.createElement('tr');
      const img = p.imagen_url || '';
      const cantidadFotos = [p.imagen_url, p.imagen_url_2, p.imagen_url_3].filter(Boolean).length;
      const activo = p.activo !== false;

      tr.innerHTML = `
        <td style="position:relative;">
          ${img
            ? `<img src="${escapeHtml(img)}" class="tienda-img-mini" alt="imagen producto"
                    onerror="this.style.display='none';" />`
            : '—'}
          ${cantidadFotos > 1
            ? `<span class="muted" style="display:block; font-size:10px; text-align:center;">+${cantidadFotos - 1} foto${cantidadFotos - 1 === 1 ? '' : 's'}</span>`
            : ''}
        </td>
        <td>
          <div style="font-weight:600;">${escapeHtml(p.nombre ?? '')}</div>
          <div style="font-size:12.5px; color:#6b7280;">
            ${escapeHtml((p.descripcion || '').slice(0, 100))}${(p.descripcion || '').length > 100 ? '…' : ''}
          </div>
        </td>
        <td>${p.categoria_nombre ? escapeHtml(p.categoria_nombre) : '<span class="muted">—</span>'}</td>
        <td>${formatPrecio(p.precio)}</td>
        <td>${escapeHtml(String(p.stock ?? 0))}${p.tiene_talles ? ' <span class="muted">(por talle)</span>' : ''}</td>
        <td>
          <span class="tw-badge-estado ${activo ? 'tw-badge-estado--activo' : 'tw-badge-estado--inactivo'}">
            ${activo ? 'Activo' : 'Inactivo'}
          </span>
        </td>
        <td style="white-space:nowrap;">
          <button class="btn btn-secondary" data-act="edit" data-id="${p.id}" title="Editar">✏️</button>
          <button class="btn btn-secondary" data-act="toggle" data-id="${p.id}" title="${activo ? 'Desactivar' : 'Activar'}">
            ${activo ? '⏸️' : '▶️'}
          </button>
          <button class="btn btn-secondary" style="background:#ef4444;border-color:#ef4444;"
                  data-act="del" data-id="${p.id}" title="Eliminar">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // =============================
  // Alta / edición de producto
  // =============================
  function resetForm() {
    editingId = null;
    currentImagenUrls = [null, null, null];
    quitarImagenFlags = [false, false, false];

    if ($('#tiendaNombre')) $('#tiendaNombre').value = '';
    if ($('#tiendaDescripcion')) $('#tiendaDescripcion').value = '';
    if ($('#tiendaPrecio')) $('#tiendaPrecio').value = '';
    if ($('#tiendaStock')) $('#tiendaStock').value = '';
    if ($('#tiendaCategoria')) $('#tiendaCategoria').value = '';
    FOTO_SLOTS.forEach(slot => { if ($(slot.file)) $(slot.file).value = ''; });
    if ($('#tiendaTieneTalles')) $('#tiendaTieneTalles').checked = false;
    tiendaTallesLimpiar();
    tiendaTieneTallesActualizarUI();

    updatePreview();

    const btn = $('#btnTiendaGuardar');
    if (btn) btn.textContent = '➕ Publicar producto';

    const btnCancelar = $('#btnTiendaCancelar');
    if (btnCancelar) btnCancelar.style.display = 'none';
  }

  function fillFormForEdit(p) {
    editingId = p.id;
    currentImagenUrls = [p.imagen_url || null, p.imagen_url_2 || null, p.imagen_url_3 || null];
    quitarImagenFlags = [false, false, false];

    $('#tiendaNombre').value = p.nombre ?? '';
    $('#tiendaDescripcion').value = p.descripcion ?? '';
    $('#tiendaPrecio').value = p.precio ?? '';
    $('#tiendaStock').value = p.stock ?? '';
    if ($('#tiendaCategoria')) $('#tiendaCategoria').value = p.categoria_id ?? '';
    FOTO_SLOTS.forEach(slot => { if ($(slot.file)) $(slot.file).value = ''; });

    tiendaTallesLimpiar();
    const tieneTalles = p.tiene_talles === true;
    if ($('#tiendaTieneTalles')) $('#tiendaTieneTalles').checked = tieneTalles;
    if (tieneTalles && Array.isArray(p.talles) && p.talles.length) {
      p.talles.forEach(t => tiendaTalleAgregarFila(t.talle, t.stock));
    }
    tiendaTieneTallesActualizarUI();

    updatePreview();

    const btn = $('#btnTiendaGuardar');
    if (btn) btn.textContent = '💾 Guardar cambios';

    const btnCancelar = $('#btnTiendaCancelar');
    if (btnCancelar) btnCancelar.style.display = 'inline-flex';
  }

  async function saveProducto() {
    const clubId = getActiveClubId();
    const nombre = $('#tiendaNombre')?.value?.trim() || '';
    const descripcion = $('#tiendaDescripcion')?.value?.trim() || '';
    const precio = $('#tiendaPrecio')?.value;
    const stock = $('#tiendaStock')?.value;
    const tieneTalles = !!$('#tiendaTieneTalles')?.checked;

    if (!nombre) {
      alert('Completá el nombre del producto.');
      return;
    }
    const precioNum = Number(precio);
    if (!Number.isFinite(precioNum) || precioNum < 0) {
      alert('El precio no es válido.');
      return;
    }

    const payload = {
      nombre,
      descripcion: descripcion || null,
      precio: precioNum,
      categoria_id: $('#tiendaCategoria')?.value || null,
      tiene_talles: tieneTalles,
    };

    if (tieneTalles) {
      const talles = tiendaTallesObtenerValores();
      const talleConNombre = talles.filter(t => t.talle);
      if (!talleConNombre.length) {
        alert('Agregá al menos un talle con su stock.');
        return;
      }
      for (const t of talleConNombre) {
        if (!Number.isInteger(t.stock) || t.stock < 0) {
          alert(`El stock del talle "${t.talle}" no es válido (debe ser un número entero mayor o igual a 0).`);
          return;
        }
      }
      const nombresRepetidos = talleConNombre.map(t => t.talle.toLowerCase());
      if (new Set(nombresRepetidos).size !== nombresRepetidos.length) {
        alert('Hay talles repetidos. Cada talle debe ser único.');
        return;
      }
      payload.talles = talleConNombre;
      payload.stock = talleConNombre.reduce((acc, t) => acc + t.stock, 0);
    } else {
      const stockNum = Number(stock);
      if (!Number.isInteger(stockNum) || stockNum < 0) {
        alert('El stock no es válido (debe ser un número entero mayor o igual a 0).');
        return;
      }
      payload.stock = stockNum;
      payload.talles = [];
    }

    // ✅ NUEVO: hasta 3 fotos — cada slot manda su propio par base64/mimetype
    // si se eligió un archivo nuevo, o quitar_imagen(_N)=true si se apretó
    // "Quitar" sobre una foto existente sin reemplazarla.
    const PAYLOAD_KEYS = [
      { base64: 'imagen_base64', mimetype: 'imagen_mimetype', quitar: 'quitar_imagen' },
      { base64: 'imagen2_base64', mimetype: 'imagen2_mimetype', quitar: 'quitar_imagen_2' },
      { base64: 'imagen3_base64', mimetype: 'imagen3_mimetype', quitar: 'quitar_imagen_3' },
    ];
    for (let i = 0; i < FOTO_SLOTS.length; i++) {
      const fileInputSlot = $(FOTO_SLOTS[i].file);
      const fileSlot = fileInputSlot?.files?.[0] || null;
      const keys = PAYLOAD_KEYS[i];

      if (fileSlot) {
        if (fileSlot.size > 3 * 1024 * 1024) {
          alert(`La foto ${i + 1} supera los 3MB. Elegí una más liviana.`);
          return;
        }
        const img = await readFileAsBase64(fileSlot);
        payload[keys.base64] = img.base64;
        payload[keys.mimetype] = img.mimetype;
      } else if (quitarImagenFlags[i]) {
        payload[keys.quitar] = true;
      }
    }

    const btn = $('#btnTiendaGuardar');
    if (btn) btn.disabled = true;

    try {
      let url = `/club/${clubId}/tienda/productos`;
      let method = 'POST';

      if (editingId) {
        url = `/club/${clubId}/tienda/productos/${editingId}`;
        method = 'PUT';
        payload.activo = true;
      }

      const { res, data } = await fetchAuth(url, {
        method,
        json: true,
        body: JSON.stringify(payload),
      });

      if (!res.ok || !data.ok) {
        alert(data.error || 'No se pudo guardar el producto');
        return;
      }

      alert(editingId ? '✅ Producto actualizado' : '✅ Producto publicado');
      resetForm();
      await loadProductos();
    } catch (e) {
      console.error('saveProducto:', e);
      alert(e.message || 'Error guardando el producto');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function toggleActivoProducto(p) {
    const clubId = getActiveClubId();
    const nuevoActivo = !(p.activo !== false);

    try {
      const { res, data } = await fetchAuth(`/club/${clubId}/tienda/productos/${p.id}`, {
        method: 'PUT',
        json: true,
        body: JSON.stringify({
          nombre: p.nombre,
          descripcion: p.descripcion,
          precio: p.precio,
          stock: p.stock,
          categoria_id: p.categoria_id || null,
          tiene_talles: p.tiene_talles === true,
          talles: p.tiene_talles === true ? (p.talles || []) : [],
          activo: nuevoActivo,
        }),
      });
      if (!res.ok || !data.ok) {
        alert(data.error || 'No se pudo actualizar el estado del producto');
        return;
      }
      await loadProductos();
    } catch (e) {
      console.error('toggleActivoProducto:', e);
      alert(e.message || 'Error actualizando el producto');
    }
  }

  async function deleteProducto(id) {
    const clubId = getActiveClubId();
    if (!confirm('¿Eliminar este producto? Si tiene reservas asociadas, se desactivará en su lugar.')) return;

    try {
      const { res, data } = await fetchAuth(`/club/${clubId}/tienda/productos/${id}`, { method: 'DELETE' });
      if (!res.ok || !data.ok) {
        alert(data.error || 'No se pudo eliminar el producto');
        return;
      }
      if (data.desactivado) {
        alert(data.mensaje || 'El producto tenía reservas asociadas: se desactivó en vez de eliminarse.');
      }
      await loadProductos();
    } catch (e) {
      console.error('deleteProducto:', e);
      alert(e.message || 'Error eliminando el producto');
    }
  }

  // =============================
  // Bind de eventos
  // =============================
  function bindOnce() {
    const root = document.getElementById('tienda-section');
    if (!root) return;

    if (root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    // ✅ NUEVO: cambio de estado de pago desde el Historial de ventas
    root.addEventListener('change', async (ev) => {
      const select = ev.target.closest('select[data-act="v_estado_pago"]');
      if (!select) return;
      await manejarCambioEstadoPago(select);
    });

    // ✅ NUEVO: eliminar una compra del Historial de ventas
    root.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('button[data-act="v_eliminar"]');
      if (!btn) return;
      await eliminarVentaHistorial(btn.dataset.id);
    });

    // ✅ NUEVO: buscador de ventas por socio o producto (Historial de ventas)
    const buscarVentaInput = root.querySelector('#tiendaBuscarVenta');
    if (buscarVentaInput) {
      buscarVentaInput.addEventListener('input', (e) => {
        filtroVentas = e.target.value || '';
        renderHistorialVentas(ventasFiltradas());
      });
    }

    // ✅ NUEVO: filtro por tipo/categoría (Historial de ventas)
    const filtroCategoriaVentaSelect = root.querySelector('#tiendaFiltroCategoriaVenta');
    if (filtroCategoriaVentaSelect) {
      filtroCategoriaVentaSelect.addEventListener('change', (e) => {
        filtroCategoriaVentas = e.target.value || '';
        renderHistorialVentas(ventasFiltradas());
      });
    }

    // ✅ NUEVO: toggle "No socio" en el modal de venta manual
    const checkboxNoSocio = document.getElementById('ventaManualNoSocio');
    if (checkboxNoSocio) {
      checkboxNoSocio.addEventListener('change', ventaManualActualizarSegunNoSocio);
    }

    // ✅ NUEVO: modal "Cargar venta manual"
    const btnVentaManualAbrir = root.querySelector('#btnVentaManualAbrir');
    if (btnVentaManualAbrir) {
      btnVentaManualAbrir.addEventListener('click', (e) => {
        e.preventDefault();
        ventaManualAbrir();
      });
    }

    const btnVentaManualCancel = document.getElementById('ventaManualCancel');
    if (btnVentaManualCancel) {
      btnVentaManualCancel.addEventListener('click', (e) => {
        e.preventDefault();
        ventaManualCerrar();
      });
    }

    const btnVentaManualConfirm = document.getElementById('ventaManualConfirm');
    if (btnVentaManualConfirm) {
      btnVentaManualConfirm.addEventListener('click', (e) => {
        e.preventDefault();
        ventaManualConfirmar();
      });
    }

    const selectVentaManualProducto = document.getElementById('ventaManualProducto');
    if (selectVentaManualProducto) {
      selectVentaManualProducto.addEventListener('change', ventaManualActualizarSegunProducto);
    }

    const selectVentaManualEstadoPago = document.getElementById('ventaManualEstadoPago');
    if (selectVentaManualEstadoPago) {
      selectVentaManualEstadoPago.addEventListener('change', ventaManualActualizarSegunEstadoPago);
    }

    const inputVentaManualSocioBusqueda = document.getElementById('ventaManualSocioBusqueda');
    if (inputVentaManualSocioBusqueda) {
      inputVentaManualSocioBusqueda.addEventListener('input', (e) => {
        const q = e.target.value || '';
        if (timeoutBusquedaSocioVentaManual) clearTimeout(timeoutBusquedaSocioVentaManual);
        timeoutBusquedaSocioVentaManual = setTimeout(() => ventaManualBuscarSocios(q), 300);
      });
    }

    const overlayVentaManual = document.getElementById('modalVentaManualOverlay');
    if (overlayVentaManual) {
      overlayVentaManual.addEventListener('click', (e) => {
        if (e.target === overlayVentaManual) ventaManualCerrar();
      });
    }

    const btnGuardar = root.querySelector('#btnTiendaGuardar');
    const btnCancelar = root.querySelector('#btnTiendaCancelar');

    if (btnGuardar) {
      btnGuardar.addEventListener('click', (e) => {
        e.preventDefault();
        saveProducto();
      });
    }

    if (btnCancelar) {
      btnCancelar.addEventListener('click', (e) => {
        e.preventDefault();
        resetForm();
      });
    }

    // Vista previa en vivo (nombre / precio / stock / fotos)
    const nombreInput = root.querySelector('#tiendaNombre');
    const precioInput = root.querySelector('#tiendaPrecio');
    const stockInput = root.querySelector('#tiendaStock');

    if (nombreInput) nombreInput.addEventListener('input', updatePreview);
    if (precioInput) precioInput.addEventListener('input', updatePreview);
    if (stockInput) stockInput.addEventListener('input', updatePreview);

    // ✅ NUEVO: hasta 3 fotos por producto — cada slot (archivo + "Quitar")
    // se maneja igual, sea la foto principal o una adicional.
    FOTO_SLOTS.forEach((slot, i) => {
      const fileInput = root.querySelector(slot.file);
      const btnQuitar = root.querySelector(slot.quitarBtn);

      if (fileInput) {
        fileInput.addEventListener('change', () => {
          quitarImagenFlags[i] = false;
          if (i === 0) {
            updatePreview();
          } else {
            fotoSlotRefrescarUI(i);
          }
        });
      }

      if (btnQuitar) {
        btnQuitar.addEventListener('click', (e) => {
          e.preventDefault();
          if (fileInput) fileInput.value = '';
          quitarImagenFlags[i] = true;
          if (i === 0) {
            updatePreview();
          } else {
            fotoSlotRefrescarUI(i);
          }
        });
      }
    });

    // ✅ NUEVO: talles configurables por producto
    const checkboxTieneTalles = root.querySelector('#tiendaTieneTalles');
    if (checkboxTieneTalles) {
      checkboxTieneTalles.addEventListener('change', tiendaTieneTallesActualizarUI);
    }

    const btnTalleAgregar = root.querySelector('#btnTiendaTalleAgregar');
    if (btnTalleAgregar) {
      btnTalleAgregar.addEventListener('click', (e) => {
        e.preventDefault();
        tiendaTalleAgregarFila();
      });
    }

    const tallesFilas = root.querySelector('#tiendaTallesFilas');
    if (tallesFilas) {
      tallesFilas.addEventListener('click', (e) => {
        const btn = e.target.closest('.tw-talle-quitar');
        if (!btn) return;
        e.preventDefault();
        btn.closest('[data-talle-fila]')?.remove();
        tiendaTallesRecalcularTotal();
        updatePreview();
      });
      tallesFilas.addEventListener('input', (e) => {
        if (e.target.classList.contains('tw-talle-stock')) {
          tiendaTallesRecalcularTotal();
          updatePreview();
        }
      });
    }

    // ✅ NUEVO: buscador de productos publicados (filtra en vivo mientras se tipea)
    const buscarInput = root.querySelector('#tiendaBuscarProducto');
    if (buscarInput) {
      buscarInput.addEventListener('input', (e) => {
        filtroProductos = e.target.value || '';
        renderProductosTable();
      });
    }

    // ✅ NUEVO: filtro por tipo/categoría (Productos publicados)
    const filtroCategoriaProductoSelect = root.querySelector('#tiendaFiltroCategoriaProducto');
    if (filtroCategoriaProductoSelect) {
      filtroCategoriaProductoSelect.addEventListener('change', (e) => {
        filtroCategoriaProducto = e.target.value || '';
        renderProductosTable();
      });
    }

    const tbody = $('#tiendaTableBody');
    if (tbody) {
      tbody.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button[data-act]');
        if (!btn) return;

        const act = btn.dataset.act;
        const id = btn.dataset.id;
        const p = productosCache.find(x => String(x.id) === String(id));
        if (!p) return;

        if (act === 'edit') {
          fillFormForEdit(p);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        if (act === 'toggle') {
          toggleActivoProducto(p);
        }

        if (act === 'del') {
          deleteProducto(id);
        }
      });
    }
  }

  // =============================
  // ✅ NUEVO: Historial de ventas (reservas aceptadas + retiradas)
  // =============================
  let historialVentasCache = [];
  let filtroVentas = '';
  let filtroCategoriaVentas = ''; // ✅ NUEVO: filtro por tipo/categoría en "Historial de ventas"

  // Mismas etiquetas/valores que en pendientes.js (tabla "a retirar"): las
  // dos pantallas hablan contra el mismo endpoint PATCH estado-pago.
  const ESTADOS_PAGO_TIENDA = [
    ['sin_pago', 'Falta de pago'],
    ['parcial', 'Adelanto / seña'],
    ['pagado', 'Pago completo'],
  ];

  const ESTADO_RESERVA_LABEL = {
    aceptada: 'A retirar',
    retirada: 'Retirada',
  };

  function formatDateISOToDMY_tienda(iso) {
    if (!iso) return '—';
    const s = String(iso).slice(0, 10);
    const [y, m, d] = s.split('-');
    if (!y || !m || !d) return s;
    return `${d}/${m}/${y}`;
  }

  function ventaSocioLabel(r) {
    if (!r.socio_id) {
      return r.nombre_referencia ? `${escapeHtml(r.nombre_referencia)} (no socio)` : 'No socio';
    }
    return `#${r.numero_socio ?? '—'} ${escapeHtml(r.socio_apellido ?? '')} ${escapeHtml(r.socio_nombre ?? '')}`.trim();
  }

  function ventaImgHtml(r) {
    return r.producto_imagen_url
      ? `<img src="${escapeHtml(r.producto_imagen_url)}" class="tienda-img-mini" style="cursor:pointer;" onclick="window.open('${escapeHtml(r.producto_imagen_url)}','_blank')" />`
      : '—';
  }

  // ✅ Filtra el historial por nombre/apellido/número de socio (o nombre de
  // referencia, si es venta a "no socio") o por nombre de producto (según
  // lo tipeado en #tiendaBuscarVenta), y opcionalmente por tipo/categoría
  // del producto (según lo elegido en #tiendaFiltroCategoriaVenta).
  function ventasFiltradas() {
    const q = filtroVentas.trim().toLowerCase();
    return historialVentasCache.filter(r => {
      if (filtroCategoriaVentas && String(r.producto_categoria_id ?? '') !== String(filtroCategoriaVentas)) return false;
      if (!q) return true;
      const producto = (r.producto_nombre || '').toLowerCase();
      const socio = `${r.numero_socio ?? ''} ${r.socio_nombre || ''} ${r.socio_apellido || ''} ${r.nombre_referencia || ''}`.toLowerCase();
      return producto.includes(q) || socio.includes(q);
    });
  }

  function pagoLabelTexto(estadoPago, monto, formaPago) {
    if (estadoPago === 'parcial') {
      const cuentaTxt = formaPago ? ` · ${formaPago}` : '';
      return `Abonado: ${formatPrecio(monto)}${cuentaTxt}`;
    }
    if (estadoPago === 'pagado') {
      return formaPago ? `Pagado · ${formaPago}` : 'Pagado';
    }
    return '';
  }

  function estadoPagoSelectHtml(r, act) {
    const actual = r.estado_pago || 'sin_pago';
    const monto = Number(r.monto_pagado || 0);
    const opciones = ESTADOS_PAGO_TIENDA
      .map(([val, label]) => `<option value="${val}"${val === actual ? ' selected' : ''}>${label}</option>`)
      .join('');
    const textoLabel = pagoLabelTexto(actual, monto, r.forma_pago);
    const montoLabelHtml = textoLabel
      ? `<div class="tw-monto-pagado-label">${escapeHtml(textoLabel)}</div>`
      : '';
    return `
      <select class="tw-estado-pago-select" data-act="${act}" data-estado="${actual}" data-monto="${monto}">
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
        // Fallback defensivo por si el modal no está en el HTML.
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
          ? cuentas.map(c => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join('')
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

  // ✅ Compartido entre el Historial de ventas (tienda.js) y la tabla
  // "a retirar" de Pendientes (pendientes.js expone la misma función con el
  // mismo contrato, ver bindOnce() de ese archivo).
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
    // afectada, así que solo actualizamos su propio registro en caché y su
    // propio select/label — no hace falta buscar filas hermanas.
    const reservaActualizada = data.reserva;

    const item = historialVentasCache.find(x => String(x.id) === String(rowId));
    if (item) {
      item.estado_pago = reservaActualizada.estado_pago;
      item.monto_pagado = reservaActualizada.monto_pagado;
      item.forma_pago = reservaActualizada.forma_pago;
    }

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

  // ✅ Cuántas líneas comparten cada pedido_id (carrito con varios
  // productos) — solo para mostrar un badge de contexto; la gestión
  // (estado de pago, eliminar) es individual por línea.
  function contarLineasPorPedidoVenta(items) {
    const mapa = new Map();
    items.forEach(r => mapa.set(r.pedido_id, (mapa.get(r.pedido_id) || 0) + 1));
    return mapa;
  }

  function renderHistorialVentas(items) {
    const tbody = $('#tiendaHistorialVentasBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!historialVentasCache.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="muted">Todavía no hay ventas registradas.</td></tr>`;
      return;
    }

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="muted">No se encontraron ventas que coincidan con los filtros aplicados.</td></tr>`;
      return;
    }

    const lineasPorPedido = contarLineasPorPedidoVenta(historialVentasCache);

    items.forEach(r => {
      const tr = document.createElement('tr');
      // ✅ Gestión individual por línea: se usa el id de la reserva (no el
      // pedido_id) — el estado de pago y la eliminación afectan solo a
      // este producto, aunque haya venido de un carrito con varios.
      tr.dataset.id = r.id;

      const esCarritoMultiple = (lineasPorPedido.get(r.pedido_id) || 1) > 1;
      const nombreConTalle = r.talle
        ? `${escapeHtml(r.producto_nombre)} <span class="muted">(talle ${escapeHtml(r.talle)})</span>`
        : escapeHtml(r.producto_nombre);
      const origenBadge = r.origen === 'manual'
        ? ' <span class="muted" style="font-size:11px;">· venta manual</span>'
        : '';
      const badgePedido = esCarritoMultiple
        ? `<div style="font-size:10.5px; color:#2563eb; margin-top:2px;">🛒 Parte de un pedido con varios productos</div>`
        : '';

      tr.innerHTML = `
        <td>${ventaImgHtml(r)}</td>
        <td><b>${nombreConTalle}</b>${origenBadge}${badgePedido}</td>
        <td>${ventaSocioLabel(r)}</td>
        <td>${escapeHtml(r.cantidad)}</td>
        <td>${formatPrecio(r.producto_precio)}</td>
        <td>${ESTADO_RESERVA_LABEL[r.estado] || escapeHtml(r.estado)}</td>
        <td>${estadoPagoSelectHtml(r, 'v_estado_pago')}</td>
        <td>${formatDateISOToDMY_tienda(r.gestionada_at || r.created_at)}</td>
        <td>
          <button type="button" class="btn btn-secondary" style="background:#ef4444;border-color:#ef4444;"
                  data-act="v_eliminar" data-id="${r.id}" title="Eliminar del historial">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ✅ Elimina definitivamente un producto del Historial de ventas (y, si
  // tenía un pago registrado, el ingreso asociado en Finanzas). No
  // restituye stock: se asume que el producto ya salió del club. Gestión
  // individual por línea (reservaId, no pedido_id).
  async function eliminarVentaHistorial(reservaId) {
    const confirmado = confirm(
      '¿Eliminar este producto del historial?\n\n' +
      'Esta acción es DEFINITIVA: se borra el registro de la venta y, si tenía ' +
      'un pago registrado, también el ingreso correspondiente en Finanzas.\n\n' +
      'El stock del producto NO se modifica (se asume que ya salió del club).'
    );
    if (!confirmado) return;

    const clubId = getActiveClubId();
    try {
      const { res, data } = await fetchAuth(`/club/${clubId}/tienda/reservas/${reservaId}`, {
        method: 'DELETE',
      });
      if (!res.ok || !data.ok) {
        alert(data.error || 'No se pudo eliminar la compra');
        return;
      }
      await loadHistorialVentas();
    } catch (e) {
      console.error('eliminarVentaHistorial:', e);
      alert(e.message || 'Error eliminando la compra');
    }
  }

  // Trae reservas aceptadas ("a retirar") + retiradas y las junta en una
  // sola lista, más recientes primero. Las rechazadas/canceladas no cuentan
  // como venta.
  async function loadHistorialVentas() {
    const clubId = getActiveClubId();

    const [{ res: resAcept, data: dataAcept }, { res: resRet, data: dataRet }] = await Promise.all([
      fetchAuth(`/club/${clubId}/tienda/reservas?estado=aceptada`),
      fetchAuth(`/club/${clubId}/tienda/reservas?estado=retirada`),
    ]);

    const aceptadas = (resAcept.ok && dataAcept.ok) ? (dataAcept.reservas || []) : [];
    const retiradas = (resRet.ok && dataRet.ok) ? (dataRet.reservas || []) : [];

    historialVentasCache = [...aceptadas, ...retiradas].sort((a, b) => {
      const fa = new Date(a.gestionada_at || a.created_at).getTime();
      const fb = new Date(b.gestionada_at || b.created_at).getTime();
      return fb - fa;
    });

    renderHistorialVentas(ventasFiltradas());
  }

  // =============================
  // ✅ NUEVO: Cargar venta manual (socios que compran en el club, no por la app)
  // =============================
  let socioSeleccionadoVentaManual = null;
  let responsablesCacheVentaManual = [];
  let timeoutBusquedaSocioVentaManual = null;

  function ventaManualPoblarProductos() {
    const select = $('#ventaManualProducto');
    if (!select) return;
    const activos = productosCache.filter(p => p.activo !== false);
    select.innerHTML = activos.length
      ? activos.map(p => `<option value="${p.id}">${escapeHtml(p.nombre)}</option>`).join('')
      : '<option value="">(no hay productos activos)</option>';
    ventaManualActualizarSegunProducto();
  }

  function ventaManualActualizarSegunProducto() {
    const select = $('#ventaManualProducto');
    const talleWrap = $('#ventaManualTalleWrap');
    const talleSelect = $('#ventaManualTalle');
    const precioInput = $('#ventaManualPrecio');
    if (!select) return;

    const p = productosCache.find(x => String(x.id) === String(select.value));
    if (!p) {
      if (talleWrap) talleWrap.style.display = 'none';
      return;
    }

    if (precioInput) precioInput.value = p.precio ?? '';

    const tieneTalles = p.tiene_talles === true && Array.isArray(p.talles) && p.talles.length > 0;
    if (talleWrap) talleWrap.style.display = tieneTalles ? '' : 'none';
    if (tieneTalles && talleSelect) {
      const conStock = p.talles.filter(t => Number(t.stock) > 0);
      talleSelect.innerHTML = conStock.length
        ? conStock.map(t => `<option value="${t.id}">${escapeHtml(t.talle)} (stock: ${t.stock})</option>`).join('')
        : '<option value="">(sin stock en ningún talle)</option>';
    }
  }

  // ✅ NUEVO: toggle "No socio" — oculta el buscador de socio y muestra el
  // campo de nombre de referencia opcional.
  function ventaManualActualizarSegunNoSocio() {
    const esNoSocio = !!$('#ventaManualNoSocio')?.checked;
    const socioWrap = $('#ventaManualSocioWrap');
    const nombreRefWrap = $('#ventaManualNombreReferenciaWrap');
    if (socioWrap) socioWrap.style.display = esNoSocio ? 'none' : '';
    if (nombreRefWrap) nombreRefWrap.style.display = esNoSocio ? '' : 'none';
  }

  function ventaManualActualizarSegunEstadoPago() {
    const estado = $('#ventaManualEstadoPago')?.value;
    const montoWrap = $('#ventaManualMontoWrap');
    const cuentaWrap = $('#ventaManualCuentaWrap');
    if (montoWrap) montoWrap.style.display = estado === 'parcial' ? '' : 'none';
    if (cuentaWrap) cuentaWrap.style.display = (estado === 'parcial' || estado === 'pagado') ? '' : 'none';
  }

  async function ventaManualCargarCuentas() {
    const clubId = getActiveClubId();
    const select = $('#ventaManualCuenta');
    if (!select) return;
    select.innerHTML = '<option value="">Cargando cuentas...</option>';
    const { res, data } = await fetchAuth(`/club/${clubId}/config/responsables`);
    responsablesCacheVentaManual = (res.ok && data.ok) ? (data.responsables || []) : [];
    select.innerHTML = responsablesCacheVentaManual.length
      ? responsablesCacheVentaManual.map(c => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join('')
      : '<option value="">(no hay cuentas configuradas)</option>';
  }

  function ventaManualSeleccionarSocio(s) {
    socioSeleccionadoVentaManual = s;
    const resultados = $('#ventaManualSocioResultados');
    const seleccionado = $('#ventaManualSocioSeleccionado');
    const busqueda = $('#ventaManualSocioBusqueda');
    if (resultados) { resultados.style.display = 'none'; resultados.innerHTML = ''; }
    if (busqueda) busqueda.value = '';
    if (seleccionado) {
      seleccionado.style.display = 'block';
      seleccionado.textContent = `Seleccionado: #${s.numero_socio ?? '—'} ${s.apellido ?? ''} ${s.nombre ?? ''}`.trim();
    }
  }

  async function ventaManualBuscarSocios(q) {
    const resultados = $('#ventaManualSocioResultados');
    if (!resultados) return;
    if (!q || q.trim().length < 2) {
      resultados.style.display = 'none';
      resultados.innerHTML = '';
      return;
    }
    const clubId = getActiveClubId();
    const { res, data } = await fetchAuth(`/club/${clubId}/socios?search=${encodeURIComponent(q.trim())}&limit=8`);
    const items = (res.ok && data.ok) ? (data.socios || []) : [];
    if (!items.length) {
      resultados.style.display = 'block';
      resultados.innerHTML = `<div class="item muted">Sin resultados</div>`;
      return;
    }
    resultados.style.display = 'block';
    resultados.innerHTML = items.map(s => `
      <div class="item" data-id="${s.id}">#${escapeHtml(s.numero_socio ?? '—')} ${escapeHtml(s.apellido ?? '')} ${escapeHtml(s.nombre ?? '')}</div>
    `).join('');
    resultados.querySelectorAll('.item[data-id]').forEach(el => {
      el.addEventListener('click', () => {
        const s = items.find(x => String(x.id) === el.dataset.id);
        if (s) ventaManualSeleccionarSocio(s);
      });
    });
  }

  function ventaManualResetear() {
    socioSeleccionadoVentaManual = null;
    const busqueda = $('#ventaManualSocioBusqueda');
    const seleccionado = $('#ventaManualSocioSeleccionado');
    const resultados = $('#ventaManualSocioResultados');
    if (busqueda) busqueda.value = '';
    if (seleccionado) { seleccionado.style.display = 'none'; seleccionado.textContent = ''; }
    if (resultados) { resultados.style.display = 'none'; resultados.innerHTML = ''; }
    if ($('#ventaManualNoSocio')) $('#ventaManualNoSocio').checked = false;
    if ($('#ventaManualNombreReferencia')) $('#ventaManualNombreReferencia').value = '';
    if ($('#ventaManualCantidad')) $('#ventaManualCantidad').value = '1';
    if ($('#ventaManualEstadoPago')) $('#ventaManualEstadoPago').value = 'pagado';
    if ($('#ventaManualMonto')) $('#ventaManualMonto').value = '';
    if ($('#ventaManualRetirado')) $('#ventaManualRetirado').checked = true;
    ventaManualActualizarSegunEstadoPago();
    ventaManualActualizarSegunNoSocio();
  }

  function ventaManualAbrir() {
    const overlay = $('#modalVentaManualOverlay');
    if (!overlay) return;
    ventaManualResetear();
    ventaManualPoblarProductos();
    ventaManualCargarCuentas();
    overlay.style.display = 'flex';
  }

  function ventaManualCerrar() {
    const overlay = $('#modalVentaManualOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  async function ventaManualConfirmar() {
    const esNoSocio = !!$('#ventaManualNoSocio')?.checked;
    if (!esNoSocio && !socioSeleccionadoVentaManual) {
      alert('Buscá y seleccioná el socio, o marcá "Venta a no socio".');
      return;
    }
    const productoId = $('#ventaManualProducto')?.value;
    if (!productoId) {
      alert('Seleccioná un producto.');
      return;
    }
    const p = productosCache.find(x => String(x.id) === String(productoId));
    const talleWrap = $('#ventaManualTalleWrap');
    const talleId = (talleWrap && talleWrap.style.display !== 'none') ? $('#ventaManualTalle')?.value : null;
    if (p?.tiene_talles && !talleId) {
      alert('Seleccioná el talle.');
      return;
    }

    const cantidad = Number($('#ventaManualCantidad')?.value);
    if (!Number.isInteger(cantidad) || cantidad < 1) {
      alert('Ingresá una cantidad válida.');
      return;
    }

    const estadoPago = $('#ventaManualEstadoPago')?.value || 'sin_pago';
    const body = {
      no_socio: esNoSocio,
      socio_id: esNoSocio ? null : socioSeleccionadoVentaManual.id,
      nombre_referencia: esNoSocio ? ($('#ventaManualNombreReferencia')?.value?.trim() || null) : null,
      producto_id: productoId,
      talle_id: talleId || null,
      cantidad,
      estado_pago: estadoPago,
      marcar_retirado: !!$('#ventaManualRetirado')?.checked,
    };

    if (estadoPago === 'parcial' || estadoPago === 'pagado') {
      const cuentaId = $('#ventaManualCuenta')?.value;
      if (!cuentaId) {
        alert('Seleccioná la cuenta / forma de pago.');
        return;
      }
      body.cuenta_id = cuentaId;
    }
    if (estadoPago === 'parcial') {
      const monto = Number(String($('#ventaManualMonto')?.value ?? '').replace(',', '.'));
      if (!Number.isFinite(monto) || monto <= 0) {
        alert('Ingresá el monto abonado.');
        return;
      }
      body.monto_pagado = monto;
    }

    const btnConfirm = $('#ventaManualConfirm');
    if (btnConfirm) btnConfirm.disabled = true;

    try {
      const clubId = getActiveClubId();
      const { res, data } = await fetchAuth(`/club/${clubId}/tienda/ventas-manuales`, {
        method: 'POST',
        json: true,
        body: JSON.stringify(body),
      });

      if (!res.ok || !data.ok) {
        alert(data.error || 'Error cargando la venta');
        return;
      }

      alert('✅ Venta cargada');
      ventaManualCerrar();
      await loadProductos();
      await loadHistorialVentas();
    } finally {
      if (btnConfirm) btnConfirm.disabled = false;
    }
  }

  // =============================
  // Init sección
  // =============================
  async function initTiendaSection() {
    bindOnce();
    resetForm();
    await loadCategoriasProducto();
    await loadProductos();
    await loadHistorialVentas();
  }

  // Exponer para club.js
  window.initTiendaSection = initTiendaSection;

  // Por si abren tienda.html directo
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('tienda-section')) {
      initTiendaSection();
    }
  });
})();
