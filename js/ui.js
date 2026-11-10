// DOM, панели, диалоги, тосты, талон с результатом.
// Тяжёлую логику (прокрутка, файлы) делает main.js через объект api.

import * as S from './state.js';
import { PALETTES, TEMPLATES, LIMITS, textColorFor } from './state.js';
import { attachDropzone, formatSize } from './media.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const g = (id) => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const PRESETS = {
  normal: { fill: 100, lines: true, labels: true },
  labels: { fill: 0, lines: false, labels: true },
  clean: { fill: 0, lines: false, labels: false },
};

let api = null;
const keys = {};
const layers = [];
let resultLayer = null;
let wasSpinning = false;

// ───── Мелкие помощники ─────
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

const iconBtn = (name, label, onclick, extra = '') =>
  h('button', { type: 'button', class: `btn btn-icon btn-small btn-ghost ${extra}`, 'aria-label': label, title: label, onclick }, icon(name));

function switchEl({ label, checked, onchange }) {
  return h('label', { class: 'switch' },
    h('input', { type: 'checkbox', checked: checked || null, onchange: (e) => onchange(e.target.checked) }),
    h('span', { class: 'switch-box' }),
    h('span', { class: 'switch-text', text: label }));
}

const setChecked = (id, v) => { const e = g(id); if (e.checked !== !!v) e.checked = !!v; };
const setValue = (id, v) => {
  const e = g(id);
  if (document.activeElement !== e && e.value !== String(v)) e.value = v;
};
const setRange = (id, v) => { const e = g(id); if (e.value !== String(v)) e.value = v; };

// ───── Тосты и объявления ─────
export function toast(message, { kind = 'info', timeout = 4200 } = {}) {
  const root = g('toasts');
  while (root.children.length >= 3) root.firstElementChild.remove();
  const el = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status', text: message });
  root.append(el);
  const kill = () => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 220);
  };
  setTimeout(kill, timeout);
  el.addEventListener('click', kill);
}

export function announce(text) {
  const live = g('live');
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 40);
}

export function showStorageBanner(text) {
  g('storage-banner-text').textContent = text;
  g('storage-banner').hidden = false;
}

// ───── Тема ─────
export function applyTheme(pref) {
  const dark = pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1A1814' : '#EFE8D8');
  return dark ? 'dark' : 'light';
}

// ───── Слои: диалоги и талон (focus trap, Esc) ─────
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function openLayer({ node, label, className = '', initialFocus, onClose }) {
  const prevFocus = document.activeElement;
  const scrim = h('div', { class: `scrim ${className}` });
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-modal', 'true');
  node.setAttribute('aria-label', label);
  scrim.append(node);
  g('layer-root').append(scrim);
  g('app').inert = true;

  let closed = false;
  const layer = {
    node,
    close(reason) {
      if (closed) return;
      closed = true;
      layers.splice(layers.indexOf(layer), 1);
      scrim.remove();
      if (!layers.length) g('app').inert = false;
      onClose?.(reason);
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus?.();
    },
  };
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) layer.close('scrim'); });
  layers.push(layer);
  (initialFocus ?? node.querySelector(FOCUSABLE))?.focus();
  return layer;
}

