import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowUpRight,
  Check,
  Code2,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Globe,
  Loader2,
  Pin,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import type {
  DorkFileFormat,
  GoogleDorkHit,
  GoogleDorkResponse,
  TargetType,
} from '@/src/types/investigation';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';

interface DeepGoogleDorkingCardProps {
  target: string;
  targetType: TargetType;
  report: GoogleDorkResponse | null;
  loading: boolean;
  error: string | null;
  pinnedHitIds?: Set<string>;
  onTogglePinHit?: (hit: GoogleDorkHit) => void;
  onRunDork: (customKeyword?: string) => void;
}

type DorkViewTab =
  | 'hits_all'
  | 'hits_files'
  | 'hits_web'
  | 'hits_code'
  | 'queries';

type FormatFilter = 'all' | 'pdf' | 'sheets' | 'docs' | 'code' | 'web';

function FormatIcon({ format }: { format: DorkFileFormat }) {
  if (format === 'XLSX' || format === 'CSV') {
    return <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />;
  }
  if (
    format === 'PDF' ||
    format === 'DOCX' ||
    format === 'TXT' ||
    format === 'LOG'
  ) {
    return <FileText className="w-4 h-4 text-orange-600 shrink-0" />;
  }
  if (format === 'CODE' || format === 'JSON' || format === 'SQL' || format === 'XML') {
    return <Code2 className="w-4 h-4 text-indigo-600 shrink-0" />;
  }
  return <Globe className="w-4 h-4 text-slate-500 shrink-0" />;
}

function verificationMethodLabel(method?: GoogleDorkHit['verificationMethod']): string {
  switch (method) {
    case 'live-page-match':
      return 'Live Page Verified';
    case 'snippet-exact-match':
      return 'Exact Snippet Match';
    case 'api-exact-match':
      return 'Index Exact Match';
    case 'ct-log':
      return 'CT Log Verified';
    case 'wayback-snapshot':
      return 'Wayback Archive';
    default:
      return 'Confirmed Match';
  }
}

