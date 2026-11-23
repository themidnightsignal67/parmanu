import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUpRight,
  Check,
  Copy,
  Mail,
  MapPin,
  Pin,
  Search,
  Tag,
  X,
} from 'lucide-react';
import { formatShortDate } from '@/src/lib/api';
import type {
  DisplayField,
  InvestigationResultItem,
  ResultAnnotation,
} from '@/src/types/investigation';
import { maskPiiString } from '@/src/lib/annotationsStore';
import { playClickTick, playCopyPing } from '@/src/lib/sound';
import { Card } from '@/src/components/ui/Card';
import { PlatformMark, resolveSiteDomain } from '@/src/components/ui/PlatformMark';
import { SafeAvatar } from '@/src/components/ui/SafeAvatar';

interface ResultCardProps {
  item: InvestigationResultItem;
  annotation?: ResultAnnotation;
  redactPii?: boolean;
  highlighted?: boolean;
  isPinned?: boolean;
  isNewInRescan?: boolean;
  onTogglePin?: (item: InvestigationResultItem) => void;
  onSelect: (item: InvestigationResultItem) => void;
}

function buildFallbackFields(item: InvestigationResultItem): DisplayField[] {
  const fields: DisplayField[] = [];
  const d = (item.details || {}) as Record<string, unknown>;

  const rawId = d.id || d.player_id || d.gaiaId || d.uid;
  if (typeof rawId === 'string' || typeof rawId === 'number') {
    fields.push({ label: 'ID', value: String(rawId), copyable: true });
  }

  if (item.handle) {
    const isEmail = item.handle.includes('@');
    fields.push({
      label: isEmail ? 'Email' : 'Username',
      value: item.handle,
      kind: isEmail ? 'email' : 'text',
      copyable: true,
    });
  }

  if (item.displayName && item.displayName !== item.handle) {
    fields.push({ label: 'Name', value: item.displayName, copyable: true });
  }

  if (typeof d.profileUrl === 'string' && d.profileUrl) {
    fields.push({
      label: 'Profile URL',
      value: d.profileUrl,
      kind: 'url',
      copyable: true,
    });
  }

  if (typeof d.mapsUrl === 'string' && d.mapsUrl) {
    fields.push({
      label: 'Maps URL',
      value: d.mapsUrl,
      kind: 'url',
      copyable: true,
    });
  }

  if (item.accountType && fields.length < 4) {
    fields.push({ label: 'Account Type', value: item.accountType });
  }

  if (typeof d.location === 'string' && d.location && fields.length < 5) {
    fields.push({ label: 'Location', value: d.location, copyable: true });
  }

  if (item.firstSeen && fields.length < 5) {
    fields.push({
      label: 'Joined At',
      value: formatShortDate(item.firstSeen),
      kind: 'date',
    });
  }

  return fields.slice(0, 5);
}

