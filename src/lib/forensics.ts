export interface ForensicsMetadataResult {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  md5?: string;
  dimensions?: string;
  cameraMake?: string;
  cameraModel?: string;
  software?: string;
  dateTimeOriginal?: string;
  gps?: { lat: number; lng: number } | null;
  pdfMeta?: Record<string, string>;
  pngChunks?: Record<string, string>;
  headers?: Record<string, string>;
  warnings: string[];
}

// Lightweight RFC 1321 MD5 in pure TypeScript for Gravatar email hashing & file checksums
export function md5Hex(input: string | Uint8Array): string {
  const bytes =
    typeof input === 'string' ? new TextEncoder().encode(input) : input;

  const origBitLen = bytes.length * 8;
  const withOneLen = bytes.length + 1;
  const padLen = (56 - (withOneLen % 64) + 64) % 64;
  const padded = new Uint8Array(withOneLen + padLen + 8);
  padded.set(bytes, 0);
  padded[bytes.length] = 0x80;

  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, origBitLen >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(origBitLen / 0x100000000) >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  }

  for (let offset = 0; offset < padded.length; offset += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) {
      M[j] = dv.getUint32(offset + j * 4, true);
    }

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i++) {
      let F = 0;
      let g = 0;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      const rot = S[i];
      B = (B + ((F << rot) | (F >>> (32 - rot)))) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const outDv = new DataView(out.buffer);
  outDv.setUint32(0, a0, true);
  outDv.setUint32(4, b0, true);
  outDv.setUint32(8, c0, true);
  outDv.setUint32(12, d0, true);
  return Array.from(out)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function readAscii(bytes: Uint8Array, start: number, len: number): string {
  const end = Math.min(bytes.length, start + len);
  let out = '';
  for (let i = start; i < end; i++) {
    const ch = bytes[i];
    if (ch === 0) break;
    if (ch >= 32 && ch <= 126) out += String.fromCharCode(ch);
  }
  return out.trim();
}

function parseJpegExif(bytes: Uint8Array): Partial<ForensicsMetadataResult> {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return {};

  const out: Partial<ForensicsMetadataResult> = {};
  let pos = 2;

  while (pos + 4 < bytes.length) {
    if (bytes[pos] !== 0xff) break;
    const marker = bytes[pos + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const segLen = (bytes[pos + 2] << 8) | bytes[pos + 3];
    if (segLen < 2 || pos + 2 + segLen > bytes.length) break;

    // SOF0/SOF2 dimensions
    if (marker === 0xc0 || marker === 0xc2) {
      if (pos + 9 < bytes.length) {
        const h = (bytes[pos + 5] << 8) | bytes[pos + 6];
        const w = (bytes[pos + 7] << 8) | bytes[pos + 8];
        if (w > 0 && h > 0) out.dimensions = `${w} × ${h} px`;
      }
    }

    // APP1 Exif header
    if (marker === 0xe1 && readAscii(bytes, pos + 4, 4) === 'Exif') {
      const tiffStart = pos + 10;
      if (tiffStart + 8 < bytes.length) {
        const littleEndian =
          bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const u16 = (off: number) => view.getUint16(off, littleEndian);
        const u32 = (off: number) => view.getUint32(off, littleEndian);

        const ifd0Rel = u32(tiffStart + 4);
        const ifd0 = tiffStart + ifd0Rel;

        const readStringTag = (type: number, count: number, valOff: number) => {
          if (type !== 2 || count <= 0) return '';
          if (count <= 4) return readAscii(bytes, valOff, count);
          const strRel = u32(valOff);
          return readAscii(bytes, tiffStart + strRel, Math.min(count, 160));
        };

        const readRational = (off: number) => {
          if (off + 8 > bytes.length) return 0;
          const num = u32(off);
          const den = u32(off + 4);
          return den === 0 ? 0 : num / den;
        };

        let exifIfdRel = 0;
        let gpsIfdRel = 0;

        if (ifd0 + 2 <= bytes.length) {
          const entries = Math.min(u16(ifd0), 80);
          for (let i = 0; i < entries; i++) {
            const entry = ifd0 + 2 + i * 12;
            if (entry + 12 > bytes.length) break;
            const tag = u16(entry);
            const type = u16(entry + 2);
            const count = u32(entry + 4);
            const valOff = entry + 8;

            if (tag === 0x010f) out.cameraMake = readStringTag(type, count, valOff);
            if (tag === 0x0110) out.cameraModel = readStringTag(type, count, valOff);
            if (tag === 0x0131) out.software = readStringTag(type, count, valOff);
            if (tag === 0x0132 && !out.dateTimeOriginal) {
              out.dateTimeOriginal = readStringTag(type, count, valOff);
            }
            if (tag === 0x8769) exifIfdRel = u32(valOff);
            if (tag === 0x8825) gpsIfdRel = u32(valOff);
          }
        }

        if (exifIfdRel > 0) {
          const exifIfd = tiffStart + exifIfdRel;
          if (exifIfd + 2 <= bytes.length) {
            const entries = Math.min(u16(exifIfd), 80);
            for (let i = 0; i < entries; i++) {
              const entry = exifIfd + 2 + i * 12;
              if (entry + 12 > bytes.length) break;
              const tag = u16(entry);
              const type = u16(entry + 2);
              const count = u32(entry + 4);
              const valOff = entry + 8;
              if (tag === 0x9003) {
                out.dateTimeOriginal = readStringTag(type, count, valOff) || out.dateTimeOriginal;
              }
            }
          }
        }

        if (gpsIfdRel > 0) {
          const gpsIfd = tiffStart + gpsIfdRel;
          if (gpsIfd + 2 <= bytes.length) {
            let latRef = 'N';
            let lngRef = 'E';
            let lat: number | null = null;
            let lng: number | null = null;

            const entries = Math.min(u16(gpsIfd), 40);
            for (let i = 0; i < entries; i++) {
              const entry = gpsIfd + 2 + i * 12;
              if (entry + 12 > bytes.length) break;
              const tag = u16(entry);
              const type = u16(entry + 2);
              const count = u32(entry + 4);
              const valOff = entry + 8;

              if (tag === 0x0001) latRef = readStringTag(type, count, valOff) || 'N';
              if (tag === 0x0003) lngRef = readStringTag(type, count, valOff) || 'E';
              if (tag === 0x0002 && count >= 3) {
                const off = tiffStart + u32(valOff);
                const d = readRational(off);
                const m = readRational(off + 8);
                const s = readRational(off + 16);
                lat = d + m / 60 + s / 3600;
              }
              if (tag === 0x0004 && count >= 3) {
                const off = tiffStart + u32(valOff);
                const d = readRational(off);
                const m = readRational(off + 8);
                const s = readRational(off + 16);
                lng = d + m / 60 + s / 3600;
              }
            }

            if (lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng)) {
              out.gps = {
                lat: Number((latRef === 'S' ? -lat : lat).toFixed(5)),
                lng: Number((lngRef === 'W' ? -lng : lng).toFixed(5)),
              };
            }
          }
        }
      }
      break;
    }

    pos += 2 + segLen;
  }

  return out;
}

function parsePngChunks(bytes: Uint8Array): Partial<ForensicsMetadataResult> {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return {};
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Record<string, string> = {};
  let dimensions: string | undefined;
  let pos = 8;

  while (pos + 12 <= bytes.length) {
    const len = view.getUint32(pos, false);
    const type = readAscii(bytes, pos + 4, 4);
    const dataStart = pos + 8;
    if (dataStart + len + 4 > bytes.length) break;

    if (type === 'IHDR' && len >= 8) {
      const w = view.getUint32(dataStart, false);
      const h = view.getUint32(dataStart + 4, false);
      dimensions = `${w} × ${h} px`;
    } else if (type === 'tEXt' && len > 0 && len < 2048) {
      const raw = new TextDecoder('latin1').decode(bytes.subarray(dataStart, dataStart + len));
      const sep = raw.indexOf('\0');
      if (sep > 0) {
        const k = raw.slice(0, sep).trim();
        const v = raw.slice(sep + 1).trim();
        if (k && v) chunks[k] = v.slice(0, 220);
      }
    }

    if (type === 'IEND') break;
    pos += 12 + len;
  }

  return {
    dimensions,
    software: chunks.Software || chunks.Creator,
    pngChunks: Object.keys(chunks).length > 0 ? chunks : undefined,
  };
}

function parsePdfMetadata(bytes: Uint8Array): Partial<ForensicsMetadataResult> {
  const sample = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 250_000)));
  if (!sample.startsWith('%PDF-')) return {};

  const pdfMeta: Record<string, string> = {};
  const fields = ['Title', 'Author', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Subject'];
  for (const field of fields) {
    const match = sample.match(new RegExp(`/${field}\\s*\\(([^()]{1,180})\\)`));
    if (match?.[1]) {
      pdfMeta[field] = match[1].replace(/\\([()\\])/g, '$1').trim();
    }
  }
  return {
    software: pdfMeta.Creator || pdfMeta.Producer,
    dateTimeOriginal: pdfMeta.CreationDate,
    pdfMeta: Object.keys(pdfMeta).length > 0 ? pdfMeta : undefined,
  };
}

