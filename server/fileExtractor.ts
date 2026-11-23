import zlib from 'node:zlib';
import type { TargetType } from '../src/types/investigation.ts';

export interface BatchExtractedTarget {
  id: string;
  target: string;
  targetType: TargetType;
  sourceHint: string;
  confidence: 'high' | 'medium';
}

export interface BatchExtractResult {
  fileName: string;
  fileSize: number;
  detectedFormat: string;
  totalExtracted: number;
  targets: BatchExtractedTarget[];
  notes: string[];
}

const IGNORED_DOMAINS = new Set([
  'w3.org',
  'www.w3.org',
  'schemas.openxmlformats.org',
  'schemas.microsoft.com',
  'purl.org',
  'ns.adobe.com',
  'xml.org',
  'xmlns.com',
  'example.com',
  'example.org',
  'example.net',
  'localhost.localdomain',
  'openxmlformats.org',
]);

const FILE_EXTENSION_TLDS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tiff',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods',
  'csv', 'tsv', 'txt', 'md', 'log', 'json', 'jsonl', 'ndjson', 'xml',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'css', 'scss', 'less', 'html', 'htm',
  'py', 'rb', 'go', 'rs', 'java', 'cpp', 'hpp', 'c', 'h', 'cs', 'php', 'sh', 'bat',
  'zip', 'tar', 'gz', 'bz2', 'xz', 'rar', '7z',
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'db', 'sqlite', 'bak', 'tmp',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'mp4', 'wav', 'avi', 'mov',
]);

const VALID_COMMON_SHORT_TLDS = new Set([
  'com', 'org', 'net', 'edu', 'gov', 'mil', 'int',
  'io', 'ai', 'co', 'in', 'uk', 'us', 'de', 'fr', 'jp', 'cn', 'ru', 'au', 'ca', 'br',
  'dev', 'app', 'me', 'tv', 'info', 'biz', 'xyz', 'cloud', 'tech', 'online', 'site',
  'store', 'pro', 'club', 'live', 'news', 'blog', 'gg', 'to', 'ly', 'cc', 'it', 'es',
  'nl', 'se', 'no', 'fi', 'dk', 'ch', 'at', 'pl', 'ua', 'kr', 'sg', 'ae', 'za', 'nz',
]);

function isLikelyRealDomain(rawDomain: string, strictMode: boolean): boolean {
  const clean = rawDomain.trim().toLowerCase().replace(/\.+$/, '');
  if (!clean || clean.length < 4 || clean.length > 253) return false;
  if (IGNORED_DOMAINS.has(clean)) return false;
  if (clean.startsWith('.') || clean.includes('..')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(clean)) return false;

  const parts = clean.split('.');
  if (parts.length < 2) return false;
  const tld = parts[parts.length - 1];
  if (!/^[a-z]{2,14}$/.test(tld)) return false;
  if (FILE_EXTENSION_TLDS.has(tld)) return false;

  // In binary/noisy text mode, require either a well-known TLD or >=2 labels with clean alpha host
  if (strictMode && !VALID_COMMON_SHORT_TLDS.has(tld)) {
    return false;
  }

  // Reject single-char labels in noisy binary scans like a.b.com unless known
  if (parts.some((p) => p.length === 0 || p.length > 63)) return false;
  if (strictMode && parts[0].length < 2) return false;

  return true;
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return false;
    if (p.length > 1 && p.startsWith('0')) return false;
    const n = Number(p);
    if (n < 0 || n > 255) return false;
  }
  // Filter obvious software version patterns like 0.0.0.0 or 1.0.0.0 when ambiguous
  if (ip === '0.0.0.0' || ip === '255.255.255.255') return false;
  return true;
}

