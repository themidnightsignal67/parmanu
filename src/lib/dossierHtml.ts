import type {
  DossierOptions,
  EvidenceBoardPin,
  GhuntIntelligenceData,
  GoogleDorkResponse,
  InvestigationRecord,
  ResultAnnotation,
} from '@/src/types/investigation';
import { buildInvestigationRedactedCopy, maskPiiString } from './annotationsStore';

function esc(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generateDossierHtml(
  rawInvestigation: InvestigationRecord,
  options: DossierOptions,
  annotations: Record<string, ResultAnnotation>,
  caseNote: string,
  dorkReport?: GoogleDorkResponse | null,
  evidencePins: EvidenceBoardPin[] = []
): string {
  const inv = buildInvestigationRedactedCopy(rawInvestigation, options.redactPii);
  const foundResults = inv.results.filter((r) => r.status === 'found');
  const noteText = options.redactPii ? maskPiiString(caseNote, true) : caseNote;
  const siteHost =
    typeof window !== 'undefined' && window.location?.host
      ? window.location.host
      : 'parmanu.osint';
  const ghuntRes = inv.results.find((r) => r.tool === 'ghunt');
  const ghunt = ghuntRes?.details?.ghuntIntel as GhuntIntelligenceData | undefined;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Parmanu Intelligence Dossier — ${esc(inv.target)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; color: #0f172a; margin: 0; padding: 32px; background: #fff; line-height: 1.5; }
  .header { border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; gap: 16px; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: #475569; margin: 24px 0 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
  .meta { font-size: 12px; color: #475569; font-family: ui-monospace, monospace; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
  .stat { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; }
  .stat-val { font-size: 20px; font-weight: 700; }
  .stat-lbl { font-size: 11px; color: #64748b; }
  .card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; margin-bottom: 10px; page-break-inside: avoid; }
  .badge { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; background: #f1f5f9; color: #0f172a; margin-right: 6px; }
  .high { background: #ffe4e6; color: #be123c; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  th { font-size: 11px; color: #64748b; text-transform: uppercase; }
  @media print { body { padding: 16px; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="meta">PARMANU INTELLIGENCE · MIDNIGHT INDUSTRIES (${esc(siteHost)}) · AUTHORIZED OSINT CASE DOSSIER</div>
      <h1>${esc(inv.target)}</h1>
      <div class="meta">Type: ${esc(inv.targetType.toUpperCase())} · Scan ID: ${esc(inv.scanId)} · Generated: ${esc(new Date().toISOString().slice(0, 19).replace('T', ' '))} UTC</div>
    </div>
    <div class="meta" style="text-align:right">
      ${options.redactPii ? '<div>PII REDACTION: ACTIVE</div>' : '<div>UNREDACTED ANALYST COPY</div>'}
      <div>Risk Posture: ${esc(inv.aiSummary?.riskPosture || 'Evaluated')}</div>
    </div>
  </div>

  ${options.includeSummary ? `
  <div class="stats">
    <div class="stat"><div class="stat-val">${inv.summary.found}</div><div class="stat-lbl">Verified Matches</div></div>
    <div class="stat"><div class="stat-val">${inv.summary.breached}</div><div class="stat-lbl">Breached Records</div></div>
    <div class="stat"><div class="stat-val">${inv.summary.registered}</div><div class="stat-lbl">Registered Accounts</div></div>
    <div class="stat"><div class="stat-val">${inv.geoMarkers.length}</div><div class="stat-lbl">Geo Signals</div></div>
  </div>` : ''}

  ${options.includeExecutiveBrief && inv.aiSummary ? `
  <h2>Executive Intelligence Brief</h2>
  <div class="card">
    <p style="margin:0 0 8px; font-size:13px;">${esc(inv.aiSummary.executiveBrief)}</p>
    ${inv.aiSummary.keyTakeaways.length > 0 ? `<ul style="margin:8px 0 0; padding-left:18px; font-size:12px;">${inv.aiSummary.keyTakeaways.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>` : ''}
  </div>` : ''}

  ${options.includeNotes && noteText.trim() ? `
  <h2>Analyst Case Notes</h2>
  <div class="card" style="font-size:12px; white-space:pre-wrap;">${esc(noteText)}</div>` : ''}

  ${ghunt ? `
  <h2>Google Account Finder (GHunt)</h2>
  <table>
    <tbody>
      <tr><th>Query</th><td>${esc(ghunt.email)}</td><th>Account Type</th><td>${esc(ghunt.accountType)}</td></tr>
      <tr><th>Photo / Gaia ID</th><td class="meta">${esc(ghunt.gaiaId || 'Not exposed')}</td><th>Last Update</th><td class="meta">${esc(ghunt.lastUpdated ? String(ghunt.lastUpdated).slice(0, 10) : 'Not exposed')}</td></tr>
      <tr><th>Google Maps</th><td class="meta" colspan="3">${esc(ghunt.gaiaId ? `https://www.google.com/maps/contrib/${ghunt.gaiaId}` : ghunt.profileUrl)}</td></tr>
      <tr><th>Google Calendar</th><td class="meta" colspan="3">${esc(ghunt.calendarEmbedUrl || `https://calendar.google.com/calendar/u/0/embed?src=${encodeURIComponent(ghunt.email)}`)}</td></tr>
      <tr><th>Google Plus Archive</th><td class="meta" colspan="3">${esc(ghunt.googlePlusArchiveUrl || (ghunt.gaiaId ? `https://web.archive.org/web/*/plus.google.com/${ghunt.gaiaId}*` : 'Not available'))}</td></tr>
    </tbody>
  </table>` : ''}

  ${options.includeBreaches && inv.breachedAccounts.length > 0 ? `
  <h2>Breached Accounts (${inv.breachedAccounts.length})</h2>
  <table>
    <thead><tr><th>Service</th><th>Severity</th><th>Date</th><th>Exposed Data Classes</th></tr></thead>
    <tbody>
      ${inv.breachedAccounts.map((b) => `
      <tr>
        <td><strong>${esc(b.breachName)}</strong><br/><span style="color:#64748b">${esc(b.domain || '')}</span></td>
        <td><span class="badge ${b.severity === 'high' ? 'high' : ''}">${esc(b.severity.toUpperCase())}</span></td>
        <td>${esc(b.date ? b.date.slice(0, 10) : b.relativeTime)}</td>
        <td>${esc(b.dataClasses.join(', ') || 'Email record')}</td>
      </tr>`).join('')}
    </tbody>
  </table>` : ''}

  ${options.includeResults ? `
  <h2>Verified Platform & Infrastructure Findings (${foundResults.length})</h2>
  ${foundResults.map((r) => {
    const ann = annotations[r.id];
    return `
    <div class="card">
      <div style="display:flex; justify-content:space-between; gap:8px;">
        <div>
          <strong>${esc(r.platform)}</strong>
          <span class="badge">${esc(r.tool)}</span>
          <span class="badge">${esc(r.findingKind)}</span>
          ${ann?.tag ? `<span class="badge">${esc(ann.tag.replace('_', ' ').toUpperCase())}</span>` : ''}
        </div>
        <span class="meta">${esc(r.handle || '')}</span>
      </div>
      <div style="font-size:12px; color:#334155; margin-top:4px;">${esc(r.summary || '')}</div>
      ${r.url ? `<div class="meta" style="margin-top:4px;">${esc(r.url)}</div>` : ''}
      ${options.includeNotes && ann?.note ? `<div style="font-size:11px; color:#4338ca; margin-top:6px;">Analyst Note: ${esc(options.redactPii ? maskPiiString(ann.note, true) : ann.note)}</div>` : ''}
    </div>`;
  }).join('')}` : ''}

  ${options.includeDorks && dorkReport && dorkReport.hits.length > 0 ? `
  <h2>Google Dorking & Indexed Files (${dorkReport.hits.length})</h2>
  <table>
    <thead><tr><th>Format</th><th>Title / URL</th><th>Source Engine</th></tr></thead>
    <tbody>
      ${dorkReport.hits.slice(0, 50).map((h) => `
      <tr>
        <td><span class="badge">${esc(h.fileType)}</span></td>
        <td><strong>${esc(options.redactPii ? maskPiiString(h.title, true) : h.title)}</strong><br/><span class="meta">${esc(h.url)}</span></td>
        <td>${esc(h.sourceEngine)}</td>
      </tr>`).join('')}
    </tbody>
  </table>` : ''}

  ${options.includeEvidenceBoard && evidencePins.length > 0 ? `
  <h2>Pinned Evidence Board (${evidencePins.length})</h2>
  ${evidencePins.map((pin) => `
  <div class="card">
    <div>
      <span class="badge ${pin.priority === 'critical' ? 'high' : ''}">${esc(pin.priority.toUpperCase())}</span>
      <span class="badge">${esc(pin.kind.toUpperCase())}</span>
      <strong>${esc(options.redactPii ? maskPiiString(pin.title, true) : pin.title)}</strong>
    </div>
    <div style="font-size:12px; color:#334155; margin-top:4px;">${esc(options.redactPii ? maskPiiString(pin.subtitle, true) : pin.subtitle)}</div>
    ${pin.url ? `<div class="meta" style="margin-top:4px;">${esc(pin.url)}</div>` : ''}
    ${pin.analystNote ? `<div style="font-size:11px; color:#4338ca; margin-top:6px;">Triage Note: ${esc(options.redactPii ? maskPiiString(pin.analystNote, true) : pin.analystNote)}</div>` : ''}
  </div>`).join('')}` : ''}
</body>
</html>`;
}