function trapTab(e, node) {
  const items = $$(FOCUSABLE, node).filter((el) => el.offsetParent !== null);
  if (!items.length) { e.preventDefault(); return; }
  const first = items[0];
  const last = items[items.length - 1];
  if (!node.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export function confirmDialog({ title, text, okText = 'Да', cancelText = 'Отмена', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const ok = h('button', { type: 'button', class: 'btn btn-primary', text: okText });
    const cancel = h('button', { type: 'button', class: 'btn', text: cancelText });
    const node = h('div', { class: 'dialog' },
      h('h2', { class: 'dialog-title', text: title }),
      text && h('p', { class: 'dialog-text', text }),
      h('div', { class: 'dialog-actions' }, cancel, ok));
    const layer = openLayer({ node, label: title, initialFocus: danger ? cancel : ok, onClose: () => resolve(result) });
    ok.addEventListener('click', () => { result = true; layer.close('ok'); });
    cancel.addEventListener('click', () => layer.close('cancel'));
  });
}

// Возвращает строку или null при отмене
export function promptDialog({ title, label, value = '', okText = 'Готово', maxLength = 60, multiline = false, placeholder = '' }) {
  return new Promise((resolve) => {
    let result = null;
    const field = multiline
      ? h('textarea', { class: 'field', id: 'prompt-field', rows: '8', placeholder })
      : h('input', { class: 'field', id: 'prompt-field', type: 'text', maxlength: maxLength, placeholder });
    field.value = value;
    const cancel = h('button', { type: 'button', class: 'btn', text: 'Отмена' });
    const form = h('form', { class: 'dialog', novalidate: true },
      h('h2', { class: 'dialog-title', text: title }),
      h('label', { class: 'label', for: 'prompt-field', text: label }),
      field,
      h('div', { class: 'dialog-actions' }, cancel, h('button', { type: 'submit', class: 'btn btn-primary', text: okText })));
    const layer = openLayer({ node: form, label: title, initialFocus: field, onClose: () => resolve(result) });
    form.addEventListener('submit', (e) => { e.preventDefault(); result = field.value; layer.close('ok'); });
    cancel.addEventListener('click', () => layer.close('cancel'));
    if (multiline) {
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
      });
    }
  });
}

function openNewWheel() {
  const wheels = S.getState().wheels;
  if (wheels.length >= LIMITS.wheels) {
    toast(`Колёс может быть не больше ${LIMITS.wheels}. Выкиньте ненужное.`, { kind: 'error' });
    return;
  }
  const name = h('input', { class: 'field', id: 'nw-name', type: 'text', maxlength: LIMITS.wheelName, value: `Колесо ${wheels.length + 1}` });
  const tpl = h('select', { class: 'field', id: 'nw-tpl' },
    TEMPLATES.map((t) => h('option', { value: t.id, text: t.id === 'empty' ? 'Пустое' : `Из шаблона: ${t.name}` })));
  const cancel = h('button', { type: 'button', class: 'btn', text: 'Отмена' });
  const form = h('form', { class: 'dialog', novalidate: true },
    h('h2', { class: 'dialog-title', text: 'Новое колесо' }),
    h('div', { class: 'dialog-section' }, h('label', { class: 'label', for: 'nw-name', text: 'Название' }), name),
    h('div', { class: 'dialog-section' }, h('label', { class: 'label', for: 'nw-tpl', text: 'С чего начать' }), tpl),
    h('div', { class: 'dialog-actions' }, cancel, h('button', { type: 'submit', class: 'btn btn-primary', text: 'Создать' })));
  const layer = openLayer({ node: form, label: 'Новое колесо', initialFocus: name });
  name.select();
  cancel.addEventListener('click', () => layer.close('cancel'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const wheel = S.addWheel(name.value, tpl.value);
    layer.close('ok');
    if (wheel) setSheet(null);
    else toast('Не получилось создать колесо.', { kind: 'error' });
  });
}

function openSettings() {
  const st = S.getState();
  const themeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Тема' },
    [['auto', 'Как в системе'], ['light', 'Бумага'], ['dark', 'Ночь']].map(([value, text]) =>
      h('button', {
        type: 'button',
        'aria-pressed': String(st.global.theme === value),
        onclick: () => {
          S.updateGlobal({ theme: value });
          $$('button', themeSeg).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === value)));
        },
        'data-v': value,
      }, text)));
  const done = h('button', { type: 'button', class: 'btn btn-primary', text: 'Готово' });
  const reset = h('button', { type: 'button', class: 'btn', text: 'Сбросить всё' });
  const node = h('div', { class: 'dialog' },
    h('h2', { class: 'dialog-title', text: 'Настройки' }),
    h('div', { class: 'dialog-section' }, h('span', { class: 'label', text: 'Тема' }), themeSeg),
    h('div', { class: 'dialog-section' },
      switchEl({ label: 'Конфетти после результата', checked: st.global.confetti, onchange: (v) => S.updateGlobal({ confetti: v }) })),
    h('div', { class: 'dialog-section' },
      h('span', { class: 'label', text: 'Данные' }),
      h('p', { class: 'hint', text: 'Всё хранится только в этом браузере. Сброс стирает колёса, историю, музыку и картинки.' }),
      reset),
    h('div', { class: 'dialog-actions' }, done));
  const layer = openLayer({ node, label: 'Настройки', initialFocus: done });
  done.addEventListener('click', () => layer.close('ok'));
  reset.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Сбросить всё?',
      text: 'Колёса, история, музыка и картинки сотрутся. Вернуть их не получится.',
      okText: 'Сбросить',
      danger: true,
    });
    if (ok) {
      layer.close('reset');
      api.resetAll();
    }
  });
}

