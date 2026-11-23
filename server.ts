import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  InvestigationRecord,
  TargetType,
  ToolId,
} from './src/types/investigation.ts';
import {
  askGeminiAnalyst,
  generateInvestigationBrief,
  getGeminiRotatorStatus,
} from './server/geminiRotator.ts';
import {
  executeInvestigation,
  fetchLiveGitHubCommitDetail,
  inspectToolsHealth,
} from './server/osintEngine.ts';
import { extractTargetsFromFileBuffer } from './server/fileExtractor.ts';
import { runDeepGoogleDorking } from './server/dorkEngine.ts';
import { runFacialRecognitionAnalysis } from './server/facialEngine.ts';
import {
  enforceAndConsumeSearchCredit,
  getCreditStatusForRequest,
} from './server/creditLimiter.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

const app = express();
app.set('trust proxy', true);

// Allow larger JSON/base64 payloads specifically for universal file batch extraction
app.post(
  '/api/batch/extract',
  express.json({ limit: '20mb' }),
  (req, res) => {
    try {
      const body = req.body || {};
      const fileName = String(body.fileName || 'uploaded-file.txt').slice(0, 260);
      const mimeType = String(body.mimeType || 'application/octet-stream').slice(0, 120);

      let buffer: Buffer;
      if (typeof body.contentBase64 === 'string' && body.contentBase64.length > 0) {
        buffer = Buffer.from(body.contentBase64, 'base64');
      } else if (typeof body.textContent === 'string') {
        buffer = Buffer.from(body.textContent, 'utf8');
      } else {
        res.status(400).json({ error: 'Provide a file or text payload to extract targets.' });
        return;
      }

      if (buffer.length > 15 * 1024 * 1024) {
        res.status(413).json({ error: 'File exceeds the 15 MB batch upload limit.' });
        return;
      }

      const result = extractTargetsFromFileBuffer(fileName, mimeType, buffer);
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to extract targets from file.',
      });
    }
  }
);

app.post(
  '/api/facial/analyze',
  express.json({ limit: '12mb' }),
  async (req, res) => {
    try {
      const body = req.body || {};
      const target = String(body.target || 'Target').trim().slice(0, 254);
      const referencePhotoId =
        typeof body.referencePhotoId === 'string'
          ? body.referencePhotoId.trim()
          : undefined;

      const rawRef = body.referenceImage;
      const referenceImage =
        rawRef && typeof rawRef.base64 === 'string' && rawRef.base64.length > 0
          ? {
              label:
                typeof rawRef.label === 'string'
                  ? rawRef.label.slice(0, 120)
                  : 'Uploaded Reference Photo',
              mimeType: String(rawRef.mimeType || 'image/jpeg').slice(0, 64),
              base64: rawRef.base64,
            }
          : undefined;

      const candidates = Array.isArray(body.candidates)
        ? body.candidates
            .filter(
              (c: unknown): c is { id: string; platform: string; url: string; handle?: string } =>
                Boolean(
                  c &&
                    typeof c === 'object' &&
                    typeof (c as { url?: unknown }).url === 'string' &&
                    typeof (c as { platform?: unknown }).platform === 'string'
                )
            )
            .slice(0, 10)
            .map((c: { id?: unknown; platform: string; url: string; handle?: unknown }) => ({
              id: String(c.id || c.url).slice(0, 120),
              platform: String(c.platform).slice(0, 80),
              url: String(c.url).slice(0, 500),
              handle: typeof c.handle === 'string' ? c.handle.slice(0, 120) : undefined,
            }))
        : [];

      if (!referenceImage && candidates.length === 0) {
        res.status(400).json({
          error: 'Upload a reference photo or provide discovered profile photo URLs.',
        });
        return;
      }

      const report = await runFacialRecognitionAnalysis({
        target,
        referenceImage,
        referencePhotoId,
        candidates,
      });
      res.json(report);
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : 'Facial recognition analysis failed.',
      });
    }
  }
);

app.use(express.json({ limit: '5mb' }));

const investigationStore = new Map<string, InvestigationRecord>();
const cancelledScans = new Set<string>();
const pendingSummarize = new Map<string, Promise<InvestigationRecord>>();

