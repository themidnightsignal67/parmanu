import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowUpRight,
  Bell,
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  GitCompare,
  Loader2,
  Play,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import {
  dispatchWebhookAlert,
  formatTimestamp,
  validateTargetInput,
} from '@/src/lib/api';
import {
  loadAutoWebhookSettings,
  saveAutoWebhookSettings,
} from '@/src/lib/annotationsStore';
import type {
  AutoWebhookSettings,
  InvestigationRecord,
  MonitoringRule,
  TargetType,
} from '@/src/types/investigation';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';

interface MonitoringPageProps {
  rules: MonitoringRule[];
  investigations?: InvestigationRecord[];
  onAddRule: (rule: MonitoringRule) => Promise<void>;
  onToggleRule: (id: string, nextActive: boolean) => Promise<void>;
  onDeleteRule: (id: string) => Promise<void>;
  onRunRuleCheck: (rule: MonitoringRule) => Promise<void>;
  onOpenInvestigation: (scanId: string) => void;
}

interface BaselineDiff {
  latestScanId: string;
  previousScanId?: string;
  addedBreaches: string[];
  removedBreaches: string[];
  addedPlatforms: string[];
  removedPlatforms: string[];
  hasBaseline: boolean;
}

function computeRuleBaselineDiff(
  rule: MonitoringRule,
  investigations: InvestigationRecord[]
): BaselineDiff | null {
  const targetKey = rule.target.trim().toLowerCase();
  const matching = investigations
    .filter(
      (inv) =>
        inv.target.trim().toLowerCase() === targetKey &&
        inv.targetType === rule.targetType
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

  if (matching.length === 0) return null;
  if (matching.length === 1) {
    return {
      latestScanId: matching[0].scanId,
      addedBreaches: [],
      removedBreaches: [],
      addedPlatforms: [],
      removedPlatforms: [],
      hasBaseline: false,
    };
  }

  const latest = matching[0];
  const prev = matching[1];

  const latestBreaches = new Set(
    (latest.breachedAccounts || []).map((b) =>
      (b.domain || b.breachName || b.platform).toLowerCase()
    )
  );
  const prevBreaches = new Set(
    (prev.breachedAccounts || []).map((b) =>
      (b.domain || b.breachName || b.platform).toLowerCase()
    )
  );

  const latestPlatforms = new Set(
    (latest.results || [])
      .filter((r) => r.status === 'found')
      .map((r) => r.platform)
  );
  const prevPlatforms = new Set(
    (prev.results || [])
      .filter((r) => r.status === 'found')
      .map((r) => r.platform)
  );

  return {
    latestScanId: latest.scanId,
    previousScanId: prev.scanId,
    addedBreaches: Array.from(latestBreaches).filter((b) => !prevBreaches.has(b)),
    removedBreaches: Array.from(prevBreaches).filter((b) => !latestBreaches.has(b)),
    addedPlatforms: Array.from(latestPlatforms).filter((p) => !prevPlatforms.has(p)),
    removedPlatforms: Array.from(prevPlatforms).filter((p) => !latestPlatforms.has(p)),
    hasBaseline: true,
  };
}

export function MonitoringPage({
  rules,
  investigations = [],
  onAddRule,
  onToggleRule,
  onDeleteRule,
  onRunRuleCheck,
  onOpenInvestigation,
}: MonitoringPageProps) {
  const [target, setTarget] = useState('');
  const [targetType, setTargetType] = useState<TargetType>('email');
  const [frequency, setFrequency] = useState<'Realtime' | 'Daily' | 'Weekly'>(
    'Daily'
  );
  const [error, setError] = useState<string | null>(null);
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);
  const [expandedDiffIds, setExpandedDiffIds] = useState<Record<string, boolean>>({});
  const [autoWebhook, setAutoWebhook] = useState<AutoWebhookSettings>(() =>
    loadAutoWebhookSettings()
  );
  const [webhookStatusMsg, setWebhookStatusMsg] = useState<string | null>(null);
  const [testingWebhook, setTestingWebhook] = useState(false);

  const diffByRuleId = useMemo(() => {
    const out: Record<string, BaselineDiff | null> = {};
    for (const r of rules) {
      out[r.id] = computeRuleBaselineDiff(r, investigations);
    }
    return out;
  }, [rules, investigations]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const check = validateTargetInput(target, targetType);
    if (!check.valid) {
      setError(check.reason || 'Enter a valid target.');
      return;
    }
    setError(null);
    await onAddRule({
      id: `mon-${Date.now().toString(36)}`,
      target: target.trim(),
      targetType,
      frequency,
      active: true,
      lastCheckedAt: new Date().toISOString(),
      alertsCount: 0,
    });
    setTarget('');
  };

  const handleRunCheck = async (rule: MonitoringRule) => {
    setRunningRuleId(rule.id);
    try {
      await onRunRuleCheck(rule);
    } finally {
      setRunningRuleId(null);
    }
  };

  const handleSaveAutoWebhook = (next: AutoWebhookSettings) => {
    setAutoWebhook(next);
    saveAutoWebhookSettings(next);
    setWebhookStatusMsg('Auto-alert webhook settings saved locally.');
    window.setTimeout(() => setWebhookStatusMsg(null), 2600);
  };

  const handleTestAutoWebhook = async () => {
    const trimmed = autoWebhook.url.trim();
    if (!trimmed.startsWith('https://')) {
      setWebhookStatusMsg('Enter a valid https:// webhook URL first.');
      return;
    }
    setTestingWebhook(true);
    setWebhookStatusMsg(null);
    try {
      const res = await dispatchWebhookAlert({
        url: trimmed,
        provider: autoWebhook.provider,
        payload: {
          title: 'Parmanu Watchlist Auto-Alert Test',
          target: 'watchlist-monitor',
          targetType: 'system',
          summary:
            'Auto-alert webhook endpoint verified. Future watchlist diffs will dispatch automatically.',
        },
      });
      setWebhookStatusMsg(res.message);
    } catch (err) {
      setWebhookStatusMsg(
        err instanceof Error ? err.message : 'Test webhook failed.'
      );
    } finally {
      setTestingWebhook(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="max-w-5xl mx-auto px-4 sm:px-8 py-8 space-y-6"
    >
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-[#0F172A] dark:text-slate-100">
          Monitoring & Alerts
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Persist continuous exposure watchlists, compute historical baseline diffs,
          and trigger live re-verification scans across authorized targets.
        </p>
      </div>

      {/* Add Watch Rule */}
      <Card className="p-6">
        <form onSubmit={handleAdd} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <select
              aria-label="Monitor target type"
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as TargetType)}
              className="sm:col-span-3 h-10 px-3 rounded-xl border border-[#E5E7EB] dark:border-slate-700 bg-[#FAFAFA] dark:bg-slate-900 text-xs font-medium text-[#0F172A] dark:text-slate-100 focus:outline-none focus:border-indigo-400"
            >
              <option value="email">Email</option>
              <option value="domain">Domain</option>
              <option value="username">Username</option>
              <option value="ip">IP Address</option>
              <option value="phone">Phone Number</option>
            </select>

            <input
              type="text"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Enter authorized target to monitor..."
              className="sm:col-span-5 h-10 px-3.5 rounded-xl border border-[#E5E7EB] dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
            />

            <select
              aria-label="Check frequency"
              value={frequency}
              onChange={(e) =>
                setFrequency(
                  e.target.value as 'Realtime' | 'Daily' | 'Weekly'
                )
              }
              className="sm:col-span-2 h-10 px-3 rounded-xl border border-[#E5E7EB] dark:border-slate-700 bg-[#FAFAFA] dark:bg-slate-900 text-xs font-medium text-[#0F172A] dark:text-slate-100 focus:outline-none focus:border-indigo-400"
            >
              <option value="Realtime">Realtime</option>
              <option value="Daily">Daily</option>
              <option value="Weekly">Weekly</option>
            </select>

            <Button type="submit" className="sm:col-span-2 h-10">
              <Plus className="w-3.5 h-3.5" />
              <span>Add Alert</span>
            </Button>
          </div>
          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        </form>
      </Card>

      {/* Auto-Alert Webhook Settings on Watchlist Diffs */}
      <Card className="p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200/80 dark:border-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <Bell className="w-4 h-4" />
            </span>
            <div>
              <h2 className="font-display text-sm font-semibold text-[#0F172A] dark:text-slate-100">
                Auto-Alert Webhooks on Watchlist Diffs
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Automatically push Slack, Discord, or JSON alerts whenever a monitor check discovers newly leaked or breached exposures.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              handleSaveAutoWebhook({
                ...autoWebhook,
                enabled: !autoWebhook.enabled,
              })
            }
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
              autoWebhook.enabled
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
            }`}
          >
            {autoWebhook.enabled ? 'Auto-Alerts Active' : 'Auto-Alerts Disabled'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          <select
            aria-label="Webhook provider"
            value={autoWebhook.provider}
            onChange={(e) =>
              handleSaveAutoWebhook({
                ...autoWebhook,
                provider: e.target.value as 'slack' | 'discord' | 'json',
              })
            }
            className="sm:col-span-3 h-10 px-3 rounded-xl border border-[#E5E7EB] dark:border-slate-700 bg-[#FAFAFA] dark:bg-slate-900 text-xs font-medium text-[#0F172A] dark:text-slate-100"
          >
            <option value="slack">Slack Incoming Webhook</option>
            <option value="discord">Discord Webhook</option>
            <option value="json">Custom JSON Endpoint</option>
          </select>

          <input
            type="url"
            value={autoWebhook.url}
            onChange={(e) =>
              setAutoWebhook((prev) => ({ ...prev, url: e.target.value }))
            }
            onBlur={() => saveAutoWebhookSettings(autoWebhook)}
            placeholder="https://hooks.slack.com/services/... or Discord webhook URL"
            className="sm:col-span-6 h-10 px-3.5 rounded-xl border border-[#E5E7EB] dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
          />

          <div className="sm:col-span-3 flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => handleSaveAutoWebhook(autoWebhook)}
              className="flex-1 h-10"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Save</span>
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={testingWebhook || !autoWebhook.url.trim()}
              onClick={() => void handleTestAutoWebhook()}
              className="flex-1 h-10"
            >
              {testingWebhook ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              <span>Test</span>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <label className="inline-flex items-center gap-2 text-slate-600 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={autoWebhook.onlyOnNewExposures}
              onChange={(e) =>
                handleSaveAutoWebhook({
                  ...autoWebhook,
                  onlyOnNewExposures: e.target.checked,
                })
              }
              className="rounded accent-indigo-600"
            />
            <span>Trigger only when diff detects new exposures or signals</span>
          </label>
          {webhookStatusMsg && (
            <span className="text-indigo-600 dark:text-indigo-400 font-medium">
              {webhookStatusMsg}
            </span>
          )}
        </div>
      </Card>

      {/* Active Rules List */}
      <Card className="overflow-hidden">
        {rules.length === 0 ? (
          <div className="py-14 px-6 text-center space-y-2">
            <BellRing className="w-7 h-7 text-slate-300 dark:text-slate-600 mx-auto" />
            <p className="text-sm font-semibold text-[#0F172A] dark:text-slate-100">
              No active monitors configured
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Add an email, username, domain, IP, or phone number above to save
              watch rules and run live exposure re-checks.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#F1F5F9] dark:divide-slate-800">
            {rules.map((rule) => {
              const isRunning = runningRuleId === rule.id;
              const diff = diffByRuleId[rule.id];
              const diffOpen = Boolean(expandedDiffIds[rule.id]);
              const deltaTotal = diff
                ? diff.addedBreaches.length +
                  diff.addedPlatforms.length +
                  diff.removedBreaches.length +
                  diff.removedPlatforms.length
                : 0;

              return (
                <div
                  key={rule.id}
                  className="px-6 py-4 space-y-3 hover:bg-[#FAFAFA]/70 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-[#0F172A] dark:text-slate-100">
                          {rule.target}
                        </span>
                        <span className="text-xs uppercase font-semibold text-orange-600 dark:text-orange-400">
                          {rule.targetType}
                        </span>
                        {rule.alertsCount > 0 && (
                          <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                            · {rule.alertsCount} exposure signal(s)
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        <span>
                          {rule.frequency} schedule · Last checked{' '}
                          {formatTimestamp(rule.lastCheckedAt)}
                        </span>
                        {diff && diff.hasBaseline && (
                          <>
                            <span aria-hidden="true">·</span>
                            {deltaTotal > 0 ? (
                              <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                                <GitCompare className="w-3 h-3" />
                                <span>
                                  +{diff.addedBreaches.length} new breaches · +
                                  {diff.addedPlatforms.length} new signals
                                </span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                                <GitCompare className="w-3 h-3" />
                                <span>Baseline unchanged</span>
                              </span>
                            )}
                          </>
                        )}
                        {diff && !diff.hasBaseline && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Initial baseline recorded</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {diff && diff.hasBaseline && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setExpandedDiffIds((prev) => ({
                              ...prev,
                              [rule.id]: !prev[rule.id],
                            }))
                          }
                        >
                          {diffOpen ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                          <span>View Diff</span>
                        </Button>
                      )}

                      {rule.lastScanId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onOpenInvestigation(rule.lastScanId!)}
                        >
                          <span>Latest Report</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </Button>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isRunning}
                        onClick={() => handleRunCheck(rule)}
                      >
                        {isRunning ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                        ) : (
                          <Play className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                        )}
                        <span>{isRunning ? 'Checking...' : 'Run Check'}</span>
                      </Button>

                      <button
                        type="button"
                        onClick={() => onToggleRule(rule.id, !rule.active)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                          rule.active
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                            : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {rule.active ? 'Active' : 'Paused'}
                      </button>

                      <button
                        type="button"
                        onClick={() => onDeleteRule(rule.id)}
                        aria-label={`Remove ${rule.target} monitor`}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Expandable Historical Baseline Diff */}
                  {diffOpen && diff && diff.hasBaseline && (
                    <div className="p-3.5 rounded-xl bg-slate-50/90 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div className="space-y-1.5">
                        <p className="font-semibold text-[#0F172A] dark:text-slate-100">
                          Newly Discovered Since Previous Scan
                        </p>
                        {diff.addedBreaches.length === 0 &&
                        diff.addedPlatforms.length === 0 ? (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            No new breaches or newly registered platforms detected.
                          </p>
                        ) : (
                          <div className="space-y-1">
                            {diff.addedBreaches.map((b) => (
                              <p
                                key={`add-b-${b}`}
                                className="font-mono text-[11px] text-rose-600 dark:text-rose-400"
                              >
                                + [Breach] {b}
                              </p>
                            ))}
                            {diff.addedPlatforms.map((p) => (
                              <p
                                key={`add-p-${p}`}
                                className="font-mono text-[11px] text-emerald-700 dark:text-emerald-400"
                              >
                                + [Platform] {p}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-[#0F172A] dark:text-slate-100">
                            Removed / Unavailable Signals
                          </p>
                          {diff.previousScanId && (
                            <button
                              type="button"
                              onClick={() => onOpenInvestigation(diff.previousScanId!)}
                              className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                            >
                              Open Previous Scan
                            </button>
                          )}
                        </div>
                        {diff.removedBreaches.length === 0 &&
                        diff.removedPlatforms.length === 0 ? (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            No signals disappeared from baseline.
                          </p>
                        ) : (
                          <div className="space-y-1">
                            {diff.removedBreaches.map((b) => (
                              <p
                                key={`rem-b-${b}`}
                                className="font-mono text-[11px] text-slate-500 dark:text-slate-400"
                              >
                                - [Breach] {b}
                              </p>
                            ))}
                            {diff.removedPlatforms.map((p) => (
                              <p
                                key={`rem-p-${p}`}
                                className="font-mono text-[11px] text-slate-500 dark:text-slate-400"
                              >
                                - [Platform] {p}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </motion.div>
  );
}
