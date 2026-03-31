(() => {
  window.initAccesoSection = async function initAccesoSection() {
    const root = document.querySelector('.section-acceso');
    if (!root) return;
    if (root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    const $ = (id) => document.getElementById(id);
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    const MONTHS_ES = [
      'Enero','Febrero','Marzo','Abril','Mayo','Junio',
      'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
    ];

    // Estado cámara / lectura
    let stream = null;          // SOLO modo nativo
    let detector = null;        // BarcodeDetector (si existe)
    let scanning = false;
    let lastValue = null;
    let cooldownTimer = null;
    let cooldownActive = false;

    // ZXing fallback
    let zxingReader = null;
    let zxingControls = null;   // controls.stop() detiene stream interno de ZXing

    // =============================
    // Helpers fecha/mes
    // =============================
    function ymToIndex(ym) {
      if (!ym) return null;
      const s = String(ym).trim();
      const m = s.match(/^(\d{4})-(\d{2})$/);
      if (!m) return null;
      const y = Number(m[1]);
      const mo = Number(m[2]);
      if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null;
      return (y * 12) + (mo - 1);
    }

    function fmtYM(ym) {
      const idx = ymToIndex(ym);
      if (idx == null) return '—';
      const y = Math.floor(idx / 12);
      const m = idx % 12;
      return `${MONTHS_ES[m]} ${y}`;
    }

    function nowIndex() {
      const d = new Date();
      return d.getFullYear() * 12 + d.getMonth();
    }

    function calcDecision(ultimoPagoYM) {
      const last = ymToIndex(ultimoPagoYM);
      const now = nowIndex();

      if (last == null) {
        return { ok:false, pill:'RECHAZADO ❌', msg:'No hay último pago válido en el QR.', ultimoFmt:'—' };
      }

      const ok = (last >= (now - 1)) && (last <= (now + 1));
      if (ok) return { ok:true, pill:'HABILITADO ✅', msg:'Cuota al día (mes actual / anterior / siguiente).', ultimoFmt: fmtYM(ultimoPagoYM) };

      return { ok:false, pill:'RECHAZADO ❌', msg:'Cuota vencida (último pago anterior al mes anterior).', ultimoFmt: fmtYM(ultimoPagoYM) };
    }

    // =============================
    // UI helpers
    // =============================
    function setOverlay(text) {
      const el = $('qrOverlayText');
      if (el) el.textContent = text || '';
    }

    function setErr(text) {
      const el = $('qrErr');
      if (el) el.textContent = text || '';
    }

    function setStatus(ok, pill, msg) {
      const pillEl = $('qrStatusPill');
      const msgEl = $('qrStatusMsg');
      if (!pillEl || !msgEl) return;

      pillEl.textContent = pill || '—';
      pillEl.classList.remove('ok','bad','neutral');
      pillEl.classList.add(ok === true ? 'ok' : ok === false ? 'bad' : 'neutral');

      msgEl.textContent = msg || '';
      msgEl.classList.toggle('muted', !msg);
    }

    function setScanningVisual(on) {
      const video = $('qrVideo');
      if (!video) return;
      if (on) video.classList.add('scanning');
      else video.classList.remove('scanning');
    }

    function clearCard() {
      $('qrCard')?.classList.add('hidden');

      const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
      setText('qrNombre','');
      setText('qrMeta','');
      setText('qrClub','');
      setText('qrAct','');
      setText('qrCat','');
      setText('qrUltimoPago','');

      const fotoEl = $('qrFoto');
      if (fotoEl) fotoEl.src = '/img/user-placeholder.png';
    }

    function renderCard(qr, ultimoPagoYM) {
      const card = $('qrCard');
      if (!card) return;

      const fotoEl = $('qrFoto');
      const fotoUrl = qr.fotoUrl || qr.foto_url || qr.fotoURL || qr.foto || null;
      if (fotoEl) fotoEl.src = fotoUrl || '/img/user-placeholder.png';

      const nombreCompleto = `${String(qr.nombre || '')} ${String(qr.apellido || '')}`.trim();
      $('qrNombre') && ($('qrNombre').textContent = nombreCompleto || '—');

      const dni = String(qr.dni || '—');
      const num = String(qr.numero || qr.numero_socio || '—');
      $('qrMeta') && ($('qrMeta').textContent = `DNI: ${dni} · Socio Nº ${num}`);

      $('qrClub') && ($('qrClub').textContent = String(qr.clubNombre || qr.clubId || '—'));
      $('qrAct') && ($('qrAct').textContent = String(qr.actividad || '—'));
      $('qrCat') && ($('qrCat').textContent = String(qr.categoria || '—'));
      $('qrUltimoPago') && ($('qrUltimoPago').textContent = fmtYM(ultimoPagoYM));

      card.classList.remove('hidden');
    }

    // =============================
    // Parse QR
    // =============================
    function parseQrPayload(raw) {
      const s = String(raw || '').trim();
      if (!s) throw new Error('QR vacío');

      let obj;
      try { obj = JSON.parse(s); }
      catch {
        try { obj = JSON.parse(decodeURIComponent(s)); }
        catch { throw new Error('El QR no es JSON válido'); }
      }

      if (!obj || typeof obj !== 'object') throw new Error('Formato de QR inválido');

      const up = obj.ultimoPago || obj.ultimo_pago;
      if (!up) throw new Error('El QR no trae "ultimoPago".');

      return obj;
    }

    // =============================
    // getUserMedia con timeout (evita “iniciando” eterno)
    // =============================
    async function getUserMediaWithTimeout(constraints, ms = 5000) {
      return await Promise.race([
        navigator.mediaDevices.getUserMedia(constraints),
        new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT_getUserMedia')), ms))
      ]);
    }

    // =============================
    // Start/Stop Camera
    // =============================
    async function startCamera(auto = false) {
      setErr('');
      setOverlay('Iniciando cámara…');

      const video = $('qrVideo');
      if (!video) return;

      // anti-negro/autoplay
      video.setAttribute('playsinline', 'true');
      video.setAttribute('autoplay', 'true');
      video.muted = true;
      video.autoplay = true;
      video.controls = false;

      if (!navigator.mediaDevices?.getUserMedia) {
        setErr('Este navegador no soporta cámara.');
        setOverlay('Cámara no disponible');
        return;
      }

      const hasNative = ('BarcodeDetector' in window);
      const hasZXing = !!(window.ZXingBrowser && window.ZXingBrowser.BrowserQRCodeReader);

      // Preferimos ZXing en mobile porque maneja mejor permisos/loop
      const useZXing = hasZXing; // si existe ZXing, usarlo siempre

      if (!hasNative && !hasZXing) {
        setErr('No hay lector QR disponible (sin BarcodeDetector y sin ZXing).');
        setOverlay('Pegá el QR manual');
        return;
      }

      // reset estado
      cooldownActive = false;
      scanning = false;
      lastValue = null;

      setStatus(null, 'Leyendo…', 'Apuntá al QR del carnet');
      setOverlay('📡 Leyendo QR…');
      setScanningVisual(true);

      try {
        if (useZXing) {
          // ---- ZXing: NO pedimos getUserMedia nosotros (ZXing lo hace) ----
          zxingReader = zxingReader || new window.ZXingBrowser.BrowserQRCodeReader();

          // si había una sesión anterior
          try { zxingControls?.stop(); } catch {}
          zxingControls = null;

          // ZXing coloca el stream en el <video> automáticamente
          zxingControls = await zxingReader.decodeFromVideoDevice(
            null,         // null => cámara trasera si existe
            'qrVideo',    // id del video
            async (result, err) => {
              if (cooldownActive) return;
              if (result) {
                const text = result.getText();
                if (!text) return;
                if (text === lastValue) return;
                lastValue = text;
                await handleQr(text);
              }
            }
          );

          return;
        }

        // ---- Nativo: pedimos stream nosotros + BarcodeDetector ----
        if (!stream) {
          // timeout para evitar “colgado”
          stream = await getUserMediaWithTimeout(
            { video: { facingMode: { ideal: 'environment' } }, audio: false },
            6000
          );
        }

        video.srcObject = stream;

        await new Promise((resolve) => {
          if (video.readyState >= 1) return resolve();
          video.onloadedmetadata = () => resolve();
        });

        await video.play();

        detector = detector || new BarcodeDetector({ formats: ['qr_code'] });
        scanning = true;
        scanLoop();
      } catch (e) {
        console.error('startCamera error', e);
        const msg = (e && (e.name || e.message)) ? `${e.name || ''} ${e.message || ''}`.trim() : String(e);

        if (String(msg).includes('TIMEOUT_getUserMedia')) {
          setErr('La cámara tardó demasiado en responder (Chrome móvil a veces se cuelga). Cerrá otras apps que usen cámara y reintentá.');
        } else {
          setErr(`No se pudo iniciar la cámara. (${msg})`);
        }

        // En mobile, siempre pedir gesto
        if (isMobile || auto) {
          setOverlay('📱 Tocá “Iniciar cámara” para comenzar');
          setStatus(null, 'Esperando lectura…', 'En celular se requiere un toque para activar la cámara.');
          setScanningVisual(false);
        } else {
          setOverlay('Permiso requerido');
          setStatus(false, 'RECHAZADO ❌', 'No se pudo iniciar la cámara.');
          setScanningVisual(false);
        }
      }
    }

    function stopCamera() {
      scanning = false;
      cooldownActive = true;
      setScanningVisual(false);

      if (cooldownTimer) {
        clearTimeout(cooldownTimer);
        cooldownTimer = null;
      }

      // stop ZXing
      try { zxingControls?.stop(); } catch {}
      zxingControls = null;

      // stop native
      detector = null;

      const video = $('qrVideo');
      if (video) {
        try { video.pause(); } catch {}
        video.srcObject = null;
      }

      if (stream) {
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
      }
      stream = null;

      setOverlay('Cámara detenida');
      setStatus(null, 'Esperando lectura…', '');
    }

    async function scanLoop() {
      if (!scanning || !detector) return;
      const video = $('qrVideo');
      if (!video) return;

      try {
        const codes = await detector.detect(video);
        if (codes && codes.length) {
          const val = codes[0].rawValue;
          if (val && val !== lastValue && !cooldownActive) {
            lastValue = val;
            await handleQr(val);
            return;
          }
        }
      } catch {}

      requestAnimationFrame(scanLoop);
    }

    async function handleQr(raw) {
      setErr('');
      cooldownActive = true;
      scanning = false;
      setScanningVisual(false);

      clearCard();

      let qr;
      try {
        qr = parseQrPayload(raw);
      } catch (e) {
        setStatus(false, 'RECHAZADO ❌', e.message || 'QR inválido');
        setOverlay('QR inválido. Reintentando…');

        if (cooldownTimer) clearTimeout(cooldownTimer);
        cooldownTimer = setTimeout(() => {
          cooldownActive = false;
          lastValue = null;
          setStatus(null, 'Leyendo…', 'Apuntá al QR del carnet');
          setOverlay('📡 Leyendo QR…');
          setScanningVisual(true);

          if (detector) { scanning = true; scanLoop(); }
          // ZXing sigue corriendo solo
        }, 2000);
        return;
      }

      const ultimoPagoYM = qr.ultimoPago || qr.ultimo_pago || null;
      const decision = calcDecision(ultimoPagoYM);

      renderCard(qr, ultimoPagoYM);
      setStatus(decision.ok, decision.pill, `${decision.msg} (Último pago: ${decision.ultimoFmt})`);
      setOverlay('Resultado mostrado. Volviendo a leer en 5s…');

      if (cooldownTimer) clearTimeout(cooldownTimer);
      cooldownTimer = setTimeout(() => {
        cooldownActive = false;
        lastValue = null;

        setStatus(null, 'Leyendo…', 'Apuntá al QR del carnet');
        setOverlay('📡 Leyendo QR…');
        setScanningVisual(true);

        if (detector) { scanning = true; scanLoop(); }
        // ZXing: no reiniciar
      }, 5000);
    }

    function clearUI() {
      setErr('');
      $('qrManual') && ($('qrManual').value = '');
      clearCard();
      lastValue = null;

      setStatus(null, 'Esperando lectura…', '');
      setOverlay('Listo para leer');

      // si cámara está activa, volver a lectura
      if (stream || zxingControls) {
        cooldownActive = false;
        setStatus(null, 'Leyendo…', 'Apuntá al QR del carnet');
        setOverlay('📡 Leyendo QR…');
        setScanningVisual(true);

        if (detector) { scanning = true; scanLoop(); }
      }
    }

    // =============================
    // Bind botones (IMPORTANTÍSIMO: fuera de otros handlers)
    // =============================
    $('btnQrStart')?.addEventListener('click', () => startCamera(false));
    $('btnQrStop')?.addEventListener('click', stopCamera);
    $('btnQrClear')?.addEventListener('click', clearUI);
    $('btnQrProcesar')?.addEventListener('click', async () => {
      const txt = $('qrManual')?.value || '';
      await handleQr(txt);
    });

    // Tap en el frame (gesto para mobile)
    document.querySelector('.scanner-frame')?.addEventListener('click', () => {
      if (!stream && !zxingControls) startCamera(false);
    });

    // Auto-start: solo PC. Mobile siempre por gesto.
    if (!isMobile) {
      setTimeout(() => startCamera(true), 150);
    } else {
      setOverlay('📱 Tocá “Iniciar cámara” para comenzar');
      setStatus(null, 'Esperando lectura…', 'En celular se requiere un toque para activar la cámara.');
      setScanningVisual(false);
    }

    // Cleanup al salir
    window.cleanupAccesoSection = stopCamera;
  };
})();
