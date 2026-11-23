import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUpRight,
  AtSign,
  Clock,
  Crown,
  FileUp,
  Globe,
  Loader2,
  LogIn,
  Network,
  Phone,
  Search,
  ShieldAlert,
  User,
  X,
  XCircle,
} from 'lucide-react';
import { getDefaultToolsForTarget } from '@/src/data/tools';
import {
  ApiClientError,
  detectTargetTypeFromInput,
  formatTimestamp,
  startInvestigation,
  validateTargetInput,
  type CreditStatusResponse,
} from '@/src/lib/api';
import type {
  InvestigationRecord,
  TargetType,
  ToolId,
} from '@/src/types/investigation';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { IndianFlag } from '@/src/components/ui/IndianFlag';
import { playClickTick, playErrorTone, playSonarPing } from '@/src/lib/sound';

interface SearchPageProps {
  isSignedIn: boolean;
  signingIn: boolean;
  creditStatus?: CreditStatusResponse | null;
  onCreditsUpdated?: (nextStatus?: CreditStatusResponse) => void;
  recentInvestigations?: InvestigationRecord[];
  onOpenInvestigation?: (scanId: string) => void;
  onOpenBatchMode?: () => void;
  onSignIn: () => Promise<void>;
  onScanStarted: (
    initialRecord: InvestigationRecord & { creditStatus?: CreditStatusResponse }
  ) => void;
}

const TARGET_META: Record<
  TargetType,
  { label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  username: { label: 'Username', Icon: User },
  email: { label: 'Email Address', Icon: AtSign },
  domain: { label: 'Domain', Icon: Globe },
  ip: { label: 'IP Address', Icon: Network },
  phone: { label: 'Phone Number', Icon: Phone },
};

const SUPPORTED_CAPABILITIES: Array<{
  title: string;
  example: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    title: 'Usernames',
    example: 'torvalds',
    description: 'Cross-platform handles, code profiles & avatars',
    Icon: User,
  },
  {
    title: 'Email Addresses',
    example: 'name@domain.com',
    description: 'Strict email checks: Unavatar, Zoho, Chess.com, X, GitHub, Microsoft, Breaches & PGP',
    Icon: AtSign,
  },
  {
    title: 'Domains & IPs',
    example: 'github.com · 8.8.8.8',
    description: 'DNS, TLS certificates, RDAP, ASN & geo telemetry',
    Icon: Globe,
  },
  {
    title: 'Phone Numbers',
    example: '+919876543210 · 9876543210',
    description: 'Live website account checks (Flipkart, Microsoft, Zoho, Telegram), 225+ services & breach exposure',
    Icon: Phone,
  },
];