// ───── Талон с результатом ─────
export function closeResult() {
  resultLayer?.close('api');
  resultLayer = null;
}

export function showResult({ item, wheelName, number, at, canRemove, onAgain, onRemove }) {
  closeResult();
  const time = new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const again = h('button', { type: 'button', class: 'btn btn-primary', text: 'Ещё раз' });
  const remove = canRemove ? h('button', { type: 'button', class: 'btn', text: 'Убрать из колеса' }) : null;
  const close = h('button', { type: 'button', class: 'btn', text: 'Закрыть' });
  const wrap = h('div', { class: 'ticket-wrap' },
    h('div', { class: 'ticket' },
      h('div', { class: 'ticket-top' },
        h('span', { class: 'label', text: `${wheelName} · № ${String(number).padStart(3, '0')}` }),
        h('span', { class: 'label mono', text: time })),
      h('div', { class: 'ticket-prize', style: `--c:${item.color};--t:${textColorFor(item.color)}` },
        h('p', { class: 'ticket-text', text: item.text })),
      h('div', { class: 'ticket-stampbox' }, h('span', { class: 'stamp', 'aria-hidden': 'true', text: 'ВЫПАЛО' })),
      h('div', { class: 'ticket-actions' }, again, remove, close)));
  const layer = openLayer({
    node: wrap,
    label: `Выпало: ${item.text}`,
    className: 'ticket-layer',
    initialFocus: again,
    onClose: () => { if (resultLayer === layer) resultLayer = null; },
  });
  resultLayer = layer;
  again.addEventListener('click', () => { layer.close('again'); onAgain?.(); });
  remove?.addEventListener('click', () => { layer.close('remove'); onRemove?.(); });
  close.addEventListener('click', () => layer.close('close'));
}

