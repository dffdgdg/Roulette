// Web Audio: синтезированные тики и победный звук, пользовательская музыка с точным fade-out.
// AudioContext создаётся и возобновляется только из unlock() — его вызывают в обработчике клика/клавиши.

let ctx = null;
let master = null;
let volume = 0.8;
let track = null; // {buffer, wheelId}
let music = null; // {src, gain}
let noiseBuffer = null;
let lastTick = 0;
let stateCb = null;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const toGain = (v) => v * v; // мягче на тихих значениях

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = toGain(volume);
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function setVolume(v) {
  volume = clamp01(v);
  if (master) master.gain.setTargetAtTime(toGain(volume), ctx.currentTime, 0.02);
}

export function setMusicStateListener(fn) { stateCb = fn; }

// Декодируем через OfflineAudioContext: ему не нужен жест пользователя
export async function decodeTrack(blob) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) throw new Error('Web Audio недоступен');
  const data = await blob.arrayBuffer();
  const off = new OAC(2, 1, 44100);
  return new Promise((resolve, reject) => {
    // Старые Safari принимают только колбэки
    const p = off.decodeAudioData(data, resolve, reject);
    if (p && p.catch) p.catch(reject);
  });
}

export function setTrack(buffer, wheelId = null) {
  stopMusic(0.05);
  track = buffer ? { buffer, wheelId } : null;
}

export function getTrack() {
  return track ? { duration: track.buffer.duration, wheelId: track.wheelId } : null;
}

// ───── Синтез ─────
function getNoise() {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.6), ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

// Щелчок колышка: короткий тон + шумовой «стук»; высота и громкость слегка плавают
export function playTick(strength = 1) {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  if (now - lastTick < 0.022) return;
  lastTick = now;
  const t = now + 0.004;
  const peak = (0.14 + Math.random() * 0.1) * clamp01(strength);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  const f = 1250 + Math.random() * 600;
  osc.frequency.setValueAtTime(f, t);
  osc.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.035);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.06);

  const src = ctx.createBufferSource();
  src.buffer = getNoise();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2400 + Math.random() * 1600;
  bp.Q.value = 1.1;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(peak * 0.9, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.022);
  src.connect(bp).connect(ng).connect(master);
  src.start(t, Math.random() * 0.4);
  src.stop(t + 0.03);
}

// Победный звук: четыре быстрые ноты, как «дзынь» кассы
export function playWin() {
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime + 0.05;
  const notes = [[523.25, 0, 0.12], [659.25, 0.09, 0.12], [783.99, 0.18, 0.12], [1046.5, 0.3, 0.55]];
  for (const [freq, at, len] of notes) {
    const t = t0 + at;
    for (const [type, mult, level] of [['triangle', 1, 0.22], ['sine', 2, 0.07]]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(level, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + len + 0.02);
    }
  }
}

// ───── Пользовательская музыка ─────
// duration — сколько секунд идёт вращение. Затухание заканчивается ровно в t0 + duration.
export function startMusic({ duration, startAt = 0, loop = true }) {
  if (!track) return false;
  const c = unlock();
  if (!c) return false;
  stopMusic(0.02);
  const buf = track.buffer;
  const offset = Math.min(Math.max(0, startAt), Math.max(0, buf.duration - 0.1));
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = loop;
  if (loop) {
    src.loopStart = offset;
    src.loopEnd = buf.duration;
  }
  const gain = c.createGain();
  const t0 = c.currentTime + 0.03;
  const fade = Math.min(1.2, duration * 0.5);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(1, t0 + 0.04);
  gain.gain.setValueAtTime(1, t0 + duration - fade);
  gain.gain.linearRampToValueAtTime(0, t0 + duration);
  src.connect(gain).connect(master);
  src.start(t0, offset);
  src.stop(t0 + duration + 0.05);
  src.onended = () => {
    if (music && music.src === src) {
      music = null;
      stateCb?.(false);
    }
  };
  music = { src, gain };
  stateCb?.(true);
  return true;
}

export function stopMusic(fade = 0.15) {
  if (!music || !ctx) return;
  const { src, gain } = music;
  music = null;
  const t = ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(0, t + fade);
  try { src.stop(t + fade + 0.02); } catch { /* уже остановлен */ }
  stateCb?.(false);
}

export const isMusicPlaying = () => !!music;
