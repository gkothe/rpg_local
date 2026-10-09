import { Problem } from '../errors.js';
import { ATLAS_IMAGE_MAX_PIXELS } from '../domain/atlasImport.js';
import { uploadBytes } from '../config.js';

/** Inspect actual bytes; caller MIME and filename are not an authorization boundary. */
export function atlasImageInfo(bytes: Buffer): {
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
} {
  if (!bytes.length || bytes.length > uploadBytes)
    throw new Problem(413, 'atlas_image_size', 'Map image exceeds the configured upload size');
  let width = 0,
    height = 0;
  let mime: 'image/png' | 'image/jpeg';
  if (
    bytes.length >= 33 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString('ascii', 12, 16) === 'IHDR'
  ) {
    mime = 'image/png';
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    mime = 'image/jpeg';
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset + 1]!;
      offset += 2;
      if (marker === 217 || marker === 218) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) &&
        length >= 7
      ) {
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  } else throw new Problem(422, 'atlas_image_format', 'Upload an actual PNG or JPEG map image');
  if (!width || !height || width * height > ATLAS_IMAGE_MAX_PIXELS)
    throw new Problem(
      422,
      'atlas_image_dimensions',
      'Map image has invalid or excessive dimensions'
    );
  return { mime, width, height };
}
