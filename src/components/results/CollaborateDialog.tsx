import React, { useState } from 'react';
import { Check, Copy, Link2, Trash2, UserPlus } from 'lucide-react';
import { useAuth } from '@/src/contexts/AuthContext';
import { updateInvestigationCollaborators } from '@/src/lib/firestoreStore';
import type { InvestigationRecord } from '@/src/types/investigation';
import { Button } from '@/src/components/ui/Button';
import { Dialog } from '@/src/components/ui/Dialog';

interface CollaborateDialogProps {
  open: boolean;
  onClose: () => void;
  investigation: InvestigationRecord;
  onUpdateInvestigation: (record: InvestigationRecord) => void;
  onNotify: (toast: {
    type: 'success' | 'error' | 'info';
    title: string;
    message?: string;
  }) => void;
}

export function CollaborateDialog({
  open,
  onClose,
  investigation,
  onUpdateInvestigation,
  onNotify,
}: CollaborateDialogProps) {
  const { user } = useAuth();
  const [inviteEmail, setInviteEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [copiedBrief, setCopiedBrief] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const collaborators = investigation.collaboratorEmails || [];
  const isOwner = !investigation.ownerId || investigation.ownerId === user?.uid;

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?scan=${encodeURIComponent(investigation.scanId)}`
      : '';

  const handleCopyBrief = async () => {
    const lines = [
      `Parmanu Investigation Brief — ${investigation.target} (${investigation.targetType})`,
      `Scan ID: ${investigation.scanId}`,
      `Total Results: ${investigation.summary.total} · Breached: ${investigation.summary.breached} · Registered: ${investigation.summary.registered} · Leaked: ${investigation.summary.leaked}`,
      investigation.aiSummary?.executiveBrief || '',
      shareUrl ? `Case Link: ${shareUrl}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      await navigator.clipboard.writeText(lines);
      setCopiedBrief(true);
      onNotify({ type: 'success', title: 'Case summary copied to clipboard' });
      window.setTimeout(() => setCopiedBrief(false), 1800);
    } catch {
      onNotify({ type: 'error', title: 'Clipboard permission unavailable' });
    }
  };

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      onNotify({ type: 'success', title: 'Direct case link copied' });
      window.setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      onNotify({ type: 'error', title: 'Clipboard permission unavailable' });
    }
  };

  const handleAddCollaborator = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !isOwner) return;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      onNotify({ type: 'error', title: 'Enter a valid teammate Google email address' });
      return;
    }

    if (collaborators.includes(email)) {
      onNotify({ type: 'info', title: 'Teammate already has access' });
      return;
    }
    if (collaborators.length >= 10) {
      onNotify({
        type: 'error',
        title: 'Collaborator limit reached (max 10 per case)',
      });
      return;
    }

    setSaving(true);
    const nextList = [...collaborators, email];
    try {
      await updateInvestigationCollaborators(investigation.scanId, nextList);
      onUpdateInvestigation({
        ...investigation,
        collaboratorEmails: nextList,
      });
      setInviteEmail('');
      onNotify({
        type: 'success',
        title: 'Collaborator Access Granted',
        message: `${email} can now open this case upon Google Sign-In.`,
      });
    } catch (err) {
      onNotify({
        type: 'error',
        title: 'Failed to save collaborator',
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveCollaborator = async (email: string) => {
    if (!isOwner) return;
    setSaving(true);
    const nextList = collaborators.filter((c) => c !== email);
    try {
      await updateInvestigationCollaborators(investigation.scanId, nextList);
      onUpdateInvestigation({
        ...investigation,
        collaboratorEmails: nextList,
      });
      onNotify({ type: 'info', title: `Revoked access for ${email}` });
    } catch {
      onNotify({ type: 'error', title: 'Unable to update collaborators' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Collaborate on Investigation"
      description={`Grant verified Google Sign-In teammates live access to ${investigation.target}.`}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3.5 rounded-xl bg-[#FAFAFA] dark:bg-slate-900/70 border border-[#E5E7EB] dark:border-slate-800 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100">
                Copy Brief
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                Metrics & AI brief
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleCopyBrief}>
              {copiedBrief ? (
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              )}
              <span>{copiedBrief ? 'Copied' : 'Copy'}</span>
            </Button>
          </div>

          <div className="p-3.5 rounded-xl bg-[#FAFAFA] dark:bg-slate-900/70 border border-[#E5E7EB] dark:border-slate-800 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100">
                Share Case URL
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                Direct scan deep-link
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleCopyShareLink}>
              {copiedLink ? (
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Link2 className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              )}
              <span>{copiedLink ? 'Copied' : 'Link'}</span>
            </Button>
          </div>
        </div>

        {isOwner ? (
          <form onSubmit={handleAddCollaborator} className="space-y-3">
            <label
              htmlFor="collab-email"
              className="block text-xs font-semibold text-[#0F172A] dark:text-slate-100"
            >
              Share with Teammate Google Email
            </label>
            <div className="flex items-center gap-2">
              <input
                id="collab-email"
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@organization.com"
                className="flex-1 h-10 px-3.5 rounded-xl border border-[#E5E7EB] dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
              />
              <Button type="submit" size="md" disabled={saving}>
                <UserPlus className="w-3.5 h-3.5" />
                <span>{saving ? 'Saving...' : 'Grant'}</span>
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400 bg-[#FAFAFA] dark:bg-slate-900/70 border border-[#E5E7EB] dark:border-slate-800 rounded-xl p-3">
            Shared with you by{' '}
            <strong className="text-[#0F172A] dark:text-slate-100">
              {investigation.ownerEmail || 'Case Owner'}
            </strong>
            .
          </p>
        )}

        {collaborators.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-[#F1F5F9] dark:border-slate-800">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Authorized Collaborators ({collaborators.length}/10)
            </p>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {collaborators.map((email) => (
                <div
                  key={email}
                  className="px-3 py-2 rounded-xl bg-[#FAFAFA] dark:bg-slate-900/70 border border-[#E5E7EB]/80 dark:border-slate-800 flex items-center justify-between gap-2 text-xs"
                >
                  <span className="font-mono text-[#0F172A] dark:text-slate-100 truncate">
                    {email}
                  </span>
                  {isOwner && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleRemoveCollaborator(email)}
                      aria-label={`Remove ${email}`}
                      className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
