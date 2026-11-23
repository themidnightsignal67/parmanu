import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowUpRight,
  Clock,
  EyeOff,
  FileSearch,
  ShieldAlert,
} from 'lucide-react';
import type {
  GoogleDorkResponse,
  InvestigationRecord,
  InvestigationResultItem,
} from '@/src/types/investigation';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { IntelligenceTimelineCard } from '@/src/components/results/IntelligenceTimelineCard';
import { buildInvestigationRedactedCopy } from '@/src/lib/annotationsStore';

interface TimelinePageProps {
  investigation: InvestigationRecord;
  dorkReport?: GoogleDorkResponse | null;
  redactPii: boolean;
  onToggleRedactPii: () => void;
  onBackToResults: () => void;
  onSelectResult: (item: InvestigationResultItem) => void;
  onOpenForensics?: () => void;
}

export function TimelinePage({
  investigation,
  dorkReport,
  redactPii,
  onToggleRedactPii,
  onBackToResults,
  onSelectResult,
  onOpenForensics,
}: TimelinePageProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<'all' | 'dated' | 'high'>('all');

  const displayInvestigation = useMemo(
    () => buildInvestigationRedactedCopy(investigation, redactPii),
    [investigation, redactPii]
  );

  const stats = useMemo(() => {
    const datedBreaches = displayInvestigation.breachedAccounts.filter((b) =>
      Boolean(b.date)
    ).length;
    const highRiskBreaches = displayInvestigation.breachedAccounts.filter(
      (b) => b.severity === 'high'
    ).length;
    const commitsCount = displayInvestigation.results.reduce(
      (acc, r) =>
        acc + (r.artifacts?.filter((a) => a.type === 'commit' && a.timestamp).length || 0),
      0
    );
    const archivedHits = dorkReport?.hits.filter((h) => Boolean(h.timestamp)).length || 0;

    return {
      datedBreaches,
      highRiskBreaches,
      commitsCount,
      archivedHits,
    };
  }, [displayInvestigation, dorkReport]);

  const filteredInvestigation = useMemo<InvestigationRecord>(() => {
    if (selectedPeriod === 'all') return displayInvestigation;
    if (selectedPeriod === 'high') {
      return {
        ...displayInvestigation,
        breachedAccounts: displayInvestigation.breachedAccounts.filter(
          (b) => b.severity === 'high'
        ),
        results: displayInvestigation.results.filter(
          (r) => r.findingKind === 'breached' || r.status === 'found'
        ),
      };
    }
    return {
      ...displayInvestigation,
      breachedAccounts: displayInvestigation.breachedAccounts.filter((b) =>
        Boolean(b.date)
      ),
    };
  }, [displayInvestigation, selectedPeriod]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="max-w-6xl mx-auto px-4 sm:px-8 py-8 space-y-6"
    >
      {/* Dedicated Separate Timeline Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200/70 dark:border-slate-800">
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Clock className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span className="font-semibold text-indigo-600 dark:text-indigo-400">
              Dedicated Chronological Timeline
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono uppercase">{displayInvestigation.targetType}</span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A] dark:text-slate-100 truncate">
            {displayInvestigation.target}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onBackToResults}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Results</span>
          </Button>
          <Button
            variant={redactPii ? 'primary' : 'outline'}
            size="sm"
            onClick={onToggleRedactPii}
          >
            <EyeOff className="w-3.5 h-3.5" />
            <span>{redactPii ? 'PII Masked' : 'Mask PII'}</span>
          </Button>
          {onOpenForensics && (
            <Button variant="outline" size="sm" onClick={onOpenForensics}>
              <FileSearch className="w-3.5 h-3.5" />
              <span>Forensics Lab</span>
            </Button>
          )}
        </div>
      </div>

      {/* Quick Timeline Overview Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Total Breaches
          </p>
          <p className="font-display text-2xl font-bold text-[#0F172A] dark:text-slate-100 mt-1 tabular-nums">
            {displayInvestigation.breachedAccounts.length}
          </p>
          <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1 flex items-center gap-1">
            <ShieldAlert className="w-3 h-3" />
            <span>{stats.highRiskBreaches} credential/password risk</span>
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Timestamped Incidents
          </p>
          <p className="font-display text-2xl font-bold text-[#0F172A] dark:text-slate-100 mt-1 tabular-nums">
            {stats.datedBreaches}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Breaches with verified dates
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Commit & Profile Events
          </p>
          <p className="font-display text-2xl font-bold text-[#0F172A] dark:text-slate-100 mt-1 tabular-nums">
            {stats.commitsCount + displayInvestigation.results.filter((r) => r.status === 'found' && r.firstSeen).length}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Registrations, RDAP & commits
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Dork & Archive Dates
          </p>
          <p className="font-display text-2xl font-bold text-[#0F172A] dark:text-slate-100 mt-1 tabular-nums">
            {stats.archivedHits}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Indexed Wayback/search timestamps
          </p>
        </Card>
      </div>

      {/* Scope Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/75 dark:bg-[#0E1526]/90 border border-slate-200/80 dark:border-slate-800">
          {([
            { id: 'all', label: 'Full Chronology' },
            { id: 'high', label: 'High Severity Breaches' },
            { id: 'dated', label: 'Verified Dates Only' },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSelectedPeriod(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                selectedPeriod === tab.id
                  ? 'bg-[#0F172A] dark:bg-indigo-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:text-[#0F172A] dark:hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onBackToResults}
          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
        >
          <span>Return to Results Overview</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Full Chronological Timeline Engine */}
      <IntelligenceTimelineCard
        investigation={filteredInvestigation}
        dorkReport={dorkReport}
        onSelectResult={onSelectResult}
      />
    </motion.div>
  );
}