// ───── Панели и листы ─────
function setTab(name) {
  g('panel-main').dataset.tab = name;
  $$('#panel-tabs [role="tab"]').forEach((b) => {
    const on = b.dataset.tab === name;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $$('.tabpanel').forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
}

function setSheet(name) {
  if (name && name !== 'wheels') setTab(name);
  if (name) document.body.dataset.sheet = name;
  else delete document.body.dataset.sheet;
  $$('.bottom-nav [data-sheet]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sheet === name)));
}

// ───── Отрисовка ─────
function renderWheelList(st, spinning) {
  const key = JSON.stringify([st.activeId, st.wheels.map((w) => [w.id, w.name, w.items.length, w.removed.length])]) + spinning;
  g('wheel-count').textContent = `${st.wheels.length}/${LIMITS.wheels}`;
  g('btn-new-wheel').disabled = st.wheels.length >= LIMITS.wheels;
  if (keys.wheels === key) return;
  keys.wheels = key;
  const list = g('wheel-list');
  list.replaceChildren();
  st.wheels.forEach((w, idx) => {
    const active = w.id === st.activeId;
    const li = h('li', { class: `wcard${active ? ' is-active' : ''}` });
    li.append(h('button', {
      type: 'button',
      class: 'wcard-main',
      'aria-current': active ? 'true' : null,
      onclick: () => {
        if (S.isSpinning()) { toast('Колесо ещё крутится. Дождитесь остановки.'); return; }
        if (S.setActive(w.id)) setSheet(null);
      },
    },
      h('span', { class: 'wcard-name', text: w.name }),
      h('span', { class: 'wcard-meta', text: `${w.items.length} вар.${w.removed.length ? ` · выбыло ${w.removed.length}` : ''}` })));
    if (active) {
      const up = iconBtn('up', 'Поднять колесо выше', () => S.moveWheel(w.id, -1));
      const down = iconBtn('down', 'Опустить колесо ниже', () => S.moveWheel(w.id, 1));
      up.disabled = idx === 0;
      down.disabled = idx === st.wheels.length - 1;
      const del = iconBtn('trash', 'Выкинуть колесо', async () => {
        if (S.isSpinning()) { toast('Это колесо крутится, удалить его нельзя.'); return; }
        const ok = await confirmDialog({
          title: 'Выкинуть колесо?',
          text: `«${w.name}» исчезнет вместе с историей, музыкой и картинкой.`,
          okText: 'Выкинуть',
          danger: true,
        });
        if (ok) api.deleteWheel(w.id);
      });
      li.append(h('div', { class: 'wcard-actions' },
        up, down,
        iconBtn('edit', 'Переименовать колесо', async () => {
          const name = await promptDialog({ title: 'Как назвать колесо?', label: 'Название', value: w.name, maxLength: LIMITS.wheelName, okText: 'Сохранить' });
          if (name !== null && !S.renameWheel(w.id, name)) toast('Название не может быть пустым.', { kind: 'error' });
        }),
        iconBtn('copy', 'Дублировать колесо', () => api.duplicateWheel(w.id)),
        del));
    }
    list.append(li);
  });
  $$('button', list).forEach((b) => { if (spinning && !b.classList.contains('wcard-main')) b.disabled = true; });
}

function renderStage(w, st, spinning) {
  const n = w.items.length;
  g('wheel-title').textContent = w.name;
  g('wheel-title').title = w.name;
  g('wheel-canvas').setAttribute('aria-label', `Колесо «${w.name}», вариантов: ${n}`);
  const hint = g('empty-hint');
  hint.hidden = n >= 2;
  hint.textContent = n === 0 ? 'Тут пока пусто. Впишите хотя бы два варианта' : 'Нужен ещё хотя бы один вариант';
  g('btn-spin').disabled = spinning;
  g('btn-spin-main').disabled = spinning;

  const fit = w.settings.fitToTrack && !!w.media.audio;
  const dur = g('duration');
  setRange('duration', w.settings.duration);
  dur.disabled = fit || spinning;
  g('duration-out').textContent = fit ? 'по треку' : `${w.settings.duration} с`;
  setChecked('remove-winner', w.settings.removeWinner);
  g('remove-winner').disabled = spinning;

  const restore = g('btn-restore');
  restore.hidden = w.removed.length === 0;
  restore.disabled = spinning;
  g('restore-label').textContent = `Вернуть выбывших · ${w.removed.length}`;
  g('stage-status').textContent = `Вариантов: ${n}${w.removed.length ? ` · выбыло: ${w.removed.length}` : ''}`;
}

function startEdit(li, item) {
  const old = li.querySelector('.item-text');
  if (!old) return;
  const input = h('input', { class: 'field item-edit', type: 'text', maxlength: LIMITS.itemText, value: item.text, 'aria-label': 'Текст варианта' });
  old.replaceWith(input);
  $$('.btn-icon', li).forEach((b) => { b.hidden = true; });
  input.focus();
  input.select();
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (commit && v && v !== item.text) {
      S.updateItem(item.id, { text: v });
    } else {
      input.replaceWith(old);
      $$('.btn-icon', li).forEach((b) => { b.hidden = false; });
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

function itemRow(item, i) {
  const li = h('li', { class: 'item' });
  li.append(
    h('span', { class: 'item-idx', text: String(i + 1).padStart(2, '0') }),
    h('label', { class: 'swatch', style: `--c:${item.color}`, title: 'Цвет' },
      h('input', { type: 'color', value: item.color, 'aria-label': `Цвет варианта «${item.text}»`, onchange: (e) => S.updateItem(item.id, { color: e.target.value }) })),
    h('button', { type: 'button', class: 'item-text', title: 'Двойной клик — править', ondblclick: () => startEdit(li, item), text: item.text }),
    iconBtn('edit', `Править «${item.text}»`, () => startEdit(li, item)),
    iconBtn('trash', `Удалить «${item.text}»`, () => S.removeItem(item.id)));
  return li;
}

function renderItems(w, spinning) {
  const n = w.items.length;
  g('items-count').textContent = `${n} / ${LIMITS.items}`;
  g('items-fieldset').disabled = spinning;
  const addInput = g('add-input');
  addInput.placeholder = n >= LIMITS.items ? 'Больше не влезет' : 'Новый вариант и Enter';
  setValue('palette-select', w.settings.palette);
  const pal = PALETTES.find((p) => p.id === w.settings.palette) ?? PALETTES[0];
  const prevKey = pal.id;
  if (keys.palette !== prevKey) {
    keys.palette = prevKey;
    g('palette-preview').replaceChildren(...pal.colors.map((c) => h('i', { style: `background:${c}` })));
  }

  const key = JSON.stringify([w.id, w.items.map((i) => [i.id, i.text, i.color]), w.removed.map((r) => r.id)]);
  if (keys.items === key) return;
  keys.items = key;
  const ol = g('items-list');
  ol.replaceChildren();
  if (!n) ol.append(h('li', { class: 'items-empty', text: 'Тут пока пусто. Впишите хотя бы два варианта' }));
  w.items.forEach((it, i) => ol.append(itemRow(it, i)));
  g('removed-box').hidden = w.removed.length === 0;
  g('removed-list').replaceChildren(...w.removed.map((r) => h('span', { class: 'chip', text: r.text })));
}

function renderSound(w, st, spinning) {
  const m = w.settings.music;
  const hasAudio = !!w.media.audio;
  setRange('volume', Math.round(st.global.volume * 100));
  g('volume-out').textContent = String(Math.round(st.global.volume * 100));
  setChecked('tick-global', st.global.tick);
  setChecked('music-loop', m.loop);
  setChecked('music-tick', m.tickWithMusic);
  setChecked('music-fit', w.settings.fitToTrack);
  setValue('music-start', m.startAt);
  g('music-fieldset').disabled = !hasAudio;
  g('audio-empty').hidden = hasAudio;
  const info = g('audio-info');
  info.hidden = !hasAudio;
  if (hasAudio) {
    const a = w.media.audio;
    info.textContent = `${a.name} · ${formatSize(a.size)}${a.duration ? ` · ${a.duration.toFixed(1).replace('.', ',')} с` : ''}`;
  }
  g('btn-audio-test').disabled = !hasAudio || spinning;
  g('btn-audio-remove').disabled = !hasAudio || spinning;
  g('btn-audio-pick').disabled = spinning;
}

function presetOf(img) {
  return Object.keys(PRESETS).find((k) => {
    const p = PRESETS[k];
    return p.fill === img.fill && p.lines === img.lines && p.labels === img.labels;
  });
}

function renderImage(w, spinning) {
  const hasImg = !!w.media.image;
  const img = w.settings.image;
  g('image-fieldset').disabled = !hasImg;
  g('image-hint').hidden = hasImg;
  g('image-empty').hidden = hasImg;
  const info = g('image-info');
  info.hidden = !hasImg;
  if (hasImg) info.textContent = `${w.media.image.name} · ${formatSize(w.media.image.size)}`;
  g('image-preview').hidden = !hasImg;
  g('btn-image-remove').disabled = !hasImg || spinning;
  g('btn-image-pick').disabled = spinning;
  setRange('image-fill', img.fill);
  g('image-fill-out').textContent = `${img.fill} %`;
  setChecked('image-lines', img.lines);
  setChecked('image-labels', img.labels);
  setChecked('image-rotate', img.rotate);
  const current = presetOf(img);
  $$('#image-presets button').forEach((b) => b.setAttribute('aria-pressed', String(hasImg && b.dataset.preset === current)));
}

function renderHistory(w) {
  g('history-count').textContent = `${w.history.length}/${LIMITS.history}`;
  g('btn-history-clear').disabled = !w.history.length;
  const key = JSON.stringify([w.id, w.history.map((e) => e.id)]);
  if (keys.history === key) return;
  keys.history = key;
  const ol = g('history-list');
  ol.replaceChildren();
  if (!w.history.length) {
    ol.append(h('li', { class: 'items-empty', text: 'Пока ни одного результата. Крутите.' }));
    return;
  }
  for (const e of w.history) {
    const when = new Date(e.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    ol.append(h('li', { class: 'hist-item' },
      h('span', { class: 'dot', style: `--c:${e.color}` }),
      h('span', { class: 'hist-text', text: e.text, title: e.text }),
      h('time', { class: 'hist-time', datetime: new Date(e.at).toISOString(), text: when })));
  }
}

function render(st) {
  const w = S.getActiveWheel();
  const spinning = S.isSpinning();
  if (spinning && !wasSpinning) setSheet(null);
  wasSpinning = spinning;
  document.body.classList.toggle('is-spinning', spinning);
  renderWheelList(st, spinning);
  renderStage(w, st, spinning);
  renderItems(w, spinning);
  renderSound(w, st, spinning);
  renderImage(w, spinning);
  renderHistory(w);
}

// ───── Прочее для main.js ─────
export function setMusicPlaying(on) {
  const btn = g('btn-audio-test');
  g('audio-test-label').textContent = on ? 'Стоп' : 'Тест';
  btn.firstElementChild.firstElementChild.setAttribute('href', on ? '#i-stop' : '#i-play');
}

export function setImagePreview(bitmap) {
  const cv = g('image-preview');
  const x = cv.getContext('2d');
  x.clearRect(0, 0, cv.width, cv.height);
  if (!bitmap) return;
  const iw = bitmap.width || bitmap.naturalWidth;
  const ih = bitmap.height || bitmap.naturalHeight;
  const scale = Math.max(cv.width / iw, cv.height / ih);
  x.drawImage(bitmap, (cv.width - iw * scale) / 2, (cv.height - ih * scale) / 2, iw * scale, ih * scale);
}

// ───── Инициализация ─────
export function initUI(apiObject) {
  api = apiObject;

  g('palette-select').replaceChildren(...PALETTES.map((p) => h('option', { value: p.id, text: p.name })));

  g('btn-theme').addEventListener('click', () => {
    S.updateGlobal({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' });
  });
  g('btn-settings').addEventListener('click', openSettings);
  g('btn-new-wheel').addEventListener('click', openNewWheel);
  g('storage-banner-close').addEventListener('click', () => { g('storage-banner').hidden = true; });

  // Вкладки правой панели
  $$('#panel-tabs [role="tab"]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  g('panel-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = $$('#panel-tabs [role="tab"]');
    const i = tabs.findIndex((b) => b.getAttribute('aria-selected') === 'true');
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    setTab(next.dataset.tab);
    next.focus();
  });
  $$('.bottom-nav [data-sheet]').forEach((b) => b.addEventListener('click', () => {
    setSheet(document.body.dataset.sheet === b.dataset.sheet ? null : b.dataset.sheet);
  }));
  $$('[data-close-sheet]').forEach((b) => b.addEventListener('click', () => setSheet(null)));
  g('sheet-scrim').addEventListener('click', () => setSheet(null));

  // Прокрутка и параметры под колесом
  g('btn-spin').addEventListener('click', () => api.spin());
  g('btn-spin-main').addEventListener('click', () => api.spin());
  g('duration').addEventListener('input', (e) => S.updateSettings({ duration: Number(e.target.value) }));
  g('remove-winner').addEventListener('change', (e) => S.updateSettings({ removeWinner: e.target.checked }));
  $$('.js-restore').forEach((b) => b.addEventListener('click', () => {
    const count = S.restoreRemoved();
    if (count) toast(`Вернул вариантов: ${count}`, { kind: 'ok' });
  }));

  // Варианты
  g('add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = g('add-input');
    const text = input.value.trim();
    if (!text) return;
    if (S.getActiveWheel().items.length >= LIMITS.items) {
      toast(`Больше ${LIMITS.items} вариантов на колесо не влезет.`, { kind: 'error' });
      return;
    }
    if (S.addItem(text)) input.value = '';
    input.focus();
  });
  g('btn-bulk').addEventListener('click', async () => {
    const text = await promptDialog({
      title: 'Добавить списком',
      label: 'Один вариант — одна строка',
      multiline: true,
      okText: 'Добавить',
      placeholder: 'Борщ\nПельмени\nОкрошка',
    });
    if (text === null) return;
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const added = S.addItems(lines);
    if (added < lines.length) {
      toast(`Добавил ${added}. Остальное не влезло: на колесе максимум ${LIMITS.items}.`, { kind: 'error' });
    } else {
      toast(`Добавил вариантов: ${added}`, { kind: 'ok' });
    }
  });
  g('btn-shuffle').addEventListener('click', () => {
    if (!S.shuffleItems()) toast('Перемешивать нечего: нужно хотя бы два варианта.');
  });
  g('btn-clear').addEventListener('click', async () => {
    if (!S.getActiveWheel().items.length && !S.getActiveWheel().removed.length) return;
    const ok = await confirmDialog({
      title: 'Очистить колесо?',
      text: 'Все варианты исчезнут. История результатов останется.',
      okText: 'Очистить',
      danger: true,
    });
    if (ok) S.clearItems();
  });
  g('palette-select').addEventListener('change', (e) => S.setPalette(e.target.value));

  // Звук
  g('volume').addEventListener('input', (e) => S.updateGlobal({ volume: Number(e.target.value) / 100 }));
  g('tick-global').addEventListener('change', (e) => S.updateGlobal({ tick: e.target.checked }));
  g('music-loop').addEventListener('change', (e) => S.updateMusic({ loop: e.target.checked }));
  g('music-tick').addEventListener('change', (e) => S.updateMusic({ tickWithMusic: e.target.checked }));
  g('music-fit').addEventListener('change', (e) => S.updateSettings({ fitToTrack: e.target.checked }));
  g('music-start').addEventListener('change', (e) => S.updateMusic({ startAt: Number(e.target.value) }));
  g('btn-audio-pick').addEventListener('click', () => g('audio-file').click());
  g('audio-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) api.uploadAudio(file);
  });
  g('btn-audio-test').addEventListener('click', () => api.testAudio());
  g('btn-audio-remove').addEventListener('click', () => api.removeAudio());
  attachDropzone(g('audio-drop'), { onFile: (f) => api.uploadAudio(f) });

  // Картинка
  $$('#image-presets button').forEach((b) => b.addEventListener('click', () => S.updateImage(PRESETS[b.dataset.preset])));
  g('image-fill').addEventListener('input', (e) => S.updateImage({ fill: Number(e.target.value) }));
  g('image-lines').addEventListener('change', (e) => S.updateImage({ lines: e.target.checked }));
  g('image-labels').addEventListener('change', (e) => S.updateImage({ labels: e.target.checked }));
  g('image-rotate').addEventListener('change', (e) => S.updateImage({ rotate: e.target.checked }));
  g('btn-image-pick').addEventListener('click', () => g('image-file').click());
  g('image-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) api.uploadImage(file);
  });
  g('btn-image-remove').addEventListener('click', () => api.removeImage());
  attachDropzone(g('image-drop'), { onFile: (f) => api.uploadImage(f) });

  // История
  g('btn-history-clear').addEventListener('click', () => {
    S.clearHistory();
    toast('История стёрта.');
  });

  // Файл, брошенный мимо зоны, не должен открываться в браузере
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // Клавиатура: Esc, Tab в слоях; Space — крутить
  document.addEventListener('keydown', (e) => {
    const top = layers[layers.length - 1];
    if (top) {
      if (e.key === 'Escape') { e.preventDefault(); top.close('esc'); }
      else if (e.key === 'Tab') trapTab(e, top.node);
      return;
    }
    if (e.key === 'Escape' && document.body.dataset.sheet) { setSheet(null); return; }
    if (e.code === 'Space' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.target.closest?.('input, textarea, select, button, a, [contenteditable="true"]')) return;
      e.preventDefault();
      api.spin();
    }
  });

  setTab('items');
  S.subscribe(render);
  render(S.getState());
}