export function SearchPage({
  isSignedIn,
  signingIn,
  creditStatus,
  onCreditsUpdated,
  recentInvestigations = [],
  onOpenInvestigation,
  onOpenBatchMode,
  onSignIn,
  onScanStarted,
}: SearchPageProps) {
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isFocused, setIsFocused] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Deduplicate by target+type (keeping newest first) and take the last 5 targets
  const recentTargets = useMemo(() => {
    const seen = new Set<string>();
    const unique: InvestigationRecord[] = [];
    const sorted = [...recentInvestigations].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    for (const inv of sorted) {
      if (!inv.scanId || !inv.target) continue;
      const key = `${inv.target.trim().toLowerCase()}::${inv.targetType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(inv);
      if (unique.length >= 5) break;
    }
    return unique;
  }, [recentInvestigations]);

  const filteredRecents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recentTargets;
    return recentTargets.filter(
      (inv) =>
        inv.target.toLowerCase().includes(q) ||
        inv.targetType.toLowerCase().includes(q)
    );
  }, [recentTargets, query]);

  // Fully universal: always auto-detected directly from current input
  const detectedType: TargetType =
    detectTargetTypeFromInput(query) || 'username';
  const activeMeta = TARGET_META[detectedType];
  const ActiveIcon = activeMeta.Icon;

  const selectedTools: ToolId[] = getDefaultToolsForTarget(detectedType);

  // Close Recent Searches dropdown on outside pointer click
  useEffect(() => {
    if (!dropdownOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
        setHighlightedIndex(-1);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [dropdownOpen]);

  const handleSelectRecent = (inv: InvestigationRecord) => {
    setDropdownOpen(false);
    setHighlightedIndex(-1);
    setQuery(inv.target);
    if (onOpenInvestigation) {
      onOpenInvestigation(inv.scanId);
    }
  };

  const handleInputChange = (value: string) => {
    setQuery(value);
    setHighlightedIndex(-1);
    if (error) setError(null);
    if (submitError) setSubmitError(null);
    if (recentTargets.length > 0) {
      setDropdownOpen(true);
    }
  };

  const handleSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (
      dropdownOpen &&
      highlightedIndex >= 0 &&
      filteredRecents[highlightedIndex]
    ) {
      handleSelectRecent(filteredRecents[highlightedIndex]);
      return;
    }
    setDropdownOpen(false);
    setHighlightedIndex(-1);
    const res = validateTargetInput(query, detectedType);
    if (!res.valid) {
      playErrorTone();
      setError(res.reason || 'Enter a valid search target.');
      return;
    }
    playClickTick();
    setError(null);
    setSubmitError(null);
    void handleDispatch();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!dropdownOpen || filteredRecents.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < filteredRecents.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredRecents.length - 1
      );
    } else if (e.key === 'Escape') {
      setDropdownOpen(false);
      setHighlightedIndex(-1);
    }
  };

  const limitReached =
    Boolean(creditStatus) &&
    !creditStatus?.unlimited &&
    (creditStatus?.remaining ?? 0) <= 0;

  const formattedReset = useMemo(() => {
    if (!creditStatus?.resetsAt) return '00:00 UTC';
    try {
      return new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(new Date(creditStatus.resetsAt));
    } catch {
      return '00:00 UTC';
    }
  }, [creditStatus?.resetsAt]);

  const handleDispatch = async (options?: { enableGoogleDorking?: boolean }) => {
    setDropdownOpen(false);
    setSubmitError(null);
    setSubmitting(true);

    const trimmed = query.trim();

    try {
      const initial = await startInvestigation({
        target: trimmed,
        targetType: detectedType,
        tools: selectedTools,
        authorizedConfirmed: true,
        enableGoogleDorking: options?.enableGoogleDorking === true,
      });

      setSubmitting(false);
      playSonarPing();
      onCreditsUpdated?.(initial.creditStatus);
      // Immediately enter ResultsPage starting at 0 counters and streaming live
      onScanStarted(initial);
    } catch (err) {
      setSubmitting(false);
      playErrorTone();
      if (err instanceof ApiClientError && err.creditStatus) {
        onCreditsUpdated?.(err.creditStatus);
      } else {
        onCreditsUpdated?.();
      }
      setSubmitError(
        err instanceof Error ? err.message : 'Unable to start search.'
      );
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col justify-center py-6 sm:py-12 px-3.5 sm:px-8 relative overflow-hidden">
      {/* Subtle Ambient Aura behind Glass Surfaces */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <motion.div
          animate={{
            x: [0, 16, -12, 0],
            y: [0, -12, 10, 0],
            opacity: [0.35, 0.55, 0.35],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-12 left-1/4 w-[28rem] h-[28rem] rounded-full bg-gradient-to-br from-orange-200/40 via-purple-100/40 to-emerald-100/35 blur-3xl"
        />
        <motion.div
          animate={{
            x: [0, -14, 12, 0],
            y: [0, 10, -12, 0],
            opacity: [0.28, 0.45, 0.28],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute bottom-8 right-1/4 w-[24rem] h-[24rem] rounded-full bg-gradient-to-tr from-indigo-200/35 via-blue-100/30 to-white/40 blur-3xl"
        />
      </div>

      <div className="relative z-10 max-w-5xl w-full mx-auto space-y-6 sm:space-y-8">
        {/* Centered Heading */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          className="text-center space-y-3"
        >
          <div className="inline-flex items-center gap-2 px-3 sm:px-3.5 py-1 rounded-full bg-white/70 dark:bg-slate-900/80 backdrop-blur-md border border-white/40 dark:border-slate-700/80 ring-1 ring-slate-900/5 shadow-xs text-[11px] font-medium text-slate-600 dark:text-slate-300 max-w-full">
            <span className="text-orange-600 dark:text-orange-400 font-semibold shrink-0" aria-hidden="true">
              ॐ
            </span>
            <IndianFlag className="w-4.5 h-3 shrink-0" />
            <span className="truncate">Parmanu · One Signal. Every Trace. Zero Blind Spots.</span>
          </div>

          <h1
            className="font-display font-bold tracking-tight text-[#0F172A] dark:text-slate-100"
            style={{
              fontSize: 'clamp(1.65rem, 3.4vw, 2.55rem)',
              textWrap: 'balance',
            }}
          >
            What would you like to search?
          </h1>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="space-y-6"
        >
          {/* Universal Glassmorphic Auto-Detect Search Box + Recent Searches Dropdown */}
          <div
            ref={searchContainerRef}
            className="max-w-3xl mx-auto relative z-30"
          >
            <form
              onSubmit={handleSubmitSearch}
              className={`bg-white/80 dark:bg-[#0D1424]/90 backdrop-blur-xl rounded-2xl border transition-all duration-200 overflow-hidden ${
                isFocused
                  ? 'border-indigo-300/90 dark:border-indigo-500/70 ring-2 ring-indigo-500/20 shadow-[0_18px_50px_rgba(79,70,229,0.14),0_0_0_4px_rgba(255,153,51,0.08)]'
                  : 'border-white/60 dark:border-slate-800 ring-1 ring-slate-900/[0.06] shadow-[0_12px_40px_rgba(15,23,42,0.06)]'
              }`}
            >
              <div className="px-4 sm:px-5 pt-3.5 sm:pt-4 pb-2.5 sm:pb-3">
                <label htmlFor="parmanu-main-search" className="sr-only">
                  Universal OSINT target input
                </label>
                <input
                  ref={inputRef}
                  id="parmanu-main-search"
                  type="text"
                  autoComplete="off"
                  disabled={submitting}
                  aria-expanded={dropdownOpen && filteredRecents.length > 0}
                  aria-controls="parmanu-recent-searches"
                  value={query}
                  onFocus={() => {
                    setIsFocused(true);
                    if (recentTargets.length > 0) setDropdownOpen(true);
                  }}
                  onBlur={() => setIsFocused(false)}
                  onKeyDown={handleInputKeyDown}
                  onChange={(e) => handleInputChange(e.target.value)}
                  placeholder="Enter username, email, domain, IP, or +phone..."
                  className="w-full h-11 bg-transparent text-base text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none disabled:opacity-60"
                />
              </div>

              {/* Bottom Control Row Inside Glass Box */}
              <div className="px-3.5 sm:px-4 py-3 border-t border-slate-200/50 dark:border-slate-800 bg-white/45 dark:bg-slate-900/60 backdrop-blur-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs min-w-0">
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={query.trim() ? detectedType : 'auto'}
                      initial={{ opacity: 0, y: 4, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.96 }}
                      transition={{ duration: 0.16 }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50/85 backdrop-blur-sm border border-indigo-200/70 text-indigo-700 font-medium shrink-0"
                    >
                      <ActiveIcon className="w-3.5 h-3.5" />
                      <span>
                        {query.trim()
                          ? `Detected: ${activeMeta.label}`
                          : 'Auto-Detect Active'}
                      </span>
                    </motion.span>
                  </AnimatePresence>

                  {query && !submitting && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery('');
                        setError(null);
                        setSubmitError(null);
                        setHighlightedIndex(-1);
                        inputRef.current?.focus();
                      }}
                      aria-label="Clear search query"
                      className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-white/60 cursor-pointer transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <span className="hidden sm:inline text-slate-300" aria-hidden="true">
                    |
                  </span>

                  <span className="text-slate-500 dark:text-slate-400">
                    {creditStatus ? (
                      creditStatus.unlimited ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
                          <Crown className="w-3.5 h-3.5 text-amber-500" />
                          <span>VIP Unlimited Access</span>
                        </span>
                      ) : creditStatus.tier === 'standard' ? (
                        <span
                          className={`font-medium tabular-nums ${
                            limitReached
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {creditStatus.remaining ?? 0} of {creditStatus.limit ?? 2} daily credits left
                        </span>
                      ) : (
                        <span
                          className={`font-medium tabular-nums ${
                            limitReached
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {creditStatus.remaining ?? 0} of 1 guest credit today · Sign in for 2/day
                        </span>
                      )
                    ) : isSignedIn ? (
                      '2 daily credits · Resets 00:00 UTC'
                    ) : (
                      '1 guest credit / day · Sign in for 2/day'
                    )}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:shrink-0">
                  {onOpenBatchMode && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={onOpenBatchMode}
                      aria-label="Open batch file upload mode"
                      className="h-9 px-3 rounded-xl border bg-white/60 dark:bg-slate-800/80 border-white/60 dark:border-slate-700 ring-1 ring-slate-900/5 text-xs font-medium text-slate-600 dark:text-slate-200 hover:text-[#0F172A] dark:hover:text-white hover:bg-white/85 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                    >
                      <FileUp className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
                      <span>Batch File</span>
                    </button>
                  )}

                  {recentTargets.length > 0 && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => {
                        setDropdownOpen((prev) => !prev);
                        setHighlightedIndex(-1);
                      }}
                      aria-label="Toggle recent searches"
                      className={`h-9 px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50 ${
                        dropdownOpen
                          ? 'bg-white dark:bg-slate-800 border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 shadow-2xs'
                          : 'bg-white/60 dark:bg-slate-800/80 border-white/60 dark:border-slate-700 ring-1 ring-slate-900/5 text-slate-600 dark:text-slate-200 hover:text-[#0F172A] dark:hover:text-white hover:bg-white/85 dark:hover:bg-slate-800'
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Recent ({recentTargets.length})</span>
                    </button>
                  )}

                  <button
                    type="submit"
                    disabled={submitting || limitReached}
                    aria-label="Run OSINT search"
                    className="h-9 px-4 rounded-xl bg-[#0F172A] dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-500 text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer flex-1 sm:flex-initial sm:shrink-0 shadow-xs disabled:opacity-50"
                  >
                    {submitting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Search className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {submitting
                        ? 'Starting...'
                        : limitReached
                        ? 'Limit Reached'
                        : 'Search'}
                    </span>
                  </button>
                </div>
              </div>
            </form>

            {/* Recent Searches Dropdown Popover (Last 5 Investigation Targets) */}
            <AnimatePresence>
              {dropdownOpen && filteredRecents.length > 0 && (
                <motion.div
                  id="parmanu-recent-searches"
                  role="listbox"
                  aria-label="Recent Searches"
                  initial={{ opacity: 0, y: -6, scale: 0.99 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.99 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute left-0 right-0 top-full mt-2 z-40 rounded-2xl bg-white/90 dark:bg-[#0D1424]/95 backdrop-blur-xl border border-white/60 dark:border-slate-800 ring-1 ring-slate-900/[0.06] shadow-[0_18px_48px_rgba(15,23,42,0.18)] overflow-hidden"
                >
                  <div className="px-4 py-2.5 border-b border-slate-200/60 dark:border-slate-800 bg-white/50 dark:bg-slate-900/60 flex items-center justify-between text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1.5 text-[#0F172A] dark:text-slate-100 font-semibold">
                      <Clock className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
                      <span>Recent Searches</span>
                    </span>
                    <span className="tabular-nums">
                      Last {filteredRecents.length} investigation
                      {filteredRecents.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  <div className="divide-y divide-slate-200/50 dark:divide-slate-800">
                    {filteredRecents.map((inv, index) => {
                      const meta =
                        TARGET_META[inv.targetType] || TARGET_META.username;
                      const Icon = meta.Icon;
                      const active = index === highlightedIndex;
                      return (
                        <button
                          key={inv.scanId}
                          type="button"
                          role="option"
                          aria-selected={active}
                          onMouseEnter={() => setHighlightedIndex(index)}
                          onClick={() => handleSelectRecent(inv)}
                          className="relative w-full px-4 py-3 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-white/50 dark:hover:bg-slate-800/50 transition-colors"
                        >
                          {active && (
                            <motion.span
                              layoutId="recent-hover-pill"
                              transition={{
                                type: 'spring',
                                stiffness: 480,
                                damping: 36,
                              }}
                              className="absolute inset-0 bg-indigo-50/85 dark:bg-indigo-950/50 pointer-events-none"
                            />
                          )}
                          <div className="relative z-10 flex items-center gap-3 min-w-0">
                            <span className="w-8 h-8 rounded-xl bg-white/90 dark:bg-slate-900 border border-slate-200/70 dark:border-slate-700 flex items-center justify-center shrink-0 shadow-2xs">
                              <Icon className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                            </span>
                            <div className="min-w-0">
                              <p className="font-mono text-xs sm:text-sm font-semibold text-[#0F172A] dark:text-slate-100 truncate">
                                {inv.target}
                              </p>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5 truncate">
                                <span className="capitalize">{meta.label}</span>
                                <span aria-hidden="true">·</span>
                                <span className="tabular-nums">
                                  {formatTimestamp(inv.createdAt)}
                                </span>
                              </p>
                            </div>
                          </div>

                          <div className="relative z-10 flex items-center gap-3 shrink-0 text-xs">
                            <div className="text-right hidden sm:block">
                              <span className="font-semibold text-[#0F172A] dark:text-slate-100 tabular-nums">
                                {inv.summary.total}
                              </span>{' '}
                              <span className="text-slate-500 dark:text-slate-400">results</span>
                              {inv.summary.breached > 0 && (
                                <span className="ml-2 text-rose-600 dark:text-rose-400 font-medium tabular-nums">
                                  · {inv.summary.breached} breached
                                </span>
                              )}
                            </div>
                            <span className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-medium whitespace-nowrap">
                              <span className="hidden xs:inline">Open</span>
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {error && <p className="text-xs text-rose-600 mt-2 pl-2">{error}</p>}

            {limitReached && (
              <Card className="mt-3 p-4 border-amber-300/90 dark:border-amber-800/80 bg-amber-50/90 dark:bg-amber-950/35 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
                  <ShieldAlert className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                  <div>
                    <p className="font-semibold">
                      {creditStatus?.tier === 'guest'
                        ? 'Daily guest search credit used (1/1 today)'
                        : 'Daily search quota reached (2/2 today)'}
                    </p>
                    <p className="text-amber-800/90 dark:text-amber-300/90 mt-0.5">
                      {creditStatus?.tier === 'guest'
                        ? `Resets at ${formattedReset}. Sign in with Google now to unlock 2 daily search credits + saved case history.`
                        : `Your signed-in credits reset automatically at ${formattedReset}.`}
                    </p>
                  </div>
                </div>
                {creditStatus?.tier === 'guest' && (
                  <Button
                    size="sm"
                    disabled={signingIn}
                    onClick={() => void onSignIn()}
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>{signingIn ? 'Connecting...' : 'Sign in for 2/day'}</span>
                  </Button>
                )}
              </Card>
            )}

            {submitError && (
              <Card className="mt-3 p-4 border-rose-200 dark:border-rose-900 bg-rose-50/80 dark:bg-rose-950/40 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 text-xs text-rose-700 dark:text-rose-300">
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span>{submitError}</span>
                </div>
                {!limitReached && (
                  <Button size="sm" onClick={() => void handleDispatch()}>
                    Retry
                  </Button>
                )}
              </Card>
            )}

            <div className="mt-2.5 px-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
              <span>Auto-routes to verified OSINT modules</span>
              <span>Live zero-to-live streaming</span>
            </div>
          </div>

          {/* 4 Glass Informational Capability Cards */}
          <div className="max-w-4xl mx-auto space-y-2.5 pt-2">
            <p className="text-[11px] font-medium text-slate-400 text-center">
              Type any supported identifier above — Parmanu streams live findings
              into your results dashboard
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {SUPPORTED_CAPABILITIES.map((cap, idx) => {
                const Icon = cap.Icon;
                const firstExample = cap.example.split('·')[0].trim();
                return (
                  <motion.button
                    key={cap.title}
                    type="button"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.25,
                      delay: idx * 0.05,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    whileHover={{ y: -3 }}
                    onClick={() => {
                      setQuery(firstExample);
                      setError(null);
                      setSubmitError(null);
                      inputRef.current?.focus();
                    }}
                    className="group text-left p-4 rounded-2xl bg-white/70 dark:bg-[#0E1526]/85 backdrop-blur-md border border-white/40 dark:border-slate-800 ring-1 ring-slate-900/[0.045] shadow-[0_6px_24px_rgba(15,23,42,0.04)] hover:bg-white/85 dark:hover:bg-slate-800/80 transition-all duration-150 cursor-pointer flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4 text-orange-600 dark:text-orange-400 shrink-0" />
                        <span className="text-xs font-semibold text-[#0F172A] dark:text-slate-100">
                          {cap.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        {cap.description}
                      </p>
                    </div>

                    <p className="text-[11px] font-mono text-slate-400 dark:text-slate-500 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors truncate">
                      e.g. {cap.example}
                    </p>
                  </motion.button>
                );
              })}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
