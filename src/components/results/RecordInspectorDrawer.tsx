import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  Crosshair,
  ExternalLink,
  Flag,
  GitCommit,
  Globe,
  Loader2,
  Pin,
  ScanFace,
  StickyNote,
  X,
  XCircle,
} from 'lucide-react';
import type {
  EvidenceTag,
  InvestigationResultItem,
  ResultAnnotation,
  TargetType,
} from '@/src/types/investigation';
import { fetchGitHubCommitDetail, formatDuration } from '@/src/lib/api';
import { maskPiiString } from '@/src/lib/annotationsStore';
import { playClickTick, playCopyPing } from '@/src/lib/sound';
import { Button } from '@/src/components/ui/Button';
import { PlatformMark } from '@/src/components/ui/PlatformMark';
import { SafeAvatar } from '@/src/components/ui/SafeAvatar';

interface RecordInspectorDrawerProps {
  item: InvestigationResultItem | null;
  annotation?: ResultAnnotation;
  redactPii: boolean;
  isPinned?: boolean;
  onTogglePin?: (item: InvestigationResultItem) => void;
  onClose: () => void;
  onOpenFullDetail: (item: InvestigationResultItem) => void;
  onUpdateAnnotation: (
    resultId: string,
    patch: { tag?: EvidenceTag | null; note?: string }
  ) => void;
  onPivotScan: (target: string, targetType: TargetType) => void;
  onOpenFacialMatch?: (item: InvestigationResultItem) => void;
}