async function getOrCreateAiSummary(
  record: InvestigationRecord
): Promise<InvestigationRecord> {
  const existing = investigationStore.get(record.scanId);
  if (existing?.aiSummary && !existing.aiSummary.error) {
    return existing;
  }

  const inflight = pendingSummarize.get(record.scanId);
  if (inflight) {
    return inflight;
  }

  const task = (async () => {
    try {
      const aiSummary = await generateInvestigationBrief(record);
      const latest = investigationStore.get(record.scanId) || record;
      const updated = { ...latest, aiSummary };
      if (!cancelledScans.has(record.scanId)) {
        investigationStore.set(record.scanId, updated);
      }
      return updated;
    } finally {
      pendingSummarize.delete(record.scanId);
    }
  })();

  pendingSummarize.set(record.scanId, task);
  return task;
}

function sanitizeTargetType(val: unknown): TargetType {
  if (
    val === 'username' ||
    val === 'email' ||
    val === 'domain' ||
    val === 'ip' ||
    val === 'phone'
  ) {
    return val;
  }
  return 'email';
}

function sanitizeTools(tools: unknown, targetType: TargetType): ToolId[] {
  const valid: ToolId[] = [
    'mailaccess',
    'holehe',
    'maigret',
    'ghunt',
    'blackbird',
    'sherlock',
    'phoneinfoga',
    'ignorant',
  ];
  const parsed = Array.isArray(tools)
    ? tools.filter((t): t is ToolId => valid.includes(t as ToolId))
    : [];

  if (targetType === 'email') {
    const emailAllowed: ToolId[] = ['mailaccess', 'holehe', 'ghunt'];
    const emailParsed = parsed.filter((t) => emailAllowed.includes(t));
    return emailParsed.length > 0 ? emailParsed : emailAllowed;
  }

  if (parsed.length > 0) return parsed;
  if (targetType === 'phone') {
    return ['mailaccess', 'phoneinfoga', 'ignorant'];
  }
  if (targetType === 'domain' || targetType === 'ip') {
    return ['mailaccess'];
  }
  if (targetType === 'username') {
    return ['mailaccess', 'maigret', 'blackbird', 'sherlock'];
  }
  return ['mailaccess', 'holehe', 'ghunt'];
}

// Serve restored Parmanu Om emblem on logo & favicon URLs
app.get(['/logo.png', '/favicon.png', '/favicon.ico'], (_req, res) => {
  const logoPath = path.resolve(
    __dirname,
    'src/assets/images/brahman_om_logo_1794746111823.jpg'
  );
  if (fs.existsSync(logoPath)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(logoPath);
    return;
  }
  res.status(404).end();
});

app.get(['/robots.txt', '/rover.txt'], (_req, res) => {
  res
    .type('text/plain')
    .send(
      ['User-agent: *', 'Allow: /', 'Disallow: /api/', '', 'Sitemap: /sitemap.xml'].join('\n')
    );
});

app.get(['/.well-known/security.txt', '/security.txt'], (_req, res) => {
  res
    .type('text/plain')
    .send(
      [
        'Contact: mailto:security@parmanu-osint.local',
        'Expires: 2027-12-31T23:59:59.000Z',
        'Preferred-Languages: en, hi',
        'Canonical: /.well-known/security.txt',
      ].join('\n')
    );
});

app.get('/sitemap.xml', (_req, res) => {
  res
    .type('application/xml')
    .send(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '  <url><loc>/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>',
        '</urlset>',
      ].join('\n')
    );
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    status: 'healthy',
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/tools/health', async (_req, res) => {
  try {
    const tools = await inspectToolsHealth();
    res.json({
      tools,
      gemini: getGeminiRotatorStatus(),
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Health check failed',
    });
  }
});

app.get('/api/credits/status', async (req, res) => {
  try {
    const status = await getCreditStatusForRequest(req, res);
    res.json(status);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Unable to verify credit status.',
    });
  }
});

