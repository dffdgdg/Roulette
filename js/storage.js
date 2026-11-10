// localStorage (состояние) и IndexedDB (Blob аудио/картинок), миграции, debounce-сохранение.

import { createDefaultState, sanitizeState } from './state.js';

export const LS_KEY = 'wheel:v1:state';
export const LS_CORRUPT = 'wheel:v1:corrupt';
const LS_PREFIX = 'wheel:v1:';
const CURRENT_VERSION = 1;
const DB_NAME = 'wheel-media';
const STORE = 'blobs';

// ───── localStorage ─────
let lsChecked = null;
export function localStorageAvailable() {
  if (lsChecked !== null) return lsChecked;
  try {
    const k = `${LS_PREFIX}probe`;
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    lsChecked = true;
  } catch {
    lsChecked = false;
  }
  return lsChecked;
}

// Шаги миграции: ключ — версия, из которой переходим
const MIGRATIONS = {
  0: (d) => ({ ...d, global: d.global ?? {} }),
};

export function migrate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Неверный формат');
  let data = raw;
  let v = Number.isInteger(raw.version) ? raw.version : 0;
  while (v < CURRENT_VERSION) {
    data = MIGRATIONS[v](data);
    v++;
  }
  return sanitizeState({ ...data, version: CURRENT_VERSION });
}

// status: 'ok' | 'fresh' | 'corrupt' | 'unavailable'
export function loadState() {
  if (!localStorageAvailable()) return { state: createDefaultState(), status: 'unavailable' };
  let text = null;
  try { text = localStorage.getItem(LS_KEY); } catch { return { state: createDefaultState(), status: 'unavailable' }; }
  if (text === null) return { state: createDefaultState(), status: 'fresh' };
  try {
    return { state: migrate(JSON.parse(text)), status: 'ok' };
  } catch {
    try { localStorage.setItem(LS_CORRUPT, text); } catch { /* места нет — не страшно */ }
    return { state: createDefaultState(), status: 'corrupt' };
  }
}

// ───── Debounce-сохранение ─────
let timer = 0;
let getter = null;
let dirty = false;
let errorHandler = null;

export function onSaveError(fn) { errorHandler = fn; }

export function scheduleSave(getSnapshot) {
  getter = getSnapshot;
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(flushSave, 300);
}

export function flushSave() {
  clearTimeout(timer);
  timer = 0;
  if (!dirty || !getter || !localStorageAvailable()) { dirty = false; return; }
  dirty = false;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(getter()));
  } catch (e) {
    errorHandler?.(e);
  }
}

// Изменения из другой вкладки
export function watchExternal(cb) {
  window.addEventListener('storage', (e) => {
    if (e.key !== LS_KEY || e.newValue == null) return;
    try { cb(migrate(JSON.parse(e.newValue))); } catch { /* битые данные игнорируем */ }
  });
}

// ───── IndexedDB ─────
let db = null;
let useMemory = false;
let persistAsked = false;
const memory = new Map(); // запасной вариант, если IndexedDB недоступна

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB недоступна')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Заблокировано'));
  });
}

// true — медиа сохраняются надолго; false — только до закрытия вкладки
export async function initMedia() {
  try {
    db = await openDb();
    return true;
  } catch {
    useMemory = true;
    return false;
  }
}

export const isMediaPersistent = () => !useMemory;

function request(mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    const req = fn(store);
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Транзакция прервана'));
  });
}

async function putRecord(rec) {
  if (!useMemory) {
    try {
      await request('readwrite', (s) => s.put(rec));
      memory.delete(rec.key);
      return true;
    } catch { /* падаем в память */ }
  }
  memory.set(rec.key, rec);
  return false;
}

// Возвращает {persisted}: false, если файл удалось удержать только в памяти
export async function putMedia(wheelId, kind, blob, meta = {}) {
  if (!persistAsked && navigator.storage?.persist) {
    persistAsked = true;
    navigator.storage.persist().catch(() => {});
  }
  const rec = {
    key: `${wheelId}:${kind}`,
    blob,
    name: meta.name ?? '',
    size: blob.size,
    type: blob.type || meta.type || '',
    savedAt: Date.now(),
  };
  return { persisted: await putRecord(rec) };
}

export async function getMedia(wheelId, kind) {
  const key = `${wheelId}:${kind}`;
  if (memory.has(key)) return memory.get(key);
  if (useMemory) return null;
  try {
    return (await request('readonly', (s) => s.get(key))) ?? null;
  } catch {
    return null;
  }
}

export async function deleteMedia(wheelId, kind) {
  const key = `${wheelId}:${kind}`;
  memory.delete(key);
  if (useMemory) return;
  try { await request('readwrite', (s) => s.delete(key)); } catch { /* уже нет */ }
}

export async function deleteWheelMedia(wheelId) {
  await Promise.all([deleteMedia(wheelId, 'audio'), deleteMedia(wheelId, 'image')]);
}

export async function copyMedia(fromId, toId) {
  for (const kind of ['audio', 'image']) {
    const rec = await getMedia(fromId, kind);
    if (rec) await putRecord({ ...rec, key: `${toId}:${kind}`, savedAt: Date.now() });
  }
}

// «Сбросить всё»: localStorage этого сайта + IndexedDB
export async function clearAllData() {
  clearTimeout(timer);
  timer = 0;
  dirty = false;
  memory.clear();
  if (localStorageAvailable()) {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(LS_PREFIX))
        .forEach((k) => localStorage.removeItem(k));
    } catch { /* ничего */ }
  }
  if (!useMemory && db) {
    try { await request('readwrite', (s) => s.clear()); } catch { /* ничего */ }
  }
}
