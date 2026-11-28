import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_FLAG_BYTES = 2 * 1024 * 1024;

const FORMATS = Object.freeze([
  { ext: 'png', mime: 'image/png' },
  { ext: 'jpg', mime: 'image/jpeg' },
  { ext: 'webp', mime: 'image/webp' },
]);

export function detectImageFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.byteLength < 12) return null;
  if (
    buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4E
    && buffer[3] === 0x47
    && buffer[4] === 0x0D
    && buffer[5] === 0x0A
    && buffer[6] === 0x1A
    && buffer[7] === 0x0A
  ) {
    return FORMATS[0];
  }
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return FORMATS[1];
  }
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return FORMATS[2];
  }
  return null;
}

export function createFlagStore({ dir }) {
  async function findExisting() {
    if (!dir) return null;
    for (const fmt of FORMATS) {
      const filePath = join(dir, `main-flag.${fmt.ext}`);
      try {
        const info = await stat(filePath);
        if (info.isFile()) {
          return { ...fmt, filePath, updatedAt: Math.trunc(info.mtimeMs) };
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    return null;
  }

  async function removeAll(keepExt = null) {
    if (!dir) return;
    for (const fmt of FORMATS) {
      if (keepExt && fmt.ext === keepExt) continue;
      try {
        await unlink(join(dir, `main-flag.${fmt.ext}`));
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }

  return {
    async inspect() {
      const hit = await findExisting();
      if (!hit) return { hasCustom: false, mime: null, updatedAt: null };
      return { hasCustom: true, mime: hit.mime, updatedAt: hit.updatedAt };
    },
    async readImage() {
      const hit = await findExisting();
      if (!hit) return null;
      const buffer = await readFile(hit.filePath);
      return { buffer, mime: hit.mime, updatedAt: hit.updatedAt };
    },
    async saveImage(buffer) {
      if (!dir) throw new Error('flag storage directory unavailable');
      if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
        const err = new Error('empty image payload');
        err.status = 400;
        throw err;
      }
      if (buffer.byteLength > MAX_FLAG_BYTES) {
        const err = new Error('flag image exceeds 2 MB limit');
        err.status = 413;
        throw err;
      }
      const fmt = detectImageFormat(buffer);
      if (!fmt) {
        const err = new Error('unsupported image format; expected PNG, JPEG, or WebP');
        err.status = 415;
        throw err;
      }
      await mkdir(dir, { recursive: true });
      const target = join(dir, `main-flag.${fmt.ext}`);
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, buffer);
      await rename(tmp, target);
      await removeAll(fmt.ext);
      const info = await stat(target);
      return { hasCustom: true, mime: fmt.mime, updatedAt: Math.trunc(info.mtimeMs) };
    },
    async clearImage() {
      await removeAll();
      return { hasCustom: false, mime: null, updatedAt: null };
    },
  };
}
