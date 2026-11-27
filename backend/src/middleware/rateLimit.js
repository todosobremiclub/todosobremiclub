// src/middleware/rateLimit.js
//
// Límite de intentos en memoria (sin dependencias externas).
//
// Cada "limitador" cuenta pedidos por una clave (normalmente la IP) dentro de una
// ventana de tiempo. Si se supera el máximo, responde 429 ("Demasiados intentos") con
// el encabezado Retry-After y NO ejecuta la ruta, hasta que vence la ventana.
//
// Dos modos:
//  - contar todo (formularios públicos, pedido de reseteo, demo): cada pedido suma.
//  - contarSoloFallos (logins): el pedido suma al empezar y se DEVUELVE si termina bien
//    (status < 400). Así un uso normal no gasta intentos, pero una ráfaga de pedidos en
//    paralelo igual se frena porque cada uno suma apenas entra.
//
// Limitación conocida: el estado vive en la memoria de UN proceso. Con una sola
// instancia (como hoy en Render) alcanza; si algún día hay varias instancias, cada una
// lleva su propia cuenta (habría que pasar a Redis).
//
// Importante: para que la IP sea la del cliente y no la del proxy de Render hay que
// tener app.set('trust proxy', N) (ver src/app.js).

const almacenes = new Map(); // nombre -> Map(clave -> { n, vence })

function getAlmacen(nombre) {
  let a = almacenes.get(nombre);
  if (!a) { a = new Map(); almacenes.set(nombre, a); }
  return a;
}

// Limpieza periódica de entradas vencidas (no mantiene vivo el proceso).
const timer = setInterval(() => {
  const ahora = Date.now();
  for (const a of almacenes.values()) {
    for (const [k, v] of a) if (v.vence <= ahora) a.delete(k);
  }
}, 60 * 1000);
if (timer.unref) timer.unref();

function ipDe(req) {
  return req.ip || req.socket?.remoteAddress || 'desconocida';
}

// Suma 1 a la clave. Devuelve { permitido, restante, retryAfterSeg }.
function intentar(nombre, clave, max, ventanaMs, ahora = Date.now()) {
  const a = getAlmacen(nombre);
  let e = a.get(clave);
  if (!e || e.vence <= ahora) {
    e = { n: 0, vence: ahora + ventanaMs };
    a.set(clave, e);
  }
  if (e.n >= max) {
    return { permitido: false, restante: 0, retryAfterSeg: Math.max(1, Math.ceil((e.vence - ahora) / 1000)) };
  }
  e.n += 1;
  return { permitido: true, restante: max - e.n, retryAfterSeg: 0 };
}

function devolver(nombre, clave) {
  const e = getAlmacen(nombre).get(clave);
  if (e && e.n > 0) e.n -= 1;
}

function crearLimitador({
  nombre,
  ventanaMs,
  max,
  clave = ipDe,
  contarSoloFallos = false,
  mensaje = 'Demasiados intentos. Probá de nuevo en unos minutos.'
}) {
  return function limitador(req, res, next) {
    const k = String(clave(req));
    const r = intentar(nombre, k, max, ventanaMs);
    if (!r.permitido) {
      console.warn(`🚫 rate-limit "${nombre}" bloqueó a ${k} (reintento en ${r.retryAfterSeg}s)`);
      res.set('Retry-After', String(r.retryAfterSeg));
      return res.status(429).json({ ok: false, error: mensaje, retry_after_seg: r.retryAfterSeg });
    }
    if (contarSoloFallos) {
      res.on('finish', () => {
        if (res.statusCode < 400) devolver(nombre, k);
      });
    }
    next();
  };
}

function _reset() { almacenes.clear(); }

module.exports = { crearLimitador, intentar, ipDe, _reset };
