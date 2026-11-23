import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  ArrowUpRight,
  Crosshair,
  Globe,
  Image as ImageIcon,
  Link2,
  Mail,
  MapPin,
  ShieldAlert,
  User,
} from 'lucide-react';
import type {
  InvestigationRecord,
  TargetType,
} from '@/src/types/investigation';
import { maskIdentifierLabel, maskPiiString } from '@/src/lib/annotationsStore';
import { Dialog } from '@/src/components/ui/Dialog';
import { Button } from '@/src/components/ui/Button';
import { SafeAvatar } from '@/src/components/ui/SafeAvatar';

interface CrossCaseLinkerDialogProps {
  open: boolean;
  onClose: () => void;
  investigations: InvestigationRecord[];
  initialScanId?: string;
  redactPii: boolean;
  onOpenInvestigation: (scanId: string) => void;
  onPivotScan?: (target: string, targetType: TargetType) => void;
}

interface ExtractedEntities {
  domains: Set<string>;
  breaches: Set<string>;
  handles: Set<string>;
  emails: Set<string>;
  regions: Set<string>;
  ips: Set<string>;
  avatars: Set<string>;
}

function extractEntities(inv: InvestigationRecord): ExtractedEntities {
  const domains = new Set<string>();
  const breaches = new Set<string>();
  const handles = new Set<string>();
  const emails = new Set<string>();
  const regions = new Set<string>();
  const ips = new Set<string>();
  const avatars = new Set<string>();

  if (inv.targetType === 'domain') domains.add(inv.target.toLowerCase());
  if (inv.targetType === 'email') emails.add(inv.target.toLowerCase());
  if (inv.targetType === 'username') handles.add(inv.target.toLowerCase());
  if (inv.targetType === 'ip') ips.add(inv.target.toLowerCase());

  for (const b of inv.breachedAccounts || []) {
    const label = (b.breachName || b.platform || '').trim();
    if (label) breaches.add(label.toLowerCase());
    if (b.domain) domains.add(b.domain.toLowerCase());
  }

  for (const gm of inv.geoMarkers || []) {
    if (gm.region || gm.country) {
      regions.add(`${gm.region}, ${gm.country}`.toLowerCase());
    }
  }

  for (const p of inv.profilePhotos || []) {
    if (p.url) avatars.add(p.url);
    if (p.handle) handles.add(p.handle.toLowerCase());
  }

  for (const r of inv.results || []) {
    if (r.status !== 'found') continue;
    if (r.domain && !r.domain.includes(' ')) domains.add(r.domain.toLowerCase());
    if (r.handle) {
      const clean = r.handle.trim().toLowerCase();
      if (clean.includes('@')) emails.add(clean);
      else if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(clean)) ips.add(clean);
      else if (clean.length >= 2) handles.add(clean);
    }
    if (r.avatarUrl) avatars.add(r.avatarUrl);
    for (const art of r.artifacts || []) {
      if (art.authorEmail && !art.authorEmail.endsWith('users.noreply.github.com')) {
        emails.add(art.authorEmail.toLowerCase());
      }
    }
    const d = (r.details || {}) as Record<string, unknown>;
    if (Array.isArray(d.aRecords)) {
      for (const ip of d.aRecords) {
        if (typeof ip === 'string') ips.add(ip);
      }
    }
    if (typeof d.ip === 'string') ips.add(d.ip);
  }

  return { domains, breaches, handles, emails, regions, ips, avatars };
}

function intersect(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const item of a) {
    if (b.has(item)) out.push(item);
  }
  return out.sort();
}

