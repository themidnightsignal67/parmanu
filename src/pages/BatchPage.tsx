import React, { useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  ClipboardPaste,
  Download,
  FileSpreadsheet,
  FileText,
  FileUp,
  GitBranch,
  Globe,
  Loader2,
  Play,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Square,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { getDefaultToolsForTarget } from '@/src/data/tools';
import {
  ApiClientError,
  cancelInvestigation,
  detectTargetTypeFromInput,
  extractBatchTargetsFromFile,
  extractBatchTargetsFromText,
  fetchInvestigationById,
  formatDuration,
  startInvestigation,
  validateTargetInput,
  type CreditStatusResponse,
} from '@/src/lib/api';
import type {
  BatchExtractResponse,
  BatchQueueItem,
  InvestigationRecord,
  TargetType,
} from '@/src/types/investigation';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Dialog } from '@/src/components/ui/Dialog';

interface BatchFileSummary {
  id: string;
  fileName: string;
  fileSize: number;
  detectedFormat: string;
  totalExtracted: number;
  notes: string[];
}

interface BatchPageProps {
  items: BatchQueueItem[];
  setItems: React.Dispatch<React.SetStateAction<BatchQueueItem[]>>;
  uploadedFiles: BatchFileSummary[];
  setUploadedFiles: React.Dispatch<React.SetStateAction<BatchFileSummary[]>>;
  isSignedIn: boolean;
  signingIn: boolean;
  creditStatus?: CreditStatusResponse | null;
  onCreditsUpdated?: (nextStatus?: CreditStatusResponse) => void;
  onSignIn: () => Promise<void>;
  onScanFinished: (record: InvestigationRecord) => Promise<void>;
  onOpenInvestigation: (record: InvestigationRecord) => void;
  onNotify: (toast: {
    type: 'success' | 'error' | 'info';
    title: string;
    message?: string;
  }) => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function csvEscape(val: unknown): string {
  const s = String(val ?? '');
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function BatchPage({
  items,
  setItems,
  uploadedFiles,
  setUploadedFiles,
  isSignedIn,
  signingIn,
  creditStatus,
  onCreditsUpdated,
  onSignIn,
  onScanFinished,
  onOpenInvestigation,
  onNotify,
}: BatchPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelRequestedRef = useRef(false);
  const activeScanIdsRef = useRef<Set<string>>(new Set());

  const [dragActive, setDragActive] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [runningBatch, setRunningBatch] = useState(false);
  const [concurrency, setConcurrency] = useState<1 | 2 | 3>(2);

  const [typeFilter, setTypeFilter] = useState<'all' | TargetType>('all');
  const [searchFilter, setSearchFilter] = useState('');

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [manualInput, setManualInput] = useState('');

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authChecked, setAuthChecked] = useState(true);
  const [enableBatchDorking, setEnableBatchDorking] = useState(false);

  const appendExtractResult = (res: BatchExtractResponse) => {
    setUploadedFiles((prev) => [
      {
        id: `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
        fileName: res.fileName,
        fileSize: res.fileSize,
        detectedFormat: res.detectedFormat,
        totalExtracted: res.totalExtracted,
        notes: res.notes || [],
      },
      ...prev,
    ]);

    if (res.targets.length === 0) {
      onNotify({
        type: 'info',
        title: `No targets found in ${res.fileName}`,
        message: 'Try pasting raw identifiers or uploading a file with emails, domains, IPs, phones, or @handles.',
      });
      return;
    }

    let addedCount = 0;
    setItems((prev) => {
      const existingKeys = new Set(
        prev.map((p) => `${p.targetType}::${p.target.toLowerCase()}`)
      );
      const next = [...prev];
      for (const t of res.targets) {
        const key = `${t.targetType}::${t.target.toLowerCase()}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        addedCount++;
        next.push({
          id: t.id,
          target: t.target,
          targetType: t.targetType,
          sourceHint: t.sourceHint,
          confidence: t.confidence,
          selected: true,
          status: 'pending',
        });
      }
      return next;
    });

    onNotify({
      type: 'success',
      title: `Extracted ${res.totalExtracted} target${res.totalExtracted === 1 ? '' : 's'}`,
      message: `${res.fileName} (${res.detectedFormat})${addedCount < res.totalExtracted ? ` · ${res.totalExtracted - addedCount} duplicates skipped` : ''}`,
    });
  };

  const handleFilesSelected = async (fileList: FileList | File[] | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setExtracting(true);
    try {
      for (const file of files) {
        try {
          const result = await extractBatchTargetsFromFile(file);
          appendExtractResult(result);
        } catch (err) {
          onNotify({
            type: 'error',
            title: `Could not parse ${file.name}`,
            message: err instanceof Error ? err.message : 'File extraction failed.',
          });
        }
      }
    } finally {
      setExtracting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handlePasteExtract = async () => {
    const trimmed = pasteText.trim();
    if (!trimmed) return;
    setExtracting(true);
    try {
      const res = await extractBatchTargetsFromText(trimmed, 'pasted-list.txt');
      appendExtractResult(res);
      setPasteText('');
      setPasteOpen(false);
    } catch (err) {
      onNotify({
        type: 'error',
        title: 'Extraction failed',
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setExtracting(false);
    }
  };

  const handleAddManualTarget = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = manualInput.trim();
    if (!raw) return;
    const detected = detectTargetTypeFromInput(raw) || 'username';
    const valid = validateTargetInput(raw, detected);
    if (!valid.valid) {
      onNotify({
        type: 'error',
        title: 'Invalid target',
        message: valid.reason,
      });
      return;
    }
    const key = `${detected}::${raw.toLowerCase()}`;
    if (items.some((i) => `${i.targetType}::${i.target.toLowerCase()}` === key)) {
      onNotify({ type: 'info', title: 'Target already in batch queue' });
      return;
    }
    setItems((prev) => [
      {
        id: `manual_${Date.now().toString(36)}`,
        target: raw,
        targetType: detected,
        sourceHint: 'Manual entry',
        confidence: 'high',
        selected: true,
        status: 'pending',
      },
      ...prev,
    ]);
    setManualInput('');
  };

  const filteredItems = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    return items.filter((item) => {
      if (typeFilter !== 'all' && item.targetType !== typeFilter) return false;
      if (!q) return true;
      return `${item.target} ${item.targetType} ${item.sourceHint}`
        .toLowerCase()
        .includes(q);
    });
  }, [items, typeFilter, searchFilter]);

  const stats = useMemo(() => {
    const selectedPending = items.filter(
      (i) => i.selected && (i.status === 'pending' || i.status === 'failed' || i.status === 'cancelled')
    );
    const completed = items.filter((i) => i.status === 'completed' || i.status === 'partial');
    const running = items.filter((i) => i.status === 'running');
    const failed = items.filter((i) => i.status === 'failed');
    const totalSignals = completed.reduce(
      (acc, i) => acc + (i.record?.summary.found || 0),
      0
    );
    const totalBreaches = completed.reduce(
      (acc, i) => acc + (i.record?.summary.breached || 0),
      0
    );
    return {
      total: items.length,
      selectedPendingCount: selectedPending.length,
      completedCount: completed.length,
      runningCount: running.length,
      failedCount: failed.length,
      totalSignals,
      totalBreaches,
    };
  }, [items]);

  const runSingleQueueItem = async (item: BatchQueueItem): Promise<void> => {
    if (cancelRequestedRef.current) return;

    setItems((prev) =>
      prev.map((row) =>
        row.id === item.id ? { ...row, status: 'running', error: undefined } : row
      )
    );

    try {
      const tools = getDefaultToolsForTarget(item.targetType);
      const initial = await startInvestigation({
        target: item.target,
        targetType: item.targetType,
        tools,
        authorizedConfirmed: true,
        enableGoogleDorking: enableBatchDorking,
      });

      onCreditsUpdated?.(initial.creditStatus);
      activeScanIdsRef.current.add(initial.scanId);
      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id ? { ...row, scanId: initial.scanId } : row
        )
      );

      const startedAt = Date.now();
      let latest = initial;

      while (!cancelRequestedRef.current) {
        await new Promise((r) => setTimeout(r, 750));
        if (cancelRequestedRef.current) break;

        try {
          latest = await fetchInvestigationById(initial.scanId);
          const terminal =
            latest.status === 'completed' ||
            latest.status === 'partial' ||
            latest.status === 'failed' ||
            latest.status === 'cancelled';

          if (terminal) {
            if (!latest.aiSummary && Date.now() - startedAt < 7000) {
              continue;
            }
            break;
          }
        } catch {
          // transient fetch failure; keep polling until timeout
        }
        if (Date.now() - startedAt > 90000) {
          break;
        }
      }

      activeScanIdsRef.current.delete(initial.scanId);

      if (cancelRequestedRef.current || latest.status === 'cancelled') {
        await cancelInvestigation(initial.scanId).catch(() => {});
        setItems((prev) =>
          prev.map((row) =>
            row.id === item.id ? { ...row, status: 'cancelled' } : row
          )
        );
        return;
      }

      const finalStatus =
        latest.status === 'failed'
          ? 'failed'
          : latest.status === 'partial'
          ? 'partial'
          : 'completed';

      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id
            ? {
                ...row,
                status: finalStatus,
                scanId: latest.scanId,
                record: latest,
              }
            : row
        )
      );

