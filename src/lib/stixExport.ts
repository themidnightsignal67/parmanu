import type { GoogleDorkResponse, InvestigationRecord } from '@/src/types/investigation';

function deterministicUuid(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const hex =
    (h1 >>> 0).toString(16).padStart(8, '0') +
    (h2 >>> 0).toString(16).padStart(8, '0') +
    ((h1 ^ h2) >>> 0).toString(16).padStart(8, '0') +
    (((h1 + h2) >>> 0)).toString(16).padStart(8, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function buildStix21Bundle(
  investigation: InvestigationRecord,
  dorkReport?: GoogleDorkResponse | null
) {
  const now = investigation.completedAt || investigation.createdAt || new Date().toISOString();
  const producerIdentityId = `identity--${deterministicUuid('parmanu-osint-engine')}`;
  const targetIdentityId = `identity--${deterministicUuid(`target:${investigation.targetType}:${investigation.target}`)}`;

  const objects: Array<Record<string, unknown>> = [
    {
      type: 'identity',
      spec_version: '2.1',
      id: producerIdentityId,
      created: now,
      modified: now,
      name: 'Parmanu OSINT Intelligence Engine',
      identity_class: 'system',
    },
    {
      type: 'identity',
      spec_version: '2.1',
      id: targetIdentityId,
      created: now,
      modified: now,
      name: investigation.target,
      identity_class: investigation.targetType === 'domain' ? 'organization' : 'individual',
      description: `Authorized OSINT subject (${investigation.targetType}) · Scan ${investigation.scanId}`,
    },
  ];

  const foundResults = investigation.results.filter((r) => r.status === 'found');
  for (const item of foundResults.slice(0, 80)) {
    const obsId = `observed-data--${deterministicUuid(`${investigation.scanId}:res:${item.id}`)}`;
    objects.push({
      type: 'observed-data',
      spec_version: '2.1',
      id: obsId,
      created_by_ref: producerIdentityId,
      created: now,
      modified: now,
      first_observed: item.firstSeen || now,
      last_observed: item.lastSeen || now,
      number_observed: 1,
      object_refs: [],
      x_parmanu_platform: item.platform,
      x_parmanu_category: item.category,
      x_parmanu_finding_kind: item.findingKind,
      x_parmanu_handle: item.handle,
      x_parmanu_url: item.url,
      x_parmanu_summary: item.summary,
    });

    objects.push({
      type: 'relationship',
      spec_version: '2.1',
      id: `relationship--${deterministicUuid(`rel:${targetIdentityId}:${obsId}`)}`,
      created_by_ref: producerIdentityId,
      created: now,
      modified: now,
      relationship_type: 'related-to',
      source_ref: targetIdentityId,
      target_ref: obsId,
    });
  }

  for (const breach of investigation.breachedAccounts.slice(0, 50)) {
    const indId = `indicator--${deterministicUuid(`${investigation.scanId}:breach:${breach.id}`)}`;
    objects.push({
      type: 'indicator',
      spec_version: '2.1',
      id: indId,
      created_by_ref: producerIdentityId,
      created: now,
      modified: now,
      name: `Breach Exposure: ${breach.breachName}`,
      description: `${breach.summary || 'Public breach record'} · Data classes: ${breach.dataClasses.join(', ')}`,
      indicator_types: ['compromised'],
      pattern_type: 'stix',
      pattern: `[email-addr:value = '${investigation.target.replace(/'/g, '')}']`,
      valid_from: breach.date || now,
      labels: [breach.severity, ...(breach.domain ? [breach.domain] : [])],
    });
    objects.push({
      type: 'relationship',
      spec_version: '2.1',
      id: `relationship--${deterministicUuid(`rel:${indId}:${targetIdentityId}`)}`,
      created_by_ref: producerIdentityId,
      created: now,
      modified: now,
      relationship_type: 'indicates',
      source_ref: indId,
      target_ref: targetIdentityId,
    });
  }

  if (dorkReport && dorkReport.hits.length > 0) {
    for (const hit of dorkReport.hits.slice(0, 35)) {
      const noteId = `note--${deterministicUuid(`${investigation.scanId}:dork:${hit.id}`)}`;
      objects.push({
        type: 'note',
        spec_version: '2.1',
        id: noteId,
        created_by_ref: producerIdentityId,
        created: dorkReport.executedAt || now,
        modified: dorkReport.executedAt || now,
        abstract: `[${hit.fileType}] ${hit.title}`,
        content: `${hit.url}\n${hit.snippet}\nEngine: ${hit.sourceEngine}`,
        object_refs: [targetIdentityId],
      });
    }
  }

  return {
    type: 'bundle',
    id: `bundle--${deterministicUuid(`bundle:${investigation.scanId}`)}`,
    objects,
  };
}
