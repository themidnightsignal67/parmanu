import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Archive,
  ArrowUpDown,
  ArrowUpRight,
  Clock,
  GitCommit,
  Globe,
  Search,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import type {
  GoogleDorkResponse,
  InvestigationRecord,
  InvestigationResultItem,
} from '@/src/types/investigation';
import { Card } from '@/src/components/ui/Card';

interface IntelligenceTimelineCardProps {
  investigation: InvestigationRecord;
  dorkReport?: GoogleDorkResponse | null;
  onSelectResult: (item: InvestigationResultItem) => void;
}

type TimelineCategory = 'all' | 'breach' | 'account' | 'infrastructure' | 'archive';

interface TimelineEvent {
  id: string;
  category: Exclude<TimelineCategory, 'all'>;
  sortMs: number;
  dateLabel: string;
  relativeLabel?: string;
  title: string;
  subtitle: string;
  detail: string;
  severity?: 'high' | 'medium' | 'low';
  linkedResult?: InvestigationResultItem;
  externalUrl?: string;
}

function parseSortableMs(raw?: string): number {
  if (!raw) return 0;
  const trimmed = raw.trim();
  if (/^\d{4}$/.test(trimmed)) {
    return Date.parse(`${trimmed}-01-01T00:00:00Z`) || 0;
  }
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? 0 : ms;
}

