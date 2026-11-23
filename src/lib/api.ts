import type {
  BatchExtractResponse,
  FacialAnalysisResponse,
  FacialCandidateInput,
  GoogleDorkResponse,
  InvestigationRecord,
  TargetType,
  ToolAvailabilityStatus,
  ToolHealthItem,
  ToolId,
} from '@/src/types/investigation';
import { auth } from '@/src/lib/firebase';
import { getDeviceSignals, syncServerClientId } from '@/src/lib/fingerprint';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export interface GeminiPoolStatus {
  configuredSlots: number;
  activeSlot: number;
  slots: Array<{
    slot: number;
    healthy: boolean;
    uses: number;
    failures: number;
  }>;
}

export type CreditTier = 'guest' | 'standard' | 'vip_unlimited';

export interface CreditStatusResponse {
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

export class ApiClientError extends Error {
  status: number;
  isUnreachable: boolean;
  code?: string;
  creditStatus?: CreditStatusResponse;

  constructor(
    message: string,
    status = 0,
    isUnreachable = false,
    code?: string,
    creditStatus?: CreditStatusResponse
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.isUnreachable = isUnreachable;
    this.code = code;
    this.creditStatus = creditStatus;
  }
}

export function detectTargetTypeFromInput(raw: string): TargetType | null {
  const val = raw.trim();
  if (!val) return null;
  if (val.includes('@') && !val.startsWith('@')) return 'email';
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(val) || /^[0-9a-f:]+:[0-9a-f:]+$/i.test(val)) {
    return 'ip';
  }
  const hasTelPrefix = /^tel:/i.test(val);
  const phoneCandidate = val.replace(/^tel:\s*/i, '').trim();
  const digitCount = phoneCandidate.replace(/\D/g, '').length;
  if (
    hasTelPrefix ||
    (/^\+[\d\s().-]{6,24}$/.test(phoneCandidate) && digitCount >= 7 && digitCount <= 15) ||
    (/^[\d\s().-]{7,24}$/.test(phoneCandidate) && digitCount >= 7 && digitCount <= 15)
  ) {
    return 'phone';
  }
  if (/^(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/.*)?$/.test(val) && !val.startsWith('@')) {
    return 'domain';
  }
  return 'username';
}

