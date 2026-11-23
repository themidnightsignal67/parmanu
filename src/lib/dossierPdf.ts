import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  DossierOptions,
  EvidenceBoardPin,
  GhuntIntelligenceData,
  GoogleDorkResponse,
  InvestigationRecord,
  ResultAnnotation,
} from '@/src/types/investigation';
import { buildInvestigationRedactedCopy, maskPiiString } from './annotationsStore';

const runAutoTable: typeof autoTable =
  typeof autoTable === 'function'
    ? autoTable
    : (autoTable as unknown as { default?: typeof autoTable }).default ?? autoTable;

type JsPdfWithAutoTable = jsPDF & {
  lastAutoTable?: {
    finalY: number;
  };
};

export interface BuiltDossierPdfArtifact {
  filename: string;
  blob: Blob;
  base64: string;
}

function sanitizePdfText(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00B7/g, ' | ')
    .replace(/\u2605/g, '* ')
    .replace(/\u00B1/g, '+/-')
    .replace(/[^\x20-\x7E\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeMultilineText(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .split(/\r?\n/)
    .map((line) => sanitizePdfText(line))
    .join('\n')
    .trim();
}

function safeFileSlug(str: string): string {
  const cleaned = str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return cleaned || 'target';
}

function getSiteIdentity(): { brand: string; company: string; tagline: string; host: string; origin: string } {
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.host || 'parmanu.osint';
    const origin = window.location.origin || `https://${host}`;
    return {
      brand: 'Parmanu Intelligence',
      company: 'Midnight Industries',
      tagline: 'One Signal. Every Trace. Zero Blind Spots.',
      host,
      origin,
    };
  }
  return {
    brand: 'Parmanu Intelligence',
    company: 'Midnight Industries',
    tagline: 'One Signal. Every Trace. Zero Blind Spots.',
    host: 'parmanu.osint',
    origin: 'https://parmanu.osint',
  };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.target = '_self';
  a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 20_000);
}