      await onScanFinished(latest);
    } catch (err) {
      if (err instanceof ApiClientError && (err.status === 429 || err.status === 403)) {
        cancelRequestedRef.current = true;
        onCreditsUpdated?.(err.creditStatus);
        onNotify({
          type: 'error',
          title: 'Daily Search Credit Limit Reached',
          message: err.message,
        });
      }
      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id
            ? {
                ...row,
                status: 'failed',
                error: err instanceof Error ? err.message : 'Scan failed',
              }
            : row
        )
      );
    }
  };

  const handleStartBatch = async () => {
    setAuthModalOpen(false);
    const queue = items.filter(
      (i) =>
        i.selected &&
        (i.status === 'pending' || i.status === 'failed' || i.status === 'cancelled')
    );

    if (queue.length === 0) {
      onNotify({ type: 'info', title: 'No pending selected targets to scan' });
      return;
    }

    cancelRequestedRef.current = false;
    setRunningBatch(true);

    let cursor = 0;
    const workerCount = Math.min(concurrency, queue.length);

    const worker = async () => {
      while (!cancelRequestedRef.current) {
        const idx = cursor++;
        if (idx >= queue.length) break;
        await runSingleQueueItem(queue[idx]);
      }
    };

    try {
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      if (!cancelRequestedRef.current) {
        onNotify({
          type: 'success',
          title: 'Batch investigation finished',
          message: `Processed ${queue.length} target${queue.length === 1 ? '' : 's'}.`,
        });
      }
    } finally {
      setRunningBatch(false);
    }
  };

  const handleStopBatch = async () => {
    cancelRequestedRef.current = true;
    const ids = Array.from(activeScanIdsRef.current);
    await Promise.all(ids.map((id) => cancelInvestigation(id).catch(() => {})));
    activeScanIdsRef.current.clear();
    setItems((prev) =>
      prev.map((row) =>
        row.status === 'running' ? { ...row, status: 'cancelled' } : row
      )
    );
    setRunningBatch(false);
    onNotify({ type: 'info', title: 'Batch scan stopped' });
  };

  const handleExportCsv = () => {
    const completed = items.filter((i) => i.record);
    if (completed.length === 0) {
      onNotify({ type: 'info', title: 'Run at least one scan before exporting' });
      return;
    }
    const headers = [
      'Target',
      'Type',
      'Source',
      'Status',
      'Total Findings',
      'Registered Accounts',
      'Breached Accounts',
      'Leaked Signals',
      'Risk Posture',
      'Duration (ms)',
      'Platforms',
      'Scan ID',
    ];
    const rows = completed.map((item) => {
      const rec = item.record!;
      const platforms = rec.results
        .filter((r) => r.status === 'found')
        .map((r) => r.platform)
        .slice(0, 12)
        .join(' | ');
      return [
        item.target,
        item.targetType,
        item.sourceHint,
        item.status,
        rec.summary.found,
        rec.summary.registered,
        rec.summary.breached,
        rec.summary.leaked,
        rec.aiSummary?.riskPosture || '—',
        rec.durationMs,
        platforms,
        rec.scanId,
      ]
        .map(csvEscape)
        .join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parmanu-batch-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify({ type: 'success', title: 'Batch CSV exported' });
  };

  const handleExportJson = () => {
    const completed = items.filter((i) => i.record);
    if (completed.length === 0) {
      onNotify({ type: 'info', title: 'Run at least one scan before exporting' });
      return;
    }
    const payload = {
      exportedAt: new Date().toISOString(),
      filesParsed: uploadedFiles,
      totalTargets: items.length,
      completedCount: completed.length,
      investigations: completed.map((i) => i.record),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parmanu-batch-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify({ type: 'success', title: 'Batch JSON exported' });
  };

  const allVisibleSelected =
    filteredItems.length > 0 && filteredItems.every((i) => i.selected);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="max-w-6xl mx-auto px-3.5 sm:px-8 py-6 sm:py-8 space-y-5 sm:space-y-6"
    >
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#0F172A]">
            Universal File Batch Mode
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Drop any file type (CSV, TXT, JSON, PDF, DOCX, XLSX, logs, emails, or binary dumps) to auto-extract and investigate targets in parallel.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPasteOpen(true)}
            disabled={extracting}
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            <span>Paste Text</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={stats.completedCount === 0}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportJson}
            disabled={stats.completedCount === 0}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export JSON</span>
          </Button>
        </div>
      </div>

      {/* Universal Drag & Drop Upload Zone (NO accept filter — accepts literally any file) */}
      <motion.div
        animate={
          dragActive
            ? { scale: 1.008 }
            : { scale: 1 }
        }
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        <Card
          className={`p-6 transition-all duration-200 ${
            dragActive
              ? 'border-indigo-400 bg-indigo-50/55 ring-4 ring-indigo-500/15 shadow-[0_14px_38px_rgba(79,70,229,0.12)]'
              : 'border-dashed border-slate-300'
          }`}
        >
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              void handleFilesSelected(e.dataTransfer.files);
            }}
            className="flex flex-col md:flex-row items-center justify-between gap-6"
          >
            <div className="flex items-start gap-4">
              <motion.div
                animate={
                  dragActive
                    ? { y: [-2, -8, -2], scale: 1.08 }
                    : extracting
                    ? { scale: [1, 1.05, 1] }
                    : { y: 0, scale: 1 }
                }
                transition={{
                  duration: 0.9,
                  repeat: dragActive || extracting ? Infinity : 0,
                  ease: 'easeInOut',
                }}
                className={`w-11 h-11 rounded-2xl border flex items-center justify-center shrink-0 transition-colors ${
                  dragActive
                    ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm'
                    : 'bg-[#FAFAFA] border-[#E5E7EB]'
                }`}
              >
                {extracting ? (
                  <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                ) : (
                  <FileUp
                    className={`w-5 h-5 ${
                      dragActive ? 'text-white' : 'text-orange-600'
                    }`}
                  />
                )}
              </motion.div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-[#0F172A]">
                  {extracting
                    ? 'Scanning file for OSINT indicators...'
                    : dragActive
                    ? 'Release to extract OSINT targets...'
                    : 'Drop any file here or browse from your device'}
                </p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Supports every format up to 15 MB per file: CSV, TSV, TXT, JSON, NDJSON, PDF, DOCX, XLSX, ODT, XML, HTML, EML, VCF, logs, SQLite, or raw binary strings.
                </p>
              </div>
            </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => void handleFilesSelected(e.target.files)}
            />
            <Button
              size="md"
              disabled={extracting}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-4 h-4" />
              <span>{extracting ? 'Extracting...' : 'Choose Any File'}</span>
            </Button>
          </div>
        </div>

        {/* Parsed File Ledger */}
        {uploadedFiles.length > 0 && (
          <div className="mt-5 pt-4 border-t border-[#F1F5F9] space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-medium text-[#0F172A]">
                Parsed Files ({uploadedFiles.length})
              </span>
              {items.length > 0 && !runningBatch && (
                <button
                  type="button"
                  onClick={() => {
                    setItems([]);
                    setUploadedFiles([]);
                  }}
                  className="text-xs text-rose-600 hover:text-rose-700 font-medium cursor-pointer"
                >
                  Clear All
                </button>
              )}
            </div>
            <div className="divide-y divide-[#F1F5F9]">
              {uploadedFiles.slice(0, 5).map((f) => (
                <div
                  key={f.id}
                  className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-mono font-medium text-[#0F172A] truncate">
                      {f.fileName}
                    </span>
                    <span className="text-slate-400" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-slate-500">{f.detectedFormat}</span>
                    <span className="text-slate-400" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-slate-500 tabular-nums">
                      {formatBytes(f.fileSize)}
                    </span>
                  </div>
                  <span className="text-slate-600 tabular-nums font-medium">
                    {f.totalExtracted} extracted
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
      </motion.div>

      {/* Summary & Batch Execution Bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Queued Targets</p>
          <p className="font-display text-xl font-bold text-[#0F172A] dark:text-slate-100 tabular-nums mt-1">
            {stats.total}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Completed Scans</p>
          <p className="font-display text-xl font-bold text-[#0F172A] dark:text-slate-100 tabular-nums mt-1">
            {stats.completedCount}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Verified Signals</p>
          <p className="font-display text-xl font-bold text-indigo-600 dark:text-indigo-400 tabular-nums mt-1">
            {stats.totalSignals}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Breach Exposures</p>
          <p className="font-display text-xl font-bold text-rose-600 dark:text-rose-400 tabular-nums mt-1">
            {stats.totalBreaches}
          </p>
        </Card>
      </div>

      {/* Cross-Target Overlap & Correlation Matrix */}
      {(() => {
        const completed = items.filter(
          (i) => i.record && (i.status === 'completed' || i.status === 'partial')
        );
        if (completed.length < 2) return null;

        const breachMap = new Map<string, Array<{ target: string; record: InvestigationRecord }>>();
        const platformMap = new Map<string, Array<{ target: string; record: InvestigationRecord }>>();
        const geoMap = new Map<string, Array<{ target: string; record: InvestigationRecord }>>();

        for (const entry of completed) {
          const rec = entry.record!;
          const seenB = new Set<string>();
          for (const b of rec.breachedAccounts || []) {
            const key = (b.domain || b.breachName || b.platform || '').trim().toLowerCase();
            if (!key || seenB.has(key)) continue;
            seenB.add(key);
            const arr = breachMap.get(key) || [];
            arr.push({ target: rec.target, record: rec });
            breachMap.set(key, arr);
          }

          const seenP = new Set<string>();
          for (const r of rec.results || []) {
            if (r.status !== 'found') continue;
            const pKey = r.platform.trim();
            if (!pKey || seenP.has(pKey)) continue;
            seenP.add(pKey);
            const arr = platformMap.get(pKey) || [];
            arr.push({ target: rec.target, record: rec });
            platformMap.set(pKey, arr);
          }

          const seenG = new Set<string>();
          for (const g of rec.geoMarkers || []) {
            const gKey = [g.country, g.region || g.source].filter(Boolean).join(' · ').trim();
            if (!gKey || seenG.has(gKey)) continue;
            seenG.add(gKey);
            const arr = geoMap.get(gKey) || [];
            arr.push({ target: rec.target, record: rec });
            geoMap.set(gKey, arr);
          }
        }

        const sharedBreaches = Array.from(breachMap.entries())
          .filter(([, hits]) => hits.length >= 2)
          .sort((a, b) => b[1].length - a[1].length)
          .slice(0, 6);
        const sharedPlatforms = Array.from(platformMap.entries())
          .filter(([, hits]) => hits.length >= 2)
          .sort((a, b) => b[1].length - a[1].length)
          .slice(0, 8);
        const sharedGeo = Array.from(geoMap.entries())
          .filter(([, hits]) => hits.length >= 2)
          .sort((a, b) => b[1].length - a[1].length)
          .slice(0, 5);

        if (
          sharedBreaches.length === 0 &&
          sharedPlatforms.length === 0 &&
          sharedGeo.length === 0
        ) {
          return null;
        }

        return (
          <Card className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <div>
                  <h2 className="font-display text-sm font-semibold text-[#0F172A] dark:text-slate-100">
                    Batch Overlap & Correlation Matrix
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Shared breaches, registered platforms, and network footprints across {completed.length} scanned batch targets.
                  </p>
                </div>
              </div>
              <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400 tabular-nums">
                {sharedBreaches.length + sharedPlatforms.length + sharedGeo.length} shared clusters
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-[#FAFAFA] dark:bg-slate-900/70 border border-[#E5E7EB] dark:border-slate-800 space-y-2">
                <p className="font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>Shared Breaches ({sharedBreaches.length})</span>
                </p>
                {sharedBreaches.length === 0 ? (
                  <p className="text-[11px] text-slate-400">No overlapping breach incidents detected.</p>
                ) : (
                  <div className="space-y-1.5">
                    {sharedBreaches.map(([domain, hits]) => (
                      <div key={domain} className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-[#0F172A] dark:text-slate-100 truncate">
                            {domain}
                          </span>
                          <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 tabular-nums shrink-0">
                            {hits.length} targets
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {hits.map((h) => (
                            <button
                              key={h.record.scanId}
                              type="button"
                              onClick={() => onOpenInvestigation(h.record)}
                              className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-[10px] text-slate-600 dark:text-slate-300 hover:border-indigo-400 cursor-pointer truncate max-w-[140px]"
                            >
                              {h.target}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-3.5 rounded-xl bg-[#FAFAFA] dark:bg-slate-900/70 border border-[#E5E7EB] dark:border-slate-800 space-y-2">
                <p className="font-semibold text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" />
                  <span>Shared Platforms ({sharedPlatforms.length})</span>
                </p>
                {sharedPlatforms.length === 0 ? (
                  <p className="text-[11px] text-slate-400">No common platforms shared across targets.</p>
                ) : (
                  <div className="space-y-1.5">
                    {sharedPlatforms.map(([plat, hits]) => (
                      <div key={plat} className="flex items-center justify-between gap-2">
                        <span className="font-medium text-[#0F172A] dark:text-slate-100 truncate">
                          {plat}
                        </span>
                        <span className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400 tabular-nums shrink-0">
                          {hits.length} / {completed.length}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-3.5 rounded-xl bg-[#FAFAFA] dark:bg-slate-900/70 border border-[#E5E7EB] dark:border-slate-800 space-y-2">
                <p className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Shared ASN / Geo ({sharedGeo.length})</span>
                </p>
                {sharedGeo.length === 0 ? (
                  <p className="text-[11px] text-slate-400">No overlapping infrastructure regions.</p>
                ) : (
                  <div className="space-y-1.5">
                    {sharedGeo.map(([geo, hits]) => (
                      <div key={geo} className="flex items-center justify-between gap-2">
                        <span className="text-[#0F172A] dark:text-slate-100 truncate">
                          {geo}
                        </span>
                        <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 tabular-nums shrink-0">
                          {hits.length} targets
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>
        );
      })()}

      {/* Queue Toolbar + Add Single Target */}
      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Segmented Type Filter */}
            <div className="flex items-center gap-1 p-1 bg-[#F4F5F7] dark:bg-slate-900 rounded-xl text-xs">
              {(['all', 'email', 'username', 'domain', 'ip', 'phone'] as const).map(
                (t) => {
                  const active = typeFilter === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTypeFilter(t)}
                      className={`relative px-2.5 py-1 rounded-lg font-medium capitalize transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        active
                          ? 'text-[#0F172A] dark:text-slate-100'
                          : 'text-slate-600 dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-slate-100'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="batch-type-pill"
                          transition={{
                            type: 'spring',
                            stiffness: 460,
                            damping: 34,
                          }}
                          className="absolute inset-0 rounded-lg bg-white dark:bg-slate-800 shadow-2xs"
                        />
                      )}
                      <span className="relative z-10">{t}</span>
                    </button>
                  );
                }
              )}
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filter targets..."
                className="h-8 pl-8 pr-3 rounded-xl border border-[#E5E7EB] dark:border-slate-700 bg-[#FAFAFA] dark:bg-slate-900 text-xs text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
              <span>Workers</span>
              <select
                aria-label="Concurrent batch workers"
                value={concurrency}
                disabled={runningBatch}
                onChange={(e) => setConcurrency(Number(e.target.value) as 1 | 2 | 3)}
                className="h-8 px-2 rounded-lg border border-[#E5E7EB] dark:border-slate-700 bg-[#FAFAFA] dark:bg-slate-900 text-xs font-medium text-[#0F172A] dark:text-slate-100 focus:outline-none"
              >
                <option value={1}>1 (Sequential)</option>
                <option value={2}>2 (Balanced)</option>
                <option value={3}>3 (Fast)</option>
              </select>
            </label>

            {runningBatch ? (
              <Button
                variant="outline"
                size="sm"
                className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:border-rose-300"
                onClick={() => void handleStopBatch()}
              >
                <Square className="w-3.5 h-3.5" />
                <span>Stop Batch ({stats.runningCount} running)</span>
              </Button>
            ) : (
              <Button
                variant="gradient"
                size="sm"
                disabled={stats.selectedPendingCount === 0}
                onClick={() => setAuthModalOpen(true)}
              >
                <Play className="w-3.5 h-3.5" />
                <span>
                  Run Selected ({stats.selectedPendingCount})
                </span>
              </Button>
            )}
          </div>
        </div>

        {/* Inline Add Target */}
        <form
          onSubmit={handleAddManualTarget}
          className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#F1F5F9] dark:border-slate-800"
        >
          <input
            type="text"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="Quick-add any email, username, domain, IP, or +phone into this batch..."
            className="flex-1 min-w-[240px] h-9 px-3 rounded-xl border border-[#E5E7EB] dark:border-slate-700 bg-[#FAFAFA] dark:bg-slate-900 text-xs text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
          />
          <Button type="submit" variant="outline" size="sm">
            <Plus className="w-3.5 h-3.5" />
            <span>Add to Queue</span>
          </Button>
          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums ml-auto">
            {creditStatus
              ? creditStatus.unlimited
                ? 'VIP Unlimited Batch Access'
                : `${creditStatus.remaining ?? 0}/${creditStatus.limit ?? 1} daily credits remaining (1 credit per target)`
              : isSignedIn
              ? '2 daily credits · VIP accounts unlimited'
              : '1 guest credit/day · 2/day with Google Sign-In'}
          </span>
        </form>
      </Card>

      {/* Batch Targets Data Grid */}
      <Card className="overflow-hidden">
        {items.length === 0 ? (
          <div className="py-16 px-6 text-center space-y-2.5">
            <FileUp className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
            <p className="text-sm font-semibold text-[#0F172A] dark:text-slate-100">
              No targets queued yet
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Upload any file above—spreadsheets, PDFs, Word docs, JSON exports, server logs, or raw text—and Parmanu will extract every valid email, username, domain, IP, and phone number automatically.
            </p>
            <div className="pt-2 flex items-center justify-center gap-2">
              <Button size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-3.5 h-3.5" />
                <span>Upload File</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPasteOpen(true)}
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                <span>Paste List</span>
              </Button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E5E7EB] dark:border-slate-800 bg-[#FAFAFA] dark:bg-slate-900/70 text-slate-500 dark:text-slate-400 font-medium">
                  <th className="py-3 pl-4 pr-2 w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all visible targets"
                      checked={allVisibleSelected}
                      disabled={runningBatch}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        const visibleIds = new Set(filteredItems.map((f) => f.id));
                        setItems((prev) =>
                          prev.map((row) =>
                            visibleIds.has(row.id)
                              ? { ...row, selected: checked }
                              : row
                          )
                        );
                      }}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </th>
                  <th className="py-3 px-3">Target</th>
                  <th className="py-3 px-3">Type</th>
                  <th className="py-3 px-3">Source</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Findings</th>
                  <th className="py-3 pl-3 pr-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9] dark:divide-slate-800/70">
                {filteredItems.map((item) => {
                  const rec = item.record;
                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-[#FAFAFA] dark:hover:bg-slate-800/50 transition-colors h-11"
                    >
                      <td className="py-2.5 pl-4 pr-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${item.target}`}
                          checked={item.selected}
                          disabled={runningBatch || item.status === 'running'}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setItems((prev) =>
                              prev.map((row) =>
                                row.id === item.id
                                  ? { ...row, selected: checked }
                                  : row
                              )
                            );
                          }}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </td>

                      <td className="py-2.5 px-3 font-mono font-medium text-[#0F172A] dark:text-slate-100 max-w-[240px] truncate">
                        {item.target}
                      </td>

                      <td className="py-2.5 px-3">
                        <select
                          aria-label={`Target type for ${item.target}`}
                          value={item.targetType}
                          disabled={runningBatch || item.status === 'running' || item.status === 'completed'}
                          onChange={(e) => {
                            const nextType = e.target.value as TargetType;
                            setItems((prev) =>
                              prev.map((row) =>
                                row.id === item.id
                                  ? { ...row, targetType: nextType }
                                  : row
                              )
                            );
                          }}
                          className="h-7 px-2 rounded-lg border border-[#E5E7EB] dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] uppercase font-semibold text-indigo-700 dark:text-indigo-400 focus:outline-none disabled:opacity-70"
                        >
                          <option value="email">email</option>
                          <option value="username">username</option>
                          <option value="domain">domain</option>
                          <option value="ip">ip</option>
                          <option value="phone">phone</option>
                        </select>
                      </td>

                      <td className="py-2.5 px-3 text-slate-500 max-w-[180px] truncate">
                        {item.sourceHint}
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {item.status === 'pending' && (
                          <span className="text-slate-500">Pending</span>
                        )}
                        {item.status === 'running' && (
                          <span className="inline-flex items-center gap-1.5 text-indigo-600 font-medium">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Scanning</span>
                          </span>
                        )}
                        {(item.status === 'completed' || item.status === 'partial') && (
                          <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>
                              {item.status === 'partial' ? 'Partial' : 'Completed'}
                            </span>
                          </span>
                        )}
                        {item.status === 'failed' && (
                          <span
                            title={item.error}
                            className="inline-flex items-center gap-1.5 text-rose-600 font-medium"
                          >
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>Failed</span>
                          </span>
                        )}
                        {item.status === 'cancelled' && (
                          <span className="inline-flex items-center gap-1.5 text-slate-500">
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Stopped</span>
                          </span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right tabular-nums text-slate-600 whitespace-nowrap">
                        {rec ? (
                          <span>
                            {rec.summary.found} found ·{' '}
                            <span
                              className={
                                rec.summary.breached > 0
                                  ? 'text-rose-600 font-semibold'
                                  : 'text-slate-500'
                              }
                            >
                              {rec.summary.breached} breached
                            </span>{' '}
                            · {formatDuration(rec.durationMs)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>

                      <td className="py-2.5 pl-3 pr-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {rec && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onOpenInvestigation(rec)}
                            >
                              <span>Report</span>
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {item.status !== 'running' && !runningBatch && (
                            <button
                              type="button"
                              aria-label={`Remove ${item.target}`}
                              onClick={() =>
                                setItems((prev) =>
                                  prev.filter((row) => row.id !== item.id)
                                )
                              }
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Paste Raw Text Dialog */}
      <Dialog
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title="Paste Target List or Raw Dump"
        description="Paste any unstructured text, CSV rows, JSON, logs, or newline-separated identifiers to extract targets."
      >
        <div className="space-y-4">
          <textarea
            rows={7}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="alice@company.com, 8.8.8.8, github.com&#10;@torvalds&#10;+919876543210"
            className="w-full p-3 rounded-xl border border-[#E5E7EB] dark:border-slate-700 bg-[#FAFAFA] dark:bg-slate-900 font-mono text-xs text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
          />
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!pasteText.trim() || extracting}
              onClick={() => void handlePasteExtract()}
            >
              {extracting ? 'Extracting...' : 'Extract Targets'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Batch Authorization Attestation Dialog */}
      <Dialog
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        title="Confirm Authorized Batch Scan"
        description="Parmanu executes strictly public open-source lookups across the selected queue."
      >
        <div className="space-y-5">
          <div className="p-4 rounded-xl bg-[#FAFAFA] dark:bg-slate-900/70 border border-[#E5E7EB] dark:border-slate-800 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">Selected Targets</span>
              <span className="font-mono font-semibold text-[#0F172A] dark:text-slate-100 tabular-nums">
                {stats.selectedPendingCount} target
                {stats.selectedPendingCount === 1 ? '' : 's'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">Execution Mode</span>
              <span className="font-medium text-[#0F172A] dark:text-slate-100">
                {concurrency} concurrent worker{concurrency === 1 ? '' : 's'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">Daily Credit Quota</span>
              {creditStatus?.unlimited ? (
                <span className="font-medium text-emerald-700 dark:text-emerald-400 tabular-nums">
                  VIP Unlimited · {concurrency} worker{concurrency === 1 ? '' : 's'}
                </span>
              ) : (
                <span
                  className={`font-medium tabular-nums ${
                    creditStatus && (creditStatus.remaining ?? 0) < stats.selectedPendingCount
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-indigo-700 dark:text-indigo-300'
                  }`}
                >
                  {creditStatus
                    ? `${creditStatus.remaining ?? 0}/${creditStatus.limit ?? 1} credits left today`
                    : isSignedIn
                    ? '2 credits / day'
                    : '1 guest credit / day'}
                </span>
              )}
            </div>
          </div>

          {creditStatus &&
            !creditStatus.unlimited &&
            (creditStatus.remaining ?? 0) < stats.selectedPendingCount && (
              <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/70 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                <div>
                  <p className="font-semibold">
                    Selected targets ({stats.selectedPendingCount}) exceed remaining daily credits ({creditStatus.remaining ?? 0})
                  </p>
                  <p className="mt-0.5">
                    Each batch target consumes 1 daily search credit. Uncheck extra rows or sign in with Google for higher tiers.
                  </p>
                </div>
              </div>
            )}

          {!isSignedIn && (
            <div className="p-3.5 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/35 border border-indigo-200/80 dark:border-indigo-800/70 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Sign in with Google for 2 daily search credits and persistent Firestore reports.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={signingIn}
                onClick={() => void onSignIn()}
              >
                {signingIn ? 'Connecting...' : 'Google Sign-In'}
              </Button>
            </div>
          )}

          <label className="flex items-start gap-3 p-3.5 rounded-xl border border-[#E5E7EB] dark:border-slate-700 cursor-pointer hover:bg-[#FAFAFA] dark:hover:bg-slate-800/50 transition-colors">
            <input
              type="checkbox"
              checked={enableBatchDorking}
              onChange={(e) => setEnableBatchDorking(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              <span className="font-semibold text-[#0F172A] dark:text-slate-100">
                Enable Deep Google Dorking (Optional)
              </span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Off by default. Enable to automatically run web/file dork queries for every queued target.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 p-3.5 rounded-xl border border-[#E5E7EB] dark:border-slate-700 cursor-pointer hover:bg-[#FAFAFA] dark:hover:bg-slate-800/50 transition-colors">
            <input
              type="checkbox"
              checked={authChecked}
              onChange={(e) => setAuthChecked(e.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              I confirm I own these identifiers or hold explicit authorization to run public OSINT checks across every selected target in this batch.
            </span>
          </label>

          <div className="flex items-center justify-end gap-2.5">
            <Button variant="outline" onClick={() => setAuthModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="gradient"
              disabled={!authChecked}
              onClick={() => void handleStartBatch()}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Start Batch Scan</span>
            </Button>
          </div>
        </div>
      </Dialog>
    </motion.div>
  );
}