export function RecordInspectorDrawer({
  item,
  annotation,
  redactPii,
  isPinned = false,
  onTogglePin,
  onClose,
  onOpenFullDetail,
  onUpdateAnnotation,
  onPivotScan,
  onOpenFacialMatch,
}: RecordInspectorDrawerProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState(annotation?.note || '');
  const [loadingSha, setLoadingSha] = useState<string | null>(null);
  const [commitDetails, setCommitDetails] = useState<Record<string, Record<string, unknown>>>({});

  useEffect(() => {
    setNoteDraft(annotation?.note || '');
  }, [item?.id, annotation?.note]);

  useEffect(() => {
    if (!item) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [item, onClose]);

  const pivotCandidates = useMemo(() => {
    if (!item) return [];
    const seen = new Set<string>();
    const list: Array<{ target: string; type: TargetType; label: string }> = [];
    const add = (target: string | undefined, type: TargetType, label: string) => {
      const clean = (target || '').trim();
      if (!clean || clean.length < 2) return;
      const key = `${type}:${clean.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ target: clean, type, label });
    };

    if (item.handle) {
      const hType: TargetType = item.handle.includes('@')
        ? 'email'
        : /^\+?\d[\d\s-]{6,}$/.test(item.handle)
        ? 'phone'
        : /^(?:\d{1,3}\.){3}\d{1,3}$/.test(item.handle)
        ? 'ip'
        : item.handle.includes('.') && !item.handle.includes(' ')
        ? 'domain'
        : 'username';
      add(item.handle, hType, `Handle: ${item.handle}`);
    }
    if (item.domain && !item.domain.includes(' ')) {
      add(item.domain, 'domain', `Domain: ${item.domain}`);
    }
    for (const f of item.displayFields || []) {
      if (f.kind === 'email') add(f.value, 'email', `Email: ${f.value}`);
      if (f.kind === 'phone') add(f.value, 'phone', `Phone: ${f.value}`);
      if (f.label.toLowerCase().includes('username') && f.value) {
        add(f.value, 'username', `User: ${f.value}`);
      }
      if (f.label.toLowerCase().includes('ip') && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(f.value)) {
        add(f.value, 'ip', `IP: ${f.value}`);
      }
    }
    for (const art of item.artifacts || []) {
      if (art.authorEmail && !art.authorEmail.endsWith('users.noreply.github.com')) {
        add(art.authorEmail, 'email', `Commit Email: ${art.authorEmail}`);
      }
    }
    return list.slice(0, 5);
  }, [item]);

  if (!item) return null;

  const displaySummary = redactPii && item.summary
    ? maskPiiString(item.summary, true)
    : item.summary;

  const handleCopy = (key: string, val: string) => {
    navigator.clipboard.writeText(val);
    playCopyPing();
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1400);
  };

  const handleInspectCommit = async (repo: string, sha: string) => {
    playClickTick();
    setLoadingSha(sha);
    try {
      const data = await fetchGitHubCommitDetail(repo, sha);
      setCommitDetails((prev) => ({ ...prev, [sha]: data }));
    } finally {
      setLoadingSha(null);
    }
  };

  const tagOptions: Array<{
    id: EvidenceTag;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    activeCls: string;
  }> = [
    {
      id: 'verified',
      label: 'Verified',
      icon: CheckCircle2,
      activeCls:
        'bg-emerald-600 text-white border-emerald-600 dark:bg-emerald-500 dark:border-emerald-500',
    },
    {
      id: 'needs_review',
      label: 'Needs Review',
      icon: Flag,
      activeCls:
        'bg-amber-600 text-white border-amber-600 dark:bg-amber-500 dark:border-amber-500',
    },
    {
      id: 'false_positive',
      label: 'False Positive',
      icon: XCircle,
      activeCls:
        'bg-rose-600 text-white border-rose-600 dark:bg-rose-500 dark:border-rose-500',
    },
  ];

  const commits = (item.artifacts || []).filter((a) => a.type === 'commit');

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/35 dark:bg-black/65 backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        aria-label={`Inspect ${item.platform}`}
        className="w-full max-w-xl h-full bg-white dark:bg-[#0B1120] border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {item.avatarUrl ? (
              <SafeAvatar
                src={item.avatarUrl}
                alt={item.platform}
                className="w-10 h-10 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
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
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-base font-bold text-[#0F172A] dark:text-slate-100 truncate">
                  {item.platform}
                </h2>
                <span className="text-[11px] font-semibold uppercase text-indigo-600 dark:text-indigo-400">
                  {item.tool}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {item.category} · {formatDuration(item.durationMs)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            {onTogglePin && (
              <Button
                variant={isPinned ? 'primary' : 'outline'}
                size="sm"
                onClick={() => onTogglePin(item)}
              >
                <Pin className="w-3.5 h-3.5" />
                <span>{isPinned ? 'Pinned' : 'Pin'}</span>
              </Button>
            )}
            {item.avatarUrl && onOpenFacialMatch && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenFacialMatch(item)}
              >
                <ScanFace className="w-3.5 h-3.5 text-indigo-600" />
                <span>Face Match</span>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenFullDetail(item)}
            >
              <span>Full Page</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close inspector"
              className="p-2 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 sm:space-y-6">
          {displaySummary && (
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#11192E] border border-slate-200/80 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
              {displaySummary}
            </div>
          )}

          {/* Evidence Tagging & Case Note */}
          <div className="p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0E1526] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#0F172A] dark:text-slate-100 flex items-center gap-1.5">
                <Flag className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                <span>Analyst Evidence Classification</span>
              </span>
              {annotation?.tag && (
                <button
                  type="button"
                  onClick={() => onUpdateAnnotation(item.id, { tag: null })}
                  className="text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  Clear tag
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {tagOptions.map((opt) => {
                const Icon = opt.icon;
                const active = annotation?.tag === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      onUpdateAnnotation(item.id, { tag: active ? null : opt.id })
                    }
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                      active
                        ? opt.activeCls
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-1.5 pt-1">
              <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <StickyNote className="w-3 h-3" />
                <span>Finding Note</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onBlur={() => {
                    if (noteDraft !== (annotation?.note || '')) {
                      onUpdateAnnotation(item.id, { note: noteDraft });
                    }
                  }}
                  placeholder="Add verification context, false-positive rationale, or pivot note..."
                  className="flex-1 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 text-xs text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onUpdateAnnotation(item.id, { note: noteDraft })}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>

          {/* One-Click Multi-Target Pivot Actions */}
          {pivotCandidates.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0F172A] dark:text-slate-100">
                <Crosshair className="w-3.5 h-3.5 text-orange-600" />
                <span>Pivot Investigation From Discovered Signals</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {pivotCandidates.map((cand) => (
                  <button
                    key={`${cand.type}-${cand.target}`}
                    type="button"
                    onClick={() => onPivotScan(cand.target, cand.type)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-orange-200 dark:border-orange-900/60 bg-orange-50/70 dark:bg-orange-950/30 text-xs font-medium text-orange-900 dark:text-orange-200 hover:bg-orange-100 dark:hover:bg-orange-900/40 transition-colors cursor-pointer"
                  >
                    <Crosshair className="w-3 h-3 text-orange-600" />
                    <span className="font-mono">
                      {redactPii ? maskPiiString(cand.label, true) : cand.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Display Fields */}
          {item.displayFields && item.displayFields.length > 0 && (
            <div className="space-y-2.5">
              <h3 className="text-xs font-semibold text-[#0F172A] dark:text-slate-100">
                Extracted Attributes
              </h3>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-800 overflow-hidden">
                {item.displayFields.map((f, idx) => {
                  const shown = redactPii ? maskPiiString(f.value, true) : f.value;
                  return (
                    <div
                      key={`${f.label}-${idx}`}
                      className="px-3.5 py-2.5 bg-white dark:bg-[#0E1526] flex flex-wrap items-center justify-between gap-2 sm:gap-3 text-xs"
                    >
                      <span className="text-slate-500 dark:text-slate-400 font-medium shrink-0">
                        {f.label}
                      </span>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono font-semibold text-[#0F172A] dark:text-slate-100 break-all">
                          {shown}
                        </span>
                        {f.copyable && (
                          <button
                            type="button"
                            onClick={() => handleCopy(f.label, f.value)}
                            className="p-1 text-slate-400 hover:text-indigo-600 cursor-pointer shrink-0"
                            aria-label={`Copy ${f.label}`}
                          >
                            {copiedKey === f.label ? (
                              <Check className="w-3 h-3 text-emerald-500" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* GitHub Commit Quick Diff Loader */}
          {commits.length > 0 && (
            <div className="space-y-2.5">
              <h3 className="text-xs font-semibold text-[#0F172A] dark:text-slate-100 flex items-center gap-1.5">
                <GitCommit className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                <span>Public Commits ({commits.length})</span>
              </h3>
              <div className="space-y-2">
                {commits.slice(0, 6).map((c) => {
                  const loaded = c.sha ? commitDetails[c.sha] : undefined;
                  return (
                    <div
                      key={c.id}
                      className="p-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-[#11192E] space-y-2 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-[#0F172A] dark:text-slate-100 truncate">
                            {c.title}
                          </p>
                          <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {c.repository} · {c.sha?.slice(0, 7)}
                          </p>
                        </div>
                        {c.repository && c.sha && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleInspectCommit(c.repository!, c.sha!)}
                            disabled={loadingSha === c.sha}
                          >
                            {loadingSha === c.sha ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <span>Diff</span>
                            )}
                          </Button>
                        )}
                      </div>
                      {loaded && (
                        <pre className="p-2.5 rounded-lg bg-[#0F172A] text-slate-100 font-mono text-[11px] overflow-x-auto max-h-48">
                          {JSON.stringify(loaded, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* External Source Link */}
          {item.url && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-3.5 rounded-xl bg-slate-50 dark:bg-[#11192E] border border-slate-200/80 dark:border-slate-800 text-xs">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Globe className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="font-mono text-slate-600 dark:text-slate-300 truncate">
                  {item.url}
                </span>
              </div>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-indigo-600 dark:text-indigo-400 hover:underline shrink-0 ml-2"
              >
                <span>Open URL</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {item.findingKind === 'breached' && (
            <div className="p-3.5 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-900/60 flex items-start gap-2.5 text-xs text-rose-800 dark:text-rose-200">
              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <span>
                Breach exposure record indexed via public exposure feeds. Verify
                credential rotation if password hashes were included.
              </span>
            </div>
          )}

          {/* Raw Structured Payload */}
          {item.details && Object.keys(item.details).length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-[#0F172A] dark:text-slate-100">
                Raw Structured Telemetry
              </h3>
              <pre className="p-4 rounded-xl bg-[#0F172A] text-slate-100 font-mono text-[11px] overflow-x-auto max-h-64 leading-relaxed">
                {JSON.stringify(item.details, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
