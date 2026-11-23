import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

function resolveFirebaseProjectId(): string {
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { projectId?: string };
      if (typeof parsed.projectId === 'string' && parsed.projectId.trim()) {
        return parsed.projectId.trim();
      }
    }
  } catch {
    // fallback below
  }
  return process.env.FIREBASE_PROJECT_ID?.trim() || 'juicy-gantry-v7cvm';
}

const VIP_UNLIMITED_EMAILS = new Set([
  'teribottle@gmail.com',
  'kanarykeenu@gmail.com',
  'themidnightsignal67@gmail.com',
]);

export const GUEST_DAILY_LIMIT = 1;
export const SIGNED_IN_DAILY_LIMIT = 2;

const COOKIE_NAME = 'parmanu_did';
const DATA_DIR = process.env.PARMANU_DATA_DIR?.trim()
  ? path.resolve(process.env.PARMANU_DATA_DIR.trim())
  : process.cwd();
const LEDGER_PATH = path.resolve(DATA_DIR, '.parmanu-credit-ledger.json');
const SECRET_PATH = path.resolve(DATA_DIR, '.parmanu-credit-secret');

export type CreditTier = 'guest' | 'standard' | 'vip_unlimited';

export interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

export interface CreditStatusPayload {
  dateKey: string;
  resetsAt: string;
  tier: CreditTier;
  authenticated: boolean;
  email: string | null;
  unlimited: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
  deviceId: string;
  blockedReason?: string;
}

interface DailyBucket {
  guestByIp: Record<string, number>;
  guestByFp: Record<string, number>;
  guestByCookie: Record<string, number>;
  guestByClientId: Record<string, number>;
  userByUid: Record<string, number>;
  userDeviceLinks: Record<string, string[]>;
}

interface PersistedLedger {
  dateKey: string;
  bucket: DailyBucket;
}

let cachedCerts: { fetchedAt: number; expiresAt: number; certs: Record<string, string> } | null = null;
let cachedHmacSecret: string | null = null;
let ledgerState: PersistedLedger | null = null;

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getNextResetIso(): string {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0)
  );
  return next.toISOString();
}

function emptyBucket(): DailyBucket {
  return {
    guestByIp: {},
    guestByFp: {},
    guestByCookie: {},
    guestByClientId: {},
    userByUid: {},
    userDeviceLinks: {},
  };
}

function getHmacSecret(): string {
  if (cachedHmacSecret) return cachedHmacSecret;
  const envSecret = process.env.PARMANU_COOKIE_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) {
    cachedHmacSecret = envSecret;
    return cachedHmacSecret;
  }
  try {
    if (fs.existsSync(SECRET_PATH)) {
      const existing = fs.readFileSync(SECRET_PATH, 'utf8').trim();
      if (existing.length >= 32) {
        cachedHmacSecret = existing;
        return cachedHmacSecret;
      }
    }
  } catch {
    // fallback to generate below
  }
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_PATH, generated, { mode: 0o600 });
  } catch {
    // ignore read-only fs edge case
  }
  cachedHmacSecret = generated;
  return cachedHmacSecret;
}

