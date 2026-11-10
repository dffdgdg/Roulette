// Точка входа: связывает состояние, хранилище, колесо, звук и интерфейс.

import * as S from './state.js';
import * as store from './storage.js';
import * as media from './media.js';
import * as audio from './audio.js';
import * as ui from './ui.js';
import { createWheelView, randomInt } from './wheel.js';
import { initConfetti, burst } from './confetti.js';

let view = null;
let currentImage = null; // ImageBitmap активного колеса
let imageWheelId = null;
let loadedWheelId = null;
let mediaToken = 0; // защита от гонок при быстром переключении колёс
let tickAllowed = true;
let pendingExternal = null; // изменения из другой вкладки, пришедшие во время вращения
let lastTheme = null;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const errorToast = (message) => ui.toast(message, { kind: 'error' });
const warnMemoryOnly = () => ui.toast('Хранилище браузера закрыто: файл проживёт только до закрытия вкладки.', { timeout: 7000 });

// ───── Данные для отрисовки ─────
function refreshView() {
  const w = S.getActiveWheel();
  const image = imageWheelId === w.id && w.media.image ? currentImage : null;
  view?.setData({ items: w.items, image, imageSettings: w.settings.image });
}

function setImage(bitmap, wheelId) {
  const old = currentImage;
  currentImage = bitmap;
  imageWheelId = bitmap ? wheelId : null;
  ui.setImagePreview(bitmap);
  refreshView();
  old?.close?.(); // освобождаем память прежней картинки
}

// Подтягиваем медиа активного колеса из IndexedDB
async function syncMedia() {
  const w = S.getActiveWheel();
  const id = w.id;
  const hasImage = !!w.media.image;
  const hasAudio = !!w.media.audio;
  const token = ++mediaToken;
  loadedWheelId = id;
  setImage(null, null);
  audio.setTrack(null);

  if (hasImage) {
    const rec = await store.getMedia(id, 'image');
    if (token !== mediaToken) return;
    let bitmap = null;
    if (rec) {
      try { bitmap = await media.blobToBitmap(rec.blob); } catch { bitmap = null; }
    }
    if (token !== mediaToken) { bitmap?.close?.(); return; }
    if (bitmap) {
      setImage(bitmap, id);
    } else {
      S.setMedia(id, 'image', null);
      errorToast('Картинка колеса не нашлась. Вернул обычный вид.');
    }
  }

  if (hasAudio) {
    const rec = await store.getMedia(id, 'audio');
    if (token !== mediaToken) return;
    let buffer = null;
    if (rec) {
      try { buffer = await audio.decodeTrack(rec.blob); } catch { buffer = null; }
    }
    if (token !== mediaToken) return;
    if (buffer) {
      audio.setTrack(buffer, id);
    } else {
      S.setMedia(id, 'audio', null);
      errorToast('Музыка колеса не открылась. Загрузите файл заново.');
    }
  }
}

// ───── Подписка на состояние ─────
function onChange(st, reason, source) {
  if (reason !== 'spin' && source === 'local') store.scheduleSave(S.getState);
  if (st.global.theme !== lastTheme) {
    lastTheme = st.global.theme;
    ui.applyTheme(lastTheme);
    view?.invalidate();
  }
  audio.setVolume(st.global.volume);
  if (S.getActiveWheel().id !== loadedWheelId || reason === 'external') syncMedia();
  else refreshView();
}

// ───── Прокрутка ─────
function spin() {
  if (S.isSpinning() || view?.isSpinning()) return;
  const w = S.getActiveWheel();
  const n = w.items.length;
  if (n < 2) {
    ui.toast(n === 0 ? 'Тут пока пусто. Впишите хотя бы два варианта' : 'Нужен ещё хотя бы один вариант. С одним крутить нечего.');
    return;
  }
  audio.unlock(); // строго внутри обработчика пользовательского действия
  ui.closeResult();

  const reduced = reducedMotion();
  const index = randomInt(n); // победитель выбран до анимации
  const track = audio.getTrack();
  let duration = w.settings.duration;
  if (track && w.settings.fitToTrack) {
    duration = Math.min(30, Math.max(3, track.duration - w.settings.music.startAt));
  }
  tickAllowed = S.getState().global.tick && (!track || w.settings.music.tickWithMusic);

  S.setSpinning(true);
  if (track) audio.startMusic({ duration, startAt: w.settings.music.startAt, loop: w.settings.music.loop });

  view.spin({ index, duration, reduced })
    .then((stopIndex) => onStop(w.id, stopIndex, reduced))
    .catch((e) => { console.error(e); S.setSpinning(false); });
}