export function ResultCard({
  item,
  annotation,
  redactPii = false,
  highlighted = false,
  isPinned = false,
  isNewInRescan = false,
  onTogglePin,
  onSelect,
}: ResultCardProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const kindLabel =
    item.findingKind === 'breached'
      ? 'Breached'
      : item.findingKind === 'leaked'
      ? 'Leaked'
      : item.findingKind === 'infrastructure'
      ? 'Infrastructure'
      : 'Registered';

  const domainHost =
    resolveSiteDomain(item.platform, item.domain, item.url) || kindLabel;

  const fields = useMemo(() => {
    const source =
      item.displayFields && item.displayFields.length > 0
        ? item.displayFields
        : buildFallbackFields(item);
    const seen = new Set<string>();
    const deduped: DisplayField[] = [];
    for (const f of source) {
      const k = f.label.trim().toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      deduped.push(f);
      if (deduped.length >= 5) break;
    }
    return deduped;
  }, [item]);

  const handleCopy = (field: string, value: string) => {
    if (!value || value === '—') return;
    navigator.clipboard.writeText(value).catch(() => {});
    playCopyPing();
    setCopiedField(field);
    window.setTimeout(() => {
      setCopiedField((prev) => (prev === field ? null : prev));
    }, 1500);
  };

  const mapsField = fields.find(
    (f) => f.label.toLowerCase().includes('maps') && f.kind === 'url'
  );
  const profileField = fields.find(
    (f) => f.label.toLowerCase().includes('profile url') && f.kind === 'url'
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <Card
        className={`p-4 sm:p-5 flex flex-col justify-between gap-4 h-full text-left ${
          highlighted ? 'ring-2 ring-indigo-500/70' : ''
        } ${annotation?.tag === 'false_positive' ? 'opacity-65' : ''}`}
      >
        <div className="space-y-3.5">
          {/* Header: Avatar/Placeholder + Real Site Favicon + Name + Domain */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {item.avatarUrl ? (
                <SafeAvatar
                  src={item.avatarUrl}
                  alt={`${item.platform} avatar`}
                  className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
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
                <div className="flex items-center gap-1.5 min-w-0">
                  {item.avatarUrl && (
                    <PlatformMark
                      platform={item.platform}
                      domain={item.domain}
                      url={item.url}
                      size="sm"
                    />
                  )}
                  <h3 className="text-sm font-semibold text-[#0F172A] dark:text-slate-100 truncate">
                    {item.platform}
                  </h3>
                  {isNewInRescan && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/70 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-300 shrink-0">
                      + New
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                  <p className="text-xs text-slate-400 truncate">
                    {domainHost}
                  </p>
                  {annotation?.tag && (
                    <>
                      <span className="text-slate-300 dark:text-slate-700">·</span>
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${
                          annotation.tag === 'verified'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : annotation.tag === 'false_positive'
                            ? 'text-rose-500 dark:text-rose-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {annotation.tag.replace('_', ' ')}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {onTogglePin && (
                <button
                  type="button"
                  onClick={() => onTogglePin(item)}
                  aria-label={isPinned ? `Unpin ${item.platform}` : `Pin ${item.platform} to Evidence Board`}
                  title={isPinned ? 'Unpin from Evidence Board' : 'Pin to Evidence Board'}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                    isPinned
                      ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400'
                      : 'text-slate-400 hover:text-[#0F172A] dark:hover:text-white hover:bg-slate-100/80 dark:hover:bg-slate-800'
                  }`}
                >
                  <Pin className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  playClickTick();
                  onSelect(item);
                }}
                aria-label={`Inspect ${item.platform} details`}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-[#0F172A] dark:hover:text-white hover:bg-slate-100/80 dark:hover:bg-slate-800 flex items-center justify-center shrink-0 transition-colors cursor-pointer"
              >
                <Tag className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Dynamic Variable-Field Rows (Exact attributes discovered for this platform) */}
          <div className="divide-y divide-[#F1F5F9] dark:divide-slate-800/80 border-t border-[#F1F5F9] dark:border-slate-800/80 text-xs">
            {fields.map((f, idx) => {
              const isBool = f.kind === 'boolean';
              const boolTrue = /^(yes|true|enabled|verified)$/i.test(
                f.value.trim()
              );
              const isUrl = f.kind === 'url' || /^https?:\/\//i.test(f.value);
              const isEmail = f.kind === 'email' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.value);

              return (
                <div
                  key={`${f.label}-${idx}`}
                  className="py-2 flex items-center justify-between gap-3"
                >
                  <span className="text-slate-500 font-medium shrink-0">
                    {f.label}
                  </span>

                  <div className="flex items-center gap-1.5 min-w-0 justify-end">
                    {isBool ? (
                      boolTrue ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                          <Check className="w-3.5 h-3.5" />
                          <span>{f.value}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-500 font-medium">
                          <X className="w-3.5 h-3.5" />
                          <span>{f.value}</span>
                        </span>
                      )
                    ) : isUrl ? (
                      <a
                        href={f.value}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-indigo-600 hover:text-indigo-700 underline decoration-indigo-200 underline-offset-2 truncate max-w-[140px] sm:max-w-[165px]"
                        title={f.value}
                      >
                        {f.value.replace(/^https?:\/\/(www\.)?/i, '')}
                      </a>
                    ) : (
                      <span
                        className={`font-medium truncate max-w-[140px] sm:max-w-[175px] ${
                          f.kind === 'date'
                            ? 'font-mono text-slate-600 dark:text-slate-300 tabular-nums'
                            : 'text-[#0F172A] dark:text-slate-100 font-mono'
                        }`}
                        title={redactPii ? maskPiiString(f.value, true) : f.value}
                      >
                        {redactPii ? maskPiiString(f.value, true) : f.value}
                      </span>
                    )}

                    {(f.copyable ?? !isBool) && (
                      <button
                        type="button"
                        onClick={() => handleCopy(f.label, f.value)}
                        aria-label={`Copy ${f.label}`}
                        className="relative p-1 rounded text-slate-400 hover:text-[#0F172A] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                      >
                        <AnimatePresence mode="wait">
                          {copiedField === f.label ? (
                            <motion.span
                              key="copied"
                              initial={{ scale: 0.7, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={{ scale: 0.7, opacity: 0 }}
                              transition={{ duration: 0.14 }}
                              className="inline-flex items-center gap-0.5 text-emerald-600"
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
                    )}

                    {isEmail && (
                      <a
                        href={`https://www.google.com/search?q=${encodeURIComponent(
                          `"${f.value}"`
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Search ${f.value}`}
                        className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50/70 dark:hover:bg-indigo-950/60 transition-colors shrink-0"
                      >
                        <Search className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {item.statsLine ? (
            <div className="px-3 py-1.5 rounded-lg bg-[#F8FAFC] dark:bg-[#0B1120] border border-[#E5E7EB]/70 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300 font-medium tabular-nums truncate">
              {item.statsLine}
            </div>
          ) : (
            item.summary && (
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
                {redactPii ? maskPiiString(item.summary, true) : item.summary}
              </p>
            )
          )}
        </div>

        {/* Footer: External Profile / Maps Link + Expand results */}
        <div className="pt-3 border-t border-[#F1F5F9] dark:border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            {profileField ? (
              <a
                href={profileField.value}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-[#0F172A] dark:hover:text-white transition-colors whitespace-nowrap"
              >
                <Mail className="w-3 h-3 text-slate-400" />
                <span>Profile</span>
                <ArrowUpRight className="w-3 h-3" />
              </a>
            ) : item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-[#0F172A] dark:hover:text-white transition-colors whitespace-nowrap"
              >
                <span>View profile</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            ) : (
              <span className="text-xs text-slate-400 truncate">
                {kindLabel}
              </span>
            )}

            {mapsField && (
              <a
                href={mapsField.value}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 transition-colors whitespace-nowrap"
              >
                <MapPin className="w-3 h-3" />
                <span>Maps</span>
                <ArrowUpRight className="w-3 h-3" />
              </a>
            )}
          </div>

          <button
            type="button"
            onClick={() => onSelect(item)}
            className="px-3 py-1.5 rounded-lg border border-[#E5E7EB] dark:border-slate-700 bg-white dark:bg-[#11192E] hover:bg-[#FAFAFA] dark:hover:bg-slate-800 text-xs font-medium text-[#0F172A] dark:text-slate-100 transition-colors cursor-pointer shrink-0"
          >
            Inspect
          </button>
        </div>
      </Card>
    </motion.div>
  );
}