function isLikelyPhone(raw: string): string | null {
  const trimmed = raw.trim();
  // Require + prefix OR explicit grouping separators to avoid random integers/timestamps
  const hasPlus = trimmed.startsWith('+');
  const hasSeparator = /[\s().-]/.test(trimmed);
  if (!hasPlus && !hasSeparator) return null;

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return null;
  // Reject repeated single digit or obvious dates like 2026-11-15
  if (/^(\d)\1+$/.test(digits)) return null;
  if (/^(19|20)\d{6}$/.test(digits)) return null;

  const normalized = hasPlus ? `+${digits}` : `+${digits}`;
  return normalized;
}

function extractZipTextEntries(buf: Buffer): { text: string; entryNames: string[] } | null {
  // Check PK\x03\x04 local file header signature
  if (buf.length < 30 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    return null;
  }

  const chunks: string[] = [];
  const entryNames: string[] = [];
  let offset = 0;
  let safetyCounter = 0;

  while (offset + 30 < buf.length && safetyCounter < 400) {
    safetyCounter++;
    // Search for next PK\x03\x04 if needed
    if (
      buf[offset] !== 0x50 ||
      buf[offset + 1] !== 0x4b ||
      buf[offset + 2] !== 0x03 ||
      buf[offset + 3] !== 0x04
    ) {
      const nextSig = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), offset + 1);
      if (nextSig === -1) break;
      offset = nextSig;
      if (offset + 30 >= buf.length) break;
    }

    const flags = buf.readUInt16LE(offset + 6);
    const compression = buf.readUInt16LE(offset + 8);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const fileNameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);

    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLen + extraLen;
    if (dataStart > buf.length) break;

    const entryName = buf
      .subarray(nameStart, nameStart + fileNameLen)
      .toString('utf8');

    const hasDataDescriptor = (flags & 0x08) !== 0;
    let payloadEnd = dataStart + compressedSize;
    if (hasDataDescriptor && compressedSize === 0) {
      // Find next local header or central directory signature
      const nextLocal = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), dataStart);
      const nextCd = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), dataStart);
      const candidates = [nextLocal, nextCd].filter((n) => n > dataStart);
      payloadEnd = candidates.length > 0 ? Math.min(...candidates) : buf.length;
    }

    if (payloadEnd <= buf.length && payloadEnd >= dataStart) {
      const lower = entryName.toLowerCase();
      const isTextLike =
        /\.(xml|txt|csv|tsv|json|jsonl|ndjson|md|html|htm|rels|vcf|eml|log|yaml|yml)$/.test(
          lower
        ) || !lower.includes('.');

      if (isTextLike && !lower.endsWith('/')) {
        entryNames.push(entryName);
        const compressed = buf.subarray(dataStart, payloadEnd);
        let rawEntry: Buffer | null = null;
        try {
          if (compression === 0) {
            rawEntry = compressed;
          } else if (compression === 8) {
            rawEntry = zlib.inflateRawSync(compressed);
          }
        } catch {
          // Ignore corrupt/encrypted entry
        }

        if (rawEntry && rawEntry.length > 0 && rawEntry.length < 10 * 1024 * 1024) {
          let text = rawEntry.toString('utf8');
          if (lower.endsWith('.xml') || lower.endsWith('.rels') || lower.endsWith('.html')) {
            text = text
              .replace(/<[^>]+>/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'");
          }
          chunks.push(text);
        }
      }
      offset = payloadEnd;
    } else {
      offset += 4;
    }
  }

  if (chunks.length === 0 && entryNames.length === 0) {
    return null;
  }

  return { text: chunks.join('\n'), entryNames };
}

