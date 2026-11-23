import type {
  AutoWebhookSettings,
  EvidenceBoardPin,
  EvidenceTag,
  InvestigationRecord,
  ResultAnnotation,
  TargetType,
  WebhookConfig,
} from '@/src/types/investigation';

const ANNOTATIONS_KEY_PREFIX = 'parmanu_annotations_v1_';
const CASE_NOTES_KEY_PREFIX = 'parmanu_case_note_v1_';
const EVIDENCE_BOARD_KEY_PREFIX = 'parmanu_evidence_board_v1_';
const PIVOT_LINEAGE_KEY = 'parmanu_pivot_lineage_v1';
const WEBHOOKS_KEY = 'parmanu_webhooks_v1';
const AUTO_WEBHOOK_KEY = 'parmanu_auto_webhook_v1';
const THEME_STORAGE_KEY = 'parmanu_theme_v1';

export type AnalystTheme = 'light' | 'dark';

export interface PivotLineageInfo {
  parentScanId: string;
  parentTarget: string;
  parentTargetType: TargetType;
  pivotedAt: string;
}

export function loadStoredTheme(): AnalystTheme {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return raw === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function saveStoredTheme(theme: AnalystTheme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore storage quota errors
  }
}

export function loadScanAnnotations(
  scanId: string
): Record<string, ResultAnnotation> {
  if (!scanId) return {};
  try {
    const raw = localStorage.getItem(`${ANNOTATIONS_KEY_PREFIX}${scanId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveResultAnnotation(
  scanId: string,
  resultId: string,
  patch: { tag?: EvidenceTag | null; note?: string }
): Record<string, ResultAnnotation> {
  const current = loadScanAnnotations(scanId);
  const existing = current[resultId] || { updatedAt: new Date().toISOString() };
  const nextItem: ResultAnnotation = {
    ...existing,
    ...(patch.tag === null ? { tag: undefined } : patch.tag ? { tag: patch.tag } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    updatedAt: new Date().toISOString(),
  };

  if (!nextItem.tag && (!nextItem.note || !nextItem.note.trim())) {
    delete current[resultId];
  } else {
    current[resultId] = nextItem;
  }

  try {
    localStorage.setItem(`${ANNOTATIONS_KEY_PREFIX}${scanId}`, JSON.stringify(current));
  } catch {
    // ignore
  }
  return { ...current };
}

export function loadCaseNote(scanId: string): string {
  if (!scanId) return '';
  try {
    return localStorage.getItem(`${CASE_NOTES_KEY_PREFIX}${scanId}`) || '';
  } catch {
    return '';
  }
}

export function saveCaseNote(scanId: string, note: string): void {
  if (!scanId) return;
  try {
    localStorage.setItem(`${CASE_NOTES_KEY_PREFIX}${scanId}`, note);
  } catch {
    // ignore
  }
}

export function loadPivotLineage(scanId: string): PivotLineageInfo | null {
  if (!scanId) return null;
  try {
    const raw = localStorage.getItem(PIVOT_LINEAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, PivotLineageInfo>;
    return map[scanId] || null;
  } catch {
    return null;
  }
}

export function savePivotLineage(
  childScanId: string,
  info: PivotLineageInfo
): void {
  if (!childScanId) return;
  try {
    const raw = localStorage.getItem(PIVOT_LINEAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, PivotLineageInfo>) : {};
    map[childScanId] = info;
    localStorage.setItem(PIVOT_LINEAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function loadWebhookConfigs(): WebhookConfig[] {
  try {
    const raw = localStorage.getItem(WEBHOOKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveWebhookConfigs(configs: WebhookConfig[]): void {
  try {
    localStorage.setItem(WEBHOOKS_KEY, JSON.stringify(configs));
  } catch {
    // ignore
  }
}

export function loadAutoWebhookSettings(): AutoWebhookSettings {
  try {
    const raw = localStorage.getItem(AUTO_WEBHOOK_KEY);
    if (!raw) {
      return {
        enabled: false,
        provider: 'slack',
        url: '',
        onlyOnNewExposures: true,
      };
    }
    const parsed = JSON.parse(raw) as Partial<AutoWebhookSettings>;
    return {
      enabled: Boolean(parsed.enabled),
      provider:
        parsed.provider === 'discord' || parsed.provider === 'json'
          ? parsed.provider
          : 'slack',
      url: typeof parsed.url === 'string' ? parsed.url : '',
      onlyOnNewExposures:
        parsed.onlyOnNewExposures !== undefined
          ? Boolean(parsed.onlyOnNewExposures)
          : true,
    };
  } catch {
    return {
      enabled: false,
      provider: 'slack',
      url: '',
      onlyOnNewExposures: true,
    };
  }
}

export function saveAutoWebhookSettings(settings: AutoWebhookSettings): void {
  try {
    localStorage.setItem(AUTO_WEBHOOK_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export function loadEvidenceBoard(scanId: string): EvidenceBoardPin[] {
  if (!scanId) return [];
  try {
    const raw = localStorage.getItem(`${EVIDENCE_BOARD_KEY_PREFIX}${scanId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EvidenceBoardPin[]) : [];
  } catch {
    return [];
  }
}

export function saveEvidenceBoard(
  scanId: string,
  pins: EvidenceBoardPin[]
): void {
  if (!scanId) return;
  try {
    localStorage.setItem(
      `${EVIDENCE_BOARD_KEY_PREFIX}${scanId}`,
      JSON.stringify(pins)
    );
  } catch {
    // ignore
  }
}

export function toggleEvidencePin(
  scanId: string,
  pin: Omit<EvidenceBoardPin, 'id' | 'scanId' | 'pinnedAt'>
): { pins: EvidenceBoardPin[]; added: boolean } {
  const current = loadEvidenceBoard(scanId);
  const existing = current.find(
    (p) => p.kind === pin.kind && p.refId === pin.refId
  );
  if (existing) {
    const next = current.filter((p) => p.id !== existing.id);
    saveEvidenceBoard(scanId, next);
    return { pins: next, added: false };
  }
  const newPin: EvidenceBoardPin = {
    ...pin,
    id: `pin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    scanId,
    pinnedAt: new Date().toISOString(),
  };
  const next = [newPin, ...current];
  saveEvidenceBoard(scanId, next);
  return { pins: next, added: true };
}

export function updateEvidencePin(
  scanId: string,
  pinId: string,
  patch: Partial<Pick<EvidenceBoardPin, 'priority' | 'analystNote'>>
): EvidenceBoardPin[] {
  const current = loadEvidenceBoard(scanId);
  const next = current.map((p) => (p.id === pinId ? { ...p, ...patch } : p));
  saveEvidenceBoard(scanId, next);
  return next;
}

export function removeEvidencePin(
  scanId: string,
  pinId: string
): EvidenceBoardPin[] {
  const current = loadEvidenceBoard(scanId);
  const next = current.filter((p) => p.id !== pinId);
  saveEvidenceBoard(scanId, next);
  return next;
}

export function maskPiiString(value: string, enabled: boolean): string {
  if (!enabled || !value) return value;

  // Mask emails
  let out = value.replace(
    /([a-zA-Z0-9._%+-])([a-zA-Z0-9._%+-]*)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
    (_m, first: string, rest: string, domain: string) => {
      const domainParts = domain.split('.');
      const maskedDom =
        domainParts[0].length > 2
          ? `${domainParts[0].slice(0, 2)}***`
          : '***';
      return `${first}${'•'.repeat(Math.min(Math.max(rest.length, 3), 6))}@${maskedDom}.${domainParts.slice(1).join('.')}`;
    }
  );

  // Mask phone numbers (+919876543210 or 10+ digits)
  out = out.replace(/(\+?\d{1,3}[\s-]?)(\d[\d\s-]{4,})(\d{2})/g, (_m, p1: string, mid: string, last: string) => {
    const digitCount = mid.replace(/\D/g, '').length;
    if (digitCount < 4) return _m;
    return `${p1}${'•'.repeat(Math.min(digitCount, 6))}${last}`;
  });

  return out;
}

export function maskIdentifierLabel(
  value: string,
  targetType: TargetType,
  enabled: boolean
): string {
  if (!enabled || !value) return value;
  const emailOrPhoneMasked = maskPiiString(value, true);
  if (emailOrPhoneMasked !== value) return emailOrPhoneMasked;
  if (targetType === 'ip') {
    const parts = value.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.•••.•••`;
  }
  if (value.length <= 3) return '•••';
  return `${value.slice(0, 2)}${'•'.repeat(Math.min(value.length - 2, 6))}`;
}

export function buildInvestigationRedactedCopy(
  inv: InvestigationRecord,
  enabled: boolean
): InvestigationRecord {
  if (!enabled) return inv;
  const redactTarget = maskIdentifierLabel(inv.target, inv.targetType, true);
  return {
    ...inv,
    target: redactTarget,
    email: inv.email ? maskPiiString(inv.email, true) : '',
    results: inv.results.map((r) => ({
      ...r,
      handle: r.handle ? maskPiiString(r.handle, true) : r.handle,
      displayName: r.displayName ? maskPiiString(r.displayName, true) : r.displayName,
      summary: r.summary ? maskPiiString(r.summary, true) : r.summary,
      linkedInfo: r.linkedInfo?.map((item) => maskPiiString(item, true)),
      displayFields: r.displayFields?.map((f) => ({
        ...f,
        value: maskPiiString(f.value, true),
      })),
    })),
    breachedAccounts: inv.breachedAccounts.map((b) => ({
      ...b,
      summary: b.summary ? maskPiiString(b.summary, true) : b.summary,
    })),
    aiSummary: inv.aiSummary
      ? {
          ...inv.aiSummary,
          executiveBrief: maskPiiString(inv.aiSummary.executiveBrief, true),
          keyTakeaways: inv.aiSummary.keyTakeaways.map((t) => maskPiiString(t, true)),
        }
      : undefined,
  };
}