function loadLedger(): PersistedLedger {
  const today = getTodayKey();
  if (ledgerState && ledgerState.dateKey === today) {
    return ledgerState;
  }

  try {
    if (fs.existsSync(LEDGER_PATH)) {
      const raw = fs.readFileSync(LEDGER_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedLedger>;
      if (parsed && parsed.dateKey === today && parsed.bucket) {
        ledgerState = {
          dateKey: today,
          bucket: {
            guestByIp: parsed.bucket.guestByIp || {},
            guestByFp: parsed.bucket.guestByFp || {},
            guestByCookie: parsed.bucket.guestByCookie || {},
            guestByClientId: parsed.bucket.guestByClientId || {},
            userByUid: parsed.bucket.userByUid || {},
            userDeviceLinks: parsed.bucket.userDeviceLinks || {},
          },
        };
        return ledgerState;
      }
    }
  } catch {
    // Reset clean bucket on corrupt/stale file
  }

  ledgerState = { dateKey: today, bucket: emptyBucket() };
  persistLedger(ledgerState);
  return ledgerState;
}

function persistLedger(state: PersistedLedger): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmpPath = `${LEDGER_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state), 'utf8');
    fs.renameSync(tmpPath, LEDGER_PATH);
  } catch {
    // ignore disk errors
  }
}

function signDeviceId(deviceId: string): string {
  const sig = crypto
    .createHmac('sha256', getHmacSecret())
    .update(deviceId)
    .digest('base64url');
  return `${deviceId}.${sig}`;
}

function verifySignedCookieValue(rawCookie: string | undefined): string | null {
  if (!rawCookie || !rawCookie.includes('.')) return null;
  const idx = rawCookie.lastIndexOf('.');
  const deviceId = rawCookie.slice(0, idx);
  const sig = rawCookie.slice(idx + 1);
  if (!/^[a-f0-9]{24,64}$/i.test(deviceId) || !sig) return null;
  const expected = crypto
    .createHmac('sha256', getHmacSecret())
    .update(deviceId)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? deviceId.toLowerCase() : null;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function extractNormalizedIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const cfIp = req.headers['cf-connecting-ip'];
  const realIp = req.headers['x-real-ip'];
  const raw =
    (typeof cfIp === 'string' && cfIp.trim()) ||
    (typeof xff === 'string' && xff.split(',')[0]?.trim()) ||
    (Array.isArray(xff) && xff[0]?.split(',')[0]?.trim()) ||
    (typeof realIp === 'string' && realIp.trim()) ||
    req.ip ||
    req.socket?.remoteAddress ||
    'unknown';
  return raw.replace(/^::ffff:/i, '').trim().toLowerCase() || 'unknown';
}

function sanitizeHexToken(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim().toLowerCase();
  return /^[a-f0-9]{16,128}$/.test(trimmed) ? trimmed : null;
}

function resolveAndSyncDeviceCookie(
  req: Request,
  res?: Response
): { cookieId: string; fpHash: string | null; clientId: string | null; ip: string } {
  const cookies = parseCookies(req.headers.cookie);
  const verifiedCookieId = verifySignedCookieValue(cookies[COOKIE_NAME]);
  const fpHash = sanitizeHexToken(req.headers['x-parmanu-fp']);
  const clientId = sanitizeHexToken(req.headers['x-parmanu-client-id']);
  const ip = extractNormalizedIp(req);

  const resolvedCookieId =
    verifiedCookieId ||
    clientId ||
    crypto.randomBytes(16).toString('hex');

  if (res && verifiedCookieId !== resolvedCookieId) {
    const signedVal = signDeviceId(resolvedCookieId);
    const isHttps =
      req.secure ||
      String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    res.cookie(COOKIE_NAME, signedVal, {
      httpOnly: true,
      sameSite: 'lax',
      secure: Boolean(isHttps),
      maxAge: 365 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }

  return { cookieId: resolvedCookieId, fpHash, clientId, ip };
}

async function fetchGooglePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedCerts && now < cachedCerts.expiresAt) {
    return cachedCerts.certs;
  }

  const res = await fetch(GOOGLE_CERTS_URL, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    if (cachedCerts) return cachedCerts.certs;
    throw new Error(`Failed to fetch Firebase auth certificates (HTTP ${res.status})`);
  }

  const certs = (await res.json()) as Record<string, string>;
  const cc = res.headers.get('cache-control') || '';
  const maxAgeMatch = cc.match(/max-age=(\d+)/i);
  const ttlSec = maxAgeMatch ? Math.max(60, Number(maxAgeMatch[1])) : 3600;
  cachedCerts = {
    fetchedAt: now,
    expiresAt: now + ttlSec * 1000,
    certs,
  };
  return certs;
}

function base64UrlToBuffer(segment: string): Buffer {
  const norm = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (norm.length % 4)) % 4;
  return Buffer.from(norm + '='.repeat(padLen), 'base64');
}

export async function verifyFirebaseIdToken(
  idToken: string | undefined
): Promise<VerifiedFirebaseUser | null> {
  if (!idToken) return null;
  const parts = idToken.trim().split('.');
  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(base64UrlToBuffer(parts[0]).toString('utf8')) as {
      alg?: string;
      kid?: string;
    };
    const payload = JSON.parse(base64UrlToBuffer(parts[1]).toString('utf8')) as {
      aud?: string;
      iss?: string;
      sub?: string;
      exp?: number;
      iat?: number;
      auth_time?: number;
      email?: string;
      email_verified?: boolean;
    };

    const projectId = resolveFirebaseProjectId();
    if (header.alg !== 'RS256' || !header.kid) return null;
    if (payload.aud !== projectId) return null;
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (!payload.sub || typeof payload.sub !== 'string') return null;

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= nowSec - 30) return null;
    if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) return null;

    const certs = await fetchGooglePublicCerts();
    const certPem = certs[header.kid];
    if (!certPem) return null;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();
    const sigOk = verifier.verify(certPem, base64UrlToBuffer(parts[2]));
    if (!sigOk) return null;

    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const emailVerified = payload.email_verified === true;
    return {
      uid: payload.sub,
      email,
      emailVerified,
    };
  } catch {
    return null;
  }
}

export async function getRequestUser(req: Request): Promise<VerifiedFirebaseUser | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  return verifyFirebaseIdToken(token);
}

export function isVipUnlimitedEmail(email?: string | null, emailVerified = true): boolean {
  if (!email || !emailVerified) return false;
  return VIP_UNLIMITED_EMAILS.has(email.trim().toLowerCase());
}

function getGuestUsageCount(
  bucket: DailyBucket,
  signals: { ip: string; fpHash: string | null; cookieId: string; clientId: string | null }
): number {
  const ipUsed = bucket.guestByIp[signals.ip] || 0;
  const cookieUsed = bucket.guestByCookie[signals.cookieId] || 0;
  const fpUsed = signals.fpHash ? bucket.guestByFp[signals.fpHash] || 0 : 0;
  const cidUsed = signals.clientId ? bucket.guestByClientId[signals.clientId] || 0 : 0;
  return Math.max(ipUsed, cookieUsed, fpUsed, cidUsed);
}

export async function getCreditStatusForRequest(
  req: Request,
  res?: Response
): Promise<CreditStatusPayload> {
  const ledger = loadLedger();
  const signals = resolveAndSyncDeviceCookie(req, res);
  const verifiedUser = await getRequestUser(req);
  const resetsAt = getNextResetIso();

  if (verifiedUser) {
    const vip = isVipUnlimitedEmail(verifiedUser.email, verifiedUser.emailVerified);
    if (vip) {
      return {
        dateKey: ledger.dateKey,
        resetsAt,
        tier: 'vip_unlimited',
        authenticated: true,
        email: verifiedUser.email,
        unlimited: true,
        limit: null,
        used: ledger.bucket.userByUid[verifiedUser.uid] || 0,
        remaining: null,
        deviceId: signals.cookieId,
      };
    }

    const used = ledger.bucket.userByUid[verifiedUser.uid] || 0;
    const remaining = Math.max(0, SIGNED_IN_DAILY_LIMIT - used);
    return {
      dateKey: ledger.dateKey,
      resetsAt,
      tier: 'standard',
      authenticated: true,
      email: verifiedUser.email || null,
      unlimited: false,
      limit: SIGNED_IN_DAILY_LIMIT,
      used,
      remaining,
      deviceId: signals.cookieId,
      ...(remaining === 0
        ? {
            blockedReason: `Daily signed-in credit limit reached (${SIGNED_IN_DAILY_LIMIT}/${SIGNED_IN_DAILY_LIMIT} searches used today). Resets at midnight UTC.`,
          }
        : {}),
    };
  }

  const guestUsed = getGuestUsageCount(ledger.bucket, signals);
  const remaining = Math.max(0, GUEST_DAILY_LIMIT - guestUsed);

  return {
    dateKey: ledger.dateKey,
    resetsAt,
    tier: 'guest',
    authenticated: false,
    email: null,
    unlimited: false,
    limit: GUEST_DAILY_LIMIT,
    used: Math.min(GUEST_DAILY_LIMIT, guestUsed),
    remaining,
    deviceId: signals.cookieId,
    ...(remaining === 0
      ? {
          blockedReason:
            'Daily guest search limit reached (1/1 used today on this device/network). Sign in with Google for 2 searches per day, or wait for the daily reset.',
        }
      : {}),
  };
}

export async function enforceAndConsumeSearchCredit(
  req: Request,
  res: Response
): Promise<
  | { allowed: true; status: CreditStatusPayload; rollback: () => void }
  | { allowed: false; httpStatus: number; error: string; status: CreditStatusPayload }
> {
  const ledger = loadLedger();
  const signals = resolveAndSyncDeviceCookie(req, res);
  const verifiedUser = await getRequestUser(req);
  const resetsAt = getNextResetIso();

  // Require valid browser fingerprint hash from non-VIP guests to prevent raw script loops
  if (!verifiedUser && !signals.fpHash) {
    const status = await getCreditStatusForRequest(req, res);
    return {
      allowed: false,
      httpStatus: 403,
      error:
        'Browser verification fingerprint missing. Refresh the app or sign in with Google to run an OSINT search.',
      status,
    };
  }

  if (verifiedUser) {
    if (isVipUnlimitedEmail(verifiedUser.email, verifiedUser.emailVerified)) {
      ledger.bucket.userByUid[verifiedUser.uid] =
        (ledger.bucket.userByUid[verifiedUser.uid] || 0) + 1;
      persistLedger(ledger);
      return {
        allowed: true,
        status: {
          dateKey: ledger.dateKey,
          resetsAt,
          tier: 'vip_unlimited',
          authenticated: true,
          email: verifiedUser.email,
          unlimited: true,
          limit: null,
          used: ledger.bucket.userByUid[verifiedUser.uid],
          remaining: null,
          deviceId: signals.cookieId,
        },
        rollback: () => {},
      };
    }

    const usedBefore = ledger.bucket.userByUid[verifiedUser.uid] || 0;
    if (usedBefore >= SIGNED_IN_DAILY_LIMIT) {
      const status: CreditStatusPayload = {
        dateKey: ledger.dateKey,
        resetsAt,
        tier: 'standard',
        authenticated: true,
        email: verifiedUser.email || null,
        unlimited: false,
        limit: SIGNED_IN_DAILY_LIMIT,
        used: usedBefore,
        remaining: 0,
        deviceId: signals.cookieId,
        blockedReason: `Daily credit limit reached (${usedBefore}/${SIGNED_IN_DAILY_LIMIT} searches used today). Credits reset daily at 00:00 UTC.`,
      };
      return {
        allowed: false,
        httpStatus: 429,
        error: status.blockedReason!,
        status,
      };
    }

    // Consume 1 signed-in credit AND record device fingerprint/IP on guest ledger too
    // so signing out cannot yield an extra bonus guest search on the same day.
    ledger.bucket.userByUid[verifiedUser.uid] = usedBefore + 1;
    if (signals.fpHash) {
      ledger.bucket.guestByFp[signals.fpHash] = Math.max(
        ledger.bucket.guestByFp[signals.fpHash] || 0,
        GUEST_DAILY_LIMIT
      );
    }
    ledger.bucket.guestByCookie[signals.cookieId] = Math.max(
      ledger.bucket.guestByCookie[signals.cookieId] || 0,
      GUEST_DAILY_LIMIT
    );
    if (signals.clientId) {
      ledger.bucket.guestByClientId[signals.clientId] = Math.max(
        ledger.bucket.guestByClientId[signals.clientId] || 0,
        GUEST_DAILY_LIMIT
      );
    }
    persistLedger(ledger);

    const newUsed = usedBefore + 1;
    return {
      allowed: true,
      status: {
        dateKey: ledger.dateKey,
        resetsAt,
        tier: 'standard',
        authenticated: true,
        email: verifiedUser.email || null,
        unlimited: false,
        limit: SIGNED_IN_DAILY_LIMIT,
        used: newUsed,
        remaining: Math.max(0, SIGNED_IN_DAILY_LIMIT - newUsed),
        deviceId: signals.cookieId,
      },
      rollback: () => {
        const cur = loadLedger();
        cur.bucket.userByUid[verifiedUser.uid] = Math.max(
          0,
          (cur.bucket.userByUid[verifiedUser.uid] || 1) - 1
        );
        persistLedger(cur);
      },
    };
  }

  // Strictly enforce guest limit (1/day) across IP + Fingerprint + Cookie + ClientId
  const guestUsed = getGuestUsageCount(ledger.bucket, signals);
  if (guestUsed >= GUEST_DAILY_LIMIT) {
    // Also lock all 4 currently observed identifiers to block partial-wipe retries
    ledger.bucket.guestByIp[signals.ip] = Math.max(
      ledger.bucket.guestByIp[signals.ip] || 0,
      guestUsed
    );
    ledger.bucket.guestByCookie[signals.cookieId] = Math.max(
      ledger.bucket.guestByCookie[signals.cookieId] || 0,
      guestUsed
    );
    if (signals.fpHash) {
      ledger.bucket.guestByFp[signals.fpHash] = Math.max(
        ledger.bucket.guestByFp[signals.fpHash] || 0,
        guestUsed
      );
    }
    if (signals.clientId) {
      ledger.bucket.guestByClientId[signals.clientId] = Math.max(
        ledger.bucket.guestByClientId[signals.clientId] || 0,
        guestUsed
      );
    }
    persistLedger(ledger);

    const status: CreditStatusPayload = {
      dateKey: ledger.dateKey,
      resetsAt,
      tier: 'guest',
      authenticated: false,
      email: null,
      unlimited: false,
      limit: GUEST_DAILY_LIMIT,
      used: GUEST_DAILY_LIMIT,
      remaining: 0,
      deviceId: signals.cookieId,
      blockedReason:
        'Daily guest credit exhausted (1/1 search used today on this browser/IP). Sign in with Google to get 2 daily searches, or come back tomorrow.',
    };
    return {
      allowed: false,
      httpStatus: 429,
      error: status.blockedReason!,
      status,
    };
  }

  // Consume all 4 anti-bypass guest signals atomically
  ledger.bucket.guestByIp[signals.ip] = (ledger.bucket.guestByIp[signals.ip] || 0) + 1;
  ledger.bucket.guestByCookie[signals.cookieId] =
    (ledger.bucket.guestByCookie[signals.cookieId] || 0) + 1;
  if (signals.fpHash) {
    ledger.bucket.guestByFp[signals.fpHash] =
      (ledger.bucket.guestByFp[signals.fpHash] || 0) + 1;
  }
  if (signals.clientId) {
    ledger.bucket.guestByClientId[signals.clientId] =
      (ledger.bucket.guestByClientId[signals.clientId] || 0) + 1;
  }
  persistLedger(ledger);

  return {
    allowed: true,
    status: {
      dateKey: ledger.dateKey,
      resetsAt,
      tier: 'guest',
      authenticated: false,
      email: null,
      unlimited: false,
      limit: GUEST_DAILY_LIMIT,
      used: 1,
      remaining: 0,
      deviceId: signals.cookieId,
    },
    rollback: () => {
      const cur = loadLedger();
      cur.bucket.guestByIp[signals.ip] = Math.max(
        0,
        (cur.bucket.guestByIp[signals.ip] || 1) - 1
      );
      cur.bucket.guestByCookie[signals.cookieId] = Math.max(
        0,
        (cur.bucket.guestByCookie[signals.cookieId] || 1) - 1
      );
      if (signals.fpHash) {
        cur.bucket.guestByFp[signals.fpHash] = Math.max(
          0,
          (cur.bucket.guestByFp[signals.fpHash] || 1) - 1
        );
      }
      if (signals.clientId) {
        cur.bucket.guestByClientId[signals.clientId] = Math.max(
          0,
          (cur.bucket.guestByClientId[signals.clientId] || 1) - 1
        );
      }
      persistLedger(cur);
    },
  };
}
