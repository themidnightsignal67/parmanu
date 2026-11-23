import { useEffect, useMemo, useState } from 'react';
import { Download, EyeOff, FileText, Loader2, Printer } from 'lucide-react';
import type {
  DossierOptions,
  EvidenceBoardPin,
  GoogleDorkResponse,
  InvestigationRecord,
  ResultAnnotation,
} from '@/src/types/investigation';
import { generateDossierHtml } from '@/src/lib/dossierHtml';
import { buildDossierPdfArtifact, triggerBlobDownload } from '@/src/lib/dossierPdf';
import { buildInvestigationRedactedCopy } from '@/src/lib/annotationsStore';
import { Dialog } from '@/src/components/ui/Dialog';
import { Button } from '@/src/components/ui/Button';

interface DossierDialogProps {
  open: boolean;
  onClose: () => void;
  investigation: InvestigationRecord;
  annotations: Record<string, ResultAnnotation>;
  caseNote: string;
  dorkReport?: GoogleDorkResponse | null;
  evidencePins?: EvidenceBoardPin[];
  defaultRedactPii: boolean;
  onNotify?: (toast: {
    type: 'success' | 'error' | 'info';
    title: string;
    message?: string;
  }) => void;
}

export function DossierDialog({
  open,
  onClose,
  investigation,
  annotations,
  caseNote,
  dorkReport,
  evidencePins = [],
  defaultRedactPii,
  onNotify,
}: DossierDialogProps) {
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [serverPdfUrl, setServerPdfUrl] = useState<string | null>(null);
  const [serverPdfFilename, setServerPdfFilename] = useState<string | null>(null);
  const [options, setOptions] = useState<DossierOptions>({
    includeSummary: true,
    includeExecutiveBrief: true,
    includeBreaches: true,
    includeResults: true,
    includeDorks: Boolean(dorkReport?.hits.length),
    includeNotes: true,
    includeEvidenceBoard: evidencePins.length > 0,
    redactPii: defaultRedactPii,
  });

  useEffect(() => {
    if (!open) return;
    setExportStatus(null);
    setServerPdfUrl(null);
    setServerPdfFilename(null);
    setOptions((prev) => ({
      ...prev,
      includeDorks: Boolean(dorkReport?.hits.length),
      includeEvidenceBoard: evidencePins.length > 0,
      redactPii: defaultRedactPii,
    }));
  }, [open, investigation.scanId, dorkReport?.hits.length, evidencePins.length, defaultRedactPii]);

  const redactedPreview = useMemo(
    () => buildInvestigationRedactedCopy(investigation, options.redactPii),
    [investigation, options.redactPii]
  );

  const toggle = (key: keyof DossierOptions) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    setExportStatus(null);
    setServerPdfUrl(null);
    setServerPdfFilename(null);
    try {
      const artifact = buildDossierPdfArtifact(
        investigation,
        options,
        annotations,
        caseNote,
        dorkReport,
        evidencePins
      );

      // Prepare server Content-Disposition: attachment relay so downloads succeed inside sandboxed iframes & mobile browsers
      let relayUrl: string | null = null;
      let relayName: string = artifact.filename;
      try {
        const res = await fetch('/api/export/pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: artifact.filename,
            base64: artifact.base64,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { downloadUrl?: string; filename?: string };
          if (data.downloadUrl) {
            relayUrl = data.downloadUrl;
            relayName = data.filename || artifact.filename;
            setServerPdfUrl(data.downloadUrl);
            setServerPdfFilename(relayName);
          }
        }
      } catch {
        // Fallback to direct client blob download
      }

      if (relayUrl) {
        // Hidden iframe triggers real browser download from Content-Disposition: attachment without navigating or blocking
        const dlFrame = document.createElement('iframe');
        dlFrame.style.display = 'none';
        dlFrame.setAttribute('aria-hidden', 'true');
        dlFrame.src = relayUrl;
        document.body.appendChild(dlFrame);
        window.setTimeout(() => {
          dlFrame.parentNode?.removeChild(dlFrame);
        }, 15_000);
      } else {
        triggerBlobDownload(artifact.blob, artifact.filename);
      }

      setExportStatus(
        relayUrl
          ? `PDF ready (${Math.max(1, Math.round(artifact.blob.size / 1024))} KB) — ${relayName}`
          : `Downloaded ${artifact.filename}`
      );
      onNotify?.({
        type: 'success',
        title: 'PDF Dossier Ready',
        message: relayName,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PDF generation failed.';
      setExportStatus(`Error: ${msg}`);
      onNotify?.({
        type: 'error',
        title: 'PDF Export Failed',
        message: msg,
      });
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleDownloadHtml = () => {
    const html = generateDossierHtml(
      investigation,
      options,
      annotations,
      caseNote,
      dorkReport,
      evidencePins
    );
    const filename = `parmanu-dossier-${investigation.scanId}.html`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    triggerBlobDownload(blob, filename);
    onNotify?.({
      type: 'success',
      title: 'HTML Dossier Downloaded',
      message: filename,
    });
  };

  const handlePrintCleanReport = () => {
    const html = generateDossierHtml(
      investigation,
      options,
      annotations,
      caseNote,
      dorkReport,
      evidencePins
    );
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const frameDoc = iframe.contentWindow?.document;
    if (!frameDoc) {
      document.body.removeChild(iframe);
      window.print();
      return;
    }

    frameDoc.open();
    frameDoc.write(html);
    frameDoc.close();

    window.setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        window.print();
      } finally {
        window.setTimeout(() => {
          iframe.parentNode?.removeChild(iframe);
        }, 1200);
      }
    }, 250);
  };

  const checkboxes: Array<{ key: keyof DossierOptions; label: string }> = [
    { key: 'includeSummary', label: 'Summary Metrics' },
    { key: 'includeExecutiveBrief', label: 'Executive AI Brief' },
    { key: 'includeBreaches', label: `Breached Accounts (${investigation.breachedAccounts.length})` },
    { key: 'includeResults', label: `Verified Results (${investigation.summary.found})` },
    { key: 'includeDorks', label: `Google Dorks (${dorkReport?.hits.length || 0})` },
    { key: 'includeNotes', label: 'Analyst Tags & Case Notes' },
    ...(evidencePins.length > 0
      ? [{ key: 'includeEvidenceBoard' as const, label: `Evidence Board (${evidencePins.length})` }]
      : []),
  ];

  const websiteHost =
    typeof window !== 'undefined' && window.location?.host
      ? window.location.host
      : 'parmanu.osint';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Executive Case Dossier & PDF Export"
      description="Configure included evidence sections, optionally mask PII, and download a branded multi-page PDF report or standalone HTML dossier."
      maxWidthClass="max-w-3xl"
    >
      <div className="space-y-4 sm:space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 text-xs">
          {checkboxes.map((cb) => (
            <label
              key={cb.key}
              className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/60 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={Boolean(options[cb.key])}
                onChange={() => toggle(cb.key)}
                className="rounded accent-indigo-600"
              />
              <span className="font-medium text-[#0F172A] dark:text-slate-100 truncate">
                {cb.label}
              </span>
            </label>
          ))}
        </div>

        <label className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-indigo-200/80 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/35 text-xs cursor-pointer">
          <div className="flex items-center gap-2.5 min-w-0">
            <EyeOff className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold text-[#0F172A] dark:text-slate-100">
                Mask Sensitive PII Before Export
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Redacts raw email addresses, phone digits, and personal handles in exported reports.
              </p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={options.redactPii}
            onChange={() => toggle('redactPii')}
            className="w-4 h-4 rounded accent-indigo-600 shrink-0"
          />
        </label>

        {/* Live Compact Dossier Preview */}
        <div className="print-only-sheet rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#090F1D] p-4 sm:p-5 space-y-4 max-h-64 sm:max-h-72 overflow-y-auto text-xs">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 truncate">
                Parmanu · Midnight Industries · {websiteHost}
              </p>
              <p className="font-mono text-sm sm:text-base font-bold text-[#0F172A] dark:text-slate-100 break-all">
                {redactedPreview.target}
              </p>
            </div>
            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
              {redactedPreview.scanId}
            </span>
          </div>

          {options.includeExecutiveBrief && redactedPreview.aiSummary && (
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              {redactedPreview.aiSummary.executiveBrief}
            </p>
          )}

          {options.includeResults && (
            <div className="space-y-1.5">
              <p className="font-semibold text-[#0F172A] dark:text-slate-100">
                Included Verified Records ({redactedPreview.results.filter((r) => r.status === 'found').length}):
              </p>
              {redactedPreview.results
                .filter((r) => r.status === 'found')
                .slice(0, 4)
                .map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 py-1 border-b border-slate-100 dark:border-slate-800 last:border-0"
                  >
                    <span className="font-medium text-[#0F172A] dark:text-slate-200 truncate">
                      {r.platform}
                    </span>
                    <span className="font-mono text-slate-500 dark:text-slate-400 truncate max-w-[140px] sm:max-w-[260px]">
                      {r.handle || r.domain || r.tool}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>

        {exportStatus && (
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl border border-emerald-200/80 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-950/25 text-xs">
            <p
              className={`font-medium ${
                exportStatus.startsWith('Error:')
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-emerald-700 dark:text-emerald-300'
              }`}
            >
              {exportStatus}
            </p>
            {serverPdfUrl && (
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={serverPdfUrl}
                  download={serverPdfFilename || 'parmanu-dossier.pdf'}
                  className="inline-flex items-center gap-1 font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Save PDF File</span>
                </a>
                <a
                  href={`${serverPdfUrl}?inline=1`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-slate-600 dark:text-slate-300 hover:underline"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Open PDF</span>
                </a>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={handlePrintCleanReport}>
            <Printer className="w-3.5 h-3.5" />
            <span>Print</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadHtml}>
            <FileText className="w-3.5 h-3.5" />
            <span>Download HTML</span>
          </Button>
          <Button size="sm" onClick={() => void handleDownloadPdf()} disabled={downloadingPdf}>
            {downloadingPdf ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>{downloadingPdf ? 'Generating PDF...' : 'Download PDF Report'}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