app.get('/api/investigations', (_req, res) => {
  const list = Array.from(investigationStore.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  res.json({ investigations: list });
});

app.post('/api/investigations', async (req, res) => {
  const body = req.body || {};
  const targetType = sanitizeTargetType(body.targetType);
  const rawTarget = String(body.target || body.email || '').trim();

  if (!rawTarget || rawTarget.length < 2 || rawTarget.length > 254) {
    res.status(400).json({ error: 'Provide a valid target identifier.' });
    return;
  }

  if (body.authorizedConfirmed !== true) {
    res
      .status(400)
      .json({ error: 'Explicit authorization attestation is required.' });
    return;
  }

  const creditGate = await enforceAndConsumeSearchCredit(req, res);
  if (!creditGate.allowed) {
    res.status(creditGate.httpStatus).json({
      error: creditGate.error,
      code: 'DAILY_CREDIT_LIMIT_REACHED',
      creditStatus: creditGate.status,
    });
    return;
  }

  const selectedTools = sanitizeTools(body.tools, targetType);
  const enableGoogleDorking = body.enableGoogleDorking === true;
  const scanId = `scan_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const createdAt = new Date().toISOString();

  const initialRecord: InvestigationRecord = {
    scanId,
    target: rawTarget,
    targetType,
    email: targetType === 'email' ? rawTarget : '',
    createdAt,
    durationMs: 0,
    status: 'running',
    selectedTools,
    enableGoogleDorking,
    summary: {
      total: 0,
      found: 0,
      breached: 0,
      registered: 0,
      leaked: 0,
      notFound: 0,
      notChecked: 0,
      errors: 0,
      profilePhotosCount: 0,
    },
    profilePhotos: [],
    breachedAccounts: [],
    geoMarkers: [],
    toolExecutions: selectedTools.map((tool) => ({
      tool,
      status: 'running',
      progress: 25,
      durationMs: 0,
      platformsChecked: 0,
      foundCount: 0,
      errorCount: 0,
      message: `Running ${tool} (${targetType} module)...`,
    })),
    results: [],
  };

  investigationStore.set(scanId, initialRecord);

  void (async () => {
    try {
      const completed = await executeInvestigation(
        scanId,
        rawTarget,
        targetType,
        selectedTools,
        (partial) => {
          if (!cancelledScans.has(scanId)) {
            investigationStore.set(scanId, partial);
          }
        },
        { enableGoogleDorking }
      );

      if (cancelledScans.has(scanId)) return;
      investigationStore.set(scanId, completed);
      if (completed.status === 'failed') {
        creditGate.rollback?.();
      }

      await getOrCreateAiSummary(completed);
    } catch (err) {
      creditGate.rollback?.();
      if (cancelledScans.has(scanId)) return;
      const existing = investigationStore.get(scanId);
      if (existing) {
        investigationStore.set(scanId, {
          ...existing,
          status: 'failed',
          completedAt: new Date().toISOString(),
          aiSummary: {
            executiveBrief:
              err instanceof Error ? err.message : 'Investigation execution failed.',
            riskPosture: 'Low',
            keyTakeaways: [],
            recommendedNextSteps: ['Retry the query or inspect selected modules.'],
          },
        });
      }
    }
  })();

  res.status(201).json({
    ...initialRecord,
    creditStatus: creditGate.status,
  });
});

app.get('/api/investigations/:scanId', (req, res) => {
  const record = investigationStore.get(req.params.scanId);
  if (!record) {
    res.status(404).json({ error: 'Investigation not found.' });
    return;
  }
  res.json(record);
});

app.post('/api/investigations/:scanId/cancel', (req, res) => {
  const scanId = req.params.scanId;
  cancelledScans.add(scanId);
  const existing = investigationStore.get(scanId);
  if (existing) {
    const updated: InvestigationRecord = {
      ...existing,
      status: 'cancelled',
      completedAt: new Date().toISOString(),
    };
    investigationStore.set(scanId, updated);
    res.json(updated);
    return;
  }
  res.json({ scanId, status: 'cancelled' });
});

app.post('/api/investigations/:scanId/summarize', async (req, res) => {
  const record =
    investigationStore.get(req.params.scanId) ||
    (req.body?.record as InvestigationRecord | undefined);
  if (!record || !record.target) {
    res.status(404).json({ error: 'Investigation not found.' });
    return;
  }
  try {
    const updated = await getOrCreateAiSummary(record);
    res.json(updated);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'AI summary failed',
    });
  }
});

app.post('/api/investigations/:scanId/ask', async (req, res) => {
  const record =
    investigationStore.get(req.params.scanId) ||
    (req.body?.record as InvestigationRecord | undefined);
  if (!record || !record.target) {
    res.status(404).json({ error: 'Investigation not found.' });
    return;
  }
  const question = String(req.body?.question || '').trim();
  if (!question) {
    res.status(400).json({ error: 'Question is required.' });
    return;
  }
  try {
    const reply = await askGeminiAnalyst(record, question);
    res.json(reply);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'AI Analyst request failed',
    });
  }
});

function isSafePublicImageUrl(rawUrl: string): URL | null {
  try {
    const trimmed = rawUrl
      .trim()
      .replace(/&amp;/gi, '&')
      .replace(/&#x2F;/gi, '/')
      .replace(/&#47;/g, '/');
    const withProto = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
    const parsed = new URL(withProto);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const host = parsed.hostname.toLowerCase();
    if (
      !host ||
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '[::1]' ||
      /^\[?(fe80|fc00|fd[0-9a-f]{2}):/i.test(host) ||
      /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/.test(host)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function detectImageMimeFromBuffer(buf: Buffer): string | null {
  if (buf.byteLength < 4) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  // GIF: GIF8
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  // WebP: RIFF....WEBP
  if (
    buf.byteLength >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  // AVIF / HEIC: ....ftyp(avif|avis|heic|mif1)
  if (buf.byteLength >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('ascii').toLowerCase();
    if (brand === 'avif' || brand === 'avis' || brand === 'heic' || brand === 'mif1') {
      return brand.startsWith('avi') ? 'image/avif' : 'image/heic';
    }
  }
  // ICO: 00 00 01 00
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) {
    return 'image/x-icon';
  }
  // BMP: BM
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  // SVG text check
  const headText = buf.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (headText.startsWith('<svg') || (headText.startsWith('<?xml') && headText.includes('<svg'))) {
    return 'image/svg+xml';
  }
  return null;
}

function resolveAvatarReferer(parsed: URL): string | undefined {
  const host = parsed.hostname.toLowerCase();
  if (host.includes('cdninstagram.com') || host.includes('instagram.com')) {
    return 'https://www.instagram.com/';
  }
  if (host.includes('fbcdn.net') || host.includes('facebook.com') || host.includes('fbsbx.com')) {
    return 'https://www.facebook.com/';
  }
  if (host.includes('whatsapp.net') || host.includes('whatsapp.com')) {
    return 'https://web.whatsapp.com/';
  }
  if (host.includes('telesco.me') || host.includes('telegram') || host.includes('t.me')) {
    return 'https://t.me/';
  }
  if (host.includes('twimg.com') || host === 'x.com' || host.endsWith('.x.com')) {
    return 'https://x.com/';
  }
  if (host.includes('bitmoji.com') || host.includes('snapchat.com')) {
    return 'https://accounts.snapchat.com/';
  }
  if (host.includes('googleusercontent.com') || host.includes('ggpht.com')) {
    return 'https://contacts.google.com/';
  }
  return undefined;
}

app.get('/api/proxy/avatar', async (req, res) => {
  const rawUrl = String(req.query.url || '').trim();
  const inline = req.query.inline === '1' || req.query.inline === 'true';
  const nameHint = String(req.query.name || 'profile-avatar')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 48);

  const parsed = isSafePublicImageUrl(rawUrl);
  if (!parsed) {
    res.status(403).json({ error: 'Only safe public image URLs are allowed.' });
    return;
  }

  try {
    const baseHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Sec-Fetch-Dest': 'image',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'cross-site',
    };
    const referer = resolveAvatarReferer(parsed);
    let upstream = await fetch(parsed.toString(), {
      redirect: 'follow',
      headers: referer ? { ...baseHeaders, Referer: referer } : baseHeaders,
      signal: AbortSignal.timeout(8000),
    });
    if ((upstream.status === 400 || upstream.status === 401 || upstream.status === 403 || upstream.status === 406) && referer) {
      await upstream.body?.cancel().catch(() => {});
      upstream = await fetch(parsed.toString(), {
        redirect: 'follow',
        headers: baseHeaders,
        signal: AbortSignal.timeout(8000),
      });
    }
    if (!upstream.ok && (upstream.status === 400 || upstream.status === 401 || upstream.status === 403 || upstream.status === 406)) {
      await upstream.body?.cancel().catch(() => {});
      upstream = await fetch(parsed.toString(), {
        redirect: 'follow',
        headers: {
          'User-Agent': 'curl/8.7.1',
          Accept: '*/*',
        },
        signal: AbortSignal.timeout(8000),
      });
    }
    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }
    const headerType = (upstream.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > 6 * 1024 * 1024) {
      res.status(415).json({ error: 'Avatar image payload empty or oversized.' });
      return;
    }
    const magicMime = detectImageMimeFromBuffer(buf);
    const isGenericHeader =
      !headerType ||
      headerType === 'application/octet-stream' ||
      headerType === 'binary/octet-stream';
    const contentType = magicMime || (headerType.startsWith('image/') ? headerType : '');
    if (!contentType || (!headerType.startsWith('image/') && !isGenericHeader && !magicMime)) {
      res.status(415).json({ error: 'URL did not return an image.' });
      return;
    }
    const ext = contentType.includes('png')
      ? 'png'
      : contentType.includes('webp')
      ? 'webp'
      : contentType.includes('gif')
      ? 'gif'
      : contentType.includes('svg')
      ? 'svg'
      : contentType.includes('avif')
      ? 'avif'
      : 'jpg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (!inline) {
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${nameHint || 'avatar'}.${ext}"`
      );
    }
    res.send(buf);
  } catch {
    res.status(502).json({ error: 'Failed to load avatar.' });
  }
});