function onStop(wheelId, index, reduced) {
  S.setSpinning(false);
  const w = S.getWheel(wheelId);
  const item = w?.items[index];
  if (!item) return;
  const entry = S.recordResult(wheelId, item);
  if (!audio.getTrack()) audio.playWin();
  ui.announce(`Выпало: ${item.text}`);

  if (S.getState().global.confetti && !reduced) {
    const rect = document.getElementById('wheel-box').getBoundingClientRect();
    const palette = S.PALETTES.find((p) => p.id === w.settings.palette) ?? S.PALETTES[0];
    burst({ colors: palette.colors, x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.35 });
  }

  const removeWinner = w.settings.removeWinner;
  ui.showResult({
    item,
    wheelName: w.name,
    number: w.history.length,
    at: entry.at,
    canRemove: !removeWinner,
    onAgain: spin,
    onRemove: () => removeFromWheel(item),
  });

  if (removeWinner) {
    S.removeItemToRemoved(item.id);
    notifyLastOne();
  }

  if (pendingExternal) {
    const next = pendingExternal;
    pendingExternal = null;
    applyExternal(next);
  }
}

function notifyLastOne() {
  const w = S.getActiveWheel();
  if (w.items.length === 1) {
    ui.toast('Остался один вариант: он и победил. Верните выбывших, чтобы крутить дальше.', { timeout: 7000 });
  }
}

function removeFromWheel(item) {
  if (S.removeItemToRemoved(item.id)) {
    ui.toast(`Убрал «${item.text}» из колеса.`, { kind: 'ok' });
    notifyLastOne();
  }
}

// ───── Другая вкладка ─────
function applyExternal(next) {
  const keep = S.getActiveWheel().id;
  if (next.wheels.some((x) => x.id === keep)) next.activeId = keep;
  S.setState(next, { source: 'external' });
}

function onExternal(next) {
  ui.toast('Колёса изменены в другой вкладке');
  if (S.isSpinning()) pendingExternal = next; // не ломаем текущую прокрутку
  else applyExternal(next);
}

// ───── Медиа ─────
async function uploadImage(file) {
  if (S.isSpinning()) { ui.toast('Колесо крутится. Файл можно сменить после остановки.'); return; }
  const v = media.validateImageFile(file);
  if (!v.ok) { errorToast(v.error); return; }
  const wheelId = S.getActiveWheel().id;
  let packed;
  let bitmap;
  try {
    packed = await media.compressImage(file);
    bitmap = await media.blobToBitmap(packed.blob);
  } catch {
    errorToast('Картинку не получилось прочитать. Попробуйте JPG, PNG или WebP.');
    return;
  }
  const res = await store.putMedia(wheelId, 'image', packed.blob, { name: file.name, type: packed.blob.type });
  S.setMedia(wheelId, 'image', { name: file.name, size: packed.blob.size, type: packed.blob.type });
  if (S.getActiveWheel().id === wheelId) setImage(bitmap, wheelId);
  else bitmap.close?.();
  ui.toast('Картинка легла в колесо.', { kind: 'ok' });
  if (!res.persisted) warnMemoryOnly();
}

async function removeImage() {
  if (S.isSpinning()) return;
  const id = S.getActiveWheel().id;
  await store.deleteMedia(id, 'image');
  S.setMedia(id, 'image', null);
  setImage(null, null);
}

async function uploadAudio(file) {
  if (S.isSpinning()) { ui.toast('Колесо крутится. Файл можно сменить после остановки.'); return; }
  const v = media.validateAudioFile(file);
  if (!v.ok) { errorToast(v.error); return; }
  const wheelId = S.getActiveWheel().id;
  let buffer;
  try {
    buffer = await audio.decodeTrack(file);
  } catch {
    errorToast('Звук не расшифровался. Попробуйте MP3, WAV или OGG.');
    return; // прежняя музыка остаётся нетронутой
  }
  const res = await store.putMedia(wheelId, 'audio', file, { name: file.name, type: file.type });
  S.setMedia(wheelId, 'audio', { name: file.name, size: file.size, type: file.type, duration: buffer.duration });
  if (S.getActiveWheel().id === wheelId) audio.setTrack(buffer, wheelId);
  ui.toast('Музыка загружена.', { kind: 'ok' });
  if (!res.persisted) warnMemoryOnly();
}

