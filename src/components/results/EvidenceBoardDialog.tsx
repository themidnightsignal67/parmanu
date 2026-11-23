import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Pin,
  Plus,
  ShieldAlert,
  StickyNote,
  Trash2,
} from 'lucide-react';
import type {
  EvidenceBoardPin,
  InvestigationRecord,
} from '@/src/types/investigation';
import {
  maskPiiString,
  removeEvidencePin,
  saveEvidenceBoard,
  updateEvidencePin,
} from '@/src/lib/annotationsStore';
import { Dialog } from '@/src/components/ui/Dialog';
import { Button } from '@/src/components/ui/Button';

interface EvidenceBoardDialogProps {
  open: boolean;
  onClose: () => void;
  investigation: InvestigationRecord;
  pins: EvidenceBoardPin[];
  onChangePins: (pins: EvidenceBoardPin[]) => void;
  redactPii: boolean;
}

export function EvidenceBoardDialog({
  open,
  onClose,
  investigation,
  pins,
  onChangePins,
  redactPii,
}: EvidenceBoardDialogProps) {
  const [priorityFilter, setPriorityFilter] = useState<
    'all' | 'critical' | 'high' | 'normal'
  >('all');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [notePriority, setNotePriority] = useState<'critical' | 'high' | 'normal'>(
    'high'
  );

  const filteredPins = useMemo(() => {
    if (priorityFilter === 'all') return pins;
    return pins.filter((p) => p.priority === priorityFilter);
  }, [pins, priorityFilter]);

  const handleAddNotePin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitle.trim()) return;
    const newPin: EvidenceBoardPin = {
      id: `pin_note_${Date.now().toString(36)}`,
      scanId: investigation.scanId,
      kind: 'note',
      refId: `note_${Date.now()}`,
      title: noteTitle.trim(),
      subtitle: noteBody.trim() || 'Analyst observation pinned to evidence board',
      category: 'Analyst Observation',
      priority: notePriority,
      analystNote: noteBody.trim() || undefined,
      pinnedAt: new Date().toISOString(),
    };
    const next = [newPin, ...pins];
    saveEvidenceBoard(investigation.scanId, next);
    onChangePins(next);
    setNoteTitle('');
    setNoteBody('');
  };

  const handlePriorityChange = (
    pinId: string,
    priority: 'critical' | 'high' | 'normal'
  ) => {
    const next = updateEvidencePin(investigation.scanId, pinId, { priority });
    onChangePins(next);
  };

  const handleNoteUpdate = (pinId: string, analystNote: string) => {
    const next = updateEvidencePin(investigation.scanId, pinId, { analystNote });
    onChangePins(next);
  };

  const handleRemove = (pinId: string) => {
    const next = removeEvidencePin(investigation.scanId, pinId);
    onChangePins(next);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Investigation Evidence Board"
      description="Pin critical platform matches, dorked documents, and custom analyst observations for priority triage and PDF dossier export."
      maxWidthClass="max-w-3xl"
    >
      <div className="space-y-5">
        {/* Add Custom Observation Pin */}
        <form
          onSubmit={handleAddNotePin}
          className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 space-y-3"
        >
          <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[#0F172A] dark:text-slate-100">
            <span className="inline-flex items-center gap-1.5">
              <StickyNote className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>Pin Custom Analyst Observation</span>
            </span>
            <select
              aria-label="Observation priority"
              value={notePriority}
              onChange={(e) =>
                setNotePriority(e.target.value as 'critical' | 'high' | 'normal')
              }
              className="h-7 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-semibold"
            >
              <option value="critical">Priority: Critical</option>
              <option value="high">Priority: High</option>
              <option value="normal">Priority: Normal</option>
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
            <input
              type="text"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              placeholder="Finding headline (e.g. Confirmed corporate commit email)"
              className="sm:col-span-5 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500"
            />
            <input
              type="text"
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder="Supporting evidence context or attribution..."
              className="sm:col-span-5 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!noteTitle.trim()}
              className="sm:col-span-2 h-9"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Pin</span>
            </Button>
          </div>
        </form>

        {/* Priority Filter Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-xs">
            {(
              [
                { id: 'all', label: `All (${pins.length})` },
                {
                  id: 'critical',
                  label: `Critical (${pins.filter((p) => p.priority === 'critical').length})`,
                },
                {
                  id: 'high',
                  label: `High (${pins.filter((p) => p.priority === 'high').length})`,
                },
                {
                  id: 'normal',
                  label: `Normal (${pins.filter((p) => p.priority === 'normal').length})`,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setPriorityFilter(tab.id)}
                className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  priorityFilter === tab.id
                    ? 'bg-white dark:bg-indigo-600 text-[#0F172A] dark:text-white shadow-2xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-slate-400">
            Synced to Dossier PDF Export
          </span>
        </div>

        {/* Pinned Items List */}
        {filteredPins.length === 0 ? (
          <div className="py-12 px-6 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center space-y-2">
            <Pin className="w-6 h-6 text-slate-300 dark:text-slate-600 mx-auto" />
            <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100">
              No evidence items pinned yet
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Click the Pin icon on any Result Card, Breach Record, Google Dork hit, Facial Match, or Record Inspector Drawer to curate key proof here.
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-1">
            {filteredPins.map((pin) => {
              const titleText = redactPii ? maskPiiString(pin.title, true) : pin.title;
              const subText = redactPii
                ? maskPiiString(pin.subtitle, true)
                : pin.subtitle;
              return (
                <div
                  key={pin.id}
                  className="p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0E1526] space-y-2.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                            pin.priority === 'critical'
                              ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                              : pin.priority === 'high'
                              ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          <ShieldAlert className="w-3 h-3" />
                          <span>{pin.priority}</span>
                        </span>
                        <span className="text-[10px] font-mono uppercase text-indigo-600 dark:text-indigo-400">
                          {pin.kind}
                        </span>
                        {pin.category && (
                          <span className="text-[11px] text-slate-400">
                            · {pin.category}
                          </span>
                        )}
                      </div>
                      <p className="text-xs sm:text-sm font-semibold text-[#0F172A] dark:text-slate-100">
                        {titleText}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 break-words">
                        {subText}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <select
                        aria-label={`Priority for ${pin.title}`}
                        value={pin.priority}
                        onChange={(e) =>
                          handlePriorityChange(
                            pin.id,
                            e.target.value as 'critical' | 'high' | 'normal'
                          )
                        }
                        className="h-7 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-[11px]"
                      >
                        <option value="critical">Critical</option>
                        <option value="high">High</option>
                        <option value="normal">Normal</option>
                      </select>

                      {pin.url && (
                        <a
                          href={pin.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-indigo-600"
                          title="Open source URL"
                        >
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </a>
                      )}

                      <button
                        type="button"
                        onClick={() => handleRemove(pin.id)}
                        aria-label={`Unpin ${pin.title}`}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <input
                    type="text"
                    defaultValue={pin.analystNote || ''}
                    onBlur={(e) => {
                      if (e.target.value !== (pin.analystNote || '')) {
                        handleNoteUpdate(pin.id, e.target.value);
                      }
                    }}
                    placeholder="Add triage note for this pinned evidence..."
                    className="w-full h-8 px-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 text-[11px] text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Dialog>
  );
}
