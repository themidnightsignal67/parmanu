import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  CheckCircle2,
  Cpu,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { INVESTIGATION_TOOLS } from '@/src/data/tools';
import type { GeminiPoolStatus } from '@/src/lib/api';
import type {
  TeamMemberRecord,
  ToolAvailabilityStatus,
  ToolId,
} from '@/src/types/investigation';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';

interface TeamPageProps {
  currentUser: string;
  displayName: string;
  members: TeamMemberRecord[];
  toolAvailability: Record<ToolId, ToolAvailabilityStatus>;
  geminiStatus: GeminiPoolStatus | null;
  onAddMember: (email: string, role: TeamMemberRecord['role']) => Promise<void>;
  onChangeMemberRole: (
    memberId: string,
    role: TeamMemberRecord['role']
  ) => Promise<void>;
  onRemoveMember: (memberId: string) => Promise<void>;
  onSignOut: () => void;
  onNotify: (toast: {
    type: 'success' | 'error' | 'info';
    title: string;
    message?: string;
  }) => void;
}

export function TeamPage({
  currentUser,
  displayName,
  members,
  toolAvailability,
  geminiStatus,
  onAddMember,
  onChangeMemberRole,
  onRemoveMember,
  onSignOut,
  onNotify,
}: TeamPageProps) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] =
    useState<TeamMemberRecord['role']>('Investigator');
  const [saving, setSaving] = useState(false);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inviteEmail.trim().toLowerCase();
    if (!trimmed) return;
    if (
      trimmed === currentUser.toLowerCase() ||
      members.some((m) => m.email.toLowerCase() === trimmed)
    ) {
      onNotify({ type: 'info', title: 'Member already in workspace' });
      return;
    }
    setSaving(true);
    try {
      await onAddMember(trimmed, inviteRole);
      setInviteEmail('');
      onNotify({
        type: 'success',
        title: 'Workspace Analyst Added',
        message: trimmed,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="max-w-5xl mx-auto px-4 sm:px-8 py-8 space-y-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#0F172A] dark:text-slate-100">
            Team & Workspace
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Manage authenticated Google analysts and live Parmanu engine
            readiness.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-[#E5E7EB] dark:border-slate-800 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            Unlimited Queries · Active Workspace
          </div>
          <Button variant="outline" size="sm" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </div>

      {/* Invite Form + Persisted Member Roster */}
      <Card className="p-6 space-y-5">
        <form onSubmit={handleInvite} className="flex flex-wrap gap-3">
          <input
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="Add teammate Google email..."
            className="flex-1 min-w-[220px] h-10 px-3.5 rounded-xl border border-[#E5E7EB] dark:border-slate-700 bg-[#FAFAFA] dark:bg-slate-900 text-sm text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
          />
          <select
            aria-label="Member role"
            value={inviteRole}
            onChange={(e) =>
              setInviteRole(e.target.value as TeamMemberRecord['role'])
            }
            className="h-10 px-3 rounded-xl border border-[#E5E7EB] dark:border-slate-700 bg-[#FAFAFA] dark:bg-slate-900 text-xs font-medium text-[#0F172A] dark:text-slate-100 focus:outline-none focus:border-indigo-400"
          >
            <option value="Investigator">Investigator</option>
            <option value="Viewer">Viewer</option>
          </select>
          <Button type="submit" disabled={saving}>
            <UserPlus className="w-3.5 h-3.5" />
            <span>{saving ? 'Adding...' : 'Add Analyst'}</span>
          </Button>
        </form>

        <div className="divide-y divide-[#F1F5F9] dark:divide-slate-800 border-t border-[#F1F5F9] dark:border-slate-800">
          {/* Authenticated Owner Row */}
          <div className="py-3.5 flex items-center justify-between gap-3 text-xs">
            <div className="min-w-0">
              <p className="font-semibold text-[#0F172A] dark:text-slate-100 truncate">
                {displayName}{' '}
                <span className="font-mono font-normal text-slate-500 dark:text-slate-400">
                  ({currentUser})
                </span>
              </p>
              <p className="text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Lead Analyst · Google Verified Session</span>
              </p>
            </div>
            <span className="text-emerald-600 dark:text-emerald-400 font-medium shrink-0">Active</span>
          </div>

          {members.map((m) => (
            <div
              key={m.id}
              className="py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs"
            >
              <div>
                <p className="font-semibold text-[#0F172A] dark:text-slate-100 font-mono">
                  {m.email}
                </p>
                <p className="text-slate-500 dark:text-slate-400 mt-0.5">{m.status}</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label={`Role for ${m.email}`}
                  value={m.role}
                  onChange={(e) =>
                    onChangeMemberRole(
                      m.id,
                      e.target.value as TeamMemberRecord['role']
                    )
                  }
                  className="h-8 px-2.5 rounded-lg border border-[#E5E7EB] dark:border-slate-700 bg-[#FAFAFA] dark:bg-slate-900 text-xs font-medium text-[#0F172A] dark:text-slate-100"
                >
                  <option value="Investigator">Investigator</option>
                  <option value="Viewer">Viewer</option>
                </select>
                <button
                  type="button"
                  onClick={() => onRemoveMember(m.id)}
                  aria-label={`Remove ${m.email}`}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Engine & Gemini Pool Readiness */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-orange-600 dark:text-orange-400" />
            <h2 className="font-display text-sm font-semibold text-[#0F172A] dark:text-slate-100">
              Connected OSINT Modules
            </h2>
          </div>
          <div className="space-y-2.5">
            {INVESTIGATION_TOOLS.map((tool) => (
              <div
                key={tool.id}
                className="flex items-center justify-between gap-3 py-2 border-b border-[#F8FAFC] dark:border-slate-800 last:border-0 text-xs"
              >
                <div>
                  <p className="font-semibold text-[#0F172A] dark:text-slate-100">{tool.name}</p>
                  <p className="text-slate-500 dark:text-slate-400">
                    {tool.supportedTargets.join(' · ')}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{toolAvailability[tool.id] || 'ready'}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <h2 className="font-display text-sm font-semibold text-[#0F172A] dark:text-slate-100">
              AI Analyst Key Rotation Pool
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Parmanu automatically rotates across up to 10 server-side AI API key
            slots on rate-limit or quota events without interrupting
            investigations.
          </p>
          <div className="space-y-2 text-xs">
            {geminiStatus && geminiStatus.configuredSlots > 0 ? (
              geminiStatus.slots.map((s) => (
                <div
                  key={s.slot}
                  className="p-3 rounded-xl bg-[#FAFAFA] dark:bg-slate-900 border border-[#E5E7EB] dark:border-slate-800 flex items-center justify-between"
                >
                  <span className="font-mono font-medium text-[#0F172A] dark:text-slate-100">
                    Key Slot {s.slot}
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
              <div className="p-3.5 rounded-xl bg-[#FAFAFA] dark:bg-slate-900 border border-[#E5E7EB] dark:border-slate-800 text-slate-500 dark:text-slate-400">
                Server-side key rotation pool configured via environment
                variables. Heuristic summary fallback active.
              </div>
            )}
          </div>
        </Card>
      </div>
    </motion.div>
  );
}
