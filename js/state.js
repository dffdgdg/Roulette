// Модель данных, действия и подписка на изменения.
// Состояние живёт в одном объекте; каждое действие меняет его и вызывает emit().

export const LIMITS = {
  wheels: 30,
  items: 200,
  history: 50,
  wheelName: 40,
  itemText: 120,
  durationMin: 3,
  durationMax: 20,
};

export const INK_DARK = '#1B1A17';
export const INK_LIGHT = '#F7F2E4';

export const PALETTES = [
  { id: 'print', name: 'Типография', colors: ['#D9482B', '#E8B031', '#2E6F68', '#31456E', '#D98B9A', '#7A8B3C', '#EFE3C6', '#8C5A3C'] },
  { id: 'veg', name: 'Овощная лавка', colors: ['#C8412B', '#E59A2E', '#5E8C3A', '#7B2D3B', '#F0C94A', '#3F6B4F', '#E8D9B5', '#A3B94A', '#4B2E4F'] },
  { id: 'stamp', name: 'Почтовая марка', colors: ['#B3362C', '#1F4E5F', '#D8A838', '#6C8E6B', '#E9DFC4', '#8C2F4A', '#3C5A7A', '#C97B4A', '#2B2A26'] },
  { id: 'night', name: 'Ночной рынок', colors: ['#E2533B', '#F2A03D', '#1F6F6A', '#8A3B5C', '#E7D7A8', '#3F4F7A', '#B8C24A', '#5B3A2E', '#D9788B', '#14312F'] },
];

export const TEMPLATES = [
  { id: 'empty', name: 'Пустое', items: [] },
  { id: 'food', name: 'Что поесть', items: ['Пицца', 'Суши', 'Бургер', 'Шаурма', 'Паста', 'Рамен'] },
  { id: 'dishes', name: 'Кто моет посуду', items: ['Аня', 'Борис', 'Вика', 'Гена'] },
  { id: 'yesno', name: 'Да или нет', items: ['Да', 'Нет'] },
  { id: 'dice', name: 'Кубик', items: ['1', '2', '3', '4', '5', '6'] },
  { id: 'movie', name: 'Жанр кино', items: ['Комедия', 'Драма', 'Триллер', 'Фантастика', 'Ужасы', 'Мультфильм'] },
];

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v, min, max, def) => {
  v = Number(v);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
};

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID().slice(0, 13);
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ───── Цвет текста по контрасту (WCAG) ─────
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const LUM_DARK = luminance(INK_DARK);
const LUM_LIGHT = luminance(INK_LIGHT);

export function textColorFor(hex) {
  const l = luminance(HEX.test(hex) ? hex : '#888888');
  return contrast(l, LUM_DARK) >= contrast(l, LUM_LIGHT) ? INK_DARK : INK_LIGHT;
}

// ───── Фабрики ─────
function paletteColors(id) {
  return (PALETTES.find((p) => p.id === id) ?? PALETTES[0]).colors;
}

// Цвет i-го из n: последний сектор не должен совпасть цветом с первым
function autoColor(colors, i, n) {
  let idx = i % colors.length;
  if (n > 1 && i === n - 1 && idx === 0) idx = Math.floor(colors.length / 2);
  return colors[idx];
}

function defaultSettings() {
  return {
    duration: 7,
    removeWinner: false,
    fitToTrack: false,
    palette: 'print',
    music: { loop: true, startAt: 0, tickWithMusic: false },
    image: { rotate: true, fill: 100, lines: true, labels: true },
  };
}

function createWheel(name, texts = [], paletteId = 'print') {
  const colors = paletteColors(paletteId);
  const settings = defaultSettings();
  settings.palette = paletteId;
  return {
    id: uid(),
    name,
    items: texts.map((text, i) => ({ id: uid(), text, color: autoColor(colors, i, texts.length) })),
    removed: [],
    history: [],
    settings,
    media: { audio: null, image: null },
  };
}

export function createDefaultState() {
  const food = createWheel('Что поесть', TEMPLATES.find((t) => t.id === 'food').items);
  const dishes = createWheel('Кто моет посуду', TEMPLATES.find((t) => t.id === 'dishes').items);
  return {
    version: 1,
    activeId: food.id,
    global: { theme: 'auto', volume: 0.8, tick: true, confetti: true },
    wheels: [food, dishes],
  };
}

// ───── Проверка и починка данных (из localStorage / другой вкладки) ─────
function sanitizeItem(raw, fallbackColor) {
  if (!raw || typeof raw.text !== 'string') return null;
  const text = raw.text.trim().slice(0, LIMITS.itemText);
  if (!text) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    text,
    color: HEX.test(raw.color) ? raw.color : fallbackColor,
  };
}