function formatDateLabel(raw?: string, fallback?: string): string {
  if (!raw) return fallback || 'Indexed';
  const trimmed = raw.trim();
  if (/^\d{4}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const d = new Date(trimmed);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return fallback || trimmed;
}

export function IntelligenceTimelineCard({
  investigation,
  dorkReport,
  onSelectResult,
}: IntelligenceTimelineCardProps) {
  const [categoryFilter, setCategoryFilter] = useState<TimelineCategory>('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [searchQuery, setSearchQuery] = useState('');

  const events = useMemo<TimelineEvent[]>(() => {
    const list: TimelineEvent[] = [];
    const seenKeys = new Set<string>();

    const pushEvent = (ev: TimelineEvent) => {
      const dedupeKey = `${ev.category}:${ev.title.toLowerCase()}:${ev.dateLabel}`;
      if (seenKeys.has(dedupeKey)) return;
      seenKeys.add(dedupeKey);
      list.push(ev);
    };

    // 1. Security Breaches & Exposed Incidents
    for (const breach of investigation.breachedAccounts) {
      const linked =
        investigation.results.find((r) => r.id === breach.resultId) ||
        investigation.results.find(
          (r) =>
            r.findingKind === 'breached' &&
            r.platform.toLowerCase() === breach.platform.toLowerCase()
        );
      const rawDate = breach.date || linked?.firstSeen;
      const ms = parseSortableMs(rawDate);
      pushEvent({
        id: `tl-breach-${breach.id}`,
        category: 'breach',
        sortMs: ms,
        dateLabel: formatDateLabel(rawDate, breach.relativeTime),
        relativeLabel: breach.relativeTime,
        title: `${breach.platform} Security Breach`,
        subtitle: breach.domain ? `${breach.domain} · ${breach.severity.toUpperCase()} severity` : `${breach.severity.toUpperCase()} severity`,
        detail:
          breach.dataClasses.length > 0
            ? `Exposed classes: ${breach.dataClasses.slice(0, 5).join(', ')}`
            : breach.summary || 'Indexed public credential exposure.',
        severity: breach.severity,
        linkedResult: linked,
        externalUrl: breach.domain ? `https://${breach.domain}` : undefined,
      });
    }

    // 2. Results: Accounts, Infrastructure, Leaked Signals, and dated Artifacts
    for (const item of investigation.results) {
      if (item.status !== 'found') continue;

      if (item.findingKind === 'leaked' || item.findingKind === 'breached') {
        const rawDate = item.firstSeen || item.lastSeen;
        pushEvent({
          id: `tl-leak-${item.id}`,
          category: 'breach',
          sortMs: parseSortableMs(rawDate),
          dateLabel: formatDateLabel(rawDate, item.relativeTime),
          relativeLabel: item.relativeTime,
          title: `${item.platform} (${item.findingKind === 'breached' ? 'Breached' : 'Leaked Exposure'})`,
          subtitle: item.handle || item.domain || item.tool,
          detail: item.summary || 'Public leak/breach artifact detected.',
          severity: 'high',
          linkedResult: item,
          externalUrl: item.url,
        });
      } else if (item.findingKind === 'infrastructure') {
        if (item.firstSeen) {
          pushEvent({
            id: `tl-infra-reg-${item.id}`,
            category: 'infrastructure',
            sortMs: parseSortableMs(item.firstSeen),
            dateLabel: formatDateLabel(item.firstSeen),
            title: `${item.platform} · Domain Registered`,
            subtitle: item.domain || item.handle || 'RDAP Registry',
            detail: item.summary || 'Initial domain registration record.',
            linkedResult: item,
            externalUrl: item.url,
          });
        }
        if (item.lastSeen && item.lastSeen !== item.firstSeen) {
          pushEvent({
            id: `tl-infra-upd-${item.id}`,
            category: 'infrastructure',
            sortMs: parseSortableMs(item.lastSeen),
            dateLabel: formatDateLabel(item.lastSeen),
            title: `${item.platform} · Registry Updated`,
            subtitle: item.domain || 'RDAP Change Event',
            detail: 'Domain WHOIS/RDAP metadata last modified.',
            linkedResult: item,
            externalUrl: item.url,
          });
        }
      } else {
        if (item.firstSeen) {
          pushEvent({
            id: `tl-acc-first-${item.id}`,
            category: 'account',
            sortMs: parseSortableMs(item.firstSeen),
            dateLabel: formatDateLabel(item.firstSeen),
            relativeLabel: item.relativeTime,
            title: `${item.platform} · Profile Created`,
            subtitle: item.handle
              ? item.handle.includes('@')
                ? item.handle
                : `@${item.handle.replace(/^@/, '')}`
              : item.domain || item.category,
            detail: item.summary || 'Verified public account registration.',
            linkedResult: item,
            externalUrl: item.url,
          });
        }
        if (item.lastSeen && item.lastSeen !== item.firstSeen) {
          pushEvent({
            id: `tl-acc-last-${item.id}`,
            category: 'account',
            sortMs: parseSortableMs(item.lastSeen),
            dateLabel: formatDateLabel(item.lastSeen),
            relativeLabel: item.relativeTime,
            title: `${item.platform} · Recent Activity`,
            subtitle: item.handle
              ? item.handle.includes('@')
                ? item.handle
                : `@${item.handle.replace(/^@/, '')}`
              : item.category,
            detail: item.statsLine || item.summary || 'Latest observed public profile update.',
            linkedResult: item,
            externalUrl: item.url,
          });
        }
      }

      // Artifacts (Commits, Repos, TLS certs)
      if (Array.isArray(item.artifacts)) {
        for (const art of item.artifacts.slice(0, 14)) {
          if (!art.timestamp) continue;
          const isDns = art.type === 'dns_record';
          pushEvent({
            id: `tl-art-${item.id}-${art.id}`,
            category: isDns ? 'infrastructure' : 'account',
            sortMs: parseSortableMs(art.timestamp),
            dateLabel: formatDateLabel(art.timestamp),
            title: art.title,
            subtitle: [item.platform, art.repository, art.authorEmail].filter(Boolean).join(' · '),
            detail: art.summary || art.subtitle || 'Artifact timestamp recorded.',
            linkedResult: item,
            externalUrl: art.url,
          });
        }
      }
    }

    // 3. Dated Google Dork & Archive Hits (if executed)
    if (dorkReport) {
      for (const hit of dorkReport.hits) {
        if (!hit.timestamp) continue;
        pushEvent({
          id: `tl-dork-${hit.id}`,
          category: 'archive',
          sortMs: parseSortableMs(hit.timestamp),
          dateLabel: formatDateLabel(hit.timestamp),
          title: hit.title,
          subtitle: `${hit.sourceEngine} · ${hit.domain} (${hit.fileType})`,
          detail: hit.snippet,
          externalUrl: hit.url,
        });
      }
    }

    // 4. Current Scan Execution Anchor
    pushEvent({
      id: `tl-scan-anchor-${investigation.scanId}`,
      category: 'infrastructure',
      sortMs: parseSortableMs(investigation.createdAt),
      dateLabel: formatDateLabel(investigation.createdAt),
      title: `Parmanu OSINT Scan Executed (${investigation.target})`,
      subtitle: `${investigation.summary.found} verified signals · ${investigation.summary.breached} breaches`,
      detail: `Active modules: ${investigation.selectedTools.join(', ')}`,
    });

    return list;
  }, [investigation, dorkReport]);

  const counts = useMemo(() => {
    return {
      all: events.length,
      breach: events.filter((e) => e.category === 'breach').length,
      account: events.filter((e) => e.category === 'account').length,
      infrastructure: events.filter((e) => e.category === 'infrastructure').length,
      archive: events.filter((e) => e.category === 'archive').length,
    };
  }, [events]);

  const visibleEvents = useMemo(() => {
    const byCat =
      categoryFilter === 'all'
        ? events
        : events.filter((e) => e.category === categoryFilter);

    const q = searchQuery.trim().toLowerCase();
    const bySearch = q
      ? byCat.filter((e) =>
          `${e.title} ${e.subtitle} ${e.detail} ${e.dateLabel}`
            .toLowerCase()
            .includes(q)
        )
      : byCat;

    return [...bySearch].sort((a, b) => {
      if (a.sortMs === b.sortMs) {
        return a.title.localeCompare(b.title);
      }
      return sortOrder === 'desc' ? b.sortMs - a.sortMs : a.sortMs - b.sortMs;
    });
  }, [events, categoryFilter, searchQuery, sortOrder]);

  return (
    <Card className="p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-xl bg-[#F8FAFC] dark:bg-slate-800 border border-[#E5E7EB] dark:border-slate-700 text-[#0F172A] dark:text-slate-100 flex items-center justify-center shrink-0 mt-0.5">
            <Clock className="w-4 h-4 text-orange-600" />
          </span>
          <div>
            <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-slate-100">
              Chronological Breach & Signal Timeline
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Unified historical sequence of breach exposures, account creations,
              GitHub commits, DNS/TLS milestones, and indexed web archives.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))
          }
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#FAFAFA] dark:bg-[#11192E] border border-[#E5E7EB] dark:border-slate-700 text-xs font-medium text-[#0F172A] dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
        >
          <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
          <span>{sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}</span>
        </button>
      </div>

      {/* Category Filter Bar + Inline Search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {(
            [
              { id: 'all', label: `All Events (${counts.all})` },
              { id: 'breach', label: `Breaches & Leaks (${counts.breach})` },
              { id: 'account', label: `Accounts & Commits (${counts.account})` },
              { id: 'infrastructure', label: `Infrastructure (${counts.infrastructure})` },
              { id: 'archive', label: `Archives & Dorks (${counts.archive})` },
            ] as const
          ).map((tab) => {
            const active = categoryFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategoryFilter(tab.id)}
                className={`relative px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="timeline-tab-pill"
                    transition={{ type: 'spring', stiffness: 440, damping: 34 }}
                    className="absolute inset-0 rounded-xl bg-[#0F172A] dark:bg-indigo-600"
                  />
                )}
                <span className="relative z-10">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter timeline events..."
            className="w-full h-8.5 pl-8 pr-3 rounded-lg bg-[#FAFAFA] dark:bg-[#11192E] border border-[#E5E7EB] dark:border-slate-700 text-xs text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
          />
        </div>
      </div>

      {/* Vertical Timeline List */}
      {visibleEvents.length === 0 ? (
        <div className="py-10 text-center text-xs text-slate-400 border border-dashed border-[#E5E7EB] dark:border-slate-800 rounded-xl">
          No chronological events match this filter yet.
        </div>
      ) : (
        <div className="relative pl-6 space-y-3 before:content-[''] before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-slate-200 dark:before:bg-slate-800">
          {visibleEvents.slice(0, 40).map((ev) => {
            const isBreach = ev.category === 'breach';
            const isAccount = ev.category === 'account';
            const isArchive = ev.category === 'archive';
            const Icon = isBreach
              ? ShieldAlert
              : isAccount
              ? ev.title.toLowerCase().includes('commit')
                ? GitCommit
                : UserCheck
              : isArchive
              ? Archive
              : Globe;

            return (
              <div
                key={ev.id}
                className="relative group"
              >
                {/* Node Marker */}
                <span
                  className={`absolute -left-6 top-3 w-5.5 h-5.5 rounded-full border flex items-center justify-center bg-white dark:bg-[#0D1424] ${
                    isBreach
                      ? 'border-rose-300 dark:border-rose-700 text-rose-600 dark:text-rose-400'
                      : isAccount
                      ? 'border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400'
                      : isArchive
                      ? 'border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400'
                      : 'border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                </span>

                {/* Event Card Row */}
                <div className="p-3.5 rounded-xl bg-[#FAFAFA]/80 dark:bg-[#0B1120] border border-[#E5E7EB]/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-white dark:hover:bg-[#11192E] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-mono font-semibold text-[#0F172A] dark:text-slate-100 tabular-nums">
                        {ev.dateLabel}
                      </span>
                      {ev.relativeLabel && ev.relativeLabel !== ev.dateLabel && (
                        <>
                          <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                          <span className="text-slate-500 dark:text-slate-400">{ev.relativeLabel}</span>
                        </>
                      )}
                      <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                      <span
                        className={`font-medium ${
                          isBreach
                            ? 'text-rose-600 dark:text-rose-400'
                            : isAccount
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : isArchive
                            ? 'text-orange-600 dark:text-orange-400'
                            : 'text-indigo-600 dark:text-indigo-400'
                        }`}
                      >
                        {isBreach
                          ? 'Breach / Exposure'
                          : isAccount
                          ? 'Account Activity'
                          : isArchive
                          ? 'Archive / Web Dork'
                          : 'Infrastructure'}
                      </span>
                    </div>

                    <p className="text-sm font-semibold text-[#0F172A] dark:text-slate-100">
                      {ev.title}
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      {ev.detail}
                    </p>
                    <p className="text-[11px] font-mono text-slate-400 truncate">
                      {ev.subtitle}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {ev.linkedResult && (
                      <button
                        type="button"
                        onClick={() => onSelectResult(ev.linkedResult!)}
                        className="px-3 py-1.5 rounded-lg bg-white dark:bg-[#11192E] border border-[#E5E7EB] dark:border-slate-700 text-xs font-medium text-[#0F172A] dark:text-slate-100 hover:border-indigo-300 dark:hover:border-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-400 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        Inspect Record
                      </button>
                    )}
                    {ev.externalUrl && (
                      <a
                        href={ev.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-lg bg-white dark:bg-[#11192E] border border-[#E5E7EB] dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-indigo-600 hover:border-indigo-300 transition-colors"
                        aria-label={`Open ${ev.title} link`}
                      >
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
