import { useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Globe,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import type { TyposquatCandidate } from '@/src/types/investigation';
import { Card } from '@/src/components/ui/Card';

interface TyposquatRadarCardProps {
  domain: string;
  candidates: TyposquatCandidate[];
  onPivotDomain: (domain: string) => void;
}

export function TyposquatRadarCard({
  domain,
  candidates,
  onPivotDomain,
}: TyposquatRadarCardProps) {
  const [showUnresolved, setShowUnresolved] = useState(false);

  const resolved = candidates.filter((c) => c.resolved);
  const unresolved = candidates.filter((c) => !c.resolved);

  return (
    <Card className="p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span
            className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 mt-0.5 ${
              resolved.length > 0
                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-600 dark:text-amber-400'
                : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {resolved.length > 0 ? (
              <AlertTriangle className="w-4 h-4" />
            ) : (
              <ShieldCheck className="w-4 h-4" />
            )}
          </span>
          <div>
            <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-slate-100">
              Typosquat & Lookalike Domain Radar
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Live DNS A & MX resolution across {candidates.length} impersonation,
              homoglyph, and TLD permutation variants of{' '}
              <span className="font-mono text-[#0F172A] dark:text-slate-200">
                {domain}
              </span>
              .
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs tabular-nums">
          <span
            className={`px-2.5 py-1 rounded-lg border font-semibold ${
              resolved.length > 0
                ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300'
                : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300'
            }`}
          >
            {resolved.length} Active Lookalike{resolved.length === 1 ? '' : 's'}
          </span>
          <span className="text-slate-400">
            / {candidates.length} Checked
          </span>
        </div>
      </div>

      {resolved.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {resolved.map((item) => (
            <div
              key={item.domain}
              className="p-3.5 rounded-xl border border-amber-200/80 dark:border-amber-900/60 bg-amber-50/45 dark:bg-amber-950/20 flex items-center justify-between gap-3"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span className="font-mono text-xs font-bold text-[#0F172A] dark:text-slate-100 truncate">
                    {item.domain}
                  </span>
                  {item.hasMx && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-600 dark:text-rose-400 shrink-0">
                      <Mail className="w-3 h-3" />
                      <span>MX Active</span>
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {item.reason}
                  {item.ipv4.length > 0 ? ` · IPv4: ${item.ipv4[0]}` : ''}
                </p>
              </div>

              <button
                type="button"
                onClick={() => onPivotDomain(item.domain)}
                className="px-2.5 py-1.5 rounded-lg border border-amber-300/80 dark:border-amber-800 bg-white dark:bg-[#0E1526] text-[11px] font-semibold text-amber-800 dark:text-amber-200 hover:bg-amber-100/70 dark:hover:bg-amber-900/40 inline-flex items-center gap-1 shrink-0 cursor-pointer transition-colors"
              >
                <Crosshair className="w-3 h-3" />
                <span>Pivot Scan</span>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-emerald-50/40 dark:bg-emerald-950/20 border border-emerald-200/70 dark:border-emerald-900/50 text-xs text-emerald-800 dark:text-emerald-200">
          Zero active impersonation or typosquat lookalikes resolved in DNS across the {candidates.length} checked variants.
        </div>
      )}

      {unresolved.length > 0 && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowUnresolved((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-slate-100 cursor-pointer"
          >
            {showUnresolved ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
            <span>
              {showUnresolved ? 'Hide' : 'Show'} {unresolved.length} unregistered defensive variants
            </span>
          </button>

          {showUnresolved && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {unresolved.map((u) => (
                <span
                  key={u.domain}
                  className="px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200/80 dark:border-slate-800 text-[11px] font-mono text-slate-500 dark:text-slate-400"
                  title={u.reason}
                >
                  {u.domain}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