function sanitizeMeta(m) {
  if (!m || typeof m !== 'object' || typeof m.name !== 'string') return null;
  return {
    name: m.name.slice(0, 200),
    size: clamp(m.size, 0, 1e9, 0),
    type: typeof m.type === 'string' ? m.type.slice(0, 100) : '',
    duration: clamp(m.duration, 0, 36000, 0),
  };
}

const isCleanImage = (img) => img.fill === 0 && !img.lines && !img.labels;

export function normalizeWheel(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const d = defaultSettings();
  const palette = PALETTES.some((p) => p.id === s.palette) ? s.palette : d.palette;
  const colors = paletteColors(palette);
  const music = s.music && typeof s.music === 'object' ? s.music : {};
  const image = s.image && typeof s.image === 'object' ? s.image : {};

  const media = {
    audio: sanitizeMeta(raw.media?.audio),
    image: sanitizeMeta(raw.media?.image),
  };
  const settings = {
    duration: Math.round(clamp(s.duration, LIMITS.durationMin, LIMITS.durationMax, d.duration)),
    removeWinner: !!s.removeWinner,
    fitToTrack: !!s.fitToTrack && !!media.audio,
    palette,
    music: {
      loop: music.loop === undefined ? d.music.loop : !!music.loop,
      startAt: clamp(music.startAt, 0, 3600, 0),
      tickWithMusic: !!music.tickWithMusic,
    },
    image: {
      rotate: image.rotate === undefined ? d.image.rotate : !!image.rotate,
      fill: Math.round(clamp(image.fill, 0, 100, d.image.fill)),
      lines: image.lines === undefined ? d.image.lines : !!image.lines,
      labels: image.labels === undefined ? d.image.labels : !!image.labels,
    },
  };
  // «Чистая картинка» без картинки — возвращаем «Обычное»
  if (!media.image && isCleanImage(settings.image)) {
    settings.image.fill = 100;
    settings.image.lines = true;
    settings.image.labels = true;
  }

  const items = (Array.isArray(raw.items) ? raw.items : [])
    .slice(0, LIMITS.items)
    .map((it, i) => sanitizeItem(it, colors[i % colors.length]))
    .filter(Boolean);
  const removed = (Array.isArray(raw.removed) ? raw.removed : [])
    .slice(0, LIMITS.items)
    .map((it, i) => {
      const clean = sanitizeItem(it, colors[i % colors.length]);
      return clean && { ...clean, pos: Math.round(clamp(it.pos, 0, LIMITS.items, 0)) };
    })
    .filter(Boolean);
  const history = (Array.isArray(raw.history) ? raw.history : [])
    .slice(0, LIMITS.history)
    .map((e) => {
      const clean = sanitizeItem(e, '#888888');
      return clean && { ...clean, at: clamp(e.at, 0, 8.64e15, Date.now()) };
    })
    .filter(Boolean);

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    name: (typeof raw.name === 'string' ? raw.name.trim() : '').slice(0, LIMITS.wheelName) || 'Колесо',
    items, removed, history, settings, media,
  };
}

export function sanitizeState(raw) {
  if (!raw || !Array.isArray(raw.wheels)) throw new Error('Нет списка колёс');
  const seen = new Set();
  const wheels = raw.wheels.slice(0, LIMITS.wheels).map(normalizeWheel).filter(Boolean);
  for (const w of wheels) {
    if (seen.has(w.id)) w.id = uid();
    seen.add(w.id);
  }
  if (!wheels.length) wheels.push(createWheel('Колесо'));
  const g = raw.global && typeof raw.global === 'object' ? raw.global : {};
  return {
    version: 1,
    activeId: wheels.some((w) => w.id === raw.activeId) ? raw.activeId : wheels[0].id,
    global: {
      theme: ['auto', 'light', 'dark'].includes(g.theme) ? g.theme : 'auto',
      volume: clamp(g.volume, 0, 1, 0.8),
      tick: g.tick === undefined ? true : !!g.tick,
      confetti: g.confetti === undefined ? true : !!g.confetti,
    },
    wheels,
  };
}

// ───── Хранилище состояния и подписка ─────
let state = createDefaultState();
let spinning = false;
const listeners = new Set();

