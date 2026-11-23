import { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, Download, FolderKanban, Plus } from 'lucide-react';
import { formatTimestamp } from '@/src/lib/api';
import type { CaseSnapshot, InvestigationRecord } from '@/src/types/investigation';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';

interface InvestigationsPageProps {
  investigations: InvestigationRecord[];
  snapshots: CaseSnapshot[];
  onOpenInvestigation: (scanId: string) => void;
  onNewSearch: () => void;
}

export function InvestigationsPage({
  investigations,
  snapshots,
  onOpenInvestigation,
  onNewSearch,
}: InvestigationsPageProps) {
  const [brokenSnapIds, setBrokenSnapIds] = useState<Record<string, boolean>>(
    {}
  );
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="max-w-6xl mx-auto px-4 sm:px-8 py-8 space-y-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#0F172A] dark:text-slate-100">
            Investigations
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Active case workspaces, AI executive briefs, and exported PNG
            evidence reports.
          </p>
        </div>

        <Button size="sm" onClick={onNewSearch}>
          <Plus className="w-3.5 h-3.5" />
          <span>New Investigation</span>
        </Button>
      </div>

      {/* Case Grid */}
      {investigations.length === 0 ? (
        <Card className="p-14 text-center space-y-3">
          <FolderKanban className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
          <p className="text-sm font-semibold text-[#0F172A] dark:text-slate-100">
            No active investigation cases
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Completed queries automatically populate here with structured
            summaries and exportable snapshots.
          </p>
          <Button size="sm" onClick={onNewSearch}>
            Launch First Search
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {investigations.map((inv) => (
            <Card
              key={inv.scanId}
              interactive
              onClick={() => onOpenInvestigation(inv.scanId)}
              className="p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="uppercase font-semibold text-indigo-600 dark:text-indigo-400">
                    {inv.targetType}
                  </span>
                  <span className="text-slate-400 dark:text-slate-500">
                    {formatTimestamp(inv.createdAt)}
                  </span>
                </div>
                <h2 className="font-mono text-base font-semibold text-[#0F172A] dark:text-slate-100 truncate">
                  {inv.target}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                  {inv.aiSummary?.executiveBrief ||
                    `${inv.summary.total} verified findings across selected modules.`}
                </p>
              </div>

              <div className="pt-3 border-t border-[#F1F5F9] dark:border-slate-800 flex items-center justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-400 tabular-nums">
                  {inv.summary.registered} registered · {inv.summary.breached}{' '}
                  breached
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-indigo-600 dark:text-indigo-400">
                  <span>View</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Exported Snapshots */}
      {snapshots.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-slate-100">
            Exported Visual Snapshots ({snapshots.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {snapshots.map((snap) => (
              <Card key={snap.id} className="overflow-hidden">
                {!brokenSnapIds[snap.id] ? (
                  <img
                    src={snap.dataUrl}
                    alt={`Snapshot ${snap.target}`}
                    referrerPolicy="no-referrer"
                    onError={() =>
                      setBrokenSnapIds((prev) => ({
                        ...prev,
                        [snap.id]: true,
                      }))
                    }
                    className="w-full h-auto object-cover border-b border-[#F1F5F9] dark:border-slate-800"
                  />
                ) : (
                  <div className="py-10 px-4 text-center text-xs text-slate-400 bg-slate-50/70 dark:bg-slate-900/70 border-b border-[#F1F5F9] dark:border-slate-800">
                    Snapshot preview unavailable
                  </div>
                )}
                <div className="px-4 py-3 flex items-center justify-between text-xs">
                  <span className="font-mono font-medium text-[#0F172A] dark:text-slate-100 truncate">
                    {snap.target}
                  </span>
                  <a
                    href={snap.dataUrl}
                    download={`parmanu-${snap.scanId}.png`}
                    className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline font-medium shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>PNG</span>
                  </a>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
