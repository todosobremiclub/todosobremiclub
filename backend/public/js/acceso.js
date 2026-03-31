(() => {
  window.initAccesoSection = async function initAccesoSection() {
    const root = document.querySelector('.section-acceso');
    if (!root) return;

    // Re-bindeo seguro (si el HTML se reinserta)
    if (root.dataset.bound === '1') {
      // igual refrescamos overlay y estado (evita “colgado” si se reentró)
      const overlay = document.getElementById('qrOverlayText');
      if (overlay && overlay.textContent.trim() === '') overlay.textContent = 'Listo';
      return;
    }
    root.dataset.bound = '1';

    const $ = (id) => document.getElementById(id);

    const MONTHS_ES = [
      'Enero','Febrero','Marzo','Abril','Mayo','Junio',
      'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
    ];

    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    let stream = null;
    let detector = null;
    let scanning = false;
    let lastValue = null;
    let cooldownTimer = null;
    let cooldownActive = false;

    let zxingReader = null;
    let zxingControls = null;

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
        return { ok: false, pill: 'RECHAZADO ❌', msg: 'No hay último pago válido en el QR.', ultimoFmt: '—' };
      }

      const ok = (last >= (now - 1)) && (last <= (now + 1));
      if (ok) return { ok: true, pill: 'HABILITADO ✅', msg: 'Cuota al día (mes actual / anterior / siguiente).', ultimoFmt: fmtYM(ultimoPagoYM) };

      return { ok: false, pill: 'RECHAZADO ❌', msg: 'Cuota vencida (último pago anterior al mes anterior).', ultimoFmt: fmtYM(ultimoPagoYM) };
    }

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
      pillEl.classList.remove('ok', 'bad', 'neutral');
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
      const card = $('qrCard');
      if (card) card.classList.add('hidden');

      const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
      setText('qrNombre', '');
      setText('qrMeta', '');
      setText('qrClub', '');
      setText('qrAct', '');
      setText('qrCat', '');
      setText('qrUltimoPago', '');

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

    async function startCamera(auto = false) {
      setErr('');
      setOverlay('Iniciando cámara…');

      const video = $('qrVideo');
      if (!video) return;

      // Config anti-negro
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

      if (!hasNative && !hasZXing) {
        setErr('No hay lector QR disponible (sin BarcodeDetector y sin ZXing). Revisá /js/vendor/zxing-browser.min.js.');
        setOverlay('Pegá el QR manual');
        return;
      }

      try {
        if (!stream) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        }

        video.srcObject = stream;

        await new Promise((resolve) => {
          if (video.readyState >= 1) return resolve();
          video.onloadedmetadata = () => resolve();
        });

        try {
          await video.play();
        } catch (e) {
          const msg = (e && (e.name || e.message)) ? `${e.name || ''} ${e.message || ''}`.trim() : 'Error desconocido';
          console.error('video.play error:', e);

          if (auto) {
            setErr(`No se pudo auto-iniciar la cámara. (${msg})`);
            setOverlay('📱 Tocá “Iniciar cámara”');
            setStatus(null, 'Esperando lectura…', 'En celular se requiere un toque para activar la cámara.');
            setScanningVisual(false);
            return;
          }

          setErr(`No se pudo reproducir la cámara. (${msg})`);
          setOverlay('Permiso requerido');
          setStatus(false, 'RECHAZADO ❌', 'No se pudo reproducir la cámara.');
          setScanningVisual(false);
          return;
        }

        // reset estado lectura
        cooldownActive = false;
        scanning = false;
        lastValue = null;

        setStatus(null, 'Leyendo…', 'Apuntá al QR del carnet');
        setOverlay('📡 Leyendo QR…');
        setScanningVisual(true);

        // Nativo
        if (hasNative) {
          detector = detector || new BarcodeDetector({ formats: ['qr_code'] });
          scanning = true;
          scanLoop();
          return;
        }

        // ZXing fallback
        zxingReader = zxingReader || new window.ZXingBrowser.BrowserQRCodeReader();

        try { zxingControls?.stop(); } catch {}
        zxingControls = null;

        zxingControls = await zxingReader.decodeFromVideoDevice(
          null,
          'qrVideo',
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
      } catch (e) {
        const msg = (e && (e.name || e.message)) ? `${e.name || ''} ${e.message || ''}`.trim() : 'Error desconocido';
        console.error('startCamera error:', e);

        if (auto) {
          setErr(`No se pudo auto-iniciar la cámara. (${msg})`);
          setOverlay('📱 Tocá “Iniciar cámara”');
          setStatus(null, 'Esperando lectura…', 'En celular se requiere un toque para activar la cámara.');
          setScanningVisual(false);
        } else {
          setErr(`No se pudo iniciar la cámara. (${msg})`);
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

      try { zxingControls?.stop(); } catch {}
      zxingControls = null;

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

          if (detector) {
            scanning = true;
            scanLoop();
          }
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

        if (detector) {
          scanning = true;
          scanLoop();
        }
      }, 5000);
    }

    function clearUI() {
      setErr('');
      const manual = $('qrManual');
      if (manual) manual.value = '';
      clearCard();
      lastValue = null;

      setStatus(null, 'Esperando lectura…', '');
      setOverlay('Listo para leer');

      if (stream) {
        cooldownActive = false;
        setStatus(null, 'Leyendo…', 'Apuntá al QR del carnet');
        setOverlay('📡 Leyendo QR…');
        setScanningVisual(true);

        if (detector) {
          scanning = true;
          scanLoop();
        }
      }
    }

    // =============================
    // Bind botones
    // =============================
    $('btnQrStart')?.addEventListener('click', () => startCamera(false));
    $('btnQrStop')?.addEventListener('click', stopCamera);
    $('btnQrClear')?.addEventListener('click', () => clearUI());
    $('btnQrProcesar')?.addEventListener('click', async () => {
      const txt = $('qrManual')?.value || '';
      await handleQr(txt);
    });

    // Tap en el frame (mobile-friendly)
    document.querySelector('.scanner-frame')?.addEventListener('click', () => {
      if (!stream) startCamera(false);
    });

    // Auto-start:
    if (!isMobile) {
      setTimeout(() => startCamera(true), 150);
    } else {
      setOverlay('📱 Tocá “Iniciar cámara” para comenzar');
      setStatus(null, 'Esperando lectura…', 'En celular se requiere un toque para activar la cámara.');
      setScanningVisual(false);
    }

    window.cleanupAccesoSection = stopCamera;
  };
})();