function emit(reason, source = 'local') {
  for (const fn of [...listeners]) {
    try { fn(state, reason, source); } catch (e) { console.error(e); }
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() { return state; }

// source: 'boot' | 'local' | 'external'
export function setState(next, { source = 'local' } = {}) {
  state = next;
  emit(source === 'external' ? 'external' : 'replace', source);
}

export function isSpinning() { return spinning; }
export function setSpinning(value) {
  spinning = !!value;
  emit('spin');
}

export function getActiveWheel() {
  return state.wheels.find((w) => w.id === state.activeId) ?? state.wheels[0];
}
export function getWheel(id) { return state.wheels.find((w) => w.id === id) ?? null; }

const cleanName = (name) => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.wheelName);

// ───── Колёса ─────
export function setActive(id) {
  if (spinning || !getWheel(id) || state.activeId === id) return false;
  state.activeId = id;
  emit('active');
  return true;
}

export function addWheel(name, templateId = 'empty') {
  if (spinning || state.wheels.length >= LIMITS.wheels) return null;
  const tpl = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
  const fallback = tpl.id === 'empty' ? `Колесо ${state.wheels.length + 1}` : tpl.name;
  const wheel = createWheel(cleanName(name) || fallback, tpl.items);
  state.wheels.push(wheel);
  state.activeId = wheel.id;
  emit('wheels');
  return wheel;
}

export function renameWheel(id, name) {
  const w = getWheel(id);
  const clean = cleanName(name);
  if (!w || !clean) return false;
  w.name = clean;
  emit('wheels');
  return true;
}

// Копия включает мета-данные медиа; сами Blob копирует вызывающий код под newId
export function duplicateWheel(id, newId = uid()) {
  const src = getWheel(id);
  if (!src || spinning || state.wheels.length >= LIMITS.wheels) return null;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = newId;
  copy.name = `${src.name} (копия)`.slice(0, LIMITS.wheelName);
  copy.items.forEach((i) => { i.id = uid(); });
  copy.removed.forEach((i) => { i.id = uid(); });
  copy.history = [];
  state.wheels.splice(state.wheels.indexOf(src) + 1, 0, copy);
  state.activeId = copy.id;
  emit('wheels');
  return copy;
}

export function removeWheel(id) {
  if (spinning) return false;
  const idx = state.wheels.findIndex((w) => w.id === id);
  if (idx < 0) return false;
  state.wheels.splice(idx, 1);
  if (!state.wheels.length) state.wheels.push(createWheel('Колесо'));
  if (state.activeId === id || !getWheel(state.activeId)) {
    state.activeId = state.wheels[Math.min(idx, state.wheels.length - 1)].id;
  }
  emit('wheels');
  return true;
}

export function moveWheel(id, dir) {
  const idx = state.wheels.findIndex((w) => w.id === id);
  const to = idx + dir;
  if (idx < 0 || to < 0 || to >= state.wheels.length) return false;
  [state.wheels[idx], state.wheels[to]] = [state.wheels[to], state.wheels[idx]];
  emit('wheels');
  return true;
}

// ───── Варианты ─────
function nextColor(w) {
  const colors = paletteColors(w.settings.palette);
  const last = w.items[w.items.length - 1];
  const li = last ? colors.indexOf(last.color) : -1;
  return li >= 0 ? colors[(li + 1) % colors.length] : colors[w.items.length % colors.length];
}

export function addItem(text, color) {
  const w = getActiveWheel();
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.itemText);
  if (spinning || !clean || w.items.length >= LIMITS.items) return null;
  const item = { id: uid(), text: clean, color: HEX.test(color) ? color : nextColor(w) };
  w.items.push(item);
  emit('items');
  return item;
}

export function addItems(lines) {
  const w = getActiveWheel();
  if (spinning) return 0;
  let added = 0;
  for (const line of lines) {
    const clean = String(line).replace(/\s+/g, ' ').trim().slice(0, LIMITS.itemText);
    if (!clean || w.items.length >= LIMITS.items) continue;
    w.items.push({ id: uid(), text: clean, color: nextColor(w) });
    added++;
  }
  if (added) emit('items');
  return added;
}

export function updateItem(id, patch) {
  const w = getActiveWheel();
  const item = w.items.find((i) => i.id === id);
  if (spinning || !item) return false;
  if (typeof patch.text === 'string') {
    const clean = patch.text.replace(/\s+/g, ' ').trim().slice(0, LIMITS.itemText);
    if (clean) item.text = clean;
  }
  if (HEX.test(patch.color)) item.color = patch.color;
  emit('items');
  return true;
}

export function removeItem(id) {
  const w = getActiveWheel();
  const idx = w.items.findIndex((i) => i.id === id);
  if (spinning || idx < 0) return false;
  w.items.splice(idx, 1);
  emit('items');
  return true;
}

