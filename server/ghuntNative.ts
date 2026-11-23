import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import type {
  GeoMarker,
  GhuntIntelligenceData,
  GhuntLocationRing,
  GhuntReviewItem,
  InvestigationResultItem,
} from '../src/types/investigation.ts';
import { runGeminiGoogleSearchDork } from './geminiRotator.ts';

const GHUNT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

interface ParsedGhuntCreds {
  oauthAccessToken?: string;
  oauthAuthCode?: string;
  oauthRefreshToken?: string;
  androidMasterToken?: string;
  cookies?: Record<string, string>;
  clientId?: string;
  clientSecret?: string;
  authMode: GhuntIntelligenceData['authMode'];
  tokenConfigured: boolean;
}

interface ResolvedGooglePerson {
  gaiaId?: string;
  displayName?: string;
  avatarUrl?: string;
  coverPhotoUrl?: string;
  lastUpdated?: string;
  inAppReachability: string[];
  note?: string;
  degradedToPublic?: boolean;
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function inferAreaLabelFromReviews(
  reviews: Array<GhuntReviewItem & { lat: number; lng: number }>,
  centerLat: number,
  centerLng: number
): string {
  // Prefer most frequent city/region token from review addresses near the centroid
  const nearby = [...reviews].sort(
    (a, b) =>
      haversineKm(centerLat, centerLng, a.lat, a.lng) -
      haversineKm(centerLat, centerLng, b.lat, b.lng)
  );
  for (const rev of nearby.slice(0, 5)) {
    if (rev.address) {
      const parts = rev.address
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 1 && !/^\d+$/.test(p));
      if (parts.length >= 2) {
        return parts.slice(-2).join(', ');
      }
      if (parts.length === 1) return parts[0];
    }
  }
  return `${centerLat.toFixed(3)}, ${centerLng.toFixed(3)}`;
}

export function computeLocationRing(reviews: GhuntReviewItem[]): GhuntLocationRing | undefined {
  const geoReviews = reviews.filter(
    (r): r is GhuntReviewItem & { lat: number; lng: number } =>
      typeof r.lat === 'number' &&
      typeof r.lng === 'number' &&
      Number.isFinite(r.lat) &&
      Number.isFinite(r.lng) &&
      Math.abs(r.lat) <= 90 &&
      Math.abs(r.lng) <= 180 &&
      !(r.lat === 0 && r.lng === 0)
  );

  if (geoReviews.length === 0) return undefined;

  if (geoReviews.length === 1) {
    const only = geoReviews[0];
    return {
      centerLat: Number(only.lat.toFixed(5)),
      centerLng: Number(only.lng.toFixed(5)),
      radiusMeters: 2500,
      radiusKm: 2.5,
      confidence: 'Low',
      sampleCount: 1,
      totalGeoReviews: 1,
      outliersTrimmed: 0,
      estimatedAreaLabel: inferAreaLabelFromReviews(geoReviews, only.lat, only.lng),
      spreadKm: 2.5,
    };
  }

  // Initial robust median center
  const medLat = median(geoReviews.map((r) => r.lat));
  const medLng = median(geoReviews.map((r) => r.lng));

  const withMedianDist = geoReviews.map((r) => ({
    review: r,
    distKm: haversineKm(medLat, medLng, r.lat, r.lng),
  }));

  const medianDistKm = median(withMedianDist.map((x) => x.distKm));

  // Outlier trimming: when >= 4 points exist, trim distant vacation/travel points (> max(120 km, 3.2x median spread))
  let cluster = withMedianDist;
  let outliersTrimmed = 0;
  if (withMedianDist.length >= 4) {
    const outlierThresholdKm = Math.max(120, medianDistKm * 3.2);
    const inner = withMedianDist.filter((x) => x.distKm <= outlierThresholdKm);
    if (inner.length >= 2) {
      outliersTrimmed = withMedianDist.length - inner.length;
      cluster = inner;
    }
  }

  // Compute centroid of core cluster
  const centerLat =
    cluster.reduce((sum, x) => sum + x.review.lat, 0) / cluster.length;
  const centerLng =
    cluster.reduce((sum, x) => sum + x.review.lng, 0) / cluster.length;

  const clusterDistsKm = cluster
    .map((x) => haversineKm(centerLat, centerLng, x.review.lat, x.review.lng))
    .sort((a, b) => a - b);

  // Use 85th percentile distance of core cluster (or max if <= 4 points) as ring radius, clamped [1.2 km .. 250 km]
  const p85Idx = Math.min(
    clusterDistsKm.length - 1,
    Math.max(0, Math.ceil(clusterDistsKm.length * 0.85) - 1)
  );
  const rawSpreadKm = clusterDistsKm[p85Idx] || 1.2;
  const clampedRadiusKm = Math.min(250, Math.max(1.2, Number((rawSpreadKm * 1.15).toFixed(2))));
  const radiusMeters = Math.round(clampedRadiusKm * 1000);

  const confidence: GhuntLocationRing['confidence'] =
    cluster.length >= 4 && clampedRadiusKm <= 35
      ? 'High'
      : cluster.length >= 2 && clampedRadiusKm <= 120
      ? 'Moderate'
      : 'Low';

  return {
    centerLat: Number(centerLat.toFixed(5)),
    centerLng: Number(centerLng.toFixed(5)),
    radiusMeters,
    radiusKm: clampedRadiusKm,
    confidence,
    sampleCount: cluster.length,
    totalGeoReviews: geoReviews.length,
    outliersTrimmed,
    estimatedAreaLabel: inferAreaLabelFromReviews(
      cluster.map((c) => c.review),
      centerLat,
      centerLng
    ),
    spreadKm: Number(rawSpreadKm.toFixed(2)),
  };
}

function parseRawCookiesInput(raw: string): Record<string, string> | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const cleanCookies: Record<string, string> = {};
  const SKIP_COOKIE_KEYS = new Set([
    'domain',
    'path',
    'expires',
    'max-age',
    'samesite',
    'secure',
    'httponly',
    'priority',
    'partitioned',
  ]);

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const obj = asObj(item);
          const k = asStr(obj?.name);
          const v = asStr(obj?.value);
          if (k && v) cleanCookies[k] = v;
        }
      } else {
        const obj = asObj(parsed);
        if (obj) {
          for (const [k, v] of Object.entries(obj)) {
            if (typeof v === 'string' && v.trim()) cleanCookies[k.trim()] = v.trim();
          }
        }
      }
      if (Object.keys(cleanCookies).length > 0) return cleanCookies;
    } catch {
      // fall through to line / header parser
    }
  }

  // Handle pasted Chrome/Edge DevTools cookie tables (tab or space-separated)
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const looksTabSeparated = lines.some((l) => l.includes('\t'));
  const looksSpaceTable =
    !looksTabSeparated &&
    /(?:^|\s)\.?[a-z0-9-]*google\.com\s+\//i.test(trimmed);

  if (looksTabSeparated || looksSpaceTable) {
    // Prefer .google.com entries over subdomain entries when same cookie name appears twice
    const rankMap = new Map<string, number>();
    if (looksTabSeparated) {
      for (const line of lines) {
        const cols = line.split('\t').map((c) => c.trim());
        if (cols.length >= 2 && cols[0] && cols[1] && !SKIP_COOKIE_KEYS.has(cols[0].toLowerCase())) {
          const name = cols[0];
          const value = cols[1];
          const domain = (cols[2] || '').toLowerCase();
          const rank = domain === '.google.com' ? 3 : domain.endsWith('.google.com') ? 2 : 1;
          const prevRank = rankMap.get(name) ?? 0;
          if (rank >= prevRank) {
            cleanCookies[name] = value;
            rankMap.set(name, rank);
          }
        }
      }
    } else {
      // Handle flat space-separated DevTools copy: NAME VALUE .google.com / 2027-...
      const entryRegex =
        /([A-Za-z0-9_.-]+)\s+(\S+)\s+(\.?(?:[a-z0-9-]+\.)*google\.com)\s+\/\s+\S+/gi;
      let m: RegExpExecArray | null;
      while ((m = entryRegex.exec(trimmed)) !== null) {
        const name = m[1].trim();
        const value = m[2].trim();
        const domain = m[3].toLowerCase();
        if (name && value && !SKIP_COOKIE_KEYS.has(name.toLowerCase())) {
          const rank = domain === '.google.com' ? 3 : domain.endsWith('.google.com') ? 2 : 1;
          const prevRank = rankMap.get(name) ?? 0;
          if (rank >= prevRank) {
            cleanCookies[name] = value;
            rankMap.set(name, rank);
          }
        }
      }
    }
    if (Object.keys(cleanCookies).length > 0) return cleanCookies;
  }

  for (const segment of trimmed.replace(/\r?\n/g, ';').split(';')) {
    const eqIdx = segment.indexOf('=');
    if (eqIdx <= 0) continue;
    const k = segment.slice(0, eqIdx).trim();
    const v = segment.slice(eqIdx + 1).trim();
    if (k && v && !SKIP_COOKIE_KEYS.has(k.toLowerCase())) {
      cleanCookies[k] = v;
    }
  }

  return Object.keys(cleanCookies).length > 0 ? cleanCookies : undefined;
}

function hasValidSapisidCookies(cookies?: Record<string, string>): boolean {
  return Boolean(
    cookies && (cookies.SAPISID || cookies['__Secure-3PAPISID'] || cookies['__Secure-1PAPISID'])
  );
}

