// Загрузка и сжатие картинок, проверка файлов, drag&drop.

export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
export const MAX_IMAGE_SOURCE_BYTES = 40 * 1024 * 1024;
export const IMAGE_MAX_SIDE = 1600;

const AUDIO_EXT = /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|weba|webm|mp4)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp|svg)$/i;

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
}

export function validateAudioFile(file) {
  if (!file) return { ok: false, error: 'Файл не выбран.' };
  if (file.size === 0) return { ok: false, error: 'Файл пустой.' };
  if (file.size > MAX_AUDIO_BYTES) {
    return { ok: false, error: `Файл тяжелее 15 МБ (у вас ${formatSize(file.size)}). Возьмите трек полегче.` };
  }
  const typeOk = file.type.startsWith('audio/') || AUDIO_EXT.test(file.name);
  if (!typeOk || (file.type.startsWith('video/') && !AUDIO_EXT.test(file.name))) {
    return { ok: false, error: 'Это не похоже на звук. Подойдёт MP3, WAV, OGG или M4A.' };
  }
  return { ok: true };
}

export function validateImageFile(file) {
  if (!file) return { ok: false, error: 'Файл не выбран.' };
  if (file.size === 0) return { ok: false, error: 'Файл пустой.' };
  if (file.size > MAX_IMAGE_SOURCE_BYTES) {
    return { ok: false, error: `Картинка слишком тяжёлая (${formatSize(file.size)}). Предел для исходника — 40 МБ.` };
  }
  if (!file.type.startsWith('image/') && !IMAGE_EXT.test(file.name)) {
    return { ok: false, error: 'Это не картинка. Подойдёт JPG, PNG, WebP или GIF.' };
  }
  return { ok: true };
}

// Запасной путь декодирования, если createImageBitmap не справился
function decodeViaImg(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось прочитать картинку'));
    };
    img.src = url;
  });
}

async function decodeImage(blob) {
  try {
    return await createImageBitmap(blob);
  } catch {
    return decodeViaImg(blob);
  }
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

// Уменьшает до 1600 px по большей стороне и сжимает в WebP (или JPEG)
export async function compressImage(file) {
  const src = await decodeImage(file);
  try {
    const sw = src.width || src.naturalWidth;
    const sh = src.height || src.naturalHeight;
    if (!sw || !sh) throw new Error('Пустая картинка');
    const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(sw, sh));
    const width = Math.max(1, Math.round(sw * scale));
    const height = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.drawImage(src, 0, 0, width, height);

    let blob = await toBlob(canvas, 'image/webp', 0.86);
    if (!blob || blob.type !== 'image/webp') {
      // Safari и старые браузеры: JPEG, прозрачность заливаем бумагой
      c.globalCompositeOperation = 'destination-over';
      c.fillStyle = '#F7F2E4';
      c.fillRect(0, 0, width, height);
      blob = await toBlob(canvas, 'image/jpeg', 0.88);
    }
    if (!blob) throw new Error('Не удалось сжать картинку');
    return { blob, width, height };
  } finally {
    src.close?.();
  }
}

// Возвращает ImageBitmap (или <img>, если bitmap недоступен); закрывать через close?.()
export function blobToBitmap(blob) {
  return decodeImage(blob);
}

// Зона перетаскивания файла
export function attachDropzone(el, { onFile }) {
  let depth = 0;
  const hasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  el.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    el.classList.add('is-drag');
  });
  el.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  el.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) el.classList.remove('is-drag');
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    el.classList.remove('is-drag');
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  });
}
