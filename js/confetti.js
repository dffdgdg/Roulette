// Конфетти: бумажные прямоугольнички и кружки цветов палитры. Без блёсток и градиентов.

const TAU = Math.PI * 2;
let canvas = null;
let c = null;
let dpr = 1;
let pieces = [];
let raf = 0;
let last = 0;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
}

export function initConfetti(el) {
  canvas = el;
  c = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
}

export function clearConfetti() {
  pieces = [];
  cancelAnimationFrame(raf);
  raf = 0;
  if (c) c.clearRect(0, 0, canvas.width, canvas.height);
}

// colors — цвета палитры; x, y — точка залпа в CSS px
export function burst({ colors, x = window.innerWidth / 2, y = window.innerHeight * 0.45, count = 130 }) {
  if (!c || reducedMotion() || !colors?.length) return;
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.95;
    const speed = 420 + Math.random() * 780;
    pieces.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: 6 + Math.random() * 7,
      h: 10 + Math.random() * 9,
      rot: Math.random() * TAU,
      vr: (Math.random() - 0.5) * 12,
      wob: Math.random() * TAU,
      round: Math.random() < 0.28,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 0,
      ttl: 2.4 + Math.random() * 1.6,
    });
  }
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); }
}

function step(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.scale(dpr, dpr);
  pieces = pieces.filter((p) => p.life < p.ttl && p.y < window.innerHeight + 40);
  for (const p of pieces) {
    p.life += dt;
    p.vy += 1500 * dt;
    p.vx *= Math.exp(-1.7 * dt);
    p.vy *= Math.exp(-0.9 * dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    p.wob += 9 * dt;
    c.save();
    c.globalAlpha = Math.min(1, (p.ttl - p.life) / 0.5);
    c.translate(p.x, p.y);
    c.rotate(p.rot);
    c.fillStyle = p.color;
    if (p.round) {
      c.beginPath();
      c.arc(0, 0, p.w * 0.6, 0, TAU);
      c.fill();
    } else {
      // «Переворот» бумажки: ширина по косинусу
      c.scale(1, Math.max(0.15, Math.abs(Math.cos(p.wob))));
      c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }
    c.restore();
  }
  if (pieces.length) {
    raf = requestAnimationFrame(step);
  } else {
    raf = 0;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
  }
}
