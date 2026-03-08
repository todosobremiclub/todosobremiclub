(() => {
  const $ = (id) => document.getElementById(id);

  function qs(){
    const p = new URLSearchParams(location.search);
    return { clubId: p.get('clubId'), t: p.get('t') };
  }

  function onlyDigits(v){ return String(v ?? '').replace(/\D+/g,''); }

  async function loadOptions(){
    const { clubId, t } = qs();
    const res = await fetch(`/public/club/${clubId}/apply/options?t=${encodeURIComponent(t)}`);
    const data = await res.json().catch(()=>({ok:false}));
    if (!res.ok || !data.ok) throw new Error(data.error || 'No autorizado');

    const act = $('actividad');
    const cat = $('categoria');
    act.innerHTML = '<option value="">Seleccionar...</option>' + data.actividades.map(x=>`<option>${x}</option>`).join('');
    cat.innerHTML = '<option value="">Seleccionar...</option>' + data.categorias.map(x=>`<option>${x}</option>`).join('');
  }

  function showMsg(text, ok){
    const box = $('msg');
    box.className = ok ? 'ok' : 'err';
    box.textContent = text;
  }

  function readFileAsBase64(file){
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const dataUrl = String(r.result || '');
        const i = dataUrl.indexOf(',');
        if (i < 0) return reject(new Error('No se pudo leer la imagen'));
        resolve({ base64: dataUrl.slice(i+1), mimetype: file.type || 'image/jpeg' });
      };
      r.onerror = () => reject(new Error('Error leyendo archivo'));
      r.readAsDataURL(file);
    });
  }

  async function submit(){
    const { clubId, t } = qs();
    if (!clubId || !t) return showMsg('QR inválido (faltan parámetros).', false);

    const payload = {
      nombre: $('nombre').value.trim(),
      apellido: $('apellido').value.trim(),
      dni: onlyDigits($('dni').value),
      actividad: $('actividad').value.trim(),
      categoria: $('categoria').value.trim(),
      telefono: $('telefono').value.trim(),
      direccion: $('direccion').value.trim(),
      fecha_nacimiento: $('fecha_nacimiento').value.trim()
    };

    if (!payload.nombre || !payload.apellido || !payload.dni || !payload.actividad || !payload.categoria || !payload.fecha_nacimiento){
      return showMsg('Completá Nombre, Apellido, DNI, Actividad, Categoría y Fecha de nacimiento.', false);
    }

    const file = $('foto').files && $('foto').files[0];
    if (file){
      const img = await readFileAsBase64(file);
      payload.foto_base64 = img.base64;
      payload.foto_mimetype = img.mimetype;
    }

    const res = await fetch(`/public/club/${clubId}/apply?t=${encodeURIComponent(t)}`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(()=>({ok:false, error:'Respuesta inválida'}));
    if (!res.ok || !data.ok){
      return showMsg(data.error || 'Error enviando postulación', false);
    }

    showMsg('✅ Postulación enviada. Quedó pendiente de aprobación.', true);

    // bloquear botón
    $('enviar').disabled = true;
    $('enviar').style.opacity = '0.6';
  }

  $('foto')?.addEventListener('change', async () => {
    const file = $('foto').files && $('foto').files[0];
    if (!file) return;
    $('preview').style.display = 'flex';
    $('previewImg').src = URL.createObjectURL(file);
    $('previewMeta').textContent = `${file.name} (${Math.round(file.size/1024)} KB)`;
  });

  $('enviar')?.addEventListener('click', () => submit().catch(e => showMsg(e.message, false)));

  loadOptions().catch(e => showMsg(e.message, false));
})();