export function buildDossierPdfArtifact(
  rawInvestigation: InvestigationRecord,
  options: DossierOptions,
  annotations: Record<string, ResultAnnotation>,
  caseNote: string,
  dorkReport?: GoogleDorkResponse | null,
  evidencePins: EvidenceBoardPin[] = []
): BuiltDossierPdfArtifact {
  const inv = buildInvestigationRedactedCopy(rawInvestigation, options.redactPii);
  const allResults = Array.isArray(inv.results) ? inv.results : [];
  const breachedAccounts = Array.isArray(inv.breachedAccounts) ? inv.breachedAccounts : [];
  const geoMarkers = Array.isArray(inv.geoMarkers) ? inv.geoMarkers : [];
  const foundResults = allResults.filter((r) => r.status === 'found');
  const noteText = options.redactPii ? maskPiiString(caseNote, true) : caseNote;
  const site = getSiteIdentity();

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  }) as JsPdfWithAutoTable;

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14;
  const contentWidth = pageWidth - marginX * 2;
  const bottomLimit = pageHeight - 19;

  const palette = {
    ink: [15, 23, 42] as [number, number, number],
    indigo: [79, 70, 229] as [number, number, number],
    indigoSoft: [238, 242, 255] as [number, number, number],
    slateBg: [248, 250, 252] as [number, number, number],
    border: [226, 232, 240] as [number, number, number],
    muted: [100, 116, 139] as [number, number, number],
    bodyText: [51, 65, 85] as [number, number, number],
    emerald: [5, 150, 105] as [number, number, number],
    amber: [217, 119, 6] as [number, number, number],
    rose: [225, 29, 72] as [number, number, number],
    orange: [234, 88, 12] as [number, number, number],
  };

  let cursorY = 0;

  const ensureSpace = (neededMm: number) => {
    if (cursorY + neededMm > bottomLimit) {
      doc.addPage();
      cursorY = 16;
    }
  };

  const drawSectionHeading = (title: string, subtitle?: string) => {
    ensureSpace(15);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...palette.ink);
    doc.text(sanitizePdfText(title.toUpperCase()), marginX, cursorY);

    if (subtitle) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...palette.muted);
      doc.text(sanitizePdfText(subtitle), pageWidth - marginX, cursorY, { align: 'right' });
    }

    cursorY += 2;
    doc.setDrawColor(...palette.indigo);
    doc.setLineWidth(0.55);
    doc.line(marginX, cursorY, marginX + 26, cursorY);
    doc.setDrawColor(...palette.border);
    doc.setLineWidth(0.25);
    doc.line(marginX + 26, cursorY, pageWidth - marginX, cursorY);
    cursorY += 5.5;
  };

  // === TOP BRANDING BANNER ===
  doc.setFillColor(...palette.ink);
  doc.rect(0, 0, pageWidth, 34, 'F');
  // Subtle 3-band Indian Tricolour Hairline beneath cover banner
  doc.setFillColor(255, 153, 51);
  doc.rect(0, 34, pageWidth, 0.7, 'F');
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 34.7, pageWidth, 0.5, 'F');
  doc.setFillColor(19, 136, 8);
  doc.rect(0, 35.2, pageWidth, 0.7, 'F');

  // Vector orbital mark in header
  doc.setDrawColor(129, 140, 248);
  doc.setLineWidth(0.65);
  doc.circle(marginX + 5.8, 15, 5.5, 'S');
  doc.setDrawColor(251, 146, 60);
  doc.setLineWidth(0.45);
  doc.ellipse(marginX + 5.8, 15, 7.6, 2.7, 'S');
  doc.setFillColor(249, 115, 22);
  doc.circle(marginX + 5.8, 15, 1.5, 'F');

  // Website Name, Attribution, Tagline & Live Origin URL
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14.5);
  doc.setTextColor(255, 255, 255);
  doc.text('PARMANU INTELLIGENCE  |  MIDNIGHT INDUSTRIES', marginX + 16.5, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  doc.text(
    sanitizePdfText(`Authorized OSINT Case Dossier  |  ${site.tagline}`),
    marginX + 16.5,
    17.4
  );

  doc.setFont('courier', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(165, 180, 252);
  doc.text(
    sanitizePdfText(`Website: ${site.origin}  (${site.host})`).slice(0, 74),
    marginX + 16.5,
    23.4
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.3);
  doc.setTextColor(148, 163, 184);
  doc.text(
    sanitizePdfText(
      `Engineered in India by ${site.company}  |  DPDP Act 2023 & BSA 2023 Sec. 63 Audit Format  |  Scope: ${inv.targetType.toUpperCase()}`
    ).slice(0, 96),
    marginX + 16.5,
    28.6
  );

  // Right Header Metadata
  const generatedUtc = `${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(
    options.redactPii ? 253 : 167,
    options.redactPii ? 186 : 243,
    options.redactPii ? 116 : 208
  );
  doc.text(
    options.redactPii ? 'CONFIDENTIAL // PII REDACTED' : 'ANALYST COPY // FULL TELEMETRY',
    pageWidth - marginX,
    11.5,
    { align: 'right' }
  );

  doc.setFont('courier', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(226, 232, 240);
  doc.text(sanitizePdfText(`Scan ID: ${inv.scanId}`), pageWidth - marginX, 17.4, { align: 'right' });
  doc.text(sanitizePdfText(`Generated: ${generatedUtc}`), pageWidth - marginX, 23.4, { align: 'right' });
  doc.text(
    sanitizePdfText(`Websites Swept: ${allResults.length}`),
    pageWidth - marginX,
    28.6,
    { align: 'right' }
  );

  cursorY = 42;

  // === TARGET HERO PANEL ===
  const posture = inv.aiSummary?.riskPosture || 'Evaluated';
  const postureColor =
    posture === 'Elevated'
      ? palette.rose
      : posture === 'Moderate'
      ? palette.amber
      : palette.emerald;

  doc.setFillColor(...palette.slateBg);
  doc.setDrawColor(...palette.border);
  doc.setLineWidth(0.3);
  doc.roundedRect(marginX, cursorY, contentWidth, 23, 2.5, 2.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...palette.indigo);
  doc.text(
    sanitizePdfText(`TARGET IDENTIFIER (${inv.targetType.toUpperCase()})`),
    marginX + 4,
    cursorY + 5.8
  );

  doc.setFont('courier', 'bold');
  doc.setFontSize(12.5);
  doc.setTextColor(...palette.ink);
  const targetDisplay = sanitizePdfText(inv.target);
  doc.text(targetDisplay.slice(0, 54), marginX + 4, cursorY + 12.8);

  const selectedToolsList = Array.isArray(inv.selectedTools) ? inv.selectedTools : [];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(...palette.muted);
  doc.text(
    sanitizePdfText(
      `Modules: ${selectedToolsList.join(', ') || 'All active'}  |  Status: ${String(
        inv.status || 'completed'
      ).toUpperCase()}`
    ).slice(0, 88),
    marginX + 4,
    cursorY + 18.8
  );

  // Risk Posture Badge on right
  doc.setFillColor(...postureColor);
  doc.roundedRect(pageWidth - marginX - 40, cursorY + 6.2, 36, 10, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text(
    sanitizePdfText(`RISK: ${posture.toUpperCase()}`),
    pageWidth - marginX - 22,
    cursorY + 12.4,
    { align: 'center' }
  );

  cursorY += 29;

  // === KPI SUMMARY CARDS ===
  if (options.includeSummary) {
    ensureSpace(24);
    const kpis = [
      { label: 'Verified Matches', value: String(inv.summary?.found ?? foundResults.length), accent: palette.indigo },
      {
        label: 'Breached Records',
        value: String(inv.summary?.breached ?? breachedAccounts.length),
        accent: (inv.summary?.breached ?? 0) > 0 ? palette.rose : palette.emerald,
      },
      { label: 'Registered Accounts', value: String(inv.summary?.registered ?? 0), accent: palette.ink },
      { label: 'Geo Signals', value: String(geoMarkers.length), accent: palette.emerald },
    ];
    const gap = 3.5;
    const cardW = (contentWidth - gap * 3) / 4;

    kpis.forEach((kpi, idx) => {
      const x = marginX + idx * (cardW + gap);
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...palette.border);
      doc.setLineWidth(0.3);
      doc.roundedRect(x, cursorY, cardW, 18, 2, 2, 'FD');

      doc.setFillColor(...kpi.accent);
      doc.rect(x, cursorY, 1.5, 18, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(...palette.ink);
      doc.text(kpi.value, x + 5, cursorY + 9.2);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...palette.muted);
      doc.text(kpi.label, x + 5, cursorY + 14.5);
    });

    cursorY += 25;
  }

  // === EXECUTIVE AI BRIEF ===
  if (options.includeExecutiveBrief && inv.aiSummary?.executiveBrief) {
    drawSectionHeading('Executive Intelligence Brief', `Posture: ${posture}`);
    const briefText = sanitizeMultilineText(inv.aiSummary.executiveBrief);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.1);
    const briefLines = doc.splitTextToSize(briefText, contentWidth - 8);
    const boxHeight = Math.max(14, briefLines.length * 4.5 + 8);
    ensureSpace(boxHeight + 4);

    doc.setFillColor(...palette.indigoSoft);
    doc.setDrawColor(199, 210, 254);
    doc.roundedRect(marginX, cursorY, contentWidth, boxHeight, 2, 2, 'FD');

    doc.setTextColor(...palette.ink);
    doc.text(briefLines, marginX + 4, cursorY + 6);
    cursorY += boxHeight + 5;

    const takeaways = Array.isArray(inv.aiSummary.keyTakeaways)
      ? inv.aiSummary.keyTakeaways
      : [];
    if (takeaways.length > 0) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...palette.ink);
      ensureSpace(8);
      doc.text('Key Analytical Takeaways:', marginX, cursorY);
      cursorY += 4.5;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.4);
      doc.setTextColor(...palette.bodyText);
      for (const item of takeaways.slice(0, 6)) {
        const lines = doc.splitTextToSize(`- ${sanitizePdfText(item)}`, contentWidth - 4);
        ensureSpace(lines.length * 4.2 + 2);
        doc.text(lines, marginX + 2, cursorY);
        cursorY += lines.length * 4.2 + 1.2;
      }
      cursorY += 3;
    }
  }

  // === PHONE TELECOM, UPI PAYMENTS & OTT FOOTPRINT SECTION ===
  const phoneIntelItems = allResults.filter(
    (r) =>
      r.status === 'found' &&
      (r.category === 'Phone & Telecom' ||
        r.id === 'mailaccess-payment-upi-intel' ||
        r.id === 'mailaccess-ott-footprint-index' ||
        /razorpay|instamojo|paypal/i.test(r.platform))
  );
  if (inv.targetType === 'phone' || phoneIntelItems.length > 0) {
    drawSectionHeading(
      'Phone Telecom, Payment / UPI & OTT Intelligence',
      'Zero unsolicited SMS OTP dispatched'
    );
    if (phoneIntelItems.length > 0) {
      runAutoTable(doc, {
        startY: cursorY,
        margin: { left: marginX, right: marginX },
        head: [['Channel / Platform', 'Signal / Handle', 'Verified Details & Citations']],
        body: phoneIntelItems.map((item) => {
          const extra = Array.isArray(item.displayFields)
            ? item.displayFields.map((f) => `${f.label}: ${f.value}`).join(' | ')
            : '';
          return [
            sanitizePdfText(item.platform),
            sanitizePdfText(item.displayName || item.handle || item.findingKind),
            sanitizePdfText([item.summary, extra, item.url].filter(Boolean).join('\n')),
          ];
        }),
        theme: 'striped',
        headStyles: {
          fillColor: palette.indigo,
          textColor: [255, 255, 255],
          fontSize: 8,
          fontStyle: 'bold',
        },
        styles: {
          fontSize: 7.7,
          cellPadding: 2.3,
          textColor: palette.bodyText,
          overflow: 'linebreak',
        },
        columnStyles: {
          0: { fontStyle: 'bold', textColor: palette.ink, cellWidth: 38 },
          1: { font: 'courier', cellWidth: 42 },
          2: { cellWidth: 'auto' },
        },
      });
      cursorY = (doc.lastAutoTable?.finalY ?? cursorY) + 7;
    }
  }

  // === GOOGLE (GHUNT) ACCOUNT INTELLIGENCE ===
  const ghuntResult = allResults.find((r) => r.tool === 'ghunt');
  const g = ghuntResult?.details?.ghuntIntel as GhuntIntelligenceData | undefined;
  if (g) {
    drawSectionHeading(
      'Google Account & Maps Contributor (GHunt)',
      g.tokenConfigured ? `Auth: ${g.authMode}` : 'Public Metadata'
    );

    const reachabilityList = Array.isArray(g.inAppReachability) ? g.inAppReachability : [];
    const reviewList = Array.isArray(g.reviews) ? g.reviews : [];
    const mapsServiceUrl = g.gaiaId
      ? `https://www.google.com/maps/contrib/${g.gaiaId}`
      : g.profileUrl || '-';
    const calServiceUrl =
      g.calendarEmbedUrl ||
      `https://calendar.google.com/calendar/u/0/embed?src=${encodeURIComponent(g.email)}`;
    const plusArchiveUrl =
      g.googlePlusArchiveUrl ||
      (g.gaiaId ? `https://web.archive.org/web/*/plus.google.com/${g.gaiaId}*` : 'Not available');
    const lastUpdateStr = g.lastUpdated ? String(g.lastUpdated).slice(0, 10) : 'Not exposed';

    const ghuntRows: string[][] = [
      [
        'Query Email',
        sanitizePdfText(g.email),
        'Account Classification',
        sanitizePdfText(g.accountType || 'Google Account'),
      ],
      [
        'Photo / Gaia ID',
        sanitizePdfText(g.gaiaId || 'Not exposed'),
        'Last Update',
        sanitizePdfText(lastUpdateStr),
      ],
      [
        'Resolved Display Name',
        sanitizePdfText(g.displayName || 'Not exposed'),
        'Public Calendar ICS',
        g.publicCalendar ? 'Exposed' : 'Private / Disabled',
      ],
      [
        'Reachable Google Apps',
        sanitizePdfText(reachabilityList.join(', ') || 'Gmail'),
        'Mail Auth (SPF / DMARC)',
        `SPF: ${g.spfPolicy ? 'Yes' : 'No'} | DMARC: ${g.dmarcPolicy ? 'Yes' : 'No'}`,
      ],
      [
        'Google Maps',
        sanitizePdfText(mapsServiceUrl),
        'Google Calendar',
        sanitizePdfText(calServiceUrl),
      ],
      [
        'Google Plus Archive',
        sanitizePdfText(plusArchiveUrl),
        'Location Triangulation',
        g.locationRing
          ? sanitizePdfText(
              `${g.locationRing.estimatedAreaLabel} (+/-${g.locationRing.radiusKm} km, ${g.locationRing.confidence})`
            )
          : 'No geo-tagged reviews',
      ],
    ];

    runAutoTable(doc, {
      startY: cursorY,
      margin: { left: marginX, right: marginX },
      body: ghuntRows,
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8,
        cellPadding: 2.5,
        textColor: palette.ink,
        lineColor: palette.border,
        lineWidth: 0.2,
      },
      columnStyles: {
        0: { fontStyle: 'bold', fillColor: palette.slateBg, cellWidth: 36 },
        1: { cellWidth: 55 },
        2: { fontStyle: 'bold', fillColor: palette.slateBg, cellWidth: 38 },
        3: { cellWidth: 'auto' },
      },
    });
    cursorY = (doc.lastAutoTable?.finalY ?? cursorY) + 6;

    if (reviewList.length > 0) {
      runAutoTable(doc, {
        startY: cursorY,
        margin: { left: marginX, right: marginX },
        head: [['Place Reviewed', 'Rating', 'Date', 'Address & Review Excerpt']],
        body: reviewList.slice(0, 20).map((rev) => [
          sanitizePdfText(rev.placeName),
          rev.rating > 0 ? `${rev.rating}/5` : '-',
          sanitizePdfText(rev.dateText || '-'),
          sanitizePdfText([rev.address, rev.comment].filter(Boolean).join(' | ') || '-').slice(0, 140),
        ]),
        theme: 'striped',
        headStyles: {
          fillColor: palette.ink,
          textColor: [255, 255, 255],
          fontSize: 8,
          fontStyle: 'bold',
        },
        styles: {
          fontSize: 7.7,
          cellPadding: 2.2,
          textColor: palette.bodyText,
        },
      });
      cursorY = (doc.lastAutoTable?.finalY ?? cursorY) + 6;
    }
  }

  // === ANALYST CASE NOTES ===
  if (options.includeNotes && noteText.trim()) {
    drawSectionHeading('Analyst Case Notes');
    const cleanNote = sanitizeMultilineText(noteText);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.8);
    const lines = doc.splitTextToSize(cleanNote, contentWidth - 8);
    const h = Math.max(12, lines.length * 4.3 + 7);
    ensureSpace(h + 4);

    doc.setFillColor(...palette.slateBg);
    doc.setDrawColor(...palette.border);
    doc.roundedRect(marginX, cursorY, contentWidth, h, 2, 2, 'FD');
    doc.setTextColor(...palette.ink);
    doc.text(lines, marginX + 4, cursorY + 5.5);
    cursorY += h + 6;
  }

  // === BREACHED ACCOUNTS TABLE ===
  if (options.includeBreaches && breachedAccounts.length > 0) {
    drawSectionHeading(
      `Breached Accounts (${breachedAccounts.length})`,
      'Verified breach & credential leak correlations'
    );

    runAutoTable(doc, {
      startY: cursorY,
      margin: { left: marginX, right: marginX },
      head: [['Service / Breach Name', 'Severity', 'Date', 'Exposed Data Classes']],
      body: breachedAccounts.map((b) => [
        sanitizePdfText(b.domain ? `${b.breachName} (${b.domain})` : b.breachName),
        String(b.severity || 'medium').toUpperCase(),
        sanitizePdfText(b.date ? b.date.slice(0, 10) : b.relativeTime || '-'),
        sanitizePdfText((Array.isArray(b.dataClasses) ? b.dataClasses : []).join(', ') || 'Email record'),
      ]),
      theme: 'striped',
      headStyles: {
        fillColor: [190, 18, 60],
        textColor: [255, 255, 255],
        fontSize: 8,
        fontStyle: 'bold',
      },
      styles: {
        fontSize: 8,
        cellPadding: 2.5,
        textColor: palette.bodyText,
      },
      columnStyles: {
        0: { fontStyle: 'bold', textColor: palette.ink, cellWidth: 52 },
        1: { cellWidth: 22, fontStyle: 'bold' },
        2: { cellWidth: 26 },
        3: { cellWidth: 'auto' },
      },
    });
    cursorY = (doc.lastAutoTable?.finalY ?? cursorY) + 7;
  }

  // === VERIFIED PLATFORM & INFRASTRUCTURE FINDINGS ===
  if (options.includeResults) {
    drawSectionHeading(
      `Verified Platform & Infrastructure Findings (${foundResults.length})`,
      'Live OSINT module telemetry'
    );

    if (foundResults.length === 0) {
      ensureSpace(10);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(...palette.muted);
      doc.text('No verified matches recorded in this scan.', marginX, cursorY);
      cursorY += 7;
    } else {
      runAutoTable(doc, {
        startY: cursorY,
        margin: { left: marginX, right: marginX },
        head: [['Platform', 'Module / Type', 'Handle / Identity', 'Summary, URL & Analyst Triage']],
        body: foundResults.map((r) => {
          const ann = annotations[r.id];
          const tagLabel = ann?.tag ? `[${ann.tag.replace(/_/g, ' ').toUpperCase()}]` : '';
          const annNote =
            options.includeNotes && ann?.note
              ? `Note: ${options.redactPii ? maskPiiString(ann.note, true) : ann.note}`
              : '';
          const detailParts = [r.summary, r.url, tagLabel, annNote]
            .filter(Boolean)
            .map((p) => sanitizePdfText(p));
          return [
            sanitizePdfText(r.platform),
            sanitizePdfText(`${r.tool} | ${r.findingKind}`),
            sanitizePdfText(r.handle || r.displayName || r.domain || '-'),
            detailParts.join('\n') || '-',
          ];
        }),
        theme: 'striped',
        headStyles: {
          fillColor: palette.ink,
          textColor: [255, 255, 255],
          fontSize: 8,
          fontStyle: 'bold',
        },
        styles: {
          fontSize: 7.7,
          cellPadding: 2.3,
          textColor: palette.bodyText,
          overflow: 'linebreak',
        },
        columnStyles: {
          0: { fontStyle: 'bold', textColor: palette.ink, cellWidth: 34 },
          1: { cellWidth: 28 },
          2: { font: 'courier', cellWidth: 34 },
          3: { cellWidth: 'auto' },
        },
      });
      cursorY = (doc.lastAutoTable?.finalY ?? cursorY) + 7;
    }
  }

  // === GEOGRAPHIC DISTRIBUTION SIGNALS ===
  if (options.includeSummary && geoMarkers.length > 0) {
    drawSectionHeading(`Geographic Distribution Signals (${geoMarkers.length})`);
    runAutoTable(doc, {
      startY: cursorY,
      margin: { left: marginX, right: marginX },
      head: [['Signal Label', 'Region / Country', 'Coordinates', 'Source']],
      body: geoMarkers.slice(0, 30).map((m) => [
        sanitizePdfText(m.label),
        sanitizePdfText([m.region, m.country].filter(Boolean).join(', ') || '-'),
        `${Number(m.lat || 0).toFixed(4)}, ${Number(m.lng || 0).toFixed(4)}`,
        sanitizePdfText(m.source),
      ]),
      theme: 'striped',
      headStyles: {
        fillColor: palette.emerald,
        textColor: [255, 255, 255],
        fontSize: 8,
        fontStyle: 'bold',
      },
      styles: {
        fontSize: 7.7,
        cellPadding: 2.2,
        textColor: palette.bodyText,
      },
    });
    cursorY = (doc.lastAutoTable?.finalY ?? cursorY) + 7;
  }

  // === GOOGLE DORKING HITS ===
  const dorkHits = Array.isArray(dorkReport?.hits) ? dorkReport.hits : [];
  if (options.includeDorks && dorkHits.length > 0) {
    drawSectionHeading(`Google Dorking & Indexed Files (${dorkHits.length})`);
    runAutoTable(doc, {
      startY: cursorY,
      margin: { left: marginX, right: marginX },
      head: [['Format', 'Indexed Title & URL', 'Engine']],
      body: dorkHits.slice(0, 50).map((h) => [
        sanitizePdfText(h.fileType),
        sanitizePdfText(
          `${options.redactPii ? maskPiiString(h.title, true) : h.title}\n${h.url}`
        ),
        sanitizePdfText(h.sourceEngine),
      ]),
      theme: 'striped',
      headStyles: {
        fillColor: palette.indigo,
        textColor: [255, 255, 255],
        fontSize: 8,
        fontStyle: 'bold',
      },
      styles: {
        fontSize: 7.6,
        cellPadding: 2.2,
        textColor: palette.bodyText,
        overflow: 'linebreak',
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 20 },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 28 },
      },
    });
    cursorY = (doc.lastAutoTable?.finalY ?? cursorY) + 7;
  }

  // === PINNED EVIDENCE BOARD ===
  if (options.includeEvidenceBoard && evidencePins.length > 0) {
    drawSectionHeading(`Pinned Evidence Board (${evidencePins.length})`);
    runAutoTable(doc, {
      startY: cursorY,
      margin: { left: marginX, right: marginX },
      head: [['Priority', 'Type', 'Title & Details', 'Analyst Triage Note']],
      body: evidencePins.map((pin) => [
        sanitizePdfText(String(pin.priority || 'normal').toUpperCase()),
        sanitizePdfText(String(pin.kind || 'signal').toUpperCase()),
        sanitizePdfText(
          `${options.redactPii ? maskPiiString(pin.title, true) : pin.title}\n${
            options.redactPii ? maskPiiString(pin.subtitle, true) : pin.subtitle
          }${pin.url ? `\n${pin.url}` : ''}`
        ),
        sanitizePdfText(
          pin.analystNote
            ? options.redactPii
              ? maskPiiString(pin.analystNote, true)
              : pin.analystNote
            : '-'
        ),
      ]),
      theme: 'striped',
      headStyles: {
        fillColor: palette.ink,
        textColor: [255, 255, 255],
        fontSize: 8,
        fontStyle: 'bold',
      },
      styles: {
        fontSize: 7.7,
        cellPadding: 2.2,
        textColor: palette.bodyText,
        overflow: 'linebreak',
      },
    });
  }

  // === REPEATING PAGE FOOTER ===
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...palette.border);
    doc.setLineWidth(0.25);
    doc.line(marginX, pageHeight - 13, pageWidth - marginX, pageHeight - 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...palette.muted);
    doc.text(
      sanitizePdfText(
        `${site.brand} by ${site.company} (${site.origin})  |  Target: ${inv.target}  |  Scan ${inv.scanId}`
      ).slice(0, 102),
      marginX,
      pageHeight - 8.5
    );
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - marginX, pageHeight - 8.5, {
      align: 'right',
    });
  }

  const filename = `parmanu-dossier-${safeFileSlug(inv.target)}-${inv.scanId}.pdf`;
  const arrayBuf = doc.output('arraybuffer');
  const blob = new Blob([arrayBuf], { type: 'application/pdf' });
  const base64 = arrayBufferToBase64(arrayBuf);

  return { filename, blob, base64 };
}

export function downloadDossierPdf(
  rawInvestigation: InvestigationRecord,
  options: DossierOptions,
  annotations: Record<string, ResultAnnotation>,
  caseNote: string,
  dorkReport?: GoogleDorkResponse | null,
  evidencePins: EvidenceBoardPin[] = []
): string {
  const artifact = buildDossierPdfArtifact(
    rawInvestigation,
    options,
    annotations,
    caseNote,
    dorkReport,
    evidencePins
  );
  triggerBlobDownload(artifact.blob, artifact.filename);
  return artifact.filename;
}