async function removeAudio() {
  if (S.isSpinning()) return;
  const id = S.getActiveWheel().id;
  audio.setTrack(null);
  await store.deleteMedia(id, 'audio');
  S.setMedia(id, 'audio', null);
}

function testAudio() {
  if (S.isSpinning()) return;
  if (audio.isMusicPlaying()) { audio.stopMusic(0.25); return; }
  const w = S.getActiveWheel();
  audio.unlock();
  if (!audio.startMusic({ duration: 6, startAt: w.settings.music.startAt, loop: w.settings.music.loop })) {
    errorToast('Музыки у этого колеса пока нет.');
  }
}

// ───── Действия с колёсами ─────
async function duplicateWheel(id) {
  if (S.isSpinning()) { ui.toast('Колесо крутится. Дублировать можно после остановки.'); return; }
  if (S.getState().wheels.length >= S.LIMITS.wheels) {
    errorToast(`Колёс может быть не больше ${S.LIMITS.wheels}.`);
    return;
  }
  const newId = S.uid();
  try {
    await store.copyMedia(id, newId); // сначала копируем Blob, потом создаём колесо
  } catch {
    errorToast('Файлы колеса скопировать не вышло. Колесо дублируется без них.');
  }
  if (!S.duplicateWheel(id, newId)) store.deleteWheelMedia(newId);
  else ui.toast('Копия готова.', { kind: 'ok' });
}

async function deleteWheel(id) {
  if (S.isSpinning()) { ui.toast('Колесо крутится, удалить его нельзя.'); return; }
  if (S.removeWheel(id)) await store.deleteWheelMedia(id);
}

async function resetAll() {
  if (S.isSpinning()) { ui.toast('Подождите, пока колесо остановится.'); return; }
  audio.stopMusic(0.05);
  ui.closeResult();
  await store.clearAllData();
  S.setState(S.createDefaultState());
  ui.toast('Всё стёрто. Начинаем с чистого листа.', { kind: 'ok' });
}

// ───── Запуск ─────
async function boot() {
  const { state, status } = store.loadState();
  S.setState(state, { source: 'boot' });
  lastTheme = state.global.theme;
  ui.applyTheme(lastTheme);

  ui.initUI({ spin, uploadImage, removeImage, uploadAudio, removeAudio, testAudio, duplicateWheel, deleteWheel, resetAll });
  audio.setVolume(state.global.volume);
  audio.setMusicStateListener(ui.setMusicPlaying);
  view = createWheelView(document.getElementById('wheel-canvas'), {
    onTick: (strength) => { if (tickAllowed) audio.playTick(strength); },
  });
  initConfetti(document.getElementById('confetti'));
  refreshView();

  const idbOk = await store.initMedia();
  if (status === 'corrupt') {
    ui.toast('Сохранённые данные оказались повреждены. Копию я отложил, а колёса начались заново.', { kind: 'error', timeout: 9000 });
  }
  if (status === 'unavailable' || !idbOk) {
    ui.showStorageBanner(status === 'unavailable'
      ? 'Хранилище закрыто (похоже, приватный режим): колёса не сохранятся после закрытия вкладки.'
      : 'Файлы сохранить негде: музыка и картинки пропадут после закрытия вкладки.');
  }

  S.subscribe(onChange);
  store.onSaveError(() => errorToast('Не получилось сохранить: в хранилище браузера нет места.'));
  store.watchExternal(onExternal);
  store.scheduleSave(S.getState);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flushSave(); });
  window.addEventListener('pagehide', () => store.flushSave());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (S.getState().global.theme === 'auto') {
      ui.applyTheme('auto');
      view.invalidate();
    }
  });

  await syncMedia();

  // Подписи на колесе рисуются шрифтом заголовков: ждём его (не дольше 1,5 с) и перерисовываем
  if (document.fonts?.load) {
    Promise.race([
      document.fonts.load('800 24px "Bitter"', 'АБВабв Abc'),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]).then(() => view.invalidate()).catch(() => {});
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
