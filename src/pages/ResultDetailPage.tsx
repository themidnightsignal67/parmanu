import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  MapPin,
  Search,
  User,
  X,
} from 'lucide-react';
import {
  detectTargetTypeFromInput,
  fetchGitHubCommitDetail,
  formatDuration,
  formatTimestamp,
} from '@/src/lib/api';
import { maskPiiString } from '@/src/lib/annotationsStore';
import type {
  ArtifactItem,
  InvestigationRecord,
  InvestigationResultItem,
  TargetType,
} from '@/src/types/investigation';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { PlatformMark, resolveSiteDomain } from '@/src/components/ui/PlatformMark';
import { SafeAvatar } from '@/src/components/ui/SafeAvatar';

interface ResultDetailPageProps {
  investigation: InvestigationRecord;
  item: InvestigationResultItem;
  redactPii?: boolean;
  onPivotScan?: (target: string, targetType: TargetType) => void;
  onBack: () => void;
}

interface CommitDiffPayload {
  sha?: string;
  repository?: string;
  url?: string;
  message?: string;
  authorName?: string;
  authorEmail?: string;
  authorDate?: string;
  stats?: { additions?: number; deletions?: number; total?: number };
  files?: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>;
  error?: string;
}

interface FlattenedProperty {
  key: string;
  label: string;
  value: string;
  kind: 'boolean' | 'text' | 'number' | 'url';
  rawBool?: boolean;
}

function formatPropertyLabel(raw: string): string {
  return raw
    .replace(/\./g, ' › ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function flattenDetails(
  obj: unknown,
  prefix = '',
  out: FlattenedProperty[] = [],
  depth = 0
): FlattenedProperty[] {
  if (obj === null || obj === undefined || depth > 3) return out;
  if (Array.isArray(obj)) {
    if (obj.length === 0) return out;
    if (obj.every((v) => typeof v !== 'object' || v === null)) {
      out.push({
        key: prefix || 'items',
        label: formatPropertyLabel(prefix || 'items'),
        value: obj.join(', '),
        kind: 'text',
      });
    } else {
      obj.slice(0, 12).forEach((entry, i) => {
        flattenDetails(entry, `${prefix}[${i + 1}]`, out, depth + 1);
      });
    }
    return out;
  }

  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v === null || v === undefined || v === '') continue;
      const nextKey = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'boolean') {
        out.push({
          key: nextKey,
          label: formatPropertyLabel(nextKey),
          value: v ? 'True' : 'False',
          kind: 'boolean',
          rawBool: v,
        });
      } else if (typeof v === 'number') {
        out.push({
          key: nextKey,
          label: formatPropertyLabel(nextKey),
          value: String(v),
          kind: 'number',
        });
      } else if (typeof v === 'string') {
        const isUrl = /^https?:\/\//i.test(v);
        out.push({
          key: nextKey,
          label: formatPropertyLabel(nextKey),
          value: v,
          kind: isUrl ? 'url' : 'text',
        });
      } else {
        flattenDetails(v, nextKey, out, depth + 1);
      }
    }
  }
  return out;
}

