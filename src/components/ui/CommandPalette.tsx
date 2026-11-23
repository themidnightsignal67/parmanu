import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Clock,
  Cpu,
  EyeOff,
  FileSearch,
  FileSpreadsheet,
  FolderKanban,
  Globe,
  History,
  Link2,
  Moon,
  ScanFace,
  Search,
  Sun,
  Users,
} from 'lucide-react';
import type { AppRoute, InvestigationRecord, TargetType } from '@/src/types/investigation';
import { detectTargetTypeFromInput } from '@/src/lib/api';

interface CommandItem {
  id: string;
  group: string;
  label: string;
  subtitle?: string;
  shortcut?: string;
  icon: React.ComponentType<{ className?: string }>;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onNavigate: (route: AppRoute) => void;
  investigations: InvestigationRecord[];
  activeInvestigation: InvestigationRecord | null;
  redactPii: boolean;
  onToggleRedactPii?: () => void;
  onOpenInvestigation: (scanId: string) => void;
  onQuickPivotScan?: (target: string, targetType: TargetType) => void;
  onOpenTimeline?: () => void;
  onOpenForensics?: () => void;
  onOpenFacial?: () => void;
  onOpenCompareCases?: () => void;
}

export function CommandPalette({
  open,
  onClose,
  theme,
  onToggleTheme,
  onNavigate,
  investigations,
  activeInvestigation,
  redactPii,
  onToggleRedactPii,
  onOpenInvestigation,
  onQuickPivotScan,
  onOpenTimeline,
  onOpenForensics,
  onOpenFacial,
  onOpenCompareCases,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const items = useMemo<CommandItem[]>(() => {
    const trimmed = query.trim();
    const list: CommandItem[] = [];

    if (trimmed.length >= 2 && onQuickPivotScan) {
      const detected = detectTargetTypeFromInput(trimmed) || 'username';
      list.push({
        id: 'quick-scan',
        group: 'Quick Search',
        label: `Scan "${trimmed}"`,
        subtitle: `Run authorized ${detected.toUpperCase()} OSINT scan`,
        shortcut: 'Enter',
        icon: Search,
        action: () => {
          onQuickPivotScan(trimmed, detected);
          onClose();
        },
      });
    }

    if (activeInvestigation) {
      if (onOpenTimeline) {
        list.push({
          id: 'open-timeline',
          group: 'Active Case',
          label: `Show Timeline for ${activeInvestigation.target}`,
          subtitle: 'Open chronological breach & signal timeline view',
          icon: Clock,
          action: () => {
            onOpenTimeline();
            onClose();
          },
        });
      }
      if (onOpenFacial) {
        list.push({
          id: 'open-facial',
          group: 'Active Case',
          label: 'Open Facial Recognition Lab',
          subtitle: 'Compare faces across discovered avatars or an uploaded photo',
          icon: ScanFace,
          action: () => {
            onOpenFacial();
            onClose();
          },
        });
      }
      if (onOpenForensics) {
        list.push({
          id: 'open-forensics',
          group: 'Active Case',
          label: 'Open EXIF & Hash Forensics Lab',
          subtitle: 'Inspect image EXIF, PDF author metadata, SHA-256 & MD5',
          icon: FileSearch,
          action: () => {
            onOpenForensics();
            onClose();
          },
        });
      }
      if (onToggleRedactPii) {
        list.push({
          id: 'toggle-pii',
          group: 'Active Case',
          label: redactPii ? 'Disable PII Redaction Mask' : 'Enable PII Redaction Mask',
          subtitle: 'Mask sensitive emails, phones, and handles before sharing',
          icon: EyeOff,
          action: () => {
            onToggleRedactPii();
            onClose();
          },
        });
      }
    }

    if (investigations.length >= 2 && onOpenCompareCases) {
      list.push({
        id: 'open-compare-cases',
        group: 'Workspace',
        label: 'Compare Two Cases (Cross-Case Entity Linker)',
        subtitle: 'Find shared domains, breaches, handles & commit emails across scans',
        icon: Link2,
        action: () => {
          onOpenCompareCases();
          onClose();
        },
      });
    }

    list.push({
      id: 'toggle-theme',
      group: 'Workspace',
      label: theme === 'dark' ? 'Switch to Light Workspace' : 'Switch to Obsidian Dark Analyst Mode',
      subtitle: 'Toggle light / dark-room OSINT console appearance',
      icon: theme === 'dark' ? Sun : Moon,
      action: () => {
        onToggleTheme();
        onClose();
      },
    });

    const navCommands: Array<{
      id: string;
      label: string;
      route: AppRoute;
      subtitle: string;
      icon: React.ComponentType<{ className?: string }>;
    }> = [
      { id: 'nav-search', label: 'New Search', route: 'search', subtitle: 'Launch single-target OSINT lookup', icon: Search },
      { id: 'nav-batch', label: 'Batch Target Scan', route: 'batch', subtitle: 'Extract and scan multiple targets from files', icon: FileSpreadsheet },
      { id: 'nav-cases', label: 'Investigations', route: 'investigations', subtitle: 'Active cases & exported visual snapshots', icon: FolderKanban },
      { id: 'nav-history', label: 'Search History', route: 'history', subtitle: 'Audit table of previous queries', icon: History },
      { id: 'nav-monitoring', label: 'Monitoring Watchlists', route: 'monitoring', subtitle: 'Scheduled exposure alerts & baseline diffs', icon: Activity },
      { id: 'nav-modules', label: 'OSINT Modules & Health', route: 'modules', subtitle: 'Live engine status & Gemini rotation pool', icon: Cpu },
      { id: 'nav-team', label: 'Team & Workspace', route: 'team', subtitle: 'Manage investigators and settings', icon: Users },
    ];

    for (const nc of navCommands) {
      list.push({
        id: nc.id,
        group: 'Navigation',
        label: nc.label,
        subtitle: nc.subtitle,
        icon: nc.icon,
        action: () => {
          onNavigate(nc.route);
          onClose();
        },
      });
    }

    for (const inv of investigations.slice(0, 12)) {
      list.push({
        id: `inv-${inv.scanId}`,
        group: 'Saved Investigations',
        label: inv.target,
        subtitle: `${inv.targetType.toUpperCase()} · ${inv.summary.found} matches · ${inv.summary.breached} breaches`,
        icon: Globe,
        action: () => {
          onOpenInvestigation(inv.scanId);
          onClose();
        },
      });
    }

    const q = trimmed.toLowerCase();
    if (!q) return list;
    return list.filter(
      (item) =>
        item.id === 'quick-scan' ||
        item.label.toLowerCase().includes(q) ||
        (item.subtitle || '').toLowerCase().includes(q) ||
        item.group.toLowerCase().includes(q)
    );
  }, [
    query,
    onQuickPivotScan,
    activeInvestigation,
    onOpenTimeline,
    onOpenForensics,
    onOpenFacial,
    onOpenCompareCases,
    onToggleRedactPii,
    redactPii,
    theme,
    onToggleTheme,
    onNavigate,
    investigations,
    onOpenInvestigation,
    onClose,
  ]);

  useEffect(() => {
    setSelectedIndex((idx) => Math.min(idx, Math.max(0, items.length - 1)));
  }, [items.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (items.length === 0 ? 0 : (i + 1) % items.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) =>
          items.length === 0 ? 0 : (i - 1 + items.length) % items.length
        );
      } else if (e.key === 'Enter' && items[selectedIndex]) {
        e.preventDefault();
        items[selectedIndex].action();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, selectedIndex, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 bg-slate-900/40 dark:bg-black/70 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-[#0D1424] border border-slate-200 dark:border-slate-800 shadow-[0_28px_72px_rgba(15,23,42,0.28)] overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to case, toggle theme, open timeline, or type target to scan..."
            className="flex-1 bg-transparent text-sm text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
          <kbd className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
            Esc
          </kbd>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-2 space-y-1">
          {items.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              No matching commands or investigations.
            </div>
          ) : (
            items.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={item.action}
                  className={`w-full px-3 py-2.5 rounded-xl flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-950 dark:text-indigo-100'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">{item.label}</p>
                      {item.subtitle && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {item.subtitle}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-medium text-slate-400">
                      {item.group}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <span>↑↓ Navigate · Enter Execute</span>
          <span className="font-mono">⌘K / Ctrl+K</span>
        </div>
      </div>
    </div>
  );
}