export function loadGhuntCredentialsFromEnv(overrideToken?: string): ParsedGhuntCreds {
  const tokenEnv = (overrideToken || process.env.GHUNT_OAUTH_TOKEN || '').trim();
  const masterEnv = (process.env.GHUNT_MASTER_TOKEN || '').trim();
  const clientId = (process.env.GHUNT_OAUTH_CLIENT_ID || '').trim() || undefined;
  const clientSecret = (process.env.GHUNT_OAUTH_CLIENT_SECRET || '').trim() || undefined;
  const credsB64 = (process.env.GHUNT_CREDS_B64 || '').trim();
  const credsJsonRaw = (process.env.GHUNT_CREDS_JSON || '').trim();
  const cookiesEnvRaw = (process.env.GHUNT_COOKIES || '').trim();

  let jsonObj: Record<string, unknown> | null = null;
  if (credsJsonRaw) {
    try {
      jsonObj = asObj(JSON.parse(credsJsonRaw));
    } catch {
      jsonObj = null;
    }
  } else if (credsB64) {
    try {
      const decoded = Buffer.from(credsB64, 'base64').toString('utf8');
      jsonObj = asObj(JSON.parse(decoded));
    } catch {
      jsonObj = null;
    }
  } else if (tokenEnv.startsWith('{')) {
    try {
      jsonObj = asObj(JSON.parse(tokenEnv));
    } catch {
      jsonObj = null;
    }
  }

  let oauthAccessToken: string | undefined;
  let oauthAuthCode: string | undefined;
  let oauthRefreshToken: string | undefined;
  let androidMasterToken: string | undefined;
  let cookies: Record<string, string> | undefined;

  const classifyToken = (rawToken: string) => {
    const clean = rawToken.replace(/^Bearer\s+/i, '').trim();
    if (!clean) return;
    if (clean.startsWith('aas_et/')) {
      androidMasterToken = clean;
    } else if (clean.startsWith('1//')) {
      oauthRefreshToken = clean;
    } else if (clean.startsWith('oauth2_4/') || clean.startsWith('4/')) {
      oauthAuthCode = clean.replace(/^oauth2_/, '');
    } else {
      oauthAccessToken = clean;
    }
  };

  if (jsonObj) {
    const android = asObj(jsonObj.android);
    const rawMaster =
      asStr(android?.master_token) ||
      asStr(jsonObj.master_token) ||
      asStr(jsonObj.aas_et);
    if (rawMaster) androidMasterToken = rawMaster;

    const rawAccess =
      asStr(jsonObj.access_token) ||
      asStr(jsonObj.oauth_token) ||
      asStr(jsonObj.token);
    if (rawAccess) classifyToken(rawAccess);

    const rawRefresh = asStr(jsonObj.refresh_token);
    if (rawRefresh) oauthRefreshToken = rawRefresh;

    const rawCookies = asObj(jsonObj.cookies);
    if (rawCookies) {
      const cleanCookies: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawCookies)) {
        if (typeof v === 'string' && v.trim()) {
          cleanCookies[k.trim()] = v.trim();
        }
      }
      if (Object.keys(cleanCookies).length > 0) cookies = cleanCookies;
    }
  }

  if (cookiesEnvRaw && !cookies) {
    cookies = parseRawCookiesInput(cookiesEnvRaw);
  }

  if (tokenEnv && !tokenEnv.startsWith('{')) {
    classifyToken(tokenEnv);
  }

  if (masterEnv) {
    androidMasterToken = masterEnv;
  }

  const validCookies = hasValidSapisidCookies(cookies);
  const canExchangeClientOAuth = Boolean(clientId && clientSecret);

  // Prefer immediately usable credentials; avoid letting an unexchangeable 4/... code block working browser cookies
  let authMode: GhuntIntelligenceData['authMode'] = 'public_metadata';
  if (oauthAccessToken) authMode = 'oauth_access';
  else if (androidMasterToken) authMode = 'android_master';
  else if (oauthRefreshToken && canExchangeClientOAuth) authMode = 'oauth_refresh';
  else if (oauthAuthCode && canExchangeClientOAuth) authMode = 'oauth_auth_code';
  else if (validCookies) authMode = 'cookie_session';
  else if (oauthRefreshToken) authMode = 'oauth_refresh';
  else if (oauthAuthCode) authMode = 'oauth_auth_code';

  return {
    oauthAccessToken,
    oauthAuthCode,
    oauthRefreshToken,
    androidMasterToken,
    cookies,
    clientId,
    clientSecret,
    authMode,
    tokenConfigured: authMode !== 'public_metadata',
  };
}

async function fetchJsonPost(
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs = 5500
): Promise<{ ok: boolean; status: number; text: string; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    let json: unknown = null;
    try {
      json = JSON.parse(text.replace(/^\)\]\}'\s*/, ''));
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, text, json };
  } catch {
    return { ok: false, status: 0, text: '', json: null };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonGet(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 5500
): Promise<{ ok: boolean; status: number; text: string; json: unknown; finalUrl?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': GHUNT_UA, ...headers },
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    let json: unknown = null;
    try {
      json = JSON.parse(text.replace(/^\)\]\}'\s*/, ''));
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, text, json, finalUrl: res.url };
  } catch {
    return { ok: false, status: 0, text: '', json: null };
  } finally {
    clearTimeout(timer);
  }
}

const ghuntTokenCache = new Map<string, { accessToken: string; expiresAt: number }>();
const ghuntExchangedRefreshCache = new Map<string, string>();
const ghuntFailedAuthCodes = new Set<string>();

async function exchangeCredentialsForAccessToken(
  creds: ParsedGhuntCreds
): Promise<{ accessToken?: string; exchangeNote?: string; degradedToPublic?: boolean }> {
  if (creds.oauthAccessToken) {
    return { accessToken: creds.oauthAccessToken };
  }

  const cachedRefresh =
    creds.oauthAuthCode ? ghuntExchangedRefreshCache.get(creds.oauthAuthCode) : undefined;
  const effectiveRefreshToken = creds.oauthRefreshToken || cachedRefresh;

  const cacheKeySeed =
    effectiveRefreshToken ||
    creds.androidMasterToken ||
    (creds.oauthAuthCode && creds.clientId ? `${creds.clientId}:${creds.oauthAuthCode}` : '');
  const cacheKey = cacheKeySeed
    ? crypto.createHash('sha256').update(cacheKeySeed).digest('hex')
    : '';
  if (cacheKey) {
    const cached = ghuntTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { accessToken: cached.accessToken };
    }
  }

  if (effectiveRefreshToken) {
    if (!creds.clientId || !creds.clientSecret) {
      return {
        degradedToPublic: true,
        exchangeNote:
          'GHUNT_OAUTH_TOKEN contains a refresh token (1//*), which requires GHUNT_OAUTH_CLIENT_ID and GHUNT_OAUTH_CLIENT_SECRET to mint access tokens. Running Public Metadata checks instead.',
      };
    }
    const res = await fetchJsonPost(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: effectiveRefreshToken,
        grant_type: 'refresh_token',
      }).toString(),
      {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': GHUNT_UA,
      },
      6000
    );
    const errObj = asObj(res.json);
    const token = asStr(errObj?.access_token);
    if (token) {
      if (cacheKey) {
        ghuntTokenCache.set(cacheKey, { accessToken: token, expiresAt: Date.now() + 45 * 60_000 });
      }
      return { accessToken: token };
    }
    const gErr = asStr(errObj?.error_description) || asStr(errObj?.error) || `HTTP ${res.status || 'timeout'}`;
    return {
      degradedToPublic: true,
      exchangeNote: `Google OAuth refresh token exchange rejected (${gErr}). Verify client credentials and refresh token validity; running Public Metadata checks.`,
    };
  }

  if (creds.androidMasterToken) {
    // GHunt-compatible Android Master Token -> OAuth2 access token exchange via Google GMS auth endpoint
    const params = new URLSearchParams({
      Token: creds.androidMasterToken,
      service:
        'oauth2:https://www.googleapis.com/auth/peopleapi.readonly https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/plus.me',
      app: 'com.google.android.gm',
      client_sig: '38918a453d07199354f8b19af05ec6562ced5788',
      device_country: 'us',
      operatorCountry: 'us',
      lang: 'en',
      sdk_version: '31',
    });
    const res = await fetchJsonPost(
      'https://android.clients.google.com/auth',
      params.toString(),
      {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'GoogleAuth/1.4 (Pixel 6 SD1A.210817.036)',
      },
      6500
    );
    const lines = res.text.split(/\r?\n/);
    const authLine = lines.find((l) => l.startsWith('Auth='));
    if (authLine) {
      const tok = authLine.slice(5).trim();
      if (tok) {
        if (cacheKey) {
          ghuntTokenCache.set(cacheKey, { accessToken: tok, expiresAt: Date.now() + 45 * 60_000 });
        }
        return { accessToken: tok };
      }
    }
    const gmsErr = lines.find((l) => l.startsWith('Error='))?.slice(6).trim() || `HTTP ${res.status || 'timeout'}`;
    return {
      degradedToPublic: true,
      exchangeNote: `Android GMS master token exchange returned "${gmsErr}" (Google often requires a fresh device OAuth token or SAPISID cookies). Running Public Metadata checks.`,
    };
  }

  if (creds.oauthAuthCode) {
    if (!creds.clientId || !creds.clientSecret) {
      return {
        degradedToPublic: true,
        exchangeNote:
          'GHUNT_OAUTH_TOKEN contains a single-use Google OAuth2 authorization code (4/...). Configure GHUNT_OAUTH_CLIENT_ID & GHUNT_OAUTH_CLIENT_SECRET to exchange it, or supply a ya29.* access token, 1//* refresh token, or aas_et/* master token. Running Public Metadata checks.',
      };
    }

    if (ghuntFailedAuthCodes.has(creds.oauthAuthCode)) {
      return {
        degradedToPublic: true,
        exchangeNote:
          'Supplied single-use OAuth2 authorization code (4/...) already expired or was consumed. Generate a fresh 1//* refresh token or aas_et/* master token. Running Public Metadata checks.',
      };
    }

    const res = await fetchJsonPost(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        code: creds.oauthAuthCode,
        redirect_uri: process.env.GHUNT_OAUTH_REDIRECT_URI?.trim() || 'urn:ietf:wg:oauth:2.0:oob',
        grant_type: 'authorization_code',
      }).toString(),
      {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': GHUNT_UA,
      },
      6000
    );
    const tokenObj = asObj(res.json);
    const token = asStr(tokenObj?.access_token);
    const newRefresh = asStr(tokenObj?.refresh_token);
    if (newRefresh) {
      ghuntExchangedRefreshCache.set(creds.oauthAuthCode, newRefresh);
    }
    if (token) {
      if (cacheKey) {
        ghuntTokenCache.set(cacheKey, { accessToken: token, expiresAt: Date.now() + 45 * 60_000 });
      }
      return { accessToken: token };
    }
    ghuntFailedAuthCodes.add(creds.oauthAuthCode);
    const codeErr =
      asStr(tokenObj?.error_description) ||
      asStr(tokenObj?.error) ||
      `HTTP ${res.status || 'timeout'}`;
    return {
      degradedToPublic: true,
      exchangeNote: `Google OAuth2 authorization code exchange failed (${codeErr}). Auth codes (4/...) are single-use — supply a 1//* refresh token, ya29.* access token, or aas_et/* master token. Running Public Metadata checks.`,
    };
  }

  return {};
}