export async function analyzeBufferForensics(
  fileName: string,
  mimeType: string,
  buffer: ArrayBuffer,
  extraHeaders?: Record<string, string>
): Promise<ForensicsMetadataResult> {
  const bytes = new Uint8Array(buffer);
  const sha256 = await sha256Hex(buffer);
  const md5 = md5Hex(bytes);

  const jpeg = parseJpegExif(bytes);
  const png = parsePngChunks(bytes);
  const pdf = parsePdfMetadata(bytes);

  const warnings: string[] = [];
  const hasExif = Boolean(jpeg.cameraMake || jpeg.cameraModel || jpeg.dateTimeOriginal || jpeg.gps);
  if (jpeg.gps) {
    warnings.push(`Embedded GPS EXIF coordinates found (${jpeg.gps.lat}, ${jpeg.gps.lng}).`);
  }
  if (!hasExif && (mimeType.includes('image') || /\.(jpg|jpeg|png|webp)$/i.test(fileName))) {
    warnings.push('No camera GPS/EXIF headers embedded (likely stripped by CDN/platform).');
  }
  if (pdf.pdfMeta && (pdf.pdfMeta.Author || pdf.pdfMeta.Creator)) {
    warnings.push('Document metadata exposes author/tooling attributes.');
  }

  return {
    fileName,
    mimeType,
    sizeBytes: bytes.byteLength,
    sha256,
    md5,
    dimensions: jpeg.dimensions || png.dimensions,
    cameraMake: jpeg.cameraMake,
    cameraModel: jpeg.cameraModel,
    software: jpeg.software || png.software || pdf.software,
    dateTimeOriginal: jpeg.dateTimeOriginal || pdf.dateTimeOriginal,
    gps: jpeg.gps || null,
    pdfMeta: pdf.pdfMeta,
    pngChunks: png.pngChunks,
    headers: extraHeaders,
    warnings,
  };
}
