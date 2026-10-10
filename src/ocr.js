// Read text out of screenshots (LinkedIn profiles, WhatsApp/email snippets) with local OCR.
// Runs on our own server: no API key, no per-image cost. English model downloads once
// (~10 MB) and is cached next to the database when a volume is mounted.
import { createWorker } from 'tesseract.js';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

let workerPromise = null;

function cacheDir() {
  const base = process.env.DB_PATH && process.env.DB_PATH !== ':memory:' ? dirname(process.env.DB_PATH) : 'data';
  const dir = join(base, 'ocr-cache');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function worker() {
  workerPromise ??= createWorker('eng', 1, { cachePath: cacheDir() }).catch((err) => {
    workerPromise = null;   // let the next screenshot retry
    throw err;
  });
  return workerPromise;
}

/** Plain text from an image buffer (PNG/JPEG/WebP). Cleans OCR noise a little. */
export async function imageToText(buffer) {
  const w = await worker();
  const { data } = await w.recognize(buffer);
  return cleanOcr(data.text);
}

/** OCR leaves stray symbols, broken lines and doubled spaces; tidy without losing content. */
export function cleanOcr(text) {
  return String(text || '')
    .replace(/[|¦]/g, ' ')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .split('\n')
    .map((l) => l.replace(/\s{2,}/g, ' ').trim())
    .filter((l) => l && !/^[^A-Za-z0-9@+]{1,3}$/.test(l))   // lines that are only icons/bullets
    .join('\n');
}

/** Stop the OCR engine (tests, shutdown). */
export async function stopOcr() {
  if (!workerPromise) return;
  const w = await workerPromise.catch(() => null);
  workerPromise = null;
  await w?.terminate();
}
