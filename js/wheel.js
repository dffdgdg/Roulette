// Отрисовка колеса на canvas и физика: вращение, колышки, флажок на пружине.
// Статичная часть (картинка, секторы, подписи, обод, колышки) кэшируется в слое
// и вращается через ctx.rotate; флажок рисуется поверх каждый кадр.

import { textColorFor, INK_DARK, INK_LIGHT } from './state.js';

export const HEAD_FONT = '"Bitter", "Rockwell", "Roboto Slab", Georgia, serif';
const TAU = Math.PI * 2;
const mod = (a, n) => ((a % n) + n) % n;

// ───── Случайность через crypto ─────
export function randomUnit() {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0] / 4294967296;
}

// Равновероятное целое [0, n) без modulo bias (rejection sampling)
export function randomInt(n) {
  const limit = Math.floor(4294967296 / n) * n;
  const b = new Uint32Array(1);
  do { crypto.getRandomValues(b); } while (b[0] >= limit);
  return b[0] % n;
}

// ───── Текст ─────
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;
const graphemes = (s) => (segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : Array.from(s));

// Обрезка по графемам (эмодзи не рвутся) с «…»
function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  const g = graphemes(text);
  let lo = 0;
  let hi = g.length - 1;
  let best = '…';
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cand = `${g.slice(0, mid).join('').trimEnd()}…`;
    if (ctx.measureText(cand).width <= maxW) { best = cand; lo = mid + 1; } else { hi = mid - 1; }
  }
  return best;
}

// ───── Кривая вращения ─────
// Скорость: линейный разгон за долю a, затем степенной спад (1-s)^p.
// Позиция считается аналитически; в конце скорость плавно равна нулю.
function makeEasing(reduced) {
  const a = reduced ? 0.03 : 0.07;
  const p = 3.4;
  const v0 = 1 / (a / 2 + (1 - a) / (p + 1));
  return (tau) => {
    if (tau <= 0) return 0;
    if (tau >= 1) return 1;
    if (tau < a) return (v0 * tau * tau) / (2 * a);
    const s = (tau - a) / (1 - a);
    return (v0 * a) / 2 + ((v0 * (1 - a)) / (p + 1)) * (1 - (1 - s) ** (p + 1));
  };
}

// Пружина флажка
const SPRING_K = 1500;
const SPRING_C = 2 * 0.2 * Math.sqrt(SPRING_K);

