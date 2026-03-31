(() => {
  // Exponer init para club.js
  window.initAccesoSection = async function initAccesoSection() {
    const root = document.querySelector('.section-acceso');
    if (!root) return;
    if (root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    const $ = (id) => document.getElementById(id);

    const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

    let stream = null;
    let detector = null;
    let scanning = false;
    let lastValue = null;
    let cooldownTimer = null;

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

      if (last == null) return { ok: false, pill: 'RECHAZADO ❌', msg: 'No hay último pago válido en el QR.', ultimoFmt: '—' };

      // ✅ autoriza si: actual, anterior o siguiente
      const ok = (last >= (now - 1)) && (last <= (now + 1));
      if (ok) return { ok: true, pill: 'HABILITADO ✅', msg: 'Cuota al día (mes actual/anterior/siguiente).', ultimoFmt: fmtYM(ultimoPagoYM) };

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
      pillEl.classList.remove('ok','bad','neutral');
      pillEl.classList.add(ok === true ? 'ok' : ok === false ? 'bad' : 'neutral');

      msgEl.textContent = msg || '';
      msgEl.classList.toggle('muted', !msg);
    }

    function renderCard(qr, ultimoPagoYM) {
      const card = $('qrCard');
      if (!card) return;
      card.classList.remove('hidden');

      const fotoEl = $('qrFoto');
      if (fotoEl) fotoEl.src = '/img/user-placeholder.png';

      const nombreCompleto = `${String(qr.nombre || '')} ${String(qr.apellido || '')}`.trim();
      $('qrNombre') && ($('qrNombre').textContent = nombreCompleto || '—');
      $('qrMeta') && ($('qrMeta').textContent = `DNI: ${String(qr.dni || '—')} · Socio Nº ${String(qr.numero || '—')}`);

      $('qrClub') && ($('qrClub').textContent = String(qr.clubNombre || qr.clubId || '—'));
      $('qrAct') && ($('qrAct').textContent = String(qr.actividad || '—'));
      $('qrCat') && ($('qrCat').textContent = String(qr.categoria || '—'));
      $('qrUltimoPago') && ($('qrUltimoPago').textContent = fmtYM(ultimoPagoYM));
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
      // El carnet Flutter incluye ultimoPago (YYYY-MM) [3](https://secarsecurity-my.sharepoint.com/personal/lsardella_securion_com_ar/Documents/Archivos%20de%20chat%20de%20Microsoft%C2%A0Copilot/socio.dart)
      const up = obj.ultimoPago || obj.ultimo_pago;
      if (!up) throw new Error('El QR no trae "ultimoPago".');
      return obj;
    }

    async function startCamera(auto = false) {
      setErr('');
      setOverlay('Iniciando cámara…');

      const video = $('qrVideo');
      if (!video) return;

      if (!navigator.mediaDevices?.getUserMedia) {
        setErr('Este navegador no soporta cámara.');
        setOverlay('Cámara no disponible');
        return;
      }

      // BarcodeDetector (sin librerías)
      if (!('BarcodeDetector' in window)) {
        setErr('Este navegador no soporta lectura QR nativa. Usá el pegado manual.');
        setOverlay('Pegá el QR manual');
        return;
      }

      try {
        // si ya hay stream, no pedir de nuevo
        if (!stream) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        }

        video.srcObject = stream;

        // Fix “pantalla negra”: esperar metadata y forzar play
        video.onloadedmetadata = () => {
          video.play().catch(() => {});
        };

        detector = detector || new BarcodeDetector({ formats: ['qr_code'] });

        scanning = true;
        setOverlay('Apuntá al QR…');
        setStatus(null, 'Leyendo…', 'Esperando QR del carnet.');

        scanLoop();
      } catch (e) {
        // Si auto-start falla por permisos, no es error grave: se informa y queda botón manual.
        if (auto) {
          setErr('Para habilitar la cámara, tocá “Iniciar cámara” y aceptá permisos.');
          setOverlay('Tocá “Iniciar cámara”');
          setStatus(null, 'Esperando lectura…', '');
        } else {
          setErr('No se pudo iniciar la cámara. Revisá permisos del navegador.');
          setOverlay('Permiso requerido');
          setStatus(false, 'RECHAZADO ❌', 'No se pudo iniciar la cámara.');
        }
      }
    }

    function stopCamera() {
      scanning = false;
      if (cooldownTimer) { clearTimeout(cooldownTimer); cooldownTimer = null; }

      const video = $('qrVideo');
      if (video) {
        try { video.pause(); } catch {}
        video.srcObject = null;
      }

      if (stream) {
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
      }
      stream = null;
      detector = null;

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
          if (val && val !== lastValue) {
            lastValue = val;
            await handleQr(val);
            return; // handleQr gestiona el “cooldown” y reanuda
          }
        }
      } catch {}

      requestAnimationFrame(scanLoop);
    }

    async function handleQr(raw) {
      setErr('');
      scanning = false; // pausa lectura (no apaga la cámara)

      let qr;
      try {
        qr = parseQrPayload(raw);
      } catch (e) {
        setStatus(false, 'RECHAZADO ❌', e.message || 'QR inválido');
        // reanudar en 2s si QR inválido
        cooldownTimer = setTimeout(() => {
          lastValue = null;
          scanning = true;
          setOverlay('Apuntá al QR…');
          scanLoop();
        }, 2000);
        return;
      }

      const ultimoPagoYM = qr.ultimoPago || qr.ultimo_pago || null;
      const decision = calcDecision(ultimoPagoYM);

      renderCard(qr, ultimoPagoYM);
      setStatus(decision.ok, decision.pill, `${decision.msg} (Último pago: ${decision.ultimoFmt})`);

      // ✅ después de 5 segundos vuelve a modo lectura para el próximo
      setOverlay('Resultado mostrado. Volviendo a leer en 5s…');
      cooldownTimer = setTimeout(() => {
        lastValue = null;
        scanning = true;
        setStatus(null, 'Leyendo…', 'Esperando QR del carnet.');
        setOverlay('Apuntá al QR…');
        scanLoop();
      }, 5000);
    }

    function clearUI() {
      setErr('');
      $('qrManual') && ($('qrManual').value = '');
      $('qrCard')?.classList.add('hidden');
      lastValue = null;
      setStatus(null, 'Esperando lectura…', '');
      setOverlay('Listo para leer');
    }

    // Bind botones
    $('btnQrStart')?.addEventListener('click', () => startCamera(false));
    $('btnQrStop')?.addEventListener('click', stopCamera);
    $('btnQrClear')?.addEventListener('click', () => {
      clearUI();
      // si la cámara está activa, volvemos a leer sin apagar
      if (stream && detector) {
        scanning = true;
        setOverlay('Apuntá al QR…');
        scanLoop();
      }
    });
    $('btnQrProcesar')?.addEventListener('click', async () => {
      const txt = $('qrManual')?.value || '';
      await handleQr(txt);
    });

    // Auto-start al entrar (si permisos lo permiten)
    setTimeout(() => startCamera(true), 150);

    // Cleanup al salir de la sección (club.js lo llama)
    window.cleanupAccesoSection = stopCamera;
  };
})();