app.get('/api/artifacts/github/commit', async (req, res) => {
  const repo = String(req.query.repo || '').trim();
  const sha = String(req.query.sha || '').trim();
  if (!repo || !sha || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    res.status(400).json({ error: 'Valid repo (owner/name) and sha required.' });
    return;
  }
  try {
    const detail = await fetchLiveGitHubCommitDetail(repo, sha);
    res.json(detail);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Commit lookup failed',
    });
  }
});

app.post('/api/dork', async (req, res) => {
  const body = req.body || {};
  const rawTarget = String(body.target || '').trim();
  const targetType = sanitizeTargetType(body.targetType);
  const strictPivot =
    typeof body.strictPivot === 'string'
      ? body.strictPivot.trim().slice(0, 160)
      : undefined;
  const extraTerms = Array.isArray(body.extraTerms)
    ? body.extraTerms
        .map((t: unknown) => String(t || '').trim())
        .filter((t: string) => t.length >= 2 && t.length <= 128)
        .slice(0, 6)
    : [];

  if (!rawTarget || rawTarget.length < 2 || rawTarget.length > 254) {
    res.status(400).json({ error: 'Provide a valid target for Google Dorking.' });
    return;
  }

  try {
    const dorkReport = await runDeepGoogleDorking({
      target: rawTarget,
      targetType,
      extraTerms,
      strictPivot,
      mode: 'full',
    });
    res.json(dorkReport);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Deep Google Dorking failed.',
    });
  }
});

function isSafeExternalHttpsUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    if (
      !host ||
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '[::1]' ||
      /^\[?(fe80|fc00|fd[0-9a-f]{2}):/i.test(host) ||
      /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/.test(host)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

app.post('/api/webhooks/dispatch', async (req, res) => {
  const body = req.body || {};
  const rawUrl = String(body.url || '').trim();
  const provider =
    body.provider === 'slack' || body.provider === 'discord' ? body.provider : 'json';
  const payload = body.payload as Record<string, unknown> | undefined;

  const parsed = isSafeExternalHttpsUrl(rawUrl);
  if (!parsed) {
    res.status(400).json({
      error: 'Provide a valid public HTTPS webhook URL (localhost/private ranges blocked).',
    });
    return;
  }

  try {
    const title = String(payload?.title || 'Parmanu OSINT Intelligence Alert');
    const summaryText = String(payload?.summary || 'Alert dispatched from Parmanu OSINT.');
    const target = String(payload?.target || 'target');
    const targetType = String(payload?.targetType || 'unknown');

    let outboundBody: unknown = payload || { title, summary: summaryText, target, targetType };
    if (provider === 'slack') {
      outboundBody = {
        text: `*${title}*\nTarget: \`${target}\` (${targetType})\n${summaryText}`,
      };
    } else if (provider === 'discord') {
      outboundBody = {
        embeds: [
          {
            title,
            description: summaryText.slice(0, 1800),
            color: 15548997,
            fields: [
              { name: 'Target', value: `\`${target}\``, inline: true },
              { name: 'Type', value: targetType.toUpperCase(), inline: true },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }

    const upstream = await fetch(parsed.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Parmanu-OSINT/3.1',
      },
      body: JSON.stringify(outboundBody),
      signal: AbortSignal.timeout(7000),
    });

    const responseText = await upstream.text().catch(() => '');
    res.json({
      ok: upstream.ok,
      status: upstream.status,
      message: upstream.ok
        ? `Webhook delivered (HTTP ${upstream.status}).`
        : `Webhook endpoint returned HTTP ${upstream.status}: ${responseText.slice(0, 180)}`,
    });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Failed to deliver webhook alert.',
    });
  }
});

app.post('/api/forensics/remote', async (req, res) => {
  const rawUrl = String(req.body?.url || '').trim();
  const parsed = isSafeExternalHttpsUrl(rawUrl);
  if (!parsed) {
    res.status(400).json({ error: 'Provide a valid public HTTPS asset URL.' });
    return;
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'Parmanu-OSINT/3.1' },
      signal: AbortSignal.timeout(7500),
    });
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `Upstream HTTP ${upstream.status}` });
      return;
    }
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const arr = new Uint8Array(await upstream.arrayBuffer());
    if (arr.byteLength > 8 * 1024 * 1024) {
      res.status(413).json({ error: 'Remote asset exceeds 8 MB inspection limit.' });
      return;
    }
    const buf = Buffer.from(arr);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const md5 = crypto.createHash('md5').update(buf).digest('hex');

    res.json({
      url: parsed.toString(),
      contentType,
      sizeBytes: buf.byteLength,
      sha256,
      md5,
      serverHeader: upstream.headers.get('server') || undefined,
      lastModified: upstream.headers.get('last-modified') || undefined,
      etag: upstream.headers.get('etag') || undefined,
      sampleBase64: buf.subarray(0, 512 * 1024).toString('base64'),
    });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Failed to inspect remote asset.',
    });
  }
});