export function createWheelView(canvas, { onTick }) {
  const ctx = canvas.getContext('2d');
  let W = 0; // размер canvas в device px
  let dpr = 1;
  let data = { items: [], image: null, img: { rotate: true, fill: 100, lines: true, labels: true } };
  let sig = '';
  let theta = 0; // угол поворота колеса, рад, по часовой
  let rotLayer = null;
  let bgLayer = null;
  let dirty = true;
  const flag = { d: 0, v: 0 }; // отклонение флажка (рад, вправо) и скорость
  let spinState = null;
  let lastK = 0;
  let raf = 0;
  let lastTs = 0;
  let reducedNow = false;

  const imageIds = new WeakMap();
  let imageCounter = 0;
  const idOfImage = (img) => {
    if (!img) return 0;
    if (!imageIds.has(img)) imageIds.set(img, ++imageCounter);
    return imageIds.get(img);
  };

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // Эффективные настройки: без картинки колесо всегда «обычное»
  function effective() {
    const hasImg = !!data.image;
    return {
      hasImg,
      fill: hasImg ? data.img.fill / 100 : 1,
      lines: hasImg ? data.img.lines : true,
      labels: hasImg ? data.img.labels : true,
      rotate: data.img.rotate,
    };
  }

  function geo() {
    const n = data.items.length;
    const R = W * 0.455;
    const rimW = R * 0.075;
    return {
      n, R, rimW,
      Rin: R - rimW,
      Rpeg: R - rimW / 2,
      cx: W / 2,
      cy: W / 2,
      seg: n > 0 ? TAU / n : TAU,
      hubR: W * 0.105,
    };
  }

  const makeLayer = () => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = W;
    return c;
  };

  function paintImage(x, g) {
    const img = data.image;
    const iw = img.width || img.naturalWidth;
    const ih = img.height || img.naturalHeight;
    const d = g.Rin * 2;
    const scale = Math.max(d / iw, d / ih);
    x.save();
    x.beginPath();
    x.arc(g.cx, g.cy, g.Rin, 0, TAU);
    x.clip();
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, g.cx - (iw * scale) / 2, g.cy - (ih * scale) / 2, iw * scale, ih * scale);
    x.restore();
  }

  function drawLabels(x, g, fx) {
    const { n, seg, cx, cy } = g;
    const rIn = Math.max(W * 0.145, g.hubR * 1.35);
    const rOut = g.Rin - W * 0.03;
    const avail = rOut - rIn;
    const midR = (rIn + rOut) / 2;
    const arcW = n > 1 ? 2 * midR * Math.tan(Math.min(seg, Math.PI * 0.9) / 2) : Infinity;
    const maxSize = Math.min(W * 0.052, arcW * 0.62);
    if (maxSize < 5 * dpr) return; // слишком мелко — подписи не рисуем
    const outline = fx.hasImg && fx.fill < 0.7;
    x.textAlign = 'right';
    x.textBaseline = 'middle';
    x.lineJoin = 'round';
    data.items.forEach((item, i) => {
      const text = item.text.replace(/\s+/g, ' ').trim();
      if (!text) return;
      x.font = `800 ${maxSize}px ${HEAD_FONT}`;
      let size = maxSize;
      const w = x.measureText(text).width;
      if (w > avail) {
        size = Math.max(maxSize * 0.62, (maxSize * avail) / w);
        x.font = `800 ${size}px ${HEAD_FONT}`;
      }
      const label = fitText(x, text, avail);
      x.save();
      x.translate(cx, cy);
      x.rotate((i + 0.5) * seg - Math.PI / 2);
      if (outline) {
        x.lineWidth = size * 0.3;
        x.strokeStyle = INK_DARK;
        x.strokeText(label, rOut, 0);
        x.fillStyle = INK_LIGHT;
      } else {
        x.fillStyle = textColorFor(item.color);
      }
      x.fillText(label, rOut, 0);
      x.restore();
    });
  }

  function buildLayers() {
    const g = geo();
    const fx = effective();
    const { n, cx, cy, seg } = g;
    const paper = css('--surface');
    const rim = css('--rim');
    const line = css('--line');
    const peg = css('--mustard');
    const detached = fx.hasImg && !fx.rotate; // картинка неподвижна: отдельный слой снизу

    bgLayer = null;
    if (detached) {
      bgLayer = makeLayer();
      const b = bgLayer.getContext('2d');
      b.fillStyle = paper;
      b.beginPath();
      b.arc(cx, cy, g.Rin, 0, TAU);
      b.fill();
      paintImage(b, g);
    }

    rotLayer = makeLayer();
    const x = rotLayer.getContext('2d');
    if (!detached) {
      x.fillStyle = paper;
      x.beginPath();
      x.arc(cx, cy, g.Rin, 0, TAU);
      x.fill();
      if (fx.hasImg) paintImage(x, g);
    }

    // Секторы
    if (n > 0) {
      const overlap = fx.fill >= 1 ? 0.004 : 0;
      x.globalAlpha = fx.fill;
      data.items.forEach((item, i) => {
        x.fillStyle = item.color;
        x.beginPath();
        if (n === 1) {
          x.arc(cx, cy, g.Rin, 0, TAU);
        } else {
          x.moveTo(cx, cy);
          x.arc(cx, cy, g.Rin, i * seg - Math.PI / 2, (i + 1) * seg - Math.PI / 2 + overlap);
          x.closePath();
        }
        x.fill();
      });
      x.globalAlpha = 1;
    }

    // Линии между секторами
    if (fx.lines && n > 1) {
      x.strokeStyle = rim;
      x.lineWidth = Math.max(0.6 * dpr, Math.min(W * 0.0035, ((TAU * g.Rin) / n) * 0.12));
      x.beginPath();
      for (let i = 0; i < n; i++) {
        const a = i * seg - Math.PI / 2;
        x.moveTo(cx + Math.cos(a) * g.hubR * 0.9, cy + Math.sin(a) * g.hubR * 0.9);
        x.lineTo(cx + Math.cos(a) * g.Rin, cy + Math.sin(a) * g.Rin);
      }
      x.stroke();
    }

    if (fx.labels && n > 0) drawLabels(x, g, fx);

    // Обод
    x.beginPath();
    x.arc(cx, cy, g.R, 0, TAU);
    x.arc(cx, cy, g.Rin, 0, TAU, true);
    x.fillStyle = rim;
    x.fill('evenodd');
    x.strokeStyle = line;
    x.lineWidth = W * 0.006;
    x.beginPath();
    x.arc(cx, cy, g.R - x.lineWidth / 2, 0, TAU);
    x.stroke();
    x.beginPath();
    x.arc(cx, cy, g.Rin, 0, TAU);
    x.stroke();

    // Колышки по границам секторов
    if (n > 0) {
      const pr = Math.min(g.rimW * 0.2, ((TAU * g.Rpeg) / n) * 0.28);
      if (pr >= 0.8 * dpr) {
        x.fillStyle = peg;
        x.strokeStyle = rim;
        x.lineWidth = Math.max(1, pr * 0.3);
        for (let i = 0; i < n; i++) {
          const a = i * seg - Math.PI / 2;
          x.beginPath();
          x.arc(cx + Math.cos(a) * g.Rpeg, cy + Math.sin(a) * g.Rpeg, pr, 0, TAU);
          x.fill();
          if (pr > 2.2 * dpr) x.stroke();
        }
      }
    }
  }

  // Флажок-«хлопушка» сверху
  function drawFlag() {
    const u = W;
    const accent = css('--accent');
    const line = css('--line');
    const rimInk = css('--rim');
    ctx.save();
    ctx.translate(W / 2, u * 0.033);
    ctx.rotate(-flag.d);
    ctx.lineJoin = 'round';
    ctx.lineWidth = u * 0.0065;
    ctx.strokeStyle = line;
    ctx.fillStyle = accent;
    const wTop = 0.02 * u;
    const wMid = 0.0115 * u;
    const L = 0.066 * u;
    ctx.beginPath();
    ctx.moveTo(-wTop, 0);
    ctx.lineTo(wTop, 0);
    ctx.lineTo(wMid, L * 0.68);
    ctx.lineTo(0, L);
    ctx.lineTo(-wMid, L * 0.68);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = css('--mustard');
    ctx.strokeStyle = rimInk === line ? line : rimInk;
    ctx.beginPath();
    ctx.arc(0, 0, u * 0.011, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    if (!W) return;
    if (dirty) { buildLayers(); dirty = false; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, W);
    if (bgLayer) ctx.drawImage(bgLayer, 0, 0);
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.rotate(theta);
    ctx.drawImage(rotLayer, -W / 2, -W / 2);
    ctx.restore();
    drawFlag();
  }

  // ───── Физика флажка ─────
  // Колышко подходит к кончику слева и сдвигает его вправо; после прохождения
  // флажок срывается и пружинит. Тик звучит в момент прохождения.
  let contact = { hw: 0, wc: 0 };

  function updateContact(g, speedF) {
    const spacing = g.seg * g.Rpeg;
    const base = Math.min(W * 0.0145, spacing * 0.45);
    const speedScale = 1 - 0.35 * Math.min(1, speedF / 40); // на скорости отклонение меньше
    const hw = base * speedScale * (reducedNow ? 0.6 : 1);
    contact = { hw, wc: Math.asin(Math.min(1, hw / g.Rpeg)) };
  }

  function flagStep(dt, th, g) {
    const dPivot = W * 0.0291;
    let push = 0;
    if (g.n > 0) {
      const before = g.seg - mod(th, g.seg); // расстояние до ближайшего колышка перед флажком
      if (before < contact.wc) {
        const dx = contact.hw - g.Rpeg * Math.sin(before);
        push = Math.asin(Math.min(0.9, Math.max(0, dx / dPivot)));
      }
    }
    flag.v += (-SPRING_K * flag.d - SPRING_C * flag.v) * dt;
    flag.d += flag.v * dt;
    if (push > flag.d) {
      flag.d = push;
      if (flag.v < 0) flag.v = 0;
    }
  }

  function tickStrength(f) {
    return f < 8 ? 1 : Math.max(0.35, 1 - ((Math.min(f, 60) - 8) / 52) * 0.65);
  }

  function advance(newTheta, dt, omega) {
    const g = geo();
    const prev = theta;
    theta = newTheta;
    const f = g.n > 0 ? Math.abs(omega) / g.seg : 0; // колышков в секунду
    if (g.n === 0 || dt <= 0) { flagStep(Math.max(dt, 0.001), theta, g); return; }
    updateContact(g, f);
    const k1 = Math.floor(theta / g.seg);
    if (k1 - lastK > 6) {
      // Вкладка спала: пропустили много колышков — один тик и сброс флажка
      flag.d = 0;
      flag.v = 0;
      lastK = k1;
      if (spinState) onTick?.(0.5);
      return;
    }
    const steps = Math.min(40, Math.max(1, Math.ceil(dt / (1 / 240))));
    const sdt = dt / steps;
    for (let s = 1; s <= steps; s++) {
      const th = prev + ((theta - prev) * s) / steps;
      flagStep(sdt, th, g);
      const k = Math.floor(th / g.seg);
      if (k > lastK) {
        lastK = k;
        if (spinState) onTick?.(tickStrength(f));
      }
    }
  }

  function indexAtPointer() {
    const n = data.items.length;
    if (!n) return -1;
    return Math.min(n - 1, Math.floor(mod(-theta, TAU) / (TAU / n)));
  }

  function finishSpin() {
    const s = spinState;
    if (!s) return;
    const final = s.theta0 + s.total;
    advance(final, 0.016, 0);
    spinState = null;
    clearTimeout(s.timer);
    theta = mod(theta, TAU);
    lastK = Math.floor(theta / (TAU / Math.max(1, data.items.length)));
    draw();
    ensureLoop();
    s.resolve(indexAtPointer());
  }

  function frame() {
    raf = 0;
    const now = performance.now();
    const dt = lastTs ? Math.min((now - lastTs) / 1000, 0.1) : 1 / 60;
    lastTs = now;
    if (spinState) {
      const s = spinState;
      const tau = Math.min(1, (now - s.t0) / (s.T * 1000));
      const target = s.theta0 + s.total * s.ease(tau);
      advance(target, dt, (target - theta) / Math.max(dt, 0.001));
      if (tau >= 1) finishSpin();
    } else {
      advance(theta, dt, 0);
    }
    draw();
    if (spinState || Math.abs(flag.d) > 0.002 || Math.abs(flag.v) > 0.05) {
      raf = requestAnimationFrame(frame);
    } else {
      lastTs = 0;
      flag.d = 0;
      flag.v = 0;
    }
  }

  function ensureLoop() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  // ───── Публичное API ─────
  function setData({ items, image, imageSettings }) {
    const nextSig = `${JSON.stringify([items.map((i) => [i.text, i.color]), imageSettings])}|${idOfImage(image)}`;
    if (nextSig === sig && W) return;
    sig = nextSig;
    data = { items: items.map((i) => ({ text: i.text, color: i.color })), image, img: { ...imageSettings } };
    dirty = true;
    ensureLoop();
  }

  function invalidate() {
    dirty = true;
    ensureLoop();
  }

  // Победитель выбран заранее (index); считаем конечный угол так, чтобы
  // колесо остановилось в случайной точке внутри сектора (8–92 % его ширины).
  function spin({ index, duration, reduced = false }) {
    return new Promise((resolve) => {
      const n = data.items.length;
      const seg = TAU / n;
      reducedNow = reduced;
      theta = mod(theta, TAU);
      lastK = Math.floor(theta / seg);
      const frac = 0.08 + randomUnit() * 0.84;
      const localAngle = (index + frac) * seg;
      const turns = 4 + Math.min(5, Math.floor(duration / 4)) + (randomUnit() < 0.5 ? 0 : 1);
      const total = turns * TAU + mod(-localAngle - theta, TAU);
      spinState = {
        theta0: theta,
        total,
        T: duration,
        t0: performance.now(),
        ease: makeEasing(reduced),
        resolve,
        // страховка: во фоновой вкладке rAF стоит, а таймер сработает
        timer: setTimeout(finishSpin, duration * 1000 + 120),
      };
      lastTs = 0;
      ensureLoop();
    });
  }

  // Размер canvas с учётом devicePixelRatio
  const ro = new ResizeObserver(() => {
    dpr = window.devicePixelRatio || 1;
    const size = Math.min(2400, Math.round(canvas.clientWidth * dpr));
    if (!size || size === W) return;
    W = size;
    canvas.width = W;
    canvas.height = W;
    dirty = true;
    ensureLoop();
  });
  ro.observe(canvas);

  return { setData, invalidate, spin, isSpinning: () => !!spinState, indexAtPointer };
}