const keepApiKeyCache = new Map<string, { apiKeys: string[]; expiresAt: number }>();

function buildSapisidAuthHeader(
  cookies: Record<string, string>,
  origin = 'https://keep.google.com'
): string | undefined {
  const ts = Math.floor(Date.now() / 1000);
  const hashFor = (secret?: string) =>
    secret ? crypto.createHash('sha1').update(`${ts} ${secret} ${origin}`).digest('hex') : undefined;

  const sapisid = cookies.SAPISID || cookies['__Secure-3PAPISID'] || cookies['__Secure-1PAPISID'];
  const sapisid1p = cookies['__Secure-1PAPISID'] || sapisid;
  const sapisid3p = cookies['__Secure-3PAPISID'] || sapisid;

  const h0 = hashFor(sapisid);
  const h1 = hashFor(sapisid1p);
  const h3 = hashFor(sapisid3p);
  if (!h0) return undefined;

  const parts = [`SAPISIDHASH ${ts}_${h0}`];
  if (h1) parts.push(`SAPISID1PHASH ${ts}_${h1}`);
  if (h3) parts.push(`SAPISID3PHASH ${ts}_${h3}`);
  return parts.join(' ');
}

function buildCookieHeaderString(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function getDynamicKeepApiKeys(cookies: Record<string, string>): Promise<{
  apiKeys: string[];
  sessionValid: boolean;
}> {
  const cookieHeader = buildCookieHeaderString(cookies);
  const cacheKey = crypto.createHash('sha256').update(cookieHeader).digest('hex');
  const cached = keepApiKeyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() && cached.apiKeys.length > 0) {
    return { apiKeys: cached.apiKeys, sessionValid: true };
  }

  const res = await fetchJsonGet(
    'https://keep.google.com/u/0/',
    {
      Cookie: cookieHeader,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    6500
  );

  const landedOnLogin =
    Boolean(res.finalUrl?.includes('accounts.google.com')) ||
    res.text.includes('accounts.google.com/v3/signin');

  if (!res.ok || landedOnLogin) {
    return { apiKeys: [], sessionValid: false };
  }

  const apiKeys = Array.from(new Set(res.text.match(/AIzaSy[0-9A-Za-z_-]{33}/g) || []));
  if (apiKeys.length > 0) {
    keepApiKeyCache.set(cacheKey, {
      apiKeys,
      expiresAt: Date.now() + 25 * 60_000,
    });
  }
  return { apiKeys, sessionValid: apiKeys.length > 0 };
}

function extractGaiaIdFromPayload(raw: unknown): string | undefined {
  const str = typeof raw === 'string' ? raw : JSON.stringify(raw || '');
  // Standard Google Gaia IDs are 21-digit numbers starting with 10 or 11
  const m = str.match(/"(1[01]\d{19})"/);
  if (m?.[1]) return m[1];
  const peopleM = str.match(/people\/(1[01]\d{19})/);
  if (peopleM?.[1]) return peopleM[1];
  return undefined;
}

function parsePeopleApiResponse(rawJson: unknown): ResolvedGooglePerson | null {
  if (!rawJson || typeof rawJson !== 'object') return null;
  const str = JSON.stringify(rawJson);
  const root = asObj(rawJson);

  let gaiaId: string | undefined;
  let displayName: string | undefined;
  let avatarUrl: string | undefined;
  let coverPhotoUrl: string | undefined;
  let lastUpdated: string | undefined;
  const reachability = new Set<string>();

  const toIsoFromTimestamp = (rawTs?: string): string | undefined => {
    if (!rawTs || !/^\d+$/.test(rawTs)) return undefined;
    const rawNum = Number(rawTs);
    // People-PA uses 16-digit microseconds in sourceIds.lastUpdatedMicros vs 13-digit ms in lastUpdateTimeMicros
    const ms = rawNum > 1e14 ? rawNum / 1000 : rawNum;
    if (Number.isFinite(ms) && ms > 946684800000 && ms < Date.now() + 86400_000) {
      return new Date(ms).toISOString();
    }
    return undefined;
  };

  const inspectPersonNode = (nodeRaw: unknown) => {
    const raw = asObj(nodeRaw);
    if (!raw) return;
    if (!gaiaId) {
      gaiaId = asStr(raw.personId);
    }
    const person = asObj(raw.person) || raw;
    if (!gaiaId) {
      gaiaId = asStr(person.personId);
    }

    const namesArr = [
      ...(Array.isArray(person.name) ? person.name : []),
      ...(Array.isArray(person.names) ? person.names : []),
    ];
    for (const n of namesArr) {
      const no = asObj(n);
      const dn = asStr(no?.displayName) || asStr(no?.unstructuredName);
      if (dn && !displayName && !/^g\d+-[0-9a-f]{12,}$/i.test(dn)) {
        displayName = dn;
      }
    }

    const photosArr = [
      ...(Array.isArray(person.photo) ? person.photo : []),
      ...(Array.isArray(person.photos) ? person.photos : []),
    ];
    const nonMonogram = photosArr.find((ph) => {
      const pho = asObj(ph);
      return Boolean(asStr(pho?.url)) && pho?.isMonogram !== true;
    });
    const fallbackPhoto = photosArr.find((ph) => Boolean(asStr(asObj(ph)?.url)));
    const pickedPhoto = asObj(nonMonogram || fallbackPhoto);
    if (pickedPhoto && !avatarUrl) {
      avatarUrl = asStr(pickedPhoto.url);
      const vis = asStr(asObj(pickedPhoto.metadata)?.visibility);
      if (vis === 'PUBLIC') reachability.add('Google Profile');
    }

    const coversArr = [
      ...(Array.isArray(person.coverPhoto) ? person.coverPhoto : []),
      ...(Array.isArray(person.coverPhotos) ? person.coverPhotos : []),
    ];
    const nonDefaultCover = coversArr.find((cv) => {
      const cvo = asObj(cv);
      return Boolean(asStr(cvo?.imageUrl) || asStr(cvo?.url)) && cvo?.isDefault !== true;
    });
    const firstCover = asObj(nonDefaultCover);
    if (firstCover && !coverPhotoUrl) {
      coverPhotoUrl = asStr(firstCover.imageUrl) || asStr(firstCover.url);
    }

    const roProfileArr = Array.isArray(person.readOnlyProfileInfo)
      ? person.readOnlyProfileInfo
      : [];
    for (const ro of roProfileArr) {
      const roo = asObj(ro);
      const ownerType = asStr(roo?.ownerUserType);
      if (ownerType === 'GOOGLE_USER') reachability.add('Google Account');
    }

    const meta = asObj(person.metadata);
    const idInfo = asObj(meta?.identityInfo);
    const sourceIds = Array.isArray(idInfo?.sourceIds) ? idInfo.sourceIds : [];
    for (const s of sourceIds) {
      const so = asObj(s);
      const lu =
        asStr(so?.lastUpdated) ||
        toIsoFromTimestamp(asStr(so?.lastUpdatedMicros));
      if (lu && !lastUpdated) lastUpdated = lu;
      const ctype = asStr(so?.containerType) || asStr(so?.sourceType);
      if (ctype && /profile/i.test(ctype)) reachability.add('Google Profile');
    }
    if (!lastUpdated) {
      lastUpdated = toIsoFromTimestamp(asStr(meta?.lastUpdateTimeMicros));
    }

    const sources = Array.isArray(meta?.sources) ? meta.sources : [];
    for (const src of sources) {
      const so = asObj(src);
      const ut = asStr(so?.updateTime);
      if (ut && !lastUpdated) lastUpdated = ut;
      const appType = asStr(so?.type);
      if (appType && /profile/i.test(appType)) reachability.add('Google Profile');
    }
  };

  // 1) Parse people-pa /v2/people/lookup shape: { matches: [{ lookupId, personId: [gaia] }], people: { [gaia]: {...} } }
  const matchesArr = Array.isArray(root?.matches) ? root.matches : null;
  if (matchesArr && matchesArr.length > 0) {
    const firstMatch = asObj(matchesArr[0]);
    const pidArr = Array.isArray(firstMatch?.personId) ? firstMatch.personId : [];
    const matchedId = asStr(pidArr[0]);
    if (matchedId) gaiaId = matchedId;
  }

  const peopleMap = asObj(root?.people);
  if (peopleMap && !Array.isArray(root?.people)) {
    const pNode =
      (gaiaId ? asObj(peopleMap[gaiaId]) : null) || asObj(Object.values(peopleMap)[0]);
    if (pNode) inspectPersonNode(pNode);
  }

  // 2) People-PA /v2/people (personResponse) & People API v1 (people / results / responses arrays)
  const peopleList =
    (Array.isArray(root?.personResponse) && root.personResponse) ||
    (Array.isArray(root?.people) && root.people) ||
    (Array.isArray(root?.results) && root.results) ||
    (Array.isArray(root?.responses) && root.responses) ||
    null;

  if (peopleList) {
    for (const item of peopleList) {
      inspectPersonNode(item);
    }
  } else {
    inspectPersonNode(root);
  }

  if (!gaiaId) gaiaId = extractGaiaIdFromPayload(str);

  if (!avatarUrl) {
    const lh = str.match(/https:\/\/lh\d\.googleusercontent\.com\/[^"\\]+/i)?.[0];
    if (lh) avatarUrl = lh;
  }
  if (/YOUTUBE/i.test(str)) reachability.add('YouTube');
  if (/MAPS/i.test(str)) reachability.add('Google Maps');
  if (/DYNAMITE|HANGOUTS|CHAT/i.test(str)) reachability.add('Google Chat');
  if (/PHOTOS/i.test(str)) reachability.add('Google Photos');

  if (!gaiaId && !displayName && !avatarUrl) return null;
  return {
    gaiaId,
    displayName,
    avatarUrl,
    coverPhotoUrl,
    lastUpdated,
    inAppReachability: Array.from(reachability),
  };
}

async function resolvePersonWithCookieSession(
  email: string,
  cookies: Record<string, string>
): Promise<ResolvedGooglePerson> {
  const { apiKeys, sessionValid } = await getDynamicKeepApiKeys(cookies);
  if (!sessionValid || apiKeys.length === 0) {
    return {
      inAppReachability: [],
      degradedToPublic: true,
      note: 'Google browser session cookies were rejected or expired (redirected to login). Paste fresh SAPISID / __Secure-3PSID / SID cookies into GHUNT_COOKIES.',
    };
  }

  const cookieHeader = buildCookieHeaderString(cookies);
  const sapisidHeader = buildSapisidAuthHeader(cookies, 'https://keep.google.com');
  if (!sapisidHeader) {
    return {
      inAppReachability: [],
      degradedToPublic: true,
      note: 'GHUNT_COOKIES is missing SAPISID or __Secure-3PAPISID required for authenticated SAPISIDHASH signing.',
    };
  }

  let lastStatus = 0;
  for (const apiKey of apiKeys) {
    const params = new URLSearchParams({
      id: email,
      type: 'EMAIL',
      match_type: 'EXACT',
      'merged_person_source_options.include_account_lookup_data_source': 'true',
      key: apiKey,
    });
    for (const field of [
      'person.name',
      'person.photo',
      'person.cover_photo',
      'person.about',
      'person.metadata',
      'person.read_only_profile_info',
    ]) {
      params.append('request_mask.include_field.paths', field);
    }
    params.append('request_mask.include_container', 'PROFILE');
    params.append('request_mask.include_container', 'DOMAIN_PROFILE');
    params.append('extension_set.extension_names', 'DYNAMITE_ADDITIONAL_DATA');

    const res = await fetchJsonGet(
      `https://people-pa.clients6.google.com/v2/people/lookup?${params.toString()}`,
      {
        Cookie: cookieHeader,
        Authorization: sapisidHeader,
        Origin: 'https://keep.google.com',
        Referer: 'https://keep.google.com/',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-AuthUser': '0',
        Accept: 'application/json',
      },
      6000
    );

    if (res.status === 403 || res.status === 401) {
      lastStatus = res.status;
      continue;
    }

    if (res.ok && res.json) {
      const parsed = parsePeopleApiResponse(res.json);
      if (parsed) {
        // If lookup found Gaia ID without displayName or full cover/photo metadata, query /v2/people by Gaia ID
        if (parsed.gaiaId && !parsed.displayName) {
          const v2Params = new URLSearchParams({
            person_id: parsed.gaiaId,
            key: apiKey,
          });
          for (const field of [
            'person.name',
            'person.photo',
            'person.cover_photo',
            'person.metadata',
            'person.read_only_profile_info',
          ]) {
            v2Params.append('request_mask.include_field.paths', field);
          }
          v2Params.append('request_mask.include_container', 'PROFILE');
          v2Params.append('request_mask.include_container', 'DOMAIN_PROFILE');
          const v2Res = await fetchJsonGet(
            `https://people-pa.clients6.google.com/v2/people?${v2Params.toString()}`,
            {
              Cookie: cookieHeader,
              Authorization: sapisidHeader,
              Origin: 'https://keep.google.com',
              Referer: 'https://keep.google.com/',
              'X-Goog-Api-Key': apiKey,
              'X-Goog-AuthUser': '0',
              Accept: 'application/json',
            },
            4500
          );
          const v2Parsed = v2Res.ok && v2Res.json ? parsePeopleApiResponse(v2Res.json) : null;
          if (v2Parsed?.displayName) parsed.displayName = v2Parsed.displayName;
          if (v2Parsed?.avatarUrl && !parsed.avatarUrl) parsed.avatarUrl = v2Parsed.avatarUrl;
          if (v2Parsed?.coverPhotoUrl && !parsed.coverPhotoUrl) parsed.coverPhotoUrl = v2Parsed.coverPhotoUrl;
          if (v2Parsed?.lastUpdated && !parsed.lastUpdated) parsed.lastUpdated = v2Parsed.lastUpdated;
          for (const app of v2Parsed?.inAppReachability || []) {
            if (!parsed.inAppReachability.includes(app)) parsed.inAppReachability.push(app);
          }
        }
        return {
          ...parsed,
          degradedToPublic: false,
        };
      }

      return {
        inAppReachability: [],
        degradedToPublic: false,
        note: `Google People lookup authenticated successfully (cookie_session), but no public Google profile record matched ${email}.`,
      };
    }

    lastStatus = res.status;
  }

  return {
    inAppReachability: [],
    degradedToPublic: true,
    note:
      lastStatus > 0
        ? `Authenticated Google cookie lookup returned HTTP ${lastStatus} — verify cookie freshness.`
        : 'Authenticated Google cookie lookup timed out.',
  };
}

async function resolvePersonWithAuth(
  email: string,
  creds: ParsedGhuntCreds
): Promise<ResolvedGooglePerson> {
  // Try OAuth bearer flow when access token / valid client refresh is configured
  const canTryOAuth = Boolean(
    creds.oauthAccessToken ||
      creds.androidMasterToken ||
      (creds.oauthRefreshToken && creds.clientId && creds.clientSecret) ||
      (creds.oauthAuthCode && creds.clientId && creds.clientSecret)
  );

  let oauthNote: string | undefined;
  let oauthDegraded = false;

  if (canTryOAuth) {
    const { accessToken, exchangeNote, degradedToPublic } =
      await exchangeCredentialsForAccessToken(creds);
    oauthNote = exchangeNote;
    oauthDegraded = Boolean(degradedToPublic);

    if (accessToken) {
      const [peopleSearchRes, contactsSearchRes] = await Promise.all([
        fetchJsonGet(
          `https://people.googleapis.com/v1/people:searchDirectoryPeople?query=${encodeURIComponent(
            email
          )}&readMask=names,emailAddresses,photos,coverPhotos,metadata&sources=DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE`,
          { Authorization: `Bearer ${accessToken}` },
          5500
        ),
        fetchJsonGet(
          `https://people.googleapis.com/v1/otherContacts:search?query=${encodeURIComponent(
            email
          )}&readMask=names,emailAddresses,photos,metadata`,
          { Authorization: `Bearer ${accessToken}` },
          5500
        ),
      ]);

      const parsed =
        (peopleSearchRes.ok && parsePeopleApiResponse(peopleSearchRes.json)) ||
        (contactsSearchRes.ok && parsePeopleApiResponse(contactsSearchRes.json));
      if (parsed) return parsed;

      const anyGaia =
        extractGaiaIdFromPayload(peopleSearchRes.text) ||
        extractGaiaIdFromPayload(contactsSearchRes.text);
      if (anyGaia) return { gaiaId: anyGaia, inAppReachability: [] };
    }
  } else if (!hasValidSapisidCookies(creds.cookies)) {
    const { exchangeNote, degradedToPublic } = await exchangeCredentialsForAccessToken(creds);
    return {
      inAppReachability: [],
      note: exchangeNote,
      degradedToPublic: Boolean(degradedToPublic),
    };
  }

  // Prefer / fallback to authenticated browser cookie session whenever SAPISID cookies are configured
  if (hasValidSapisidCookies(creds.cookies) && creds.cookies) {
    const cookieResult = await resolvePersonWithCookieSession(email, creds.cookies);
    if (!cookieResult.degradedToPublic || !oauthNote) {
      return cookieResult;
    }
  }

  return {
    inAppReachability: [],
    note: oauthNote || 'Authenticated Google People lookup returned no usable session.',
    degradedToPublic: true,
  };
}

/**
 * Pure TypeScript parser for Google Maps contributor reviews arrays
 * returned by /maps/contrib/<gaiaId>/reviews or /locationhistory/preview/mas.
 */
export function extractReviewsFromGoogleMapsPayload(
  payload: unknown,
  gaiaId?: string
): {
  reviews: GhuntReviewItem[];
  reviewCountHint?: number;
  photoCountHint?: number;
  contributorName?: string;
  contributorAvatarUrl?: string;
} {
  const reviews: GhuntReviewItem[] = [];
  const seenKeys = new Set<string>();
  let reviewCountHint: number | undefined;
  let photoCountHint: number | undefined;
  let contributorName: string | undefined;
  let contributorAvatarUrl: string | undefined;

  const isValidCoord = (lat: unknown, lng: unknown): lat is number =>
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) > 0.01 &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) > 0.01 &&
    Math.abs(lng) <= 180;

  const findCoordsInNode = (node: unknown, depth = 0): { lat: number; lng: number } | null => {
    if (depth > 5 || !node) return null;
    if (Array.isArray(node)) {
      // Google Maps coordinate tuples look like [null, null, lat, lng] or [lat, lng]
      if (node.length >= 4 && node[0] === null && node[1] === null && isValidCoord(node[2], node[3])) {
        return { lat: node[2], lng: node[3] };
      }
      if (node.length === 2 && isValidCoord(node[0], node[1])) {
        return { lat: node[0], lng: node[1] };
      }
      for (const child of node) {
        const hit = findCoordsInNode(child, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };

  const isOpaquePlaceId = (s: string) =>
    /^ChIJ[A-Za-z0-9_-]{4,}$/i.test(s) ||
    /^Ch[A-Za-z0-9_-]{12,}$/i.test(s) ||
    /^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(s) ||
    /^2ahU[A-Za-z0-9_-]+$/i.test(s) ||
    /^0ahU[A-Za-z0-9_-]+$/i.test(s) ||
    /^\/g\/[A-Za-z0-9_-]+$/i.test(s) ||
    /^[A-Za-z0-9_-]{24,}$/.test(s);

  const collectStringsDeep = (node: unknown, depth = 0, out: string[] = []): string[] => {
    if (depth > 5 || !node) return out;
    if (typeof node === 'string') {
      const t = node.trim();
      if (t) out.push(t);
      return out;
    }
    if (Array.isArray(node)) {
      for (const child of node) collectStringsDeep(child, depth + 1, out);
    }
    return out;
  };

  // Extract MAS top-level contributor header (mas[16]) when present
  if (Array.isArray(payload) && Array.isArray(payload[16])) {
    const hdr = payload[16] as unknown[];
    if (typeof hdr[0] === 'string' && hdr[0].trim() && !/^\d{15,24}$/.test(hdr[0].trim())) {
      contributorName = hdr[0].trim();
    }
    const hdrStrings = collectStringsDeep(hdr, 0);
    const rawAv = hdrStrings.find((s) => /^https:\/\/lh\d\.googleusercontent\.com\//i.test(s));
    if (rawAv) {
      contributorAvatarUrl = rawAv.replace(/=s\d+[^=]*$/i, '=s256-c');
    }
  }

  // Extract MAS structured review entry:
  // Shape A: [null, [placeSummaryArr, 0], reviewBlockArr, null, fullPlaceDetailsArr]
  //   where reviewBlockArr = [reviewId, reviewMetaArr, reviewContentArr, replyArr, linkBlockArr, ...]
  // Shape B (alt): [placeWrapperOrArr, reviewMetaArr, reviewContentArr, ..., fullPlaceDetailsArr]
  const tryExtractMasReviewTuple = (node: unknown[]): boolean => {
    let placeSummary: unknown[] | undefined;
    let reviewMeta: unknown[] | undefined;
    let reviewContent: unknown[] | undefined;
    let fullPlaceCand: unknown[] | undefined;

    if (
      node.length >= 3 &&
      node[0] === null &&
      Array.isArray(node[1]) &&
      Array.isArray(node[2]) &&
      typeof node[2][0] === 'string' &&
      /^Ch[A-Za-z0-9_-]{8,}$/.test(node[2][0])
    ) {
      const rawPlaceBlock = node[1] as unknown[];
      placeSummary = (
        Array.isArray(rawPlaceBlock[0]) && typeof rawPlaceBlock[0][4] === 'string'
          ? rawPlaceBlock[0]
          : rawPlaceBlock
      ) as unknown[];
      const reviewBlock = node[2] as unknown[];
      reviewMeta = reviewBlock;
      reviewContent = Array.isArray(reviewBlock[2]) ? (reviewBlock[2] as unknown[]) : undefined;
      fullPlaceCand = Array.isArray(node[4]) ? (node[4] as unknown[]) : undefined;
    } else if (
      node.length >= 3 &&
      Array.isArray(node[0]) &&
      Array.isArray(node[1]) &&
      Array.isArray(node[2])
    ) {
      const rawPlaceBlock = node[0] as unknown[];
      placeSummary = (
        Array.isArray(rawPlaceBlock[0]) && typeof rawPlaceBlock[0][4] === 'string'
          ? rawPlaceBlock[0]
          : rawPlaceBlock
      ) as unknown[];
      reviewMeta = node[1] as unknown[];
      reviewContent = node[2] as unknown[];
      fullPlaceCand = Array.isArray(node[6]) ? (node[6] as unknown[]) : undefined;
    } else {
      return false;
    }

    if (!placeSummary || !reviewMeta) return false;

    const reviewId = typeof reviewMeta[0] === 'string' ? reviewMeta[0] : '';
    const coords = findCoordsInNode(placeSummary, 0) || findCoordsInNode(fullPlaceCand, 0);
    if (!coords && !/^Ch[A-Za-z0-9_-]{8,}$/.test(reviewId)) {
      return false;
    }

    const placeNameCand =
      (typeof placeSummary[4] === 'string' && placeSummary[4].trim()) ||
      (fullPlaceCand && typeof fullPlaceCand[2] === 'string' && fullPlaceCand[2].trim()) ||
      undefined;
    if (!placeNameCand || isOpaquePlaceId(placeNameCand)) return false;

    const addressCand =
      (typeof placeSummary[5] === 'string' && placeSummary[5].trim()) ||
      (fullPlaceCand && typeof fullPlaceCand[3] === 'string' && fullPlaceCand[3].trim()) ||
      undefined;

    // Rating sits inside reviewContent[0][0] (e.g. [[5], ...])
    const ratingVal =
      reviewContent &&
      Array.isArray(reviewContent[0]) &&
      typeof reviewContent[0][0] === 'number' &&
      Number.isInteger(reviewContent[0][0]) &&
      reviewContent[0][0] >= 1 &&
      reviewContent[0][0] <= 5
        ? reviewContent[0][0]
        : 0;

    // Review relative date sits inside reviewMeta[1][6] or any relative date string in reviewMeta
    const metaStrings = collectStringsDeep(reviewMeta, 0);
    const dateCand = metaStrings.find((s) =>
      /\b(\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago|(?:a|an)\s+(?:minute|hour|day|week|month|year)\s+ago|just now|\d{4}-\d{2}-\d{2})\b/i.test(
        s
      )
    );

    // Optional author fallback from reviewMeta if mas[16] wasn't present
    if (!contributorName) {
      const innerMeta = Array.isArray(reviewMeta[1]) ? reviewMeta[1] : [];
      const authorBlock = Array.isArray(innerMeta[4]) ? innerMeta[4] : [];
      const authorStrings = collectStringsDeep(authorBlock, 0);
      const authorCand = authorStrings.find(
        (s) =>
          !s.startsWith('http') &&
          !/^\d{15,24}$/.test(s) &&
          s.length >= 2 &&
          s.length <= 80
      );
      if (authorCand) contributorName = authorCand;
    }

    // Comment sits inside reviewContent[15]?.[0]?.[0] or deepest non-language string in reviewContent
    let commentCand: string | undefined;
    if (reviewContent) {
      if (
        Array.isArray(reviewContent[15]) &&
        Array.isArray(reviewContent[15][0]) &&
        typeof reviewContent[15][0][0] === 'string' &&
        reviewContent[15][0][0].trim()
      ) {
        commentCand = reviewContent[15][0][0].trim();
      } else {
        const contentStrings = collectStringsDeep(reviewContent, 0);
        commentCand = contentStrings.find(
          (s) =>
            !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(s) &&
            !s.startsWith('http') &&
            !isOpaquePlaceId(s) &&
            s.length >= 2
        );
      }
    }

    // Timestamp (16-digit microseconds) inside reviewMeta[1][2]
    let timestampIso: string | undefined;
    if (Array.isArray(reviewMeta[1]) && typeof reviewMeta[1][2] === 'number') {
      const ms = reviewMeta[1][2] > 1e14 ? reviewMeta[1][2] / 1000 : reviewMeta[1][2];
      if (ms > 1e12 && ms < Date.now() + 86400_000) {
        timestampIso = new Date(ms).toISOString();
      }
    }

    const allStrings = collectStringsDeep(node, 0);
    const reviewUrl = allStrings.find((s) => s.includes('google.com/maps/reviews/'));
    const placeUrl = allStrings.find((s) => s.includes('google.com/maps/place/'));

    const dedupKey = `${placeNameCand.toLowerCase()}|${coords?.lat?.toFixed(3) || ''}|${coords?.lng?.toFixed(3) || ''}`;
    if (!seenKeys.has(dedupKey)) {
      seenKeys.add(dedupKey);
      reviews.push({
        id: `ghunt-rev-${reviews.length + 1}`,
        placeName: placeNameCand,
        address: addressCand,
        rating: ratingVal,
        dateText: dateCand,
        timestamp: timestampIso,
        comment: commentCand,
        lat: coords?.lat,
        lng: coords?.lng,
        placeUrl,
        reviewUrl:
          reviewUrl ||
          placeUrl ||
          (gaiaId ? `https://www.google.com/maps/contrib/${gaiaId}/reviews` : undefined),
      });
    }
    return true;
  };

  const dateTextPattern =
    /\b(\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago|(?:a|an)\s+(?:minute|hour|day|week|month|year)\s+ago|just now|\d{4}-\d{2}-\d{2})\b/i;

  const walk = (node: unknown, depth = 0) => {
    if (depth > 14 || !node || reviews.length >= 60) return;
    if (!Array.isArray(node)) return;

    // 1) Try structured Google Maps MAS review entry first
    if (tryExtractMasReviewTuple(node)) {
      return;
    }

    // 2) Fallback generic walker for alternate / legacy Maps contrib shapes
    if (node.length >= 4 && node.length <= 40) {
      const strItems = node.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
      const coords = findCoordsInNode(node, 0);
      const hasMapsPlaceUrl = strItems.some(
        (s) => s.includes('/maps/place/') || s.includes('google.com/maps') || s.startsWith('0x')
      );
      const hasReviewId = strItems.some((s) => /^Ch[A-Za-z0-9_-]{8,}$/.test(s));

      if ((coords || hasMapsPlaceUrl || hasReviewId) && strItems.length >= 1) {
        const candidateTitle = strItems.find(
          (s) =>
            !s.startsWith('http') &&
            !isOpaquePlaceId(s) &&
            !dateTextPattern.test(s) &&
            !/^google$/i.test(s) &&
            s.length >= 2 &&
            s.length <= 120
        );
        const ratingCand = node.find(
          (n) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5
        ) as number | undefined;

        const dateCand = strItems.find((s) => dateTextPattern.test(s));

        const addressCand = strItems.find(
          (s) =>
            s !== candidateTitle &&
            !s.startsWith('http') &&
            !isOpaquePlaceId(s) &&
            s.includes(',') &&
            s.length >= 6 &&
            s.length <= 160
        );

        const commentCand = strItems.find(
          (s) =>
            s !== candidateTitle &&
            s !== addressCand &&
            s !== dateCand &&
            !s.startsWith('http') &&
            !isOpaquePlaceId(s) &&
            s.length >= 8 &&
            s.length <= 1200
        );

        const placeUrl = strItems.find((s) => s.startsWith('http') && s.includes('google.com/maps'));

        if (candidateTitle && (ratingCand !== undefined || coords)) {
          const dedupKey = `${candidateTitle.toLowerCase()}|${coords?.lat?.toFixed(3) || ''}|${coords?.lng?.toFixed(3) || ''}`;
          if (!seenKeys.has(dedupKey)) {
            seenKeys.add(dedupKey);
            reviews.push({
              id: `ghunt-rev-${reviews.length + 1}`,
              placeName: candidateTitle,
              address: addressCand,
              rating: ratingCand ?? 0,
              dateText: dateCand,
              comment: commentCand,
              lat: coords?.lat,
              lng: coords?.lng,
              placeUrl,
              reviewUrl:
                placeUrl ||
                (gaiaId ? `https://www.google.com/maps/contrib/${gaiaId}/reviews` : undefined),
            });
            return;
          }
        }
      }
    }

    for (const child of node) {
      if (Array.isArray(child)) {
        walk(child, depth + 1);
      }
    }
  };

  walk(payload, 0);

  // Extract total review/photo counts from contribution stats array or raw JSON text
  try {
    const flat = JSON.stringify(payload);
    const revCountMatch = flat.match(/"(\d+)\s+reviews?"/i);
    if (revCountMatch?.[1]) reviewCountHint = Number(revCountMatch[1]);
    const photoCountMatch = flat.match(/"(\d+)\s+photos?"/i);
    if (photoCountMatch?.[1]) photoCountHint = Number(photoCountMatch[1]);
  } catch {
    // Ignore stringify limits
  }

  return {
    reviews,
    reviewCountHint,
    photoCountHint,
    contributorName,
    contributorAvatarUrl,
  };
}

async function fetchGoogleMapsReviews(
  gaiaId: string,
  cookies?: Record<string, string>
): Promise<{
  reviews: GhuntReviewItem[];
  reviewCountHint?: number;
  photoCountHint?: number;
  contributorName?: string;
  contributorAvatarUrl?: string;
  rateLimited?: boolean;
}> {
  const cookieHeader = cookies ? buildCookieHeaderString(cookies) : '';
  const reqHeaders: Record<string, string> = cookieHeader
    ? { Cookie: cookieHeader }
    : {};

  const contribUrl = `https://www.google.com/maps/contrib/${encodeURIComponent(gaiaId)}/reviews?hl=en`;
  let contribRes = await fetchJsonGet(contribUrl, reqHeaders, 6500);

  // If authenticated cookie fetch hit 403/429 on Maps HTML, retry once unauthenticated (public endpoint)
  if ((contribRes.status === 403 || contribRes.status === 429) && cookieHeader) {
    contribRes = await fetchJsonGet(contribUrl, {}, 6500);
  }

  let contributorName: string | undefined;
  let contributorAvatarUrl: string | undefined;
  const parsedPayloads: unknown[] = [];
  let dynamicMasPath: string | undefined;

  if (contribRes.text) {
    const titleMatch = contribRes.text.match(
      /(?:Contributions by|<meta property="og:title" content="Contributions by)\s*([^"<]+?)(?:"|<|\s*[-|]\s*Google Maps)/i
    );
    if (titleMatch?.[1] && !/google maps/i.test(titleMatch[1])) {
      contributorName = titleMatch[1].trim();
    }

    const stateMatch = contribRes.text.match(
      /window\.APP_INITIALIZATION_STATE=([\s\S]*?);window\.APP_FLAGS/
    );
    if (stateMatch?.[1]) {
      try {
        const initArr = JSON.parse(stateMatch[1]) as unknown[];
        parsedPayloads.push(initArr);
        const arr3 = Array.isArray(initArr?.[3]) ? initArr[3] : [];
        if (typeof arr3[17] === 'string' && arr3[17].startsWith('/locationhistory/preview/mas')) {
          dynamicMasPath = arr3[17];
        }
        for (const entry of arr3) {
          if (typeof entry === 'string' && entry.startsWith(")]}'")) {
            try {
              parsedPayloads.push(JSON.parse(entry.replace(/^\)\]\}'\s*/, '')));
            } catch {
              // ignore non-json string
            }
          }
        }
      } catch {
        // ignore parse failure
      }
    }
  }

  // Follow the live session-signed MAS URL extracted from APP_INITIALIZATION_STATE (or fallback static MAS query)
  const masUrl = dynamicMasPath
    ? `https://www.google.com${dynamicMasPath}`
    : `https://www.google.com/locationhistory/preview/mas?authuser=0&hl=en&gl=us&pb=!1m4!1s${encodeURIComponent(
        gaiaId
      )}!3m2!2s!3s!2m2!1i30!2s!4m1!2i1`;

  let masRes = await fetchJsonGet(masUrl, reqHeaders, 6000);
  if ((masRes.status === 403 || masRes.status === 429) && cookieHeader) {
    masRes = await fetchJsonGet(masUrl, {}, 6000);
  }
  if (masRes.json) {
    parsedPayloads.push(masRes.json);
  }

  const rateLimited =
    contribRes.status === 429 ||
    masRes.status === 429 ||
    (contribRes.status === 403 && !masRes.ok);

  const allReviews: GhuntReviewItem[] = [];
  const seen = new Set<string>();
  let reviewCountHint: number | undefined;
  let photoCountHint: number | undefined;

  for (const payload of parsedPayloads) {
    const extracted = extractReviewsFromGoogleMapsPayload(payload, gaiaId);
    if (extracted.contributorName && !contributorName) {
      contributorName = extracted.contributorName;
    }
    if (extracted.contributorAvatarUrl && !contributorAvatarUrl) {
      contributorAvatarUrl = extracted.contributorAvatarUrl;
    }
    if (typeof extracted.reviewCountHint === 'number' && reviewCountHint === undefined) {
      reviewCountHint = extracted.reviewCountHint;
    }
    if (typeof extracted.photoCountHint === 'number' && photoCountHint === undefined) {
      photoCountHint = extracted.photoCountHint;
    }
    for (const r of extracted.reviews) {
      const k = `${r.placeName.toLowerCase()}|${r.lat || ''}|${r.lng || ''}`;
      if (!seen.has(k)) {
        seen.add(k);
        allReviews.push(r);
      }
    }
  }

  // Fallback ONLY if Maps HTML/MAS failed or returned rate limit without contributor name
  if (allReviews.length === 0 && (rateLimited || (!masRes.ok && !contributorName))) {
    const [bingRes, geminiMapsRes] = await Promise.all([
      fetchJsonGet(
        `https://www.bing.com/search?q=${encodeURIComponent(`"maps/contrib/${gaiaId}"`)}&format=rss&count=5`,
        { Accept: 'application/rss+xml, application/xml, text/xml' },
        3500
      ),
      runGeminiGoogleSearchDork({
        target: gaiaId,
        targetType: 'username',
        queries: [
          `"maps/contrib/${gaiaId}"`,
          `"${gaiaId}" "Contributions by"`,
        ],
        mode: 'phone-fast',
      }).catch(() => ({ hits: [], active: false })),
    ]);

    const titleHit = bingRes.text.match(/<title>(?:<!\[CDATA\[)?Contributions by ([^<\]]+)/i)?.[1];
    if (titleHit && !/google maps/i.test(titleHit)) {
      contributorName = titleHit.trim();
    }
    if (!contributorName && geminiMapsRes.hits.length > 0) {
      for (const hit of geminiMapsRes.hits) {
        const m =
          hit.title?.match(/Contributions by ([^-–|]+)/i)?.[1] ||
          hit.snippet?.match(/Contributions by ([^.,;\n]+)/i)?.[1];
        if (m && !/google maps/i.test(m)) {
          contributorName = m.trim();
          break;
        }
      }
    }
  }

  return {
    reviews: allReviews,
    reviewCountHint: reviewCountHint ?? (allReviews.length > 0 ? allReviews.length : undefined),
    photoCountHint,
    contributorName,
    contributorAvatarUrl,
    rateLimited,
  };
}

function isUsableAvatarUrl(raw?: string): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const cleaned = raw.trim();
  if (!/^https?:\/\//i.test(cleaned)) return undefined;
  if (
    /api\.unavatar\.io\/favicon|\/favicon\.(?:svg|png|ico)|default_profile_normal|user-default-pictures|opengraph\.githubassets\.com/i.test(
      cleaned
    )
  ) {
    return undefined;
  }
  return cleaned;
}

async function probeDirectPublicImageUrl(url: string, timeoutMs = 4000): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': GHUNT_UA,
        Accept: 'image/*,*/*;q=0.8',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return undefined;
    }
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    const len = Number(res.headers.get('content-length') || '0');
    await res.body?.cancel().catch(() => {});
    if (!ctype.startsWith('image/')) return undefined;
    if (len > 0 && len < 150) return undefined;
    return isUsableAvatarUrl(res.url || url);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export async function runNativeGhuntInvestigation(
  email: string,
  overrideToken?: string
): Promise<{
  result: InvestigationResultItem;
  geoMarkers: GeoMarker[];
  ghuntIntel: GhuntIntelligenceData;
}> {
  const t0 = Date.now();
  const cleanEmail = email.trim().toLowerCase();
  const domain = cleanEmail.split('@')[1] || '';
  const isGoogleDomain = domain === 'gmail.com' || domain === 'googlemail.com';
  const md5Hash = crypto.createHash('md5').update(cleanEmail).digest('hex');

  const creds = loadGhuntCredentialsFromEnv(overrideToken);

  const sha256Hash = crypto.createHash('sha256').update(cleanEmail).digest('hex');

  const [
    mxRecords,
    txtRecords,
    dmarcRecords,
    unavatarGoogleRes,
    unavatarGenericRes,
    gravatarProfileRes,
    gravatarV3Res,
    githubEmailRes,
    calRes,
    authPerson,
    publicGaiaSearchRes,
  ] = await Promise.all([
    dns.resolveMx(domain).catch(() => []),
    dns.resolveTxt(domain).catch(() => []),
    dns.resolveTxt(`_dmarc.${domain}`).catch(() => []),
    fetchJsonGet(
      `https://unavatar.io/google/${encodeURIComponent(cleanEmail)}?json&fallback=false`,
      { Accept: 'application/json' },
      4200
    ),
    fetchJsonGet(
      `https://unavatar.io/${encodeURIComponent(cleanEmail)}?json&fallback=false`,
      { Accept: 'application/json' },
      4200
    ),
    fetchJsonGet(
      `https://en.gravatar.com/${md5Hash}.json`,
      { Accept: 'application/json' },
      3800
    ),
    fetchJsonGet(
      `https://api.gravatar.com/v3/profiles/${sha256Hash}`,
      { Accept: 'application/json' },
      3800
    ),
    fetchJsonGet(
      `https://api.github.com/search/users?q=${encodeURIComponent(`${cleanEmail} in:email`)}&per_page=3`,
      { Accept: 'application/vnd.github+json' },
      3800
    ),
    fetchJsonGet(
      `https://calendar.google.com/calendar/ical/${encodeURIComponent(cleanEmail)}/public/basic.ics`,
      {},
      3200
    ),
    creds.tokenConfigured
      ? resolvePersonWithAuth(cleanEmail, creds)
      : Promise.resolve<ResolvedGooglePerson>({ inAppReachability: [] }),
    runGeminiGoogleSearchDork({
      target: cleanEmail,
      targetType: 'email',
      queries: [
        `"${cleanEmail}" ("google.com/maps/contrib" OR "Contributions by")`,
      ],
      mode: 'phone-fast',
    }).catch(() => ({ hits: [], active: false })),
  ]);

  const sortedMx = [...mxRecords].sort((a, b) => a.priority - b.priority);
  const primaryMx = sortedMx[0]?.exchange?.toLowerCase() || '';
  const usesGoogleMx = sortedMx.some((m) => m.exchange.toLowerCase().includes('google'));

  const gravEntry = Array.isArray(asObj(gravatarProfileRes.json)?.entry)
    ? asObj((asObj(gravatarProfileRes.json)?.entry as unknown[])[0])
    : undefined;
  const gravV3 = asObj(gravatarV3Res.json);
  const gravDisplayName =
    asStr(gravEntry?.displayName) ||
    asStr(gravEntry?.preferredUsername) ||
    asStr(gravV3?.display_name);
  const gravRawThumb = asStr(gravEntry?.thumbnailUrl) || asStr(gravV3?.avatar_url);
  const gravAvatarUrl = gravRawThumb
    ? isUsableAvatarUrl(
        gravRawThumb.replace(/^http:\/\/([a-z0-9-]+\.)?gravatar\.com\//i, 'https://$1gravatar.com/')
      )
    : undefined;

  const ghItems = Array.isArray(asObj(githubEmailRes.json)?.items)
    ? (asObj(githubEmailRes.json)?.items as unknown[])
    : [];
  const ghUser = ghItems.length > 0 ? asObj(ghItems[0]) : undefined;
  const ghAvatarUrl = isUsableAvatarUrl(asStr(ghUser?.avatar_url));
  const ghDisplayName = asStr(ghUser?.name) || asStr(ghUser?.login);

  const unavatarGoogleUrl = isUsableAvatarUrl(asStr(asObj(unavatarGoogleRes.json)?.url));
  const unavatarGenericUrl = isUsableAvatarUrl(asStr(asObj(unavatarGenericRes.json)?.url));
  let resolvedAvatar =
    isUsableAvatarUrl(authPerson.avatarUrl) ||
    unavatarGoogleUrl ||
    unavatarGenericUrl ||
    gravAvatarUrl ||
    ghAvatarUrl;

  if (!resolvedAvatar) {
    const [directGoogleImg, gravatarImg, gravatarShaImg] = await Promise.all([
      probeDirectPublicImageUrl(
        `https://unavatar.io/google/${encodeURIComponent(cleanEmail)}?fallback=false`,
        3800
      ),
      probeDirectPublicImageUrl(
        `https://www.gravatar.com/avatar/${md5Hash}?s=256&d=404`,
        3400
      ),
      probeDirectPublicImageUrl(
        `https://www.gravatar.com/avatar/${sha256Hash}?s=256&d=404`,
        3400
      ),
    ]);
    resolvedAvatar = directGoogleImg || gravatarImg || gravatarShaImg;
  }

  // Extract publicly indexed Google Maps Contributor Gaia ID if OAuth/cookies didn't supply one
  let effectiveGaiaId = authPerson.gaiaId;
  if (!effectiveGaiaId && publicGaiaSearchRes.hits.length > 0) {
    for (const hit of publicGaiaSearchRes.hits) {
      const hay = `${hit.url || ''} ${hit.title || ''} ${hit.snippet || ''}`;
      if (!hay.toLowerCase().includes(cleanEmail) && !hay.toLowerCase().includes(cleanEmail.split('@')[0])) {
        continue;
      }
      const m = hay.match(/google\.com\/maps\/contrib\/(\d{15,24})/i);
      if (m?.[1]) {
        effectiveGaiaId = m[1];
        break;
      }
    }
  }

  const publicCalendar = calRes.status === 200;
  const calNameMatch = publicCalendar
    ? calRes.text.match(/X-WR-CALNAME:([^\r\n]+)/i)?.[1]?.trim() ||
      calRes.text.match(/SUMMARY:([^\r\n]+)/i)?.[1]?.trim()
    : undefined;
  const calTzMatch = publicCalendar
    ? calRes.text.match(/X-WR-TIMEZONE:([^\r\n]+)/i)?.[1]?.trim()
    : undefined;
  const calEventCount = publicCalendar
    ? (calRes.text.match(/BEGIN:VEVENT/g) || []).length
    : 0;

  // Attempt Maps reviews fetch whenever Gaia ID is resolved (authenticated or publicly indexed)
  let reviews: GhuntReviewItem[] = [];
  let mapsReviewsCount = 0;
  let mapsPhotosCount: number | undefined;
  let mapsContributorName: string | undefined;
  let mapsAvatarUrl: string | undefined;
  let mapsRateLimited = false;

  if (effectiveGaiaId) {
    const mapsData = await fetchGoogleMapsReviews(effectiveGaiaId, creds.cookies);
    reviews = mapsData.reviews;
    mapsReviewsCount = mapsData.reviewCountHint ?? reviews.length;
    mapsPhotosCount = mapsData.photoCountHint;
    mapsContributorName = mapsData.contributorName;
    mapsAvatarUrl = isUsableAvatarUrl(mapsData.contributorAvatarUrl);
    mapsRateLimited = Boolean(mapsData.rateLimited);
  }

  if (!resolvedAvatar && mapsAvatarUrl) {
    resolvedAvatar = mapsAvatarUrl;
  }

  const locationRing = computeLocationRing(reviews);
  const geoMarkers: GeoMarker[] = [];

  for (const rev of reviews) {
    if (typeof rev.lat === 'number' && typeof rev.lng === 'number') {
      geoMarkers.push({
        id: `ghunt-map-${rev.id}`,
        label: rev.placeName,
        region: rev.address ? rev.address.split(',').slice(-2).join(',').trim() : rev.placeName,
        country: locationRing?.estimatedAreaLabel || 'Google Maps',
        lat: rev.lat,
        lng: rev.lng,
        source: `Google Maps Review${rev.rating ? ` (${rev.rating}★)` : ''}`,
        count: 1,
        kind: 'review',
        rating: rev.rating,
        reviewUrl: rev.reviewUrl,
      });
    }
  }

  if (locationRing) {
    geoMarkers.unshift({
      id: 'ghunt-location-ring-center',
      label: `Approx. Location Center (±${locationRing.radiusKm} km)`,
      region: locationRing.estimatedAreaLabel,
      country: 'GHunt Triangulation Ring',
      lat: locationRing.centerLat,
      lng: locationRing.centerLng,
      source: `GHunt Ring (${locationRing.sampleCount} review cluster · ${locationRing.confidence} confidence)`,
      count: locationRing.sampleCount,
      radiusMeters: locationRing.radiusMeters,
      kind: 'ring_center',
    });
  }

  const spfPolicy = txtRecords.flat().some((t) => t.toLowerCase().startsWith('v=spf1'));
  const dmarcPolicy = dmarcRecords.flat().some((t) => t.toLowerCase().startsWith('v=dmarc1'));

  const mapsSearchPivotUrl = `https://www.google.com/search?q=${encodeURIComponent(
    `"${cleanEmail}" site:google.com/maps/contrib`
  )}`;
  const profileUrl = effectiveGaiaId
    ? `https://www.google.com/maps/contrib/${effectiveGaiaId}`
    : `https://contacts.google.com/search/${encodeURIComponent(cleanEmail)}`;
  const mapsContribUrl = effectiveGaiaId
    ? `https://www.google.com/maps/contrib/${effectiveGaiaId}/reviews`
    : mapsSearchPivotUrl;
  const calUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(cleanEmail)}/public/basic.ics`;
  const calendarEmbedUrl = `https://calendar.google.com/calendar/u/0/embed?src=${encodeURIComponent(cleanEmail)}`;
  const googlePlusArchiveUrl = effectiveGaiaId
    ? `https://web.archive.org/web/*/plus.google.com/${effectiveGaiaId}*`
    : undefined;

  const accountLabel = isGoogleDomain
    ? 'Consumer Gmail'
    : usesGoogleMx
    ? 'Google Workspace Host'
    : 'Non-Google MX Domain';

  const hasAccountProof = Boolean(
    effectiveGaiaId ||
      authPerson.displayName ||
      mapsContributorName ||
      publicCalendar ||
      resolvedAvatar
  );
  const isGoogleInfra = isGoogleDomain || usesGoogleMx;

  const ghuntStatus: InvestigationResultItem['status'] = hasAccountProof
    ? 'found'
    : isGoogleInfra
    ? 'not_checked'
    : 'not_found';

  const inAppReachability = Array.from(
    new Set([
      ...authPerson.inAppReachability,
      ...(isGoogleInfra ? ['Gmail'] : []),
      ...(publicCalendar ? ['Google Calendar'] : []),
      ...(mapsReviewsCount > 0 || reviews.length > 0 ? ['Google Maps Reviews'] : []),
    ])
  );

  const effectiveAuthMode: GhuntIntelligenceData['authMode'] = authPerson.degradedToPublic
    ? 'public_metadata'
    : creds.authMode;
  const effectiveTokenConfigured = !authPerson.degradedToPublic && creds.tokenConfigured;

  const ghuntIntel: GhuntIntelligenceData = {
    email: cleanEmail,
    tokenConfigured: effectiveTokenConfigured,
    authMode: effectiveAuthMode,
    gaiaId: effectiveGaiaId,
    displayName:
      authPerson.displayName ||
      mapsContributorName ||
      (calNameMatch && !calNameMatch.includes('@') ? calNameMatch : undefined) ||
      gravDisplayName ||
      ghDisplayName,
    avatarUrl: resolvedAvatar,
    coverPhotoUrl: authPerson.coverPhotoUrl,
    lastUpdated: authPerson.lastUpdated,
    accountType: accountLabel,
    isGoogleDomain,
    usesGoogleMx,
    primaryMx: primaryMx || undefined,
    publicCalendar,
    calendarUrl: publicCalendar ? calUrl : undefined,
    calendarEmbedUrl,
    googlePlusArchiveUrl,
    spfPolicy,
    dmarcPolicy,
    inAppReachability,
    profileUrl,
    mapsContribUrl,
    mapsReviewsCount,
    mapsPhotosCount,
    mapsRateLimited,
    reviews,
    locationRing,
    note:
      authPerson.note ||
      (mapsRateLimited && reviews.length === 0 && effectiveGaiaId
        ? effectiveTokenConfigured
          ? `Authenticated GHunt cookie session active — Gaia ID ${effectiveGaiaId} resolved. Google Maps public contributor endpoint rate-limited this shared server IP (HTTP 429); click Open Maps Reviews to view reviews directly in your browser.`
          : `Gaia ID ${effectiveGaiaId} resolved. Google Maps contributor endpoint returned HTTP 429 from this server IP — click Open Maps Reviews to inspect public reviews in your browser.`
        : !effectiveTokenConfigured
        ? 'Running Public Google Metadata checks (Workspace MX, Calendar ICS, GitHub/Gravatar & Public Maps Contributor Search). Add valid GHUNT_COOKIES (SAPISID/SID) or Google OAuth refresh token + client credentials to unlock private Gaia IDs & Maps reviews.'
        : undefined),
  };

  const resolvedDisplayName = ghuntIntel.displayName;
  const displayFields =
    hasAccountProof || isGoogleInfra
      ? [
          { label: 'Query', value: cleanEmail, kind: 'email' as const, copyable: true },
          ...(effectiveGaiaId
            ? [{ label: 'Photo ID', value: effectiveGaiaId, copyable: true }]
            : []),
          ...(authPerson.lastUpdated
            ? [{ label: 'Last Update', value: authPerson.lastUpdated, kind: 'date' as const, copyable: true }]
            : []),
          ...(resolvedDisplayName
            ? [{ label: 'Google Name', value: resolvedDisplayName, copyable: true }]
            : []),
          {
            label: 'Engine Mode',
            value: effectiveTokenConfigured
              ? `Live-Native GHunt (${effectiveAuthMode})`
              : 'Live-Native GHunt (Public Metadata)',
          },
          { label: 'Account Type', value: accountLabel },
          ...(calTzMatch ? [{ label: 'Calendar Timezone', value: calTzMatch }] : []),
          ...(mapsReviewsCount > 0
            ? [{ label: 'Maps Reviews', value: String(mapsReviewsCount) }]
            : []),
          ...(locationRing
            ? [
                {
                  label: 'Approx. Ring Center',
                  value: `${locationRing.centerLat}, ${locationRing.centerLng} (±${locationRing.radiusKm} km)`,
                  copyable: true,
                },
              ]
            : []),
          { label: 'Google Maps', value: profileUrl, kind: 'url' as const, copyable: true },
          { label: 'Google Calendar', value: calendarEmbedUrl, kind: 'url' as const, copyable: true },
          ...(googlePlusArchiveUrl
            ? [{ label: 'Google Plus Archive', value: googlePlusArchiveUrl, kind: 'url' as const, copyable: true }]
            : []),
          {
            label: 'Public Calendar',
            value: publicCalendar
              ? calEventCount > 0
                ? `Yes (${calEventCount} events)`
                : 'Yes'
              : 'No',
          },
        ]
      : undefined;

  const summary = hasAccountProof
    ? `${resolvedDisplayName ? `${resolvedDisplayName} · ` : ''}${accountLabel}${
        effectiveGaiaId ? ` (Gaia ${effectiveGaiaId})` : ''
      }${publicCalendar ? ` · Public Calendar${calTzMatch ? ` (${calTzMatch})` : ''}` : ''}${
        reviews.length > 0
          ? ` · ${reviews.length} Maps review(s)${
              locationRing ? ` · Approx ring ±${locationRing.radiusKm} km (${locationRing.estimatedAreaLabel})` : ''
            }`
          : ''
      }`
    : isGoogleInfra
    ? `${accountLabel} (${primaryMx || domain}) verified via Google MX & public endpoint checks.`
    : 'Domain is not hosted on Google Workspace MX.';

  const liveOAuthActive = effectiveTokenConfigured && effectiveAuthMode !== 'public_metadata';

  const result: InvestigationResultItem = {
    id: 'ghunt-google-workspace',
    platform: 'Google (GHunt)',
    domain: 'google.com',
    category: 'Productivity & Cloud',
    tool: 'ghunt',
    status: ghuntStatus,
    findingKind: 'registered',
    handle: cleanEmail,
    displayName: resolvedDisplayName || cleanEmail,
    accountType: hasAccountProof ? accountLabel : undefined,
    avatarUrl: resolvedAvatar,
    lastSeen: authPerson.lastUpdated,
    relativeTime: hasAccountProof
      ? liveOAuthActive
        ? effectiveAuthMode === 'cookie_session'
          ? 'Live Cookie GHunt'
          : 'Live OAuth GHunt'
        : 'Verified Google Signal'
      : undefined,
    linkedInfo: [
      liveOAuthActive ? `Auth: ${effectiveAuthMode}` : 'Public Metadata Mode',
      effectiveGaiaId ? `Gaia ${effectiveGaiaId}` : undefined,
      reviews.length > 0 ? `${reviews.length} Maps Reviews` : undefined,
      locationRing ? `Ring ±${locationRing.radiusKm} km` : undefined,
      publicCalendar ? 'Public Calendar ICS' : undefined,
    ].filter((v): v is string => Boolean(v)),
    displayFields,
    statsLine:
      hasAccountProof || reviews.length > 0
        ? `Services: ${inAppReachability.slice(0, 4).join(' · ') || 'Gmail'}${
            mapsReviewsCount > 0 ? ` · Reviews ${mapsReviewsCount}` : ''
          }`
        : undefined,
    url: effectiveGaiaId ? mapsContribUrl : hasAccountProof ? profileUrl : undefined,
    summary,
    durationMs: Date.now() - t0,
    artifacts: [
      ...(effectiveGaiaId
        ? [
            {
              id: 'ghunt-maps-contrib',
              type: 'profile_signal' as const,
              title: 'Google Maps Contributor Profile',
              subtitle: profileUrl,
              url: profileUrl,
              summary: `${reviews.length} review(s) parsed${
                locationRing ? ` · Center ${locationRing.estimatedAreaLabel}` : ''
              }`,
              details: { gaiaId: effectiveGaiaId, reviewsCount: reviews.length, mapsContribUrl },
            },
          ]
        : [
            {
              id: 'ghunt-maps-search-pivot',
              type: 'profile_signal' as const,
              title: 'Search Public Google Maps Contributor Index',
              subtitle: 'google.com/maps/contrib pivot',
              url: mapsSearchPivotUrl,
              summary: `Pivot to Google Search for publicly indexed Maps contributor profiles matching ${cleanEmail}.`,
              details: { query: `"${cleanEmail}" site:google.com/maps/contrib` },
            },
          ]),
      {
        id: 'ghunt-calendar-embed',
        type: 'profile_signal' as const,
        title: 'Google Calendar Embed',
        subtitle: calendarEmbedUrl,
        url: calendarEmbedUrl,
        summary: `Direct Google Calendar embed URL for ${cleanEmail}.`,
        details: { email: cleanEmail, publicCalendar, calendarEmbedUrl },
      },
      ...(googlePlusArchiveUrl
        ? [
            {
              id: 'ghunt-plus-archive',
              type: 'profile_signal' as const,
              title: 'Google Plus Archive (Wayback)',
              subtitle: googlePlusArchiveUrl,
              url: googlePlusArchiveUrl,
              summary: `Internet Archive Wayback snapshot lookup for plus.google.com/${effectiveGaiaId}.`,
              details: { gaiaId: effectiveGaiaId, googlePlusArchiveUrl },
            },
          ]
        : []),
      ...reviews.slice(0, 8).map((rev) => ({
        id: `ghunt-rev-art-${rev.id}`,
        type: 'profile_signal' as const,
        title: `${rev.placeName}${rev.rating ? ` (${rev.rating}★)` : ''}`,
        subtitle: rev.address || rev.dateText || 'Google Maps Review',
        url: rev.reviewUrl || rev.placeUrl || mapsContribUrl,
        summary: rev.comment || `Rated ${rev.rating || '—'} stars${rev.dateText ? ` · ${rev.dateText}` : ''}`,
        details: {
          lat: rev.lat,
          lng: rev.lng,
          rating: rev.rating,
          address: rev.address,
          dateText: rev.dateText,
        },
      })),
      ...(publicCalendar
        ? [
            {
              id: 'ghunt-public-calendar',
              type: 'profile_signal' as const,
              title: 'Public Google Calendar Feed (ICS)',
              subtitle: 'calendar.google.com',
              url: calUrl,
              summary: `Target exposes a public Google Calendar feed for ${cleanEmail}.`,
              details: { calUrl },
            },
          ]
        : []),
    ],
    details: {
      email: cleanEmail,
      domain,
      executionMode: 'live-native',
      ghuntIntel,
    },
  };

  return {
    result,
    geoMarkers,
    ghuntIntel,
  };
}