const pdfExportStore = new Map<
  string,
  { filename: string; buffer: Buffer; expiresAt: number }
>();

function pruneExpiredPdfExports() {
  const now = Date.now();
  for (const [id, entry] of pdfExportStore.entries()) {
    if (entry.expiresAt <= now) {
      pdfExportStore.delete(id);
    }
  }
}

app.post(
  '/api/export/pdf',
  express.json({ limit: '16mb' }),
  (req, res) => {
    try {
      pruneExpiredPdfExports();
      const body = req.body || {};
      const rawBase64 = typeof body.base64 === 'string' ? body.base64.trim() : '';
      const rawFilename = typeof body.filename === 'string' ? body.filename.trim() : 'parmanu-dossier.pdf';

      if (!rawBase64) {
        res.status(400).json({ error: 'PDF payload is required.' });
        return;
      }

      const cleanBase64 = rawBase64.replace(/^data:application\/pdf[^,]*,/i, '');
      const buffer = Buffer.from(cleanBase64, 'base64');
      if (buffer.byteLength < 64 || buffer.byteLength > 12 * 1024 * 1024) {
        res.status(413).json({ error: 'PDF payload empty or exceeds 12 MB export limit.' });
        return;
      }

      // Verify genuine PDF header magic bytes (%PDF-)
      if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
        res.status(400).json({ error: 'Invalid PDF document payload.' });
        return;
      }

      const baseName = path
        .basename(rawFilename)
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);
      const safeFilename = baseName.toLowerCase().endsWith('.pdf')
        ? baseName
        : `${baseName || 'parmanu-dossier'}.pdf`;

      if (pdfExportStore.size >= 40) {
        const oldestKey = pdfExportStore.keys().next().value;
        if (oldestKey) pdfExportStore.delete(oldestKey);
      }

      const id = crypto.randomBytes(16).toString('hex');
      pdfExportStore.set(id, {
        filename: safeFilename,
        buffer,
        expiresAt: Date.now() + 600_000,
      });

      res.json({
        id,
        filename: safeFilename,
        sizeBytes: buffer.byteLength,
        downloadUrl: `/api/export/pdf/${id}`,
      });
    } catch {
      res.status(400).json({ error: 'Failed to prepare PDF export.' });
    }
  }
);

app.get('/api/export/pdf/:id', (req, res) => {
  pruneExpiredPdfExports();
  const id = String(req.params.id || '').trim();
  if (!/^[a-f0-9]{32}$/i.test(id)) {
    res.status(400).json({ error: 'Invalid PDF export ID.' });
    return;
  }

  const entry = pdfExportStore.get(id);
  if (!entry || entry.expiresAt <= Date.now()) {
    pdfExportStore.delete(id);
    res.status(404).json({ error: 'PDF export link expired. Click Download PDF Report again.' });
    return;
  }

  const disposition = req.query.inline === '1' ? 'inline' : 'attachment';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="${entry.filename}"`);
  res.setHeader('Content-Length', String(entry.buffer.byteLength));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.send(entry.buffer);
});

async function startServer() {
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir, { maxAge: '1h' }));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(503).json({ error: 'Application build bundle not found.' });
      }
    });
  }

  const HOST = process.env.HOST || '0.0.0.0';
  const server = app.listen(PORT, HOST, () => {
    console.log(`Parmanu OSINT server listening on http://${HOST}:${PORT}`);
  });

  // Match Railway / Envoy proxy keep-alive expectations cleanly
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}; shutting down gracefully...`);
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 8000).unref();
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

startServer();
