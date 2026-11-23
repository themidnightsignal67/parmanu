import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, Link2, Plus, RefreshCw, Search } from 'lucide-react';
import { formatDuration, formatTimestamp } from '@/src/lib/api';
import type { InvestigationRecord, TargetType } from '@/src/types/investigation';
import { CompromiseHeatmap } from '@/src/components/results/CompromiseHeatmap';
import { CrossCaseLinkerDialog } from '@/src/components/results/CrossCaseLinkerDialog';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';

interface HistoryPageProps {
  investigations: InvestigationRecord[];
  isLoading: boolean;
  onRefresh: () => void;
  onOpenInvestigation: (scanId: string) => void;
  onNewSearch: () => void;
}

export function HistoryPage({
  investigations,
  isLoading,
  onRefresh,
  onOpenInvestigation,
  onNewSearch,
}: HistoryPageProps) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | TargetType>('all');
  const [compareOpen, setCompareOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return investigations.filter((inv) => {
      const matchType = typeFilter === 'all' || inv.targetType === typeFilter;
      const matchQ =
        !q ||
        inv.target.toLowerCase().includes(q) ||
        inv.scanId.toLowerCase().includes(q);
      return matchType && matchQ;
    });
  }, [investigations, query, typeFilter]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="max-w-6xl mx-auto px-4 sm:px-8 py-8 space-y-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#0F172A] dark:text-slate-100">
            Search History
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Review past OSINT queries and reopen full structured reports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {investigations.length >= 2 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCompareOpen(true)}
            >
              <Link2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>Compare Cases</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
            />
            <span>Refresh</span>
          </Button>
          <Button size="sm" onClick={onNewSearch}>
            <Plus className="w-3.5 h-3.5" />
            <span>New Search</span>
          </Button>
        </div>
      </div>

      {investigations.length > 0 && (
        <CompromiseHeatmap
          investigations={investigations}
          onOpenInvestigation={onOpenInvestigation}
          compact
        />
      )}

      <Card className="overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-white/40 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter target..."
              className="w-full h-9 pl-8 pr-3 rounded-xl border border-white/40 dark:border-slate-700 ring-1 ring-slate-900/5 bg-white/70 dark:bg-slate-900 backdrop-blur-md text-xs text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
            />
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/60 dark:bg-slate-900/80 backdrop-blur-md border border-white/40 dark:border-slate-800 ring-1 ring-slate-900/5 overflow-x-auto no-scrollbar max-w-full">
            {(['all', 'username', 'email', 'domain', 'ip', 'phone'] as const).map(
              (t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypeFilter(t)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    typeFilter === t
                      ? 'bg-white dark:bg-slate-800 text-[#0F172A] dark:text-slate-100 shadow-xs border border-white/60 dark:border-slate-700'
                      : 'text-slate-500 dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-slate-100'
                  }`}
                >
                  {t}
                </button>
              )
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="py-16 px-6 text-center space-y-3">
            <p className="text-sm font-semibold text-[#0F172A] dark:text-slate-100">
              No searches recorded yet
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Run your first authorized search to inspect profiles, breached
              records, and geographic exposure.
            </p>
            <Button size="sm" onClick={onNewSearch}>
              Start a Search
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200/60 dark:border-slate-800 bg-white/50 dark:bg-slate-900/70 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-6">Target</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4 text-right">Total</th>
                  <th className="py-3 px-4 text-right">Breached</th>
                  <th className="py-3 px-4 text-right">Duration</th>
                  <th className="py-3 px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/50 dark:divide-slate-800 text-xs">
                {filtered.map((inv) => (
                  <tr
                    key={inv.scanId}
                    onClick={() => onOpenInvestigation(inv.scanId)}
                    className="hover:bg-white/60 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                  >
                    <td className="py-3.5 px-6 font-mono font-medium text-[#0F172A] dark:text-slate-100">
                      {inv.target}
                    </td>
                    <td className="py-3.5 px-4 uppercase font-semibold text-indigo-600 dark:text-indigo-400">
                      {inv.targetType}
                    </td>
                    <td className="py-3.5 px-4 text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                      {formatTimestamp(inv.createdAt)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-semibold text-[#0F172A] dark:text-slate-100 tabular-nums">
                      {inv.summary.total}
                    </td>
                    <td className="py-3.5 px-4 text-right font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                      {inv.summary.breached}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                      {formatDuration(inv.durationMs)}
                    </td>
                    <td className="py-3.5 px-6 text-right">
                      <span className="inline-flex items-center gap-1 font-medium text-indigo-600 dark:text-indigo-400">
                        <span>Open</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <CrossCaseLinkerDialog
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        investigations={investigations}
        redactPii={false}
        onOpenInvestigation={onOpenInvestigation}
      />
    </motion.div>
  );
}