function extractPdfText(buf: Buffer): string {
  const latin = buf.toString('latin1');
  const parts: string[] = [];

  // Decompress FlateDecode / compressed PDF streams
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]*endstream/g;
  let match: RegExpExecArray | null;
  let count = 0;

  while ((match = streamRegex.exec(latin)) !== null && count < 400) {
    count++;
    const rawStream = Buffer.from(match[1], 'latin1');
    let textChunk = '';
    try {
      const inflated = zlib.inflateSync(rawStream);
      textChunk = inflated.toString('utf8');
    } catch {
      try {
        const inflatedRaw = zlib.inflateRawSync(rawStream);
        textChunk = inflatedRaw.toString('utf8');
      } catch {
        textChunk = rawStream.toString('utf8');
      }
    }

    // Extract PDF text literals inside parentheses: (hello@domain.com) Tj
    const litMatches = textChunk.match(/\(([^()\\]*(?:\\.[^()\\]*)*)\)/g);
    if (litMatches && litMatches.length > 0) {
      const joined = litMatches
        .map((m) =>
          m
            .slice(1, -1)
            .replace(/\\([()\\])/g, '$1')
            .replace(/\\n|\\r/g, ' ')
        )
        .join(' ');
      parts.push(joined);
    }
    parts.push(textChunk);
  }

  // Also append printable strings from top-level PDF (annotations, URIs, metadata)
  const uriMatches = latin.match(/\/URI\s*\(([^)]+)\)/g);
  if (uriMatches) {
    parts.push(uriMatches.map((u) => u.replace(/^\/URI\s*\(|\)$/g, '')).join('\n'));
  }

  parts.push(extractPrintableStrings(buf));
  return parts.join('\n');
}

function extractPrintableStrings(buf: Buffer): string {
  // Decode UTF-8 if mostly valid text
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  let controlCount = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b < 0x09 || (b > 0x0d && b < 0x20)) controlCount++;
  }

  if (sample.length > 0 && controlCount / sample.length < 0.08) {
    // Check UTF-16LE BOM or null-interleaved ASCII
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
      return buf.subarray(2).toString('utf16le');
    }
    return buf.toString('utf8');
  }

  // Binary fallback: extract printable ASCII sequences >= 4 chars + UTF-16LE sequences
  const asciiMatches = buf.toString('latin1').match(/[\x20-\x7e\r\n\t]{4,}/g) || [];
  const utf16Text = buf
    .toString('utf16le')
    .match(/[\x20-\x7e]{5,}/g) || [];

  return [...asciiMatches, ...utf16Text].join('\n');
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function isValidUsernameToken(raw: string): string | null {
  const clean = raw.trim().replace(/^@/, '');
  if (clean.length < 2 || clean.length > 48) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(clean)) return null;
  if (/^\d+$/.test(clean)) return null;
  if (clean.includes('..') || clean.startsWith('.') || clean.endsWith('.')) return null;
  // Don't treat file names as usernames
  const lastSeg = clean.split('.').pop()?.toLowerCase() || '';
  if (clean.includes('.') && FILE_EXTENSION_TLDS.has(lastSeg)) return null;
  return clean;
}

class TargetCollector {
  private seen = new Map<string, BatchExtractedTarget>();

  add(
    target: string,
    targetType: TargetType,
    sourceHint: string,
    confidence: 'high' | 'medium' = 'high'
  ) {
    const clean = target.trim();
    if (!clean || clean.length < 2 || clean.length > 254) return;
    const key = `${targetType}::${clean.toLowerCase()}`;
    if (!this.seen.has(key)) {
      this.seen.set(key, {
        id: `bt_${this.seen.size + 1}_${Math.random().toString(36).slice(2, 6)}`,
        target: clean,
        targetType,
        sourceHint,
        confidence,
      });
    }
  }

  list(): BatchExtractedTarget[] {
    return Array.from(this.seen.values());
  }
}