export function validateTargetInput(
  value: string,
  targetType: TargetType
): { valid: boolean; reason?: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      valid: false,
      reason: `Enter an authorized ${targetType} to search.`,
    };
  }

  if (targetType === 'email') {
    if (trimmed.length > 254) {
      return { valid: false, reason: 'Email address exceeds 254 characters.' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
      return {
        valid: false,
        reason: 'Enter a valid email address (e.g. name@domain.com).',
      };
    }
    return { valid: true };
  }

  if (targetType === 'username') {
    const clean = trimmed.replace(/^@/, '');
    if (clean.length < 2 || clean.length > 64) {
      return {
        valid: false,
        reason: 'Username must be between 2 and 64 characters.',
      };
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(clean)) {
      return {
        valid: false,
        reason: 'Use letters, numbers, dots, underscores, or hyphens only.',
      };
    }
    return { valid: true };
  }

  if (targetType === 'domain') {
    const clean = trimmed.replace(/^https?:\/\//i, '').split('/')[0];
    if (!/^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(clean)) {
      return {
        valid: false,
        reason: 'Enter a valid domain name (e.g. example.com).',
      };
    }
    return { valid: true };
  }

  if (targetType === 'ip') {
    const ipv4 = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
    const ipv6 = /^[0-9a-f:]+:[0-9a-f:]+$/i;
    if (!ipv4.test(trimmed) && !ipv6.test(trimmed)) {
      return {
        valid: false,
        reason: 'Enter a valid IPv4 or IPv6 address (e.g. 8.8.8.8).',
      };
    }
    return { valid: true };
  }

  const phoneClean = trimmed.replace(/^tel:\s*/i, '').trim();
  const digits = phoneClean.replace(/\D/g, '');
  if (/[a-zA-Z]/.test(phoneClean) || digits.length < 7 || digits.length > 15) {
    return {
      valid: false,
      reason: 'Enter a valid international phone number (e.g. +919876543210).',
    };
  }
  return { valid: true };
}

async function requestJson<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const extraHeaders: Record<string, string> = {};

  if (typeof window !== 'undefined') {
    try {
      const signals = await getDeviceSignals();
      extraHeaders['X-Parmanu-FP'] = signals.fpHash;
      extraHeaders['X-Parmanu-Client-Id'] = signals.clientId;
    } catch {
      // ignore fingerprint fallback
    }
    try {
      const hasExplicitAuth =
        options?.headers &&
        ('Authorization' in (options.headers as Record<string, string>) ||
          'authorization' in (options.headers as Record<string, string>));
      if (!hasExplicitAuth && auth.currentUser) {
        const idToken = await auth.currentUser.getIdToken();
        if (idToken) {
          extraHeaders.Authorization = `Bearer ${idToken}`;
        }
      }
    } catch {
      // ignore token error
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...extraHeaders,
        ...(options?.headers || {}),
      },
    });
  } catch {
    throw new ApiClientError(
      `Unable to reach ${path}. Verify the Parmanu server is running.`,
      0,
      true
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new ApiClientError(
      `Unexpected response from ${path} (${response.status}).`,
      response.status,
      response.status === 404
    );
  }

  const data = await response.json();
  const maybeDeviceId = data?.creditStatus?.deviceId || data?.deviceId;
  if (typeof maybeDeviceId === 'string') {
    syncServerClientId(maybeDeviceId);
  }

  if (!response.ok) {
    throw new ApiClientError(
      data?.error || data?.message || `Request failed (${response.status})`,
      response.status,
      false,
      data?.code,
      data?.creditStatus
    );
  }
  return data as T;
}

export async function fetchCreditStatus(idToken?: string): Promise<CreditStatusResponse> {
  return requestJson<CreditStatusResponse>(
    '/api/credits/status',
    idToken ? { headers: { Authorization: `Bearer ${idToken}` } } : undefined
  );
}

export async function fetchToolsHealth(): Promise<{
  availability: Partial<Record<ToolId, ToolAvailabilityStatus>>;
  gemini?: GeminiPoolStatus;
}> {
  const data = await requestJson<{
    tools?: ToolHealthItem[];
    gemini?: GeminiPoolStatus;
  }>('/api/tools/health');
  const availability: Partial<Record<ToolId, ToolAvailabilityStatus>> = {};
  for (const item of data.tools || []) {
    if (item?.tool && item?.status) {
      availability[item.tool] = item.status;
    }
  }
  return { availability, gemini: data.gemini };
}

export async function startInvestigation(payload: {
  target: string;
  targetType: TargetType;
  tools: ToolId[];
  authorizedConfirmed: boolean;
  enableGoogleDorking?: boolean;
}): Promise<InvestigationRecord & { creditStatus?: CreditStatusResponse }> {
  return requestJson<InvestigationRecord & { creditStatus?: CreditStatusResponse }>(
    '/api/investigations',
    {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        enableGoogleDorking: payload.enableGoogleDorking === true,
        email: payload.targetType === 'email' ? payload.target : undefined,
      }),
    }
  );
}

export async function fetchInvestigationById(
  scanId: string,
  signal?: AbortSignal
): Promise<InvestigationRecord> {
  return requestJson<InvestigationRecord>(
    `/api/investigations/${encodeURIComponent(scanId)}`,
    { signal }
  );
}

export async function cancelInvestigation(scanId: string): Promise<void> {
  await requestJson(`/api/investigations/${encodeURIComponent(scanId)}/cancel`, {
    method: 'POST',
  });
}

export async function regenerateInvestigationBrief(
  scanId: string,
  record?: InvestigationRecord
): Promise<InvestigationRecord> {
  return requestJson<InvestigationRecord>(
    `/api/investigations/${encodeURIComponent(scanId)}/summarize`,
    {
      method: 'POST',
      body: JSON.stringify({ record }),
    }
  );
}