export function DeepGoogleDorkingCard({
  target,
  targetType,
  report,
  loading,
  error,
  pinnedHitIds,
  onTogglePinHit,
  onRunDork,
}: DeepGoogleDorkingCardProps) {
  const [tab, setTab] = useState<DorkViewTab>('hits_all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pivotKeyword, setPivotKeyword] = useState('');
  const [hitSearch, setHitSearch] = useState('');
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all');
  const [engineFilter, setEngineFilter] = useState<string>('all');

  const availableEngines = useMemo(() => {
    if (!report) return [];
    return Array.from(new Set(report.hits.map((h) => h.sourceEngine))).sort();
  }, [report]);

  const filteredHits = useMemo<GoogleDorkHit[]>(() => {
    if (!report) return [];

    let pool = report.hits;
    if (tab === 'hits_files') {
      pool = pool.filter((h) => h.category === 'Files & Documents');
    } else if (tab === 'hits_code') {
      pool = pool.filter((h) => h.category === 'Code & Pastes');
    } else if (tab === 'hits_web') {
      pool = pool.filter(
        (h) =>
          h.category === 'Websites & Mentions' ||
          h.category === 'Archives & Records'
      );
    }

    if (formatFilter === 'pdf') {
      pool = pool.filter((h) => h.fileType === 'PDF');
    } else if (formatFilter === 'sheets') {
      pool = pool.filter((h) => h.fileType === 'XLSX' || h.fileType === 'CSV');
    } else if (formatFilter === 'docs') {
      pool = pool.filter(
        (h) => h.fileType === 'DOCX' || h.fileType === 'TXT' || h.fileType === 'LOG'
      );
    } else if (formatFilter === 'code') {
      pool = pool.filter(
        (h) =>
          h.fileType === 'CODE' ||
          h.fileType === 'JSON' ||
          h.fileType === 'SQL' ||
          h.fileType === 'XML'
      );
    } else if (formatFilter === 'web') {
      pool = pool.filter((h) => h.fileType === 'WEB' || h.fileType === 'ARCHIVE');
    }

    if (engineFilter !== 'all') {
      pool = pool.filter((h) => h.sourceEngine === engineFilter);
    }

    const q = hitSearch.trim().toLowerCase();
    if (!q) return pool;

    return pool.filter((h) =>
      `${h.title} ${h.domain} ${h.url} ${h.snippet} ${h.fileType} ${h.sourceEngine}`
        .toLowerCase()
        .includes(q)
    );
  }, [report, tab, formatFilter, engineFilter, hitSearch]);

  const handleCopyQuery = async (id: string, queryText: string) => {
    try {
      await navigator.clipboard.writeText(queryText);
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((prev) => (prev === id ? null : prev));
      }, 1600);
    } catch {
      // Ignore clipboard unavailability
    }
  };

  const handleExportDorkCsv = () => {
    if (!report) return;
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['Title', 'URL', 'Domain', 'Category', 'Format', 'Engine', 'Timestamp', 'Snippet'].join(','),
      ...report.hits.map((h) =>
        [
          esc(h.title),
          esc(h.url),
          esc(h.domain),
          esc(h.category),
          esc(h.fileType),
          esc(h.sourceEngine),
          esc(h.timestamp || ''),
          esc(h.snippet),
        ].join(',')
      ),
    ].join('\n');

    const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parmanu-dorks-${target.replace(/\W+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportDorkJson = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parmanu-dorks-${target.replace(/\W+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const triggerDork = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    onRunDork(pivotKeyword.trim() || undefined);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card className="p-6 space-y-5 border-indigo-200/70">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-[#0F172A] dark:bg-slate-800 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
              <Terminal className="w-4 h-4 text-orange-400" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-slate-100">
                  Deep Google Dorking & Public Record Discovery
                </h2>
                <span className="text-[11px] font-mono uppercase text-indigo-600 dark:text-indigo-400 font-semibold">
                  {targetType}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Strictly verified public records across Google Grounding, Bing RSS,
                DuckDuckGo, Archive.org, Wayback CDX, crt.sh & GitHub for{' '}
                <span className="font-mono text-slate-700 dark:text-slate-200">{target}</span> — unverified noise filtered automatically.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {report && report.hits.length > 0 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportDorkCsv}
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>CSV</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportDorkJson}
                >
                  <Download className="w-3.5 h-3.5 text-slate-500" />
                  <span>JSON</span>
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => triggerDork()}
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
              )}
              <span>{loading ? 'Dorking Web & Files...' : 'Re-run Deep Dork'}</span>
            </Button>
          </div>
        </div>

        {/* Inline Pivot Refinement Bar + Interactive Operator Query Builder Chips */}
        <div className="space-y-2">
          <form
            onSubmit={triggerDork}
            className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B1120] border border-[#E5E7EB]/90 dark:border-slate-800"
          >
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={pivotKeyword}
                onChange={(e) => setPivotKeyword(e.target.value)}
                placeholder="Pivot keyword or dork operator (e.g. filetype:pdf, Delhi, tender, s3.amazonaws.com)"
                className="w-full h-9 pl-8 pr-3 rounded-lg bg-white dark:bg-[#11192E] border border-slate-200 dark:border-slate-700 text-xs text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={loading}
              className="shrink-0 h-9 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/60"
            >
              <Search className="w-3.5 h-3.5" />
              <span>{pivotKeyword.trim() ? 'Dork with Pivot' : 'Run Deep Dork'}</span>
            </Button>
          </form>

          {/* Interactive Dork Operator Builder Chips */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-slate-500 dark:text-slate-400 font-medium mr-1">
              Operators:
            </span>
            {[
              'filetype:pdf',
              'filetype:xlsx OR filetype:csv',
              'site:gov.in',
              'site:github.com',
              'site:pastebin.com',
              'inurl:admin',
              'ext:sql OR ext:env',
            ].map((op) => {
              const current = pivotKeyword.trim();
              const active = current.includes(op);
              return (
                <button
                  key={op}
                  type="button"
                  onClick={() => {
                    if (active) {
                      const next = current
                        .replace(op, '')
                        .replace(/\s{2,}/g, ' ')
                        .trim();
                      setPivotKeyword(next);
                    } else {
                      setPivotKeyword(current ? `${current} ${op}` : op);
                    }
                  }}
                  className={`px-2.5 py-1 rounded-lg font-mono border transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#0F172A] dark:bg-indigo-600 text-white border-transparent'
                      : 'bg-white dark:bg-[#11192E] border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400'
                  }`}
                >
                  {op}
                </button>
              );
            })}
            {pivotKeyword.trim() && (
              <button
                type="button"
                onClick={() => setPivotKeyword('')}
                className="px-2 py-1 text-[11px] text-slate-500 hover:text-rose-600 cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Loading State */}
        {loading && !report && (
          <div className="py-10 px-4 rounded-2xl bg-[#FAFAFA] border border-[#E5E7EB] text-center space-y-3">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-600 mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[#0F172A]">
                Executing dual-pass Google Dorking pipelines...
              </p>
              <p className="text-xs text-slate-500 max-w-lg mx-auto">
                Querying Google Search Grounding, Bing Search RSS, DuckDuckGo,
                exposed PDF/XLSX/CSV/DOCX indexes, crt.sh, GitHub, and
                Archive.org.
              </p>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="p-4 rounded-xl bg-rose-50/70 border border-rose-200 text-xs text-rose-700 flex items-center justify-between gap-3">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={() => triggerDork()}>
              Retry
            </Button>
          </div>
        )}

        {/* Report Data */}
        {report && (
          <div className="space-y-5">
            {/* KPI Summary Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B1120] border border-[#E5E7EB] dark:border-slate-800">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  Live Hits Discovered
                </p>
                <p className="font-display text-2xl font-bold text-[#0F172A] dark:text-slate-100 tabular-nums mt-0.5">
                  {report.summary.totalHits}
                </p>
              </div>
              <div className="p-3.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B1120] border border-[#E5E7EB] dark:border-slate-800">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  Files & Documents
                </p>
                <p className="font-display text-2xl font-bold text-orange-600 dark:text-orange-400 tabular-nums mt-0.5">
                  {report.summary.filesAndDocs}
                </p>
              </div>
              <div className="p-3.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B1120] border border-[#E5E7EB] dark:border-slate-800">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  Websites & Archives
                </p>
                <p className="font-display text-2xl font-bold text-indigo-600 dark:text-indigo-400 tabular-nums mt-0.5">
                  {report.summary.websitesAndMentions +
                    report.summary.archivesAndRecords}
                </p>
              </div>
              <div className="p-3.5 rounded-xl bg-[#FAFAFA] dark:bg-[#0B1120] border border-[#E5E7EB] dark:border-slate-800">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  Google Dork Queries
                </p>
                <p className="font-display text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums mt-0.5">
                  {report.summary.compiledQueries}
                </p>
              </div>
            </div>

            {/* Variants & Engines Metadata Line */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 border-b border-[#F1F5F9] dark:border-slate-800 pb-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-[#0F172A] dark:text-slate-200">Engines:</span>
                <span>{report.enginesQueried.join(' · ')}</span>
              </div>
              <span className="font-mono tabular-nums">
                {typeof report.summary.droppedUnverifiedCount === 'number' &&
                report.summary.droppedUnverifiedCount > 0
                  ? `${report.summary.droppedUnverifiedCount} unverified filtered · `
                  : ''}
                {report.variantsUsed.length} variant
                {report.variantsUsed.length === 1 ? '' : 's'} ·{' '}
                {(report.durationMs / 1000).toFixed(1)}s
              </span>
            </div>

            {/* Segmented Filter Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {(
                [
                  {
                    id: 'hits_all',
                    label: `All Live Hits (${report.hits.length})`,
                  },
                  {
                    id: 'hits_files',
                    label: `Files & Docs (${report.summary.filesAndDocs})`,
                  },
                  {
                    id: 'hits_web',
                    label: `Websites & Records (${
                      report.summary.websitesAndMentions +
                      report.summary.archivesAndRecords
                    })`,
                  },
                  {
                    id: 'hits_code',
                    label: `Code & Pastes (${report.summary.codeAndPastes})`,
                  },
                  {
                    id: 'queries',
                    label: `Google Dork Queries (${report.queries.length})`,
                  },
                ] as const
              ).map((item) => {
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={`relative px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      active
                        ? 'text-white'
                        : 'text-slate-500 dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="dork-tab-pill"
                        transition={{
                          type: 'spring',
                          stiffness: 440,
                          damping: 34,
                        }}
                        className="absolute inset-0 rounded-xl bg-[#0F172A] dark:bg-indigo-600"
                      />
                    )}
                    <span className="relative z-10">{item.label}</span>
                  </button>
                );
              })}
            </div>

            {/* In-Report Search + File Format & Engine Filters (for hit tabs) */}
            {tab !== 'queries' && report.hits.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={hitSearch}
                    onChange={(e) => setHitSearch(e.target.value)}
                    placeholder="Filter hits by domain, title, URL, or snippet..."
                    className="w-full h-8.5 pl-8 pr-3 rounded-lg bg-white dark:bg-[#11192E] border border-slate-200 dark:border-slate-700 text-xs text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
                  />
                </div>

                <select
                  aria-label="Filter by file format"
                  value={formatFilter}
                  onChange={(e) => setFormatFilter(e.target.value as FormatFilter)}
                  className="h-8.5 px-2.5 rounded-lg bg-white dark:bg-[#11192E] border border-slate-200 dark:border-slate-700 text-xs text-[#0F172A] dark:text-slate-100 focus:outline-none focus:border-indigo-400 cursor-pointer"
                >
                  <option value="all">All Formats</option>
                  <option value="pdf">PDF Only</option>
                  <option value="sheets">XLSX & CSV</option>
                  <option value="docs">DOCX & TXT</option>
                  <option value="code">Code, JSON & SQL</option>
                  <option value="web">Web & Archives</option>
                </select>

                {availableEngines.length > 1 && (
                  <select
                    aria-label="Filter by search engine"
                    value={engineFilter}
                    onChange={(e) => setEngineFilter(e.target.value)}
                    className="h-8.5 px-2.5 rounded-lg bg-white dark:bg-[#11192E] border border-slate-200 dark:border-slate-700 text-xs text-[#0F172A] dark:text-slate-100 focus:outline-none focus:border-indigo-400 cursor-pointer"
                  >
                    <option value="all">All Engines</option>
                    {availableEngines.map((eng) => (
                      <option key={eng} value={eng}>
                        {eng}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Tab Body */}
            {tab === 'queries' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {report.queries.map((q) => (
                  <div
                    key={q.id}
                    className="p-4 rounded-xl bg-[#FAFAFA] dark:bg-[#0B1120] border border-[#E5E7EB] dark:border-slate-800 flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                          {q.category}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-[#0F172A] dark:text-slate-100">
                        {q.title}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                        {q.description}
                      </p>
                      <pre className="p-2.5 rounded-lg bg-white dark:bg-[#11192E] border border-slate-200/80 dark:border-slate-700 font-mono text-[11px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-all">
                        {q.query}
                      </pre>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => void handleCopyQuery(q.id, q.query)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-[#0F172A] dark:hover:text-white cursor-pointer"
                      >
                        {copiedId === q.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedId === q.id ? 'Copied' : 'Copy Dork'}</span>
                      </button>

                      <a
                        href={q.googleUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700"
                      >
                        <Search className="w-3 h-3" />
                        <span>Open in Google</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredHits.length === 0 ? (
              <div className="space-y-4">
                <div className="p-6 rounded-2xl bg-[#FAFAFA] dark:bg-[#0B1120] border border-dashed border-[#E5E7EB] dark:border-slate-800 text-center space-y-2">
                  <p className="text-sm font-semibold text-[#0F172A] dark:text-slate-100">
                    No confirmed verified hits matched this filter
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
                    Unrelated or synthetic directory pages were automatically stripped.
                    Reset filters above or launch the compiled exact Google Dork
                    operators directly in Google Search for manual review:
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {report.queries.slice(0, 6).map((q) => (
                    <a
                      key={q.id}
                      href={q.googleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-3.5 rounded-xl bg-white dark:bg-[#0B1120] border border-[#E5E7EB] dark:border-slate-800 hover:border-indigo-300 transition-colors flex items-center justify-between gap-3 group"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100 group-hover:text-indigo-700 dark:group-hover:text-indigo-400 truncate">
                          {q.title}
                        </p>
                        <p className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                          {q.query}
                        </p>
                      </div>
                      <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 shrink-0" />
                    </a>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredHits.map((hit) => (
                  <a
                    key={hit.id}
                    href={hit.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-4 rounded-xl bg-white dark:bg-[#0B1120] border border-[#E5E7EB] dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-xs transition-all flex flex-col justify-between gap-2.5 group"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-slate-600 dark:text-slate-300 min-w-0">
                          <FormatIcon format={hit.fileType} />
                          <span>{hit.fileType}</span>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="truncate max-w-[140px] text-slate-500 dark:text-slate-400 font-sans font-medium">
                            {hit.domain}
                          </span>
                          {hit.timestamp && (
                            <>
                              <span className="text-slate-300 dark:text-slate-700">·</span>
                              <span className="text-slate-400 tabular-nums shrink-0">
                                {hit.timestamp.slice(0, 10)}
                              </span>
                            </>
                          )}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 shrink-0">
                          <ShieldCheck className="w-3 h-3" />
                          <span>{verificationMethodLabel(hit.verificationMethod)}</span>
                        </span>
                      </div>

                      <p className="text-sm font-semibold text-[#0F172A] dark:text-slate-100 group-hover:text-indigo-700 dark:group-hover:text-indigo-400 line-clamp-2 leading-snug">
                        {hit.title}
                      </p>

                      {hit.snippet && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                          {hit.snippet}
                        </p>
                      )}

                      {hit.matchedEvidence && (
                        <div className="px-2.5 py-1.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-900/50 text-[11px] font-mono text-emerald-900 dark:text-emerald-200 line-clamp-2">
                          Match: {hit.matchedEvidence}
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-[#F1F5F9] dark:border-slate-800 flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-mono text-slate-400 truncate">
                        {hit.sourceEngine} · {hit.url}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {onTogglePinHit && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              onTogglePinHit(hit);
                            }}
                            aria-label="Pin dork hit to Evidence Board"
                            className={`p-1 rounded-md transition-colors cursor-pointer ${
                              pinnedHitIds?.has(hit.id)
                                ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400'
                                : 'text-slate-400 hover:text-indigo-600'
                            }`}
                          >
                            <Pin className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 shrink-0" />
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    </motion.div>
  );
}