function scanTextForIndicators(
  text: string,
  collector: TargetCollector,
  sourceHint: string,
  options: { strictDomains: boolean; allowLineUsernames: boolean }
) {
  // 1. Emails
  const emailRegex = /\b[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,14}\b/g;
  for (const m of text.matchAll(emailRegex)) {
    const email = m[0].toLowerCase();
    const domainPart = email.split('@')[1];
    if (domainPart && !FILE_EXTENSION_TLDS.has(domainPart.split('.').pop() || '')) {
      collector.add(email, 'email', sourceHint, 'high');
    }
  }

  // 2. IPv4 addresses
  const ipv4Regex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  for (const m of text.matchAll(ipv4Regex)) {
    if (isValidIpv4(m[0])) {
      collector.add(m[0], 'ip', sourceHint, 'high');
    }
  }

  // 3. Explicit URLs -> Domains
  const urlRegex = /\bhttps?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,14})(?:[/:?#]|$)/gi;
  for (const m of text.matchAll(urlRegex)) {
    const host = m[1].toLowerCase().replace(/^www\./, '');
    if (isLikelyRealDomain(host, false)) {
      collector.add(host, 'domain', sourceHint, 'high');
    }
  }

  // 4. Standalone Domains
  const domainRegex = /\b(?:[a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,14}\b/g;
  for (const m of text.matchAll(domainRegex)) {
    const idx = m.index ?? 0;
    // Skip if part of an email address right after '@'
    if (idx > 0 && text[idx - 1] === '@') continue;
    const candidate = m[0].toLowerCase().replace(/^www\./, '');
    if (isLikelyRealDomain(candidate, options.strictDomains)) {
      collector.add(candidate, 'domain', sourceHint, options.strictDomains ? 'medium' : 'high');
    }
  }

  // 5. Phone Numbers (E.164 or formatted international/local numbers)
  const phoneRegex = /(?<!\w)(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{3,5}(?!\w)/g;
  for (const m of text.matchAll(phoneRegex)) {
    const normalized = isLikelyPhone(m[0]);
    if (normalized) {
      collector.add(normalized, 'phone', sourceHint, 'medium');
    }
  }

  // 6. Explicit @handles
  const handleRegex = /(?:^|[\s,;|(\["'])@([a-zA-Z0-9._-]{3,40})\b/g;
  for (const m of text.matchAll(handleRegex)) {
    const username = isValidUsernameToken(m[1]);
    if (username) {
      collector.add(username, 'username', `${sourceHint} (@handle)`, 'high');
    }
  }

  // 7. Line-by-line simple token extraction (ideal for .txt target lists)
  if (options.allowLineUsernames) {
    const lines = text.split(/\r?\n/).slice(0, 5000);
    lines.forEach((rawLine, idx) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) return;
      // Only treat as username if the entire line is a single clean identifier token
      if (!line.includes(' ') && !line.includes('@') && !line.includes('.') && !line.includes(':')) {
        const u = isValidUsernameToken(line);
        if (u && u.length >= 3) {
          collector.add(u, 'username', `Line ${idx + 1}`, 'medium');
        }
      }
    });
  }
}

function classifySingleValue(raw: string): { target: string; targetType: TargetType } | null {
  const val = raw.trim();
  if (!val || val.length < 2 || val.length > 254) return null;

  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val)) {
    return { target: val.toLowerCase(), targetType: 'email' };
  }
  if (isValidIpv4(val) || /^[0-9a-f:]+:[0-9a-f:]+$/i.test(val)) {
    return { target: val, targetType: 'ip' };
  }
  const phone = isLikelyPhone(val);
  if (phone) {
    return { target: phone, targetType: 'phone' };
  }
  const strippedUrl = val.replace(/^https?:\/\//i, '').split(/[/?#]/)[0];
  if (isLikelyRealDomain(strippedUrl, false)) {
    return { target: strippedUrl.toLowerCase().replace(/^www\./, ''), targetType: 'domain' };
  }
  const user = isValidUsernameToken(val);
  if (user) {
    return { target: user, targetType: 'username' };
  }
  return null;
}

function extractFromJsonValue(
  node: unknown,
  collector: TargetCollector,
  pathHint = 'JSON'
) {
  if (typeof node === 'string') {
    const lowerKey = pathHint.toLowerCase();
    const isIdentityField = /(user|username|handle|login|screen_name|account|target|identifier)/.test(
      lowerKey
    );
    if (isIdentityField) {
      const classified = classifySingleValue(node);
      if (classified) {
        collector.add(classified.target, classified.targetType, pathHint, 'high');
        return;
      }
    }
    scanTextForIndicators(node, collector, pathHint, {
      strictDomains: false,
      allowLineUsernames: false,
    });
    return;
  }
  if (Array.isArray(node)) {
    node.slice(0, 2000).forEach((item, idx) => {
      extractFromJsonValue(item, collector, `${pathHint}[${idx}]`);
    });
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      extractFromJsonValue(v, collector, `${pathHint}.${k}`);
    }
  }
}

export function extractTargetsFromFileBuffer(
  fileName: string,
  mimeType: string,
  buffer: Buffer
): BatchExtractResult {
  const lowerName = (fileName || 'uploaded-file').toLowerCase();
  const ext = lowerName.includes('.') ? lowerName.split('.').pop() || '' : '';
  const collector = new TargetCollector();
  const notes: string[] = [];
  let detectedFormat = ext ? ext.toUpperCase() : mimeType || 'FILE';

  // 1. ZIP / Office Open XML / OpenDocument containers (.xlsx, .docx, .pptx, .odt, .zip)
  const isZipMagic =
    buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (
    isZipMagic ||
    ['xlsx', 'docx', 'pptx', 'odt', 'ods', 'zip'].includes(ext)
  ) {
    const zipParsed = extractZipTextEntries(buffer);
    if (zipParsed) {
      detectedFormat = ext ? `${ext.toUpperCase()} Archive` : 'ZIP Container';
      notes.push(
        `Decompressed ${zipParsed.entryNames.length} internal XML/text entries.`
      );
      scanTextForIndicators(zipParsed.text, collector, detectedFormat, {
        strictDomains: true,
        allowLineUsernames: false,
      });
      const list = collector.list().slice(0, 200);
      return {
        fileName,
        fileSize: buffer.length,
        detectedFormat,
        totalExtracted: list.length,
        targets: list,
        notes,
      };
    }
  }

  // 2. PDF Documents
  const isPdfMagic =
    buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
  if (isPdfMagic || ext === 'pdf') {
    detectedFormat = 'PDF Document';
    const pdfText = extractPdfText(buffer);
    notes.push('Scanned PDF text operators, URI annotations, and FlateDecode streams.');
    scanTextForIndicators(pdfText, collector, 'PDF stream', {
      strictDomains: true,
      allowLineUsernames: false,
    });
    const list = collector.list().slice(0, 200);
    return {
      fileName,
      fileSize: buffer.length,
      detectedFormat,
      totalExtracted: list.length,
      targets: list,
      notes,
    };
  }

  // 3. Extract text (handles UTF-8, UTF-16LE, or arbitrary binary files via strings scan)
  const textContent = extractPrintableStrings(bufToSafeBuffer(buffer));
  const trimmed = textContent.trim();

  // 4. JSON / NDJSON
  if (
    ext === 'json' ||
    ext === 'jsonl' ||
    ext === 'ndjson' ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[')
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      detectedFormat = 'JSON';
      extractFromJsonValue(parsed, collector, 'JSON');
      notes.push('Recursively parsed JSON keys and values.');
      const list = collector.list().slice(0, 200);
      return {
        fileName,
        fileSize: buffer.length,
        detectedFormat,
        totalExtracted: list.length,
        targets: list,
        notes,
      };
    } catch {
      // Try NDJSON line by line
      const lines = trimmed.split(/\r?\n/).filter(Boolean);
      let parsedAny = false;
      lines.slice(0, 2000).forEach((line, i) => {
        try {
          const obj = JSON.parse(line);
          parsedAny = true;
          extractFromJsonValue(obj, collector, `Row ${i + 1}`);
        } catch {
          // ignore
        }
      });
      if (parsedAny) {
        detectedFormat = 'NDJSON';
        notes.push('Parsed newline-delimited JSON objects.');
        const list = collector.list().slice(0, 200);
        return {
          fileName,
          fileSize: buffer.length,
          detectedFormat,
          totalExtracted: list.length,
          targets: list,
          notes,
        };
      }
    }
  }

  // 5. CSV / TSV
  if (ext === 'csv' || ext === 'tsv') {
    const delimiter = ext === 'tsv' ? '\t' : ',';
    const lines = textContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    detectedFormat = ext.toUpperCase();
    if (lines.length > 0) {
      const headerCells = splitCsvLine(lines[0], delimiter).map((h) =>
        h.toLowerCase()
      );
      const hasKnownHeader = headerCells.some((h) =>
        /(target|email|mail|user|username|handle|domain|host|ip|phone|mobile|identifier)/.test(
          h
        )
      );
      const startRow = hasKnownHeader ? 1 : 0;

      for (let r = startRow; r < Math.min(lines.length, 3000); r++) {
        const row = splitCsvLine(lines[r], delimiter);
        row.forEach((cell, cIdx) => {
          const colName = hasKnownHeader ? headerCells[cIdx] || `Col ${cIdx + 1}` : `Row ${r + 1}`;
          if (!cell) return;
          const isIdentityCol = hasKnownHeader && /(target|email|mail|user|username|handle|domain|host|ip|phone|mobile|identifier)/.test(colName);
          if (isIdentityCol) {
            const classified = classifySingleValue(cell);
            if (classified) {
              collector.add(classified.target, classified.targetType, `CSV: ${colName}`, 'high');
              return;
            }
          }
          scanTextForIndicators(cell, collector, `CSV: ${colName}`, {
            strictDomains: false,
            allowLineUsernames: false,
          });
        });
      }
      notes.push(`Parsed ${lines.length} ${detectedFormat} rows.`);
      const list = collector.list().slice(0, 200);
      return {
        fileName,
        fileSize: buffer.length,
        detectedFormat,
        totalExtracted: list.length,
        targets: list,
        notes,
      };
    }
  }

  // 6. Plain text / Logs / HTML / XML / EML / VCF / Binary arbitrary files
  const isTextFile =
    ['txt', 'log', 'md', 'html', 'htm', 'xml', 'yaml', 'yml', 'eml', 'vcf', 'ini', 'conf', 'env', 'sql'].includes(
      ext
    ) || mimeType.startsWith('text/');

  if (ext === 'html' || ext === 'htm' || ext === 'xml') {
    detectedFormat = ext.toUpperCase();
    const stripped = textContent.replace(/<[^>]+>/g, ' ');
    scanTextForIndicators(stripped, collector, detectedFormat, {
      strictDomains: true,
      allowLineUsernames: false,
    });
  } else if (isTextFile) {
    detectedFormat = ext ? `${ext.toUpperCase()} Text` : 'Plain Text';
    scanTextForIndicators(textContent, collector, detectedFormat, {
      strictDomains: false,
      allowLineUsernames: true,
    });
  } else {
    detectedFormat = ext ? `${ext.toUpperCase()} Binary` : 'Binary Scan';
    notes.push('Scanned embedded printable ASCII & UTF-16 strings from binary payload.');
    scanTextForIndicators(textContent, collector, 'Embedded strings', {
      strictDomains: true,
      allowLineUsernames: false,
    });
  }

  const finalTargets = collector.list().slice(0, 200);
  if (collector.list().length > 200) {
    notes.push('Capped extraction preview to the first 200 unique targets.');
  }

  return {
    fileName,
    fileSize: buffer.length,
    detectedFormat,
    totalExtracted: finalTargets.length,
    targets: finalTargets,
    notes,
  };
}

function bufToSafeBuffer(b: Buffer): Buffer {
  return Buffer.isBuffer(b) ? b : Buffer.from(b);
}
