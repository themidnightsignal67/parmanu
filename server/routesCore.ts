import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  InvestigationRecord,
  TargetType,
  ToolId,
} from '../src/types/investigation.ts';
import {
  askGeminiAnalyst,
  generateInvestigationBrief,
  getGeminiRotatorStatus,
} from './geminiRotator.ts';
import {
  executeInvestigation,
  fetchLiveGitHubCommitDetail,
  inspectToolsHealth,
} from './osintEngine.ts';
import { extractTargetsFromFileBuffer } from './fileExtractor.ts';
import { runFacialRecognitionAnalysis } from './facialEngine.ts';
import {
  enforceAndConsumeSearchCredit,
  getCreditStatusForRequest,
} from './creditLimiter.ts';
import express from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function registerCoreRoutes(app: Express): void {
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
    '../src/assets/images/brahman_om_logo_1794746111823.jpg'
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

// NOTE: remaining investigation routes continue below this line in source control
// This file is part of the Vercel split; full investigation POST/GET routes are required.
console.warn('[routesCore] Partial load — ensure full routesCore is deployed');
}