export function shuffleItems() {
  const w = getActiveWheel();
  if (spinning || w.items.length < 2) return false;
  for (let i = w.items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [w.items[i], w.items[j]] = [w.items[j], w.items[i]];
  }
  emit('items');
  return true;
}

export function clearItems() {
  const w = getActiveWheel();
  if (spinning) return false;
  w.items = [];
  w.removed = [];
  emit('items');
  return true;
}

export function setPalette(paletteId) {
  const w = getActiveWheel();
  if (spinning || !PALETTES.some((p) => p.id === paletteId)) return false;
  w.settings.palette = paletteId;
  const colors = paletteColors(paletteId);
  w.items.forEach((it, i) => { it.color = autoColor(colors, i, w.items.length); });
  w.removed.forEach((it, i) => { it.color = colors[i % colors.length]; });
  emit('items');
  return true;
}

// ───── Выбывшие и история ─────
export function removeItemToRemoved(itemId) {
  const w = getActiveWheel();
  const idx = w.items.findIndex((i) => i.id === itemId);
  if (spinning || idx < 0) return false;
  const [item] = w.items.splice(idx, 1);
  w.removed.push({ ...item, pos: idx });
  emit('items');
  return true;
}

export function restoreRemoved() {
  const w = getActiveWheel();
  if (spinning || !w.removed.length) return 0;
  const list = [...w.removed].sort((a, b) => a.pos - b.pos);
  let count = 0;
  for (const { pos, ...item } of list) {
    if (w.items.length >= LIMITS.items) break;
    w.items.splice(Math.min(pos, w.items.length), 0, item);
    count++;
  }
  w.removed = list.slice(count);
  emit('items');
  return count;
}

export function recordResult(wheelId, item) {
  const w = getWheel(wheelId);
  if (!w || !item) return null;
  const entry = { id: uid(), text: item.text, color: item.color, at: Date.now() };
  w.history.unshift(entry);
  w.history.length = Math.min(w.history.length, LIMITS.history);
  emit('history');
  return entry;
}

export function clearHistory() {
  getActiveWheel().history = [];
  emit('history');
}

// ───── Настройки ─────
export function updateSettings(patch) {
  const w = getActiveWheel();
  const s = w.settings;
  if ('duration' in patch) s.duration = Math.round(clamp(patch.duration, LIMITS.durationMin, LIMITS.durationMax, s.duration));
  if ('removeWinner' in patch) s.removeWinner = !!patch.removeWinner;
  if ('fitToTrack' in patch) s.fitToTrack = !!patch.fitToTrack && !!w.media.audio;
  emit('settings');
}

export function updateMusic(patch) {
  const m = getActiveWheel().settings.music;
  if ('loop' in patch) m.loop = !!patch.loop;
  if ('startAt' in patch) m.startAt = Math.round(clamp(patch.startAt, 0, 3600, m.startAt) * 10) / 10;
  if ('tickWithMusic' in patch) m.tickWithMusic = !!patch.tickWithMusic;
  emit('settings');
}

export function updateImage(patch, wheelId) {
  const w = wheelId ? getWheel(wheelId) : getActiveWheel();
  if (!w) return;
  const img = w.settings.image;
  if ('rotate' in patch) img.rotate = !!patch.rotate;
  if ('fill' in patch) img.fill = Math.round(clamp(patch.fill, 0, 100, img.fill));
  if ('lines' in patch) img.lines = !!patch.lines;
  if ('labels' in patch) img.labels = !!patch.labels;
  emit('settings');
}

export function updateGlobal(patch) {
  const g = state.global;
  if (['auto', 'light', 'dark'].includes(patch.theme)) g.theme = patch.theme;
  if ('volume' in patch) g.volume = clamp(patch.volume, 0, 1, g.volume);
  if ('tick' in patch) g.tick = !!patch.tick;
  if ('confetti' in patch) g.confetti = !!patch.confetti;
  emit('global');
}

// kind: 'audio' | 'image'; meta: {name,size,type,duration?} или null
export function setMedia(wheelId, kind, meta) {
  const w = getWheel(wheelId);
  if (!w) return;
  w.media[kind] = meta ? sanitizeMeta(meta) : null;
  if (!meta && kind === 'audio') w.settings.fitToTrack = false;
  if (!meta && kind === 'image' && isCleanImage(w.settings.image)) {
    w.settings.image.fill = 100;
    w.settings.image.lines = true;
    w.settings.image.labels = true;
  }
  emit('media');
}
