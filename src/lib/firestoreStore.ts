import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  FieldValue,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  db,
  handleFirestoreError,
  logFirestoreError,
  OperationType,
} from '@/src/lib/firebase';
import type {
  CaseSnapshot,
  InvestigationRecord,
  MonitoringRule,
  TeamMemberRecord,
  UserProfileRecord,
} from '@/src/types/investigation';

function stripUndefined<T>(input: T): T {
  if (input instanceof FieldValue) {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((v) => stripUndefined(v)) as unknown as T;
  }
  if (input && typeof input === 'object') {
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) {
      return input;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefined(v);
      }
    }
    return out as T;
  }
  return input;
}

function compactValueForFirestore(val: unknown, depth = 0): unknown {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'string') {
    return val.length > 2400 ? `${val.slice(0, 2400)}…` : val;
  }
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  if (depth >= 4) return undefined;
  if (Array.isArray(val)) {
    return val
      .slice(0, 35)
      .map((item) => compactValueForFirestore(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (k === 'dorkReport') continue;
      const compacted = compactValueForFirestore(v, depth + 1);
      if (compacted !== undefined) {
        out[k] = compacted;
      }
    }
    return out;
  }
  return undefined;
}

function sanitizeInvestigationPayload(
  record: InvestigationRecord,
  user: User
) {
  const statusRank = (r: InvestigationRecord['results'][number]): number => {
    if (r.status === 'found' && (r.findingKind === 'breached' || r.findingKind === 'leaked')) return 0;
    if (r.status === 'found') return 1;
    if (r.status === 'not_found') return 2;
    if (r.status === 'not_checked') return 3;
    return 4;
  };

  const prioritizedResults = [...record.results].sort(
    (a, b) => statusRank(a) - statusRank(b)
  );

  const safeResults = prioritizedResults.slice(0, 100).map((r) => ({
    ...r,
    summary: r.summary ? r.summary.slice(0, 600) : undefined,
    artifacts: r.artifacts
      ? r.artifacts.slice(0, 25).map((a) => ({
          ...a,
          summary: a.summary ? a.summary.slice(0, 450) : undefined,
          details: (compactValueForFirestore(a.details, 1) || {}) as Record<
            string,
            unknown
          >,
        }))
      : undefined,
    details: r.details
      ? (compactValueForFirestore(r.details, 0) as Record<string, unknown>)
      : undefined,
  }));

  const normalizedCollabs = (record.collaboratorEmails || [])
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);

  // Enforce strict <720 KB payload budget to stay safely under Firestore's 1 MB document limit
  const MAX_JSON_BYTES = 720_000;
  let finalResults = safeResults;
  const estimateBytes = (resultsList: typeof safeResults): number => {
    try {
      return JSON.stringify({
        results: resultsList,
        breaches: record.breachedAccounts.slice(0, 100),
        photos: record.profilePhotos.slice(0, 50),
        geo: record.geoMarkers.slice(0, 50),
        ai: record.aiSummary || null,
      }).length;
    } catch {
      return 0;
    }
  };

  if (estimateBytes(finalResults) > MAX_JSON_BYTES) {
    finalResults = finalResults.map((r) => ({
      ...r,
      artifacts: r.artifacts ? r.artifacts.slice(0, 8) : undefined,
      details: r.status === 'found' ? r.details : undefined,
    }));
  }
  if (estimateBytes(finalResults) > MAX_JSON_BYTES) {
    finalResults = finalResults.slice(0, 60).map((r) => ({
      ...r,
      artifacts: r.artifacts ? r.artifacts.slice(0, 3) : undefined,
      details: undefined,
    }));
  }
  if (estimateBytes(finalResults) > MAX_JSON_BYTES) {
    finalResults = finalResults.slice(0, 35).map((r) => ({
      ...r,
      artifacts: undefined,
      details: undefined,
    }));
  }

  const safeOwnerEmail = (
    record.ownerEmail ||
    user.email ||
    `${user.uid}@parmanu.local`
  )
    .trim()
    .toLowerCase()
    .slice(0, 254);

  const safeTarget = (record.target || 'target').trim().slice(0, 254);
  const safeSelectedTools =
    Array.isArray(record.selectedTools) && record.selectedTools.length > 0
      ? record.selectedTools.slice(0, 8)
      : (['sherlock'] as InvestigationRecord['selectedTools']);

  const base: Record<string, unknown> = {
    scanId: record.scanId,
    ownerId: record.ownerId || user.uid,
    ownerEmail: safeOwnerEmail.length >= 3 ? safeOwnerEmail : `${user.uid}@parmanu.local`,
    collaboratorEmails: normalizedCollabs,
    target: safeTarget.length >= 2 ? safeTarget : safeTarget.padEnd(2, '_'),
    targetType: record.targetType,
    email: (record.email || '').slice(0, 254),
    status: record.status,
    durationMs: Math.max(0, record.durationMs || 0),
    createdAtIso: record.createdAt.slice(0, 64),
    selectedTools: safeSelectedTools,
    summary: record.summary || {
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
    profilePhotos: (record.profilePhotos || []).slice(0, 50),
    breachedAccounts: (record.breachedAccounts || []).slice(0, 100),
    geoMarkers: (record.geoMarkers || []).slice(0, 50),
    toolExecutions: (record.toolExecutions || []).slice(0, 10),
    results: finalResults,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (record.completedAt) {
    base.completedAtIso = record.completedAt.slice(0, 64);
  }
  if (record.aiSummary) {
    base.aiSummary = record.aiSummary;
  }

  return stripUndefined(base);
}

function mapDocToInvestigation(
  raw: Record<string, unknown>
): InvestigationRecord {
  return {
    scanId: String(raw.scanId || ''),
    ownerId: typeof raw.ownerId === 'string' ? raw.ownerId : undefined,
    ownerEmail: typeof raw.ownerEmail === 'string' ? raw.ownerEmail : undefined,
    collaboratorEmails: Array.isArray(raw.collaboratorEmails)
      ? (raw.collaboratorEmails as string[])
      : [],
    target: String(raw.target || ''),
    targetType: raw.targetType as InvestigationRecord['targetType'],
    email: String(raw.email || ''),
    createdAt:
      typeof raw.createdAtIso === 'string'
        ? raw.createdAtIso
        : new Date().toISOString(),
    completedAt:
      typeof raw.completedAtIso === 'string' ? raw.completedAtIso : undefined,
    durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : 0,
    status: raw.status as InvestigationRecord['status'],
    selectedTools: Array.isArray(raw.selectedTools)
      ? (raw.selectedTools as InvestigationRecord['selectedTools'])
      : [],
    summary: raw.summary as InvestigationRecord['summary'],
    profilePhotos: Array.isArray(raw.profilePhotos)
      ? (raw.profilePhotos as InvestigationRecord['profilePhotos'])
      : [],
    breachedAccounts: Array.isArray(raw.breachedAccounts)
      ? (raw.breachedAccounts as InvestigationRecord['breachedAccounts'])
      : [],
    geoMarkers: Array.isArray(raw.geoMarkers)
      ? (raw.geoMarkers as InvestigationRecord['geoMarkers'])
      : [],
    toolExecutions: Array.isArray(raw.toolExecutions)
      ? (raw.toolExecutions as InvestigationRecord['toolExecutions'])
      : [],
    results: Array.isArray(raw.results)
      ? (raw.results as InvestigationRecord['results'])
      : [],
    aiSummary: raw.aiSummary as InvestigationRecord['aiSummary'],
  };
}

export async function ensureUserProfile(user: User): Promise<UserProfileRecord> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const displayName = (
    user.displayName?.trim() ||
    user.email?.split('@')[0]?.trim() ||
    'Parmanu Analyst'
  ).slice(0, 128);
  const rawEmail = (user.email || '').trim();
  const email = (rawEmail.length >= 3 ? rawEmail : `${user.uid}@parmanu.local`).slice(0, 254);
  const photoURL = (user.photoURL || '').trim().slice(0, 512);

  // Ensure the Firebase Auth ID token is ready before issuing the initial Firestore RPC
  await user.getIdToken().catch(() => undefined);

  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (!snap.exists()) {
    const initial = stripUndefined({
      uid: user.uid,
      email,
      displayName,
      photoURL: photoURL || undefined,
      // Satisfy immutable create rule on /users/{uid}; workspace queries are unlimited.
      credits: 50,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    try {
      await setDoc(ref, initial);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
    return {
      uid: user.uid,
      email,
      displayName,
      photoURL: photoURL || undefined,
    };
  }

  const data = snap.data();
  return {
    uid: user.uid,
    email: String(data.email || email),
    displayName: String(data.displayName || displayName),
    photoURL:
      typeof data.photoURL === 'string' && data.photoURL
        ? data.photoURL
        : photoURL || undefined,
  };
}

export function subscribeUserProfile(
  uid: string,
  onData: (profile: UserProfileRecord) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      onData({
        uid: String(d.uid || uid),
        email: String(d.email || ''),
        displayName: String(d.displayName || 'Analyst'),
        photoURL: typeof d.photoURL === 'string' ? d.photoURL : undefined,
      });
    },
    (error) => {
      const logged = logFirestoreError(error, OperationType.GET, path);
      onError?.(logged);
    }
  );
}

export async function saveInvestigationToFirestore(
  record: InvestigationRecord,
  user: User,
  options?: { isNew?: boolean }
) {
  const path = `investigations/${record.scanId}`;
  const ref = doc(db, 'investigations', record.scanId);
  const payload = sanitizeInvestigationPayload(record, user);

  if (options?.isNew) {
    try {
      await setDoc(ref, payload);
      return;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }

  const updateFields = stripUndefined({
    status: payload.status,
    durationMs: payload.durationMs,
    ...(payload.completedAtIso !== undefined
      ? { completedAtIso: payload.completedAtIso }
      : {}),
    summary: payload.summary,
    profilePhotos: payload.profilePhotos,
    breachedAccounts: payload.breachedAccounts,
    geoMarkers: payload.geoMarkers,
    toolExecutions: payload.toolExecutions,
    results: payload.results,
    ...(payload.aiSummary !== undefined
      ? { aiSummary: payload.aiSummary }
      : {}),
    updatedAt: serverTimestamp(),
  });

  try {
    await updateDoc(ref, updateFields);
  } catch (error) {
    const code = (error as { code?: string })?.code || '';
    const msg = error instanceof Error ? error.message : String(error || '');
    const maybeMissing =
      code === 'not-found' ||
      code === 'permission-denied' ||
      /no document to update/i.test(msg);
    if (maybeMissing) {
      const snap = await getDoc(ref).catch(() => null);
      if (!snap || !snap.exists()) {
        try {
          await setDoc(ref, payload);
          return;
        } catch (createErr) {
          handleFirestoreError(createErr, OperationType.CREATE, path);
        }
      }
    }
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

async function runUpdateWithMissingDocRetry(
  ref: ReturnType<typeof doc>,
  data: Record<string, unknown>
): Promise<void> {
  try {
    await updateDoc(ref, data);
  } catch (err) {
    const code = (err as { code?: string })?.code || '';
    const msg = err instanceof Error ? err.message : String(err || '');
    if (code === 'not-found' || /no document to update/i.test(msg)) {
      await new Promise((r) => setTimeout(r, 400));
      const snap = await getDoc(ref).catch(() => null);
      if (snap && snap.exists()) {
        await updateDoc(ref, data);
      }
      return;
    }
    throw err;
  }
}

export async function updateInvestigationAiSummary(
  scanId: string,
  aiSummary: InvestigationRecord['aiSummary']
) {
  if (!aiSummary) return;
  const path = `investigations/${scanId}`;
  try {
    await runUpdateWithMissingDocRetry(doc(db, 'investigations', scanId), {
      aiSummary: stripUndefined(aiSummary),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateInvestigationCollaborators(
  scanId: string,
  emails: string[]
) {
  const path = `investigations/${scanId}`;
  try {
    await runUpdateWithMissingDocRetry(doc(db, 'investigations', scanId), {
      collaboratorEmails: emails
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 10),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function fetchInvestigationFromFirestore(
  scanId: string
): Promise<InvestigationRecord | null> {
  const path = `investigations/${scanId}`;
  try {
    const snap = await getDoc(doc(db, 'investigations', scanId));
    if (!snap.exists()) return null;
    return mapDocToInvestigation(snap.data());
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeInvestigations(
  uid: string,
  userEmail: string,
  onData: (list: InvestigationRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'investigations';
  let owned: InvestigationRecord[] = [];
  let shared: InvestigationRecord[] = [];

  const emit = () => {
    const merged = new Map<string, InvestigationRecord>();
    for (const item of [...owned, ...shared]) {
      merged.set(item.scanId, item);
    }
    const sorted = Array.from(merged.values()).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    onData(sorted);
  };

  const unsubOwned = onSnapshot(
    query(collection(db, 'investigations'), where('ownerId', '==', uid)),
    (snap) => {
      owned = snap.docs.map((d) => mapDocToInvestigation(d.data()));
      emit();
    },
    (error) => {
      const logged = logFirestoreError(error, OperationType.LIST, path);
      onError?.(logged);
    }
  );

  let unsubShared: Unsubscribe | null = null;
  const normalizedUserEmail = userEmail.trim().toLowerCase();
  if (normalizedUserEmail) {
    unsubShared = onSnapshot(
      query(
        collection(db, 'investigations'),
        where('collaboratorEmails', 'array-contains', normalizedUserEmail)
      ),
      (snap) => {
        shared = snap.docs.map((d) => mapDocToInvestigation(d.data()));
        emit();
      },
      (error) => {
        console.warn('Shared investigations subscription paused:', error);
      }
    );
  }

  return () => {
    unsubOwned();
    unsubShared?.();
  };
}

export function subscribeMonitors(
  uid: string,
  onData: (rules: MonitoringRule[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'monitors';
  return onSnapshot(
    query(collection(db, 'monitors'), where('ownerId', '==', uid)),
    (snap) => {
      const rules = snap.docs
        .map((d) => d.data() as MonitoringRule)
        .sort(
          (a, b) =>
            new Date(b.lastCheckedAt).getTime() -
            new Date(a.lastCheckedAt).getTime()
        );
      onData(rules);
    },
    (error) => {
      const logged = logFirestoreError(error, OperationType.LIST, path);
      onError?.(logged);
    }
  );
}

export async function createMonitorInFirestore(
  rule: MonitoringRule,
  uid: string
) {
  const path = `monitors/${rule.id}`;
  try {
    await setDoc(
      doc(db, 'monitors', rule.id),
      stripUndefined({
        ...rule,
        ownerId: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function toggleMonitorInFirestore(ruleId: string, active: boolean) {
  const path = `monitors/${ruleId}`;
  try {
    await updateDoc(doc(db, 'monitors', ruleId), {
      active,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function recordMonitorCheckInFirestore(
  ruleId: string,
  lastScanId: string,
  alertsCount: number
) {
  const path = `monitors/${ruleId}`;
  try {
    await updateDoc(doc(db, 'monitors', ruleId), {
      lastCheckedAt: new Date().toISOString(),
      lastScanId,
      alertsCount,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteMonitorInFirestore(ruleId: string) {
  const path = `monitors/${ruleId}`;
  try {
    await deleteDoc(doc(db, 'monitors', ruleId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeSnapshots(
  uid: string,
  onData: (snaps: CaseSnapshot[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'snapshots';
  return onSnapshot(
    query(collection(db, 'snapshots'), where('ownerId', '==', uid)),
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as CaseSnapshot)
        .sort(
          (a, b) =>
            new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()
        );
      onData(list);
    },
    (error) => {
      const logged = logFirestoreError(error, OperationType.LIST, path);
      onError?.(logged);
    }
  );
}

export async function saveSnapshotToFirestore(
  snapshot: CaseSnapshot,
  uid: string
) {
  const path = `snapshots/${snapshot.id}`;
  try {
    await setDoc(
      doc(db, 'snapshots', snapshot.id),
      stripUndefined({
        ...snapshot,
        ownerId: uid,
        createdAt: serverTimestamp(),
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeTeamMembers(
  uid: string,
  onData: (members: TeamMemberRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'teamMembers';
  return onSnapshot(
    query(collection(db, 'teamMembers'), where('ownerId', '==', uid)),
    (snap) => {
      onData(snap.docs.map((d) => d.data() as TeamMemberRecord));
    },
    (error) => {
      const logged = logFirestoreError(error, OperationType.LIST, path);
      onError?.(logged);
    }
  );
}

export async function addTeamMemberToFirestore(
  member: TeamMemberRecord,
  uid: string
) {
  const path = `teamMembers/${member.id}`;
  try {
    await setDoc(
      doc(db, 'teamMembers', member.id),
      stripUndefined({
        ...member,
        ownerId: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateTeamMemberRoleInFirestore(
  memberId: string,
  role: TeamMemberRecord['role']
) {
  const path = `teamMembers/${memberId}`;
  try {
    await updateDoc(doc(db, 'teamMembers', memberId), {
      role,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteTeamMemberInFirestore(memberId: string) {
  const path = `teamMembers/${memberId}`;
  try {
    await deleteDoc(doc(db, 'teamMembers', memberId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
