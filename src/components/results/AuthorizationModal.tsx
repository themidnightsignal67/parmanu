import { useEffect, useState } from 'react';
import { Crown, LogIn, ShieldAlert, ShieldCheck } from 'lucide-react';
import { TOOL_BY_ID } from '@/src/data/tools';
import type { CreditStatusResponse } from '@/src/lib/api';
import type { TargetType, ToolId } from '@/src/types/investigation';
import { Button } from '@/src/components/ui/Button';
import { Dialog } from '@/src/components/ui/Dialog';

interface AuthorizationModalProps {
  open: boolean;
  target: string;
  targetType: TargetType;
  tools: ToolId[];
  isSignedIn?: boolean;
  signingIn?: boolean;
  creditStatus?: CreditStatusResponse | null;
  onSignIn?: () => Promise<void>;
  onClose: () => void;
  onConfirm: (options?: { enableGoogleDorking?: boolean }) => void;
}

export function AuthorizationModal({
  open,
  target,
  targetType,
  tools,
  isSignedIn = true,
  signingIn = false,
  creditStatus,
  onSignIn,
  onClose,
  onConfirm,
}: AuthorizationModalProps) {
  const [checked, setChecked] = useState(true);
  const [enableDorking, setEnableDorking] = useState(false);

  useEffect(() => {
    if (open) {
      setEnableDorking(false);
    }
  }, [open, target]);
  const noCreditsLeft =
    Boolean(creditStatus) &&
    !creditStatus?.unlimited &&
    (creditStatus?.remaining ?? 0) <= 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Confirm Authorized Search"
      description="Parmanu queries strictly public open-source records on targets you own or are explicitly authorized to assess."
    >
      <div className="space-y-5">
        <div className="p-4 rounded-xl bg-[#FAFAFA] dark:bg-slate-900 border border-[#E5E7EB] dark:border-slate-800 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-500 dark:text-slate-400">Target</span>
            <span className="font-mono font-semibold text-[#0F172A] dark:text-slate-100">
              {target}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-500 dark:text-slate-400">Search Type</span>
            <span className="uppercase font-semibold text-indigo-600 dark:text-indigo-400">
              {targetType}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-500 dark:text-slate-400">Selected Modules</span>
            <span className="font-medium text-[#0F172A] dark:text-slate-200 text-right">
              {tools.map((t) => TOOL_BY_ID[t]?.name || t).join(', ')}
            </span>
          </div>
          {creditStatus && (
            <div className="flex items-center justify-between gap-3 pt-1.5 border-t border-slate-200/70 dark:border-slate-800">
              <span className="text-slate-500 dark:text-slate-400">Daily Search Credit</span>
              {creditStatus.unlimited ? (
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                  <Crown className="w-3.5 h-3.5 text-amber-500" />
                  <span>Unlimited VIP</span>
                </span>
              ) : (
                <span
                  className={`font-mono font-semibold tabular-nums ${
                    noCreditsLeft
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-indigo-600 dark:text-indigo-400'
                  }`}
                >
                  {creditStatus.remaining ?? 0} of {creditStatus.limit ?? 1} remaining today (1 credit used)
                </span>
              )}
            </div>
          )}
        </div>

        {noCreditsLeft && (
          <div className="p-3.5 rounded-xl bg-rose-50/90 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Daily credit limit reached</p>
              <p className="mt-0.5 opacity-90">
                {creditStatus?.tier === 'guest'
                  ? 'Guest devices receive 1 search per day. Sign in with Google for 2 daily searches, or wait for the 00:00 UTC reset.'
                  : 'Standard signed-in accounts receive 2 searches per day. Your credits automatically reset at 00:00 UTC.'}
              </p>
            </div>
          </div>
        )}

        {!isSignedIn && onSignIn && (
          <div className="p-3.5 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-900/70 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-600 dark:text-slate-300">
              <p className="font-semibold text-[#0F172A] dark:text-slate-100">
                Guest limit: 1 search / day
              </p>
              <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                Sign in with Google to get 2 daily searches and cloud history.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={signingIn}
              onClick={() => void onSignIn()}
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>{signingIn ? 'Signing in...' : 'Google Sign-In'}</span>
            </Button>
          </div>
        )}

        <label className="flex items-start gap-3 p-3.5 rounded-xl border border-[#E5E7EB] dark:border-slate-800 cursor-pointer hover:bg-[#FAFAFA] dark:hover:bg-slate-900 transition-colors">
          <input
            type="checkbox"
            checked={enableDorking}
            onChange={(e) => setEnableDorking(e.target.checked)}
            className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            <span className="font-semibold text-[#0F172A] dark:text-slate-100">
              Enable Deep Google Dorking (Optional)
            </span>
            <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Off by default. Check this to query web, document, and code paste indexes automatically—or trigger it on demand later in Results.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 p-3.5 rounded-xl border border-[#E5E7EB] dark:border-slate-800 cursor-pointer hover:bg-[#FAFAFA] dark:hover:bg-slate-900 transition-colors">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            I confirm I own this identifier or hold explicit legal authorization
            to perform public open-source intelligence verification.
          </span>
        </label>

        <div className="flex items-center justify-end gap-2.5">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="gradient"
            disabled={!checked || noCreditsLeft}
            onClick={() => onConfirm({ enableGoogleDorking: enableDorking })}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{noCreditsLeft ? 'Limit Reached' : 'Run Investigation'}</span>
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
