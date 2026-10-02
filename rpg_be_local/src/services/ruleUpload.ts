import type { StorageEngine } from 'multer';
import { RULE_LIMITS } from '../domain/rules.js';
import { Problem } from '../errors.js';

// Bound aggregate bytes while multipart streams, before materializing all files.
export function ruleUploadStorage(): StorageEngine {
  const totals = new WeakMap<object, number>();
  return {
    _handleFile(req, file, callback) {
      const chunks: Buffer[] = [];
      let size = 0;
      let finished = false;
      const fail = (error: Error) => {
        if (finished) return;
        finished = true;
        chunks.length = 0;
        callback(error);
      };
      file.stream.on('data', (chunk: Buffer) => {
        if (finished) return;
        const total = (totals.get(req) ?? 0) + chunk.byteLength;
        totals.set(req, total);
        if (total > RULE_LIMITS.importBytes) {
          const error = new Problem(
            413,
            'rules_upload_size',
            'Book upload exceeds the combined byte limit'
          );
          fail(error);
          file.stream.destroy(error);
          return;
        }
        size += chunk.byteLength;
        chunks.push(chunk);
      });
      file.stream.on('error', fail);
      file.stream.on('end', () => {
        if (finished) return;
        finished = true;
        const buffer = Buffer.concat(chunks, size);
        chunks.length = 0;
        callback(null, { buffer, size });
      });
    },
    _removeFile(_req, file, callback) {
      file.buffer = Buffer.alloc(0);
      callback(null);
    },
  };
}
