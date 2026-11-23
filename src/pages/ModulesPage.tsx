import { motion } from 'motion/react';
import { CheckCircle2, Cpu, RefreshCw, Sparkles } from 'lucide-react';
import { INVESTIGATION_TOOLS } from '@/src/data/tools';
import type { GeminiPoolStatus } from '@/src/lib/api';
import type { ToolAvailabilityStatus, ToolId } from '@/src/types/investigation';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';

interface ModulesPageProps {
  toolAvailability: Record<ToolId, ToolAvailabilityStatus>;
  geminiStatus: GeminiPoolStatus | null;
  onRefresh: () => void;
  onRunSearch: () => void;
}

export function ModulesPage({
  toolAvailability,
  geminiStatus,
  onRefresh,
  onRunSearch,
}: ModulesPageProps) {
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
            OSINT Modules & Engine Readiness
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Inspect active live data adapters, target-type routing, and AI
            Analyst rotatable synthesis slots.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Check Status</span>
          </Button>
          <Button size="sm" onClick={onRunSearch}>
            <span>New Search</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {INVESTIGATION_TOOLS.map((tool) => (
          <Card key={tool.id} className="p-5 flex flex-col justify-between gap-4">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                  <h2 className="font-display text-sm font-bold text-[#0F172A] dark:text-slate-100">
                    {tool.name}
                  </h2>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{toolAvailability[tool.id] || 'ready'}</span>
                </span>
              </div>
              <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">{tool.scope}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {tool.description}
              </p>
            </div>

            <div className="pt-3 border-t border-[#F1F5F9] dark:border-slate-800 flex flex-wrap gap-1.5">
              {tool.supportedTargets.map((t) => (
                <span
                  key={t}
                  className="px-2 py-0.5 rounded-md bg-[#FAFAFA] dark:bg-slate-900 border border-[#E5E7EB] dark:border-slate-800 text-[11px] uppercase font-medium text-slate-600 dark:text-slate-300"
                >
                  {t}
                </span>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <h2 className="font-display text-sm font-semibold text-[#0F172A] dark:text-slate-100">
            AI Analyst 10-Key Rotation Status
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          {geminiStatus && geminiStatus.configuredSlots > 0 ? (
            geminiStatus.slots.map((s) => (
              <div
                key={s.slot}
                className="p-3.5 rounded-xl bg-[#FAFAFA] dark:bg-slate-900 border border-[#E5E7EB] dark:border-slate-800 flex items-center justify-between"
              >
                <span className="font-mono font-medium text-[#0F172A] dark:text-slate-100">
                  Slot {s.slot}
                </span>
                <span
                  className={
                    s.healthy ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-amber-600 dark:text-amber-400'
                  }
                >
                  {s.healthy ? 'Healthy' : 'Cooldown'} · {s.uses} calls
                </span>
              </div>
            ))
          ) : (
            <div className="sm:col-span-3 p-3.5 rounded-xl bg-[#FAFAFA] dark:bg-slate-900 border border-[#E5E7EB] dark:border-slate-800 text-slate-500 dark:text-slate-400">
              Server-side key rotation active with structured fallback when
              environment keys are not set.
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  );
}