export function ResultDetailPage({
  investigation,
  item,
  redactPii = false,
  onPivotScan,
  onBack,
}: ResultDetailPageProps) {
  const [expandedCommitId, setExpandedCommitId] = useState<string | null>(null);
  const [commitDetails, setCommitDetails] = useState<
    Record<string, CommitDiffPayload>
  >({});
  const [loadingCommitId, setLoadingCommitId] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);

  const [propSearch, setPropSearch] = useState('');
  const [propType, setPropType] = useState<'all' | 'boolean' | 'text' | 'number'>(
    'all'
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    setExpandedCommitId(null);
    setShowRawJson(false);
    setPropSearch('');
    setPropType('all');
  }, [item.id]);

  const handleCopy = (key: string, value: string) => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 1500);
  };

  const handleToggleCommit = async (artifact: ArtifactItem) => {
    if (expandedCommitId === artifact.id) {
      setExpandedCommitId(null);
      return;
    }
    setExpandedCommitId(artifact.id);
    if (
      artifact.type === 'commit' &&
      artifact.repository &&
      artifact.sha &&
      !commitDetails[artifact.id]
    ) {
      setLoadingCommitId(artifact.id);
      try {
        const res = await fetchGitHubCommitDetail(
          artifact.repository,
          artifact.sha
        );
        setCommitDetails((prev) => ({
          ...prev,
          [artifact.id]: res as CommitDiffPayload,
        }));
      } catch {
        setCommitDetails((prev) => ({
          ...prev,
          [artifact.id]: { error: 'Could not load live diff patch.' },
        }));
      } finally {
        setLoadingCommitId(null);
      }
    }
  };

  const allProperties = useMemo(() => {
    const props: FlattenedProperty[] = [];
    const seen = new Set<string>();

    for (const [idx, df] of (item.displayFields || []).entries()) {
      const k = df.label.trim().toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      const isBool = df.kind === 'boolean';
      const isUrl = df.kind === 'url' || /^https?:\/\//i.test(df.value);
      props.push({
        key: `df-${df.label}-${idx}`,
        label: df.label,
        value: df.value,
        kind: isBool ? 'boolean' : isUrl ? 'url' : 'text',
        rawBool: isBool ? /^(yes|true|enabled|verified)$/i.test(df.value) : undefined,
      });
    }

    const fromDetails = flattenDetails(item.details || {});
    for (const p of fromDetails) {
      if (seen.has(p.label.toLowerCase())) continue;
      seen.add(p.label.toLowerCase());
      props.push(p);
    }

    return props;
  }, [item]);

  const filteredProperties = useMemo(() => {
    const q = propSearch.trim().toLowerCase();
    return allProperties.filter((p) => {
      if (propType === 'boolean' && p.kind !== 'boolean') return false;
      if (propType === 'number' && p.kind !== 'number') return false;
      if (propType === 'text' && p.kind !== 'text' && p.kind !== 'url')
        return false;
      if (!q) return true;
      return `${p.label} ${p.value}`.toLowerCase().includes(q);
    });
  }, [allProperties, propSearch, propType]);

  const commits = (item.artifacts || []).filter((a) => a.type === 'commit');
  const otherArtifacts = (item.artifacts || []).filter(
    (a) => a.type !== 'commit'
  );

  const siteDomain = resolveSiteDomain(item.platform, item.domain, item.url);
  const detailsObj = (item.details || {}) as Record<string, unknown>;
  const profileUrl =
    typeof detailsObj.profileUrl === 'string' ? detailsObj.profileUrl : undefined;
  const mapsUrl =
    typeof detailsObj.mapsUrl === 'string' ? detailsObj.mapsUrl : undefined;

  const pivotCandidates = useMemo(() => {
    const out: Array<{ label: string; target: string; type: TargetType }> = [];
    const seen = new Set<string>();
    const pushIfValid = (raw: string | undefined, labelPrefix: string) => {
      if (!raw) return;
      const clean = raw.trim().replace(/^@/, '');
      if (
        !clean ||
        clean.toLowerCase() === investigation.target.toLowerCase() ||
        seen.has(clean.toLowerCase())
      ) {
        return;
      }
      const detected = detectTargetTypeFromInput(clean);
      if (!detected) return;
      seen.add(clean.toLowerCase());
      out.push({
        label: `${labelPrefix}: ${redactPii ? maskPiiString(clean, true) : clean}`,
        target: clean,
        type: detected,
      });
    };

    pushIfValid(item.handle, 'Pivot Handle');
    pushIfValid(
      typeof detailsObj.authorEmail === 'string' ? detailsObj.authorEmail : undefined,
      'Pivot Email'
    );
    pushIfValid(item.domain, 'Pivot Domain');
    for (const sig of item.linkedInfo || []) {
      const m = sig.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      if (m) pushIfValid(m[0], 'Linked Email');
    }
    return out.slice(0, 4);
  }, [item, detailsObj, investigation.target, redactPii]);

  const handleExportItemJson = () => {
    const blob = new Blob([JSON.stringify(item, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parmanu-${item.platform.toLowerCase().replace(/\W+/g, '-')}-${investigation.target.replace(/\W+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="max-w-5xl mx-auto px-3.5 sm:px-8 py-6 sm:py-8 space-y-5 sm:space-y-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-slate-100 cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Results for {maskPiiString(investigation.target, redactPii)}</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportItemJson}>
            <Download className="w-3.5 h-3.5" />
            <span>Export JSON</span>
          </Button>
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0F172A] dark:bg-indigo-600 text-white text-xs font-medium hover:bg-slate-800 dark:hover:bg-indigo-500 transition-colors"
            >
              <span>Open External Profile</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* Main Platform Profile Card */}
      <Card className="p-4 sm:p-8 space-y-5 sm:space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3.5 sm:gap-4 min-w-0">
            {item.avatarUrl ? (
              <SafeAvatar
                src={item.avatarUrl}
                alt={item.platform}
                className="w-16 h-16 rounded-2xl object-cover border border-[#E5E7EB] dark:border-slate-700"
                fallback={
                  <PlatformMark
                    platform={item.platform}
                    domain={item.domain}
                    url={item.url}
                    size="md"
                  />
                }
              />
            ) : (
              <PlatformMark
                platform={item.platform}
                domain={item.domain}
                url={item.url}
                size="md"
              />
            )}

            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl font-bold text-[#0F172A] dark:text-slate-100">
                  {item.platform}
                </h1>
                {siteDomain && (
                  <span className="text-xs font-mono text-slate-400">
                    {siteDomain}
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                {maskPiiString(item.displayName || item.handle || investigation.target, redactPii)} ·{' '}
                <span className="text-indigo-600 dark:text-indigo-400 font-medium">
                  {item.accountType || item.category}
                </span>
              </p>
            </div>
          </div>

          <div className="text-right text-xs text-slate-400">
            <p className="uppercase font-semibold text-slate-600 dark:text-slate-300">
              Module: {item.tool}
            </p>
            <p className="font-mono mt-0.5 tabular-nums">
              {formatDuration(item.durationMs)}
            </p>
          </div>
        </div>

        {item.summary && (
          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed pt-4 border-t border-[#F1F5F9] dark:border-slate-800">
            {maskPiiString(item.summary, redactPii)}
          </p>
        )}

        {onPivotScan && pivotCandidates.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
              <GitBranch className="w-3.5 h-3.5" />
              <span>Pivot Scan:</span>
            </span>
            {pivotCandidates.map((pc) => (
              <button
                key={`${pc.type}-${pc.target}`}
                type="button"
                onClick={() => onPivotScan(pc.target, pc.type)}
                className="px-2.5 py-1 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/60 border border-indigo-200/70 dark:border-indigo-800 text-[11px] font-mono text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/70 transition-colors cursor-pointer"
              >
                {pc.label}
              </button>
            ))}
          </div>
        )}

        {/* Prominent GHunt Profile URL & Maps URL Quick Links when present */}
        {(profileUrl || mapsUrl) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {profileUrl && (
              <a
                href={profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-3.5 rounded-xl bg-[#FAFAFA] dark:bg-slate-900/70 border border-[#E5E7EB] dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-600 flex items-center justify-between gap-3 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <User className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100">
                      Profile URL
                    </p>
                    <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                      {profileUrl}
                    </p>
                  </div>
                </div>
                <ArrowUpRight className="w-4 h-4 text-slate-400 shrink-0" />
              </a>
            )}
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-3.5 rounded-xl bg-[#FAFAFA] dark:bg-slate-900/70 border border-[#E5E7EB] dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-600 flex items-center justify-between gap-3 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <MapPin className="w-4 h-4 text-orange-600 dark:text-orange-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100">
                      Google Maps URL
                    </p>
                    <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                      {mapsUrl}
                    </p>
                  </div>
                </div>
                <ArrowUpRight className="w-4 h-4 text-slate-400 shrink-0" />
              </a>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-[#F1F5F9] dark:border-slate-800 text-xs">
          <div>
            <p className="text-slate-400">Handle / Identifier</p>
            <p className="font-mono font-semibold text-[#0F172A] dark:text-slate-100 mt-1 break-all">
              {item.handle || '—'}
            </p>
          </div>
          <div>
            <p className="text-slate-400">First Seen</p>
            <p className="font-mono text-slate-700 dark:text-slate-300 mt-1 tabular-nums">
              {formatTimestamp(item.firstSeen)}
            </p>
          </div>
          <div>
            <p className="text-slate-400">Last Seen</p>
            <p className="font-mono text-slate-700 dark:text-slate-300 mt-1 tabular-nums">
              {formatTimestamp(item.lastSeen)}
            </p>
          </div>
          <div>
            <p className="text-slate-400">Classification</p>
            <p className="font-semibold text-indigo-600 dark:text-indigo-400 capitalize mt-1">
              {item.findingKind}
            </p>
          </div>
        </div>

        {item.linkedInfo && item.linkedInfo.length > 0 && (
          <div className="pt-4 border-t border-[#F1F5F9] dark:border-slate-800 space-y-2">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Linked Signals
            </p>
            <div className="flex flex-wrap gap-2">
              {item.linkedInfo.map((sig, i) => (
                <span
                  key={i}
                  className="px-3 py-1 rounded-lg bg-[#F8FAFC] dark:bg-slate-900 border border-[#E5E7EB] dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 font-mono"
                >
                  {sig}
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Searchable & Filterable Additional Information Inspector (All extracted attributes) */}
      {allProperties.length > 0 && (
        <Card className="p-4 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-slate-100">
                Additional Information
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                All structured fields, authentication flags, and source attributes returned by {item.platform}.
              </p>
            </div>
            <span className="text-xs text-slate-400 tabular-nums">
              {filteredProperties.length} of {allProperties.length} properties
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={propSearch}
                onChange={(e) => setPropSearch(e.target.value)}
                placeholder="Search properties..."
                className="w-full h-9 pl-8 pr-3 rounded-xl border border-[#E5E7EB] dark:border-slate-700 bg-[#FAFAFA] dark:bg-slate-900 text-xs text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
              />
            </div>

            <div className="flex items-center gap-1 p-1 rounded-xl bg-[#F4F5F7] dark:bg-slate-900 text-xs">
              {(['all', 'boolean', 'text', 'number'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPropType(t)}
                  className={`px-2.5 py-1 rounded-lg font-medium capitalize cursor-pointer transition-colors ${
                    propType === t
                      ? 'bg-white dark:bg-slate-800 text-[#0F172A] dark:text-slate-100 shadow-2xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-slate-100'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-[#F1F5F9] dark:divide-slate-800 border border-[#E5E7EB]/80 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900/70">
            {filteredProperties.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-400">
                No properties match your filter.
              </p>
            ) : (
              filteredProperties.map((prop) => (
                <div
                  key={prop.key}
                  className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs hover:bg-[#FAFAFA] dark:hover:bg-slate-800/60 transition-colors"
                >
                  <span className="text-slate-500 dark:text-slate-400 font-medium">
                    {prop.label}
                  </span>

                  <div className="flex items-center gap-2 min-w-0 max-w-full sm:max-w-[65%]">
                    {prop.kind === 'boolean' ? (
                      prop.rawBool ? (
                        <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                          <Check className="w-3.5 h-3.5" />
                          <span>True</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-medium text-rose-500 dark:text-rose-400">
                          <X className="w-3.5 h-3.5" />
                          <span>False</span>
                        </span>
                      )
                    ) : prop.kind === 'url' ? (
                      <a
                        href={prop.value}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-indigo-600 dark:text-indigo-400 hover:underline underline-offset-2 truncate"
                      >
                        {prop.value}
                      </a>
                    ) : (
                      <span className="font-mono text-[#0F172A] dark:text-slate-100 break-all text-right">
                        {maskPiiString(prop.value, redactPii)}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => handleCopy(prop.key, prop.value)}
                      aria-label={`Copy ${prop.label}`}
                      className="p-1 rounded text-slate-400 hover:text-[#0F172A] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                    >
                      <AnimatePresence mode="wait">
                        {copiedKey === prop.key ? (
                          <motion.span
                            key="copied"
                            initial={{ scale: 0.7, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.7, opacity: 0 }}
                            transition={{ duration: 0.14 }}
                            className="inline-flex text-emerald-600"
                          >
                            <Check className="w-3 h-3" />
                          </motion.span>
                        ) : (
                          <motion.span
                            key="copy"
                            initial={{ scale: 0.85, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.85, opacity: 0 }}
                            transition={{ duration: 0.12 }}
                            className="inline-flex"
                          >
                            <Copy className="w-3 h-3" />
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      )}

      {/* Commits & Live Diff Drill-Down (Only inside expanded platform view) */}
      {commits.length > 0 && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-slate-100 flex items-center gap-2">
              <GitCommitHorizontal className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>Discovered Commits ({commits.length})</span>
            </h2>
            <span className="text-xs text-slate-400">
              Click any commit to load live file diffs
            </span>
          </div>

          <div className="divide-y divide-[#F1F5F9] dark:divide-slate-800 border border-[#E5E7EB]/80 dark:border-slate-800 rounded-xl overflow-hidden">
            {commits.map((c) => {
              const isOpen = expandedCommitId === c.id;
              const diff = commitDetails[c.id];
              const isLoadingDiff = loadingCommitId === c.id;
              return (
                <div key={c.id} className="bg-white dark:bg-slate-900/70">
                  <button
                    type="button"
                    onClick={() => handleToggleCommit(c)}
                    className="w-full px-4 py-3.5 flex items-center justify-between gap-4 text-left hover:bg-[#F8FAFC] dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#0F172A] dark:text-slate-100 truncate">
                        {c.title}
                      </p>
                      <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                        {c.subtitle} · {formatTimestamp(c.timestamp)}
                      </p>
                    </div>
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-4 pt-2 bg-[#FAFAFA] dark:bg-slate-950/60 border-t border-[#F1F5F9] dark:border-slate-800 space-y-3">
                          {isLoadingDiff ? (
                            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 py-3">
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600 dark:text-indigo-400" />
                              <span>Fetching commit diff from GitHub...</span>
                            </div>
                          ) : diff?.error ? (
                            <p className="text-xs text-rose-600 dark:text-rose-400">{diff.error}</p>
                          ) : diff ? (
                            <div className="space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                                <span>
                                  Author:{' '}
                                  <strong className="text-[#0F172A] dark:text-slate-100">
                                    {diff.authorName}
                                  </strong>{' '}
                                  ({diff.authorEmail || 'hidden'})
                                </span>
                                {diff.stats && (
                                  <span className="font-mono tabular-nums">
                                    <span className="text-emerald-600 dark:text-emerald-400">
                                      +{diff.stats.additions ?? 0}
                                    </span>{' '}
                                    /{' '}
                                    <span className="text-rose-600 dark:text-rose-400">
                                      -{diff.stats.deletions ?? 0}
                                    </span>
                                  </span>
                                )}
                              </div>

                              {(diff.files || []).map((file) => (
                                <div
                                  key={file.filename}
                                  className="rounded-lg border border-[#E5E7EB] dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
                                >
                                  <div className="px-3 py-2 bg-[#F8FAFC] dark:bg-slate-950/60 border-b border-[#E5E7EB] dark:border-slate-800 flex items-center justify-between text-xs font-mono">
                                    <span className="text-[#0F172A] dark:text-slate-100 truncate">
                                      {file.filename}
                                    </span>
                                    <span className="text-slate-500 dark:text-slate-400 shrink-0">
                                      +{file.additions} / -{file.deletions}
                                    </span>
                                  </div>
                                  {file.patch && (
                                    <pre className="p-3 text-[11px] font-mono text-slate-700 dark:text-slate-300 overflow-x-auto leading-relaxed">
                                      {file.patch}
                                    </pre>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Repositories / DNS / PhoneInfoga Google Dorks / Additional Artifacts */}
      {otherArtifacts.length > 0 && (
        <Card className="p-6 space-y-4">
          <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-slate-100">
            Associated Artifacts ({otherArtifacts.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {otherArtifacts.map((art) => (
              <div
                key={art.id}
                className="p-4 rounded-xl bg-[#FAFAFA] dark:bg-slate-900/70 border border-[#E5E7EB]/80 dark:border-slate-800 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100 truncate">
                    {art.title}
                  </p>
                  {art.url && (
                    <a
                      href={art.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 shrink-0"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
                {art.subtitle && (
                  <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                    {art.subtitle}
                  </p>
                )}
                {art.summary && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                    {art.summary}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Full Structured Metadata Toggle */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100">
            Full Structured Source Record
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowRawJson((p) => !p)}
          >
            {showRawJson ? 'Hide JSON' : 'Inspect JSON'}
          </Button>
        </div>

        {showRawJson && (
          <pre className="p-4 rounded-xl bg-[#FAFAFA] dark:bg-slate-900 border border-[#E5E7EB] dark:border-slate-800 font-mono text-xs text-slate-700 dark:text-slate-300 overflow-x-auto max-h-96 leading-relaxed">
            {JSON.stringify(item, null, 2)}
          </pre>
        )}
      </Card>
    </motion.div>
  );
}