export function CrossCaseLinkerDialog({
  open,
  onClose,
  investigations,
  initialScanId,
  redactPii,
  onOpenInvestigation,
  onPivotScan,
}: CrossCaseLinkerDialogProps) {
  const [scanAId, setScanAId] = useState<string>('');
  const [scanBId, setScanBId] = useState<string>('');

  useEffect(() => {
    if (!open || investigations.length === 0) return;
    const first =
      (initialScanId &&
        investigations.find((i) => i.scanId === initialScanId)?.scanId) ||
      investigations[0].scanId;
    const second =
      investigations.find((i) => i.scanId !== first)?.scanId || first;
    setScanAId(first);
    setScanBId(second);
  }, [open, initialScanId, investigations]);

  const caseA = investigations.find((i) => i.scanId === scanAId) || null;
  const caseB = investigations.find((i) => i.scanId === scanBId) || null;

  const overlap = useMemo(() => {
    if (!caseA || !caseB) return null;
    const entA = extractEntities(caseA);
    const entB = extractEntities(caseB);
    const sharedDomains = intersect(entA.domains, entB.domains);
    const sharedBreaches = intersect(entA.breaches, entB.breaches);
    const sharedHandles = intersect(entA.handles, entB.handles);
    const sharedEmails = intersect(entA.emails, entB.emails);
    const sharedRegions = intersect(entA.regions, entB.regions);
    const sharedIps = intersect(entA.ips, entB.ips);
    const sharedAvatars = intersect(entA.avatars, entB.avatars);
    const totalLinks =
      sharedDomains.length +
      sharedBreaches.length +
      sharedHandles.length +
      sharedEmails.length +
      sharedRegions.length +
      sharedIps.length +
      sharedAvatars.length;
    const unionApprox = Math.max(
      1,
      entA.domains.size +
        entB.domains.size +
        entA.breaches.size +
        entB.breaches.size +
        entA.handles.size +
        entB.handles.size +
        entA.emails.size +
        entB.emails.size
    );
    const score = Math.min(100, Math.round((totalLinks / (unionApprox * 0.45)) * 100));

    return {
      sharedDomains,
      sharedBreaches,
      sharedHandles,
      sharedEmails,
      sharedRegions,
      sharedIps,
      sharedAvatars,
      totalLinks,
      score,
    };
  }, [caseA, caseB]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Cross-Case Entity Linker"
      description="Compare any two saved investigations to uncover shared breach exposures, handles, commit emails, IPs, and regional overlaps."
      maxWidthClass="max-w-3xl"
    >
      {investigations.length < 2 ? (
        <div className="py-10 text-center space-y-2 text-xs text-slate-500 dark:text-slate-400">
          <Link2 className="w-7 h-7 text-slate-300 dark:text-slate-600 mx-auto" />
          <p className="font-semibold text-[#0F172A] dark:text-slate-100">
            At least 2 saved investigations are required
          </p>
          <p>Run another OSINT search so Parmanu can correlate overlapping entities between targets.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Case Selector Row */}
          <div className="grid grid-cols-1 sm:grid-cols-11 gap-2 items-center">
            <div className="sm:col-span-5 space-y-1">
              <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                Primary Case (A)
              </label>
              <select
                value={scanAId}
                onChange={(e) => setScanAId(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-mono text-[#0F172A] dark:text-slate-100"
              >
                {investigations.map((inv) => (
                  <option key={inv.scanId} value={inv.scanId}>
                    [{inv.targetType.toUpperCase()}] {maskIdentifierLabel(inv.target, inv.targetType, redactPii)} ({inv.summary.found} hits)
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-1 flex justify-center pt-4 text-slate-400">
              <ArrowRightLeft className="w-4 h-4" />
            </div>

            <div className="sm:col-span-5 space-y-1">
              <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                Compared Case (B)
              </label>
              <select
                value={scanBId}
                onChange={(e) => setScanBId(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-mono text-[#0F172A] dark:text-slate-100"
              >
                {investigations.map((inv) => (
                  <option key={inv.scanId} value={inv.scanId}>
                    [{inv.targetType.toUpperCase()}] {maskIdentifierLabel(inv.target, inv.targetType, redactPii)} ({inv.summary.found} hits)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {caseA && caseB && overlap && (
            <>
              {/* Score Banner */}
              <div className="p-4 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/35 border border-indigo-200/80 dark:border-indigo-900/60 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-indigo-950 dark:text-indigo-200">
                    Correlation Strength: {overlap.totalLinks} Shared Signal
                    {overlap.totalLinks === 1 ? '' : 's'}
                  </p>
                  <p className="text-[11px] text-indigo-700/80 dark:text-indigo-300/80 mt-0.5">
                    {caseA.scanId === caseB.scanId
                      ? 'Select two distinct investigations above to compute cross-target attribution links.'
                      : overlap.totalLinks > 0
                      ? 'Matching infrastructure, handles, breaches, or regions suggest shared operational links.'
                      : 'No direct shared entities found between these two investigations.'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-display text-xl font-bold text-indigo-700 dark:text-indigo-300 tabular-nums">
                    {overlap.score}%
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onOpenInvestigation(caseB.scanId);
                      onClose();
                    }}
                  >
                    <span>Open Case B</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* Categorized Shared Entities */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {[
                  {
                    title: 'Shared Emails & Commit Authors',
                    items: overlap.sharedEmails,
                    Icon: Mail,
                    pivotType: 'email' as TargetType,
                  },
                  {
                    title: 'Shared Handles & Usernames',
                    items: overlap.sharedHandles,
                    Icon: User,
                    pivotType: 'username' as TargetType,
                  },
                  {
                    title: 'Shared Breach Incidents',
                    items: overlap.sharedBreaches,
                    Icon: ShieldAlert,
                    pivotType: null,
                  },
                  {
                    title: 'Shared Domains',
                    items: overlap.sharedDomains,
                    Icon: Globe,
                    pivotType: 'domain' as TargetType,
                  },
                  {
                    title: 'Shared Infrastructure IPs',
                    items: overlap.sharedIps,
                    Icon: Crosshair,
                    pivotType: 'ip' as TargetType,
                  },
                  {
                    title: 'Shared Geographic Regions',
                    items: overlap.sharedRegions,
                    Icon: MapPin,
                    pivotType: null,
                  },
                ].map((group) => {
                  const Icon = group.Icon;
                  return (
                    <div
                      key={group.title}
                      className="p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0E1526] space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-[#0F172A] dark:text-slate-100 inline-flex items-center gap-1.5">
                          <Icon className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                          <span>{group.title}</span>
                        </span>
                        <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                          {group.items.length}
                        </span>
                      </div>

                      {group.items.length === 0 ? (
                        <p className="text-[11px] text-slate-400">None detected</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {group.items.map((val) => {
                            const label = redactPii ? maskPiiString(val, true) : val;
                            return group.pivotType && onPivotScan ? (
                              <button
                                key={val}
                                type="button"
                                onClick={() => {
                                  onPivotScan(val, group.pivotType!);
                                  onClose();
                                }}
                                className="px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-900 font-mono text-[11px] text-indigo-800 dark:text-indigo-200 hover:bg-indigo-100 cursor-pointer inline-flex items-center gap-1"
                              >
                                <span>{label}</span>
                                <Crosshair className="w-2.5 h-2.5" />
                              </button>
                            ) : (
                              <span
                                key={val}
                                className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-mono text-[11px] text-[#0F172A] dark:text-slate-200"
                              >
                                {label}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}

                <div className="md:col-span-2 p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0E1526] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#0F172A] dark:text-slate-100 inline-flex items-center gap-1.5">
                      <ImageIcon className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                      <span>Shared Profile Avatars & Image URLs</span>
                    </span>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {overlap.sharedAvatars.length}
                    </span>
                  </div>
                  {overlap.sharedAvatars.length === 0 ? (
                    <p className="text-[11px] text-slate-400">None detected</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {overlap.sharedAvatars.map((avatarUrl) => (
                        <div
                          key={avatarUrl}
                          className="inline-flex items-center gap-2 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700"
                        >
                          <SafeAvatar
                            src={avatarUrl}
                            alt="Shared avatar"
                            className="w-6 h-6 rounded-md object-cover bg-slate-200 dark:bg-slate-700 shrink-0"
                            fallback={
                              <ImageIcon className="w-4 h-4 text-slate-400 shrink-0" />
                            }
                          />
                          <span className="font-mono text-[11px] text-[#0F172A] dark:text-slate-200 max-w-[200px] truncate">
                            {redactPii ? maskPiiString(avatarUrl, true) : avatarUrl}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