export async function askInvestigationAnalyst(
  scanId: string,
  question: string,
  record?: InvestigationRecord
): Promise<{ answer: string; keySlotUsed: number; keyPoolSize: number }> {
  return requestJson<{
    answer: string;
    keySlotUsed: number;
    keyPoolSize: number;
  }>(`/api/investigations/${encodeURIComponent(scanId)}/ask`, {
    method: 'POST',
    body: JSON.stringify({ question, record }),
  });
}

export async function fetchGitHubCommitDetail(
  repository: string,
  sha: string
): Promise<Record<string, unknown>> {
  return requestJson<Record<string, unknown>>(
    `/api/artifacts/github/commit?repo=${encodeURIComponent(repository)}&sha=${encodeURIComponent(sha)}`
  );
}

export async function runDeepGoogleDorkingClient(payload: {
  target: string;
  targetType: TargetType;
  extraTerms?: string[];
  strictPivot?: string;
  scanId?: string;
}): Promise<GoogleDorkResponse> {
  return requestJson<GoogleDorkResponse>('/api/dork', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function analyzeFacialRecognition(payload: {
  target: string;
  referenceImage?: {
    label?: string;
    mimeType: string;
    base64: string;
  };
  referencePhotoId?: string;
  candidates: FacialCandidateInput[];
}): Promise<FacialAnalysisResponse> {
  return requestJson<FacialAnalysisResponse>('/api/facial/analyze', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getAvatarDownloadUrl(photoUrl: string, platform: string): string {
  const hint = `${platform}-avatar`.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return `${API_BASE}/api/proxy/avatar?url=${encodeURIComponent(photoUrl)}&name=${encodeURIComponent(hint)}`;
}

export function getAvatarImageUrl(photoUrl?: string): string | undefined {
  if (!photoUrl) return undefined;
  const trimmed = photoUrl.trim();
  if (!trimmed) return undefined;
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('/') ||
    trimmed.includes('/api/proxy/avatar')
  ) {
    return trimmed;
  }
  const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  if (!/^https?:\/\//i.test(normalized)) return undefined;
  return `${API_BASE}/api/proxy/avatar?url=${encodeURIComponent(normalized)}&inline=1`;
}

export async function dispatchWebhookAlert(payload: {
  url: string;
  provider: 'slack' | 'discord' | 'json';
  payload: Record<string, unknown>;
}): Promise<{ ok: boolean; status: number; message: string }> {
  return requestJson<{ ok: boolean; status: number; message: string }>(
    '/api/webhooks/dispatch',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}

export interface RemoteAssetForensicsResponse {
  url: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  md5: string;
  serverHeader?: string;
  lastModified?: string;
  etag?: string;
  sampleBase64: string;
}

export async function inspectRemoteAssetForensics(
  url: string
): Promise<RemoteAssetForensicsResponse> {
  return requestJson<RemoteAssetForensicsResponse>('/api/forensics/remote', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(chunks.join(''));
}

export async function extractBatchTargetsFromFile(
  file: File
): Promise<BatchExtractResponse> {
  if (file.size > 15 * 1024 * 1024) {
    throw new ApiClientError(
      `${file.name} exceeds the 15 MB maximum file size.`,
      413,
      false
    );
  }
  const buffer = await file.arrayBuffer();
  const contentBase64 = arrayBufferToBase64(buffer);
  return requestJson<BatchExtractResponse>('/api/batch/extract', {
    method: 'POST',
    body: JSON.stringify({
      fileName: file.name || 'uploaded-file',
      mimeType: file.type || 'application/octet-stream',
      contentBase64,
    }),
  });
}

export async function extractBatchTargetsFromText(
  textContent: string,
  fileName = 'pasted-targets.txt'
): Promise<BatchExtractResponse> {
  return requestJson<BatchExtractResponse>('/api/batch/extract', {
    method: 'POST',
    body: JSON.stringify({
      fileName,
      mimeType: 'text/plain',
      textContent,
    }),
  });
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatTimestamp(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatShortDate(iso?: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}
