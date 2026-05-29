const canvas = document.getElementById("bg-canvas");
const ctx = canvas.getContext("2d", { alpha: true });

let w, h, dpr;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  w = Math.floor(window.innerWidth * dpr);
  h = Math.floor(window.innerHeight * dpr);
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
}
window.addEventListener("resize", resize);
resize();

let t = 0;

function drawGlow(x, y, r, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(1, `rgba(255,255,255,0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function frame() {
  t += 0.0022;

  // Gradiente B/N animado
  const gx = w * (0.45 + Math.sin(t) * 0.18);
  const gy = h * (0.40 + Math.cos(t * 0.9) * 0.12);

  const bg = ctx.createLinearGradient(gx, gy, w, h);
  bg.addColorStop(0, "#0a0a0a");
  bg.addColorStop(0.55, "#121212");
  bg.addColorStop(1, "#070707");

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Luces suaves (B/N)
  ctx.globalCompositeOperation = "screen";
  drawGlow(w * 0.20 + Math.sin(t * 1.2) * 90, h * 0.28 + Math.cos(t) * 70, 380 * dpr, 0.08);
  drawGlow(w * 0.78 + Math.cos(t * 1.1) * 100, h * 0.62 + Math.sin(t * 0.9) * 80, 460 * dpr, 0.06);
  ctx.globalCompositeOperation = "source-over";

  requestAnimationFrame(frame);
}
frame();