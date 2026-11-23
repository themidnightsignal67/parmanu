import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  BellRing,
  Command,
  Cpu,
  Crown,
  FolderKanban,
  History,
  Home,
  Infinity as InfinityIcon,
  Layers,
  LogIn,
  LogOut,
  Menu,
  Moon,
  Music,
  Search,
  ShieldAlert,
  Sun,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import analystAvatar from '@/src/assets/images/analyst_avatar_1794745597692.jpg';
import type { CreditStatusResponse } from '@/src/lib/api';
import {
  isMusicEnabled,
  isSoundEnabled,
  subscribeAudioState,
  toggleMusicEnabled,
  toggleSoundEnabled,
} from '@/src/lib/sound';
import type { AppRoute } from '@/src/types/investigation';
import { ParmanuLogo } from '@/src/components/ui/ParmanuLogo';

interface SidebarProps {
  currentRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
  isSignedIn: boolean;
  signingIn: boolean;
  username: string;
  avatarUrl?: string;
  onSignIn: () => Promise<void>;
  onSignOut: () => void;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  onOpenCommandPalette?: () => void;
  creditStatus?: CreditStatusResponse | null;
}

const NAV_GROUPS: Array<{
  title: string;
  items: Array<{
    route: AppRoute;
    label: string;
    Icon: React.ComponentType<{ className?: string }>;
  }>;
}> = [
  {
    title: 'RESEARCH',
    items: [
      { route: 'search', label: 'Search', Icon: Search },
      { route: 'batch', label: 'Batch Mode', Icon: Layers },
      { route: 'history', label: 'History', Icon: History },
      { route: 'investigations', label: 'Investigations', Icon: FolderKanban },
      { route: 'modules', label: 'Modules', Icon: Cpu },
    ],
  },
  {
    title: 'MONITORING',
    items: [
      { route: 'monitoring', label: 'Monitoring & Alerts', Icon: BellRing },
    ],
  },
  {
    title: 'WORKSPACE',
    items: [{ route: 'team', label: 'Team', Icon: Users }],
  },
];

export function Sidebar({
  currentRoute,
  onNavigate,
  isSignedIn,
  signingIn,
  username,
  avatarUrl,
  onSignIn,
  onSignOut,
  theme = 'light',
  onToggleTheme,
  onOpenCommandPalette,
  creditStatus,
}: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [avatarErr, setAvatarErr] = useState(false);
  const [soundOn, setSoundOn] = useState<boolean>(() => isSoundEnabled());
  const [musicOn, setMusicOn] = useState<boolean>(() => isMusicEnabled());

  useEffect(() => {
    return subscribeAudioState(({ soundEnabled, musicEnabled }) => {
      setSoundOn(soundEnabled);
      setMusicOn(musicEnabled);
    });
  }, []);

  const effectiveActiveRoute: AppRoute =
    currentRoute === 'results' ||
    currentRoute === 'detail' ||
    currentRoute === 'timeline'
      ? 'search'
      : currentRoute;

  const resolvedAvatar = !avatarErr ? avatarUrl || analystAvatar : '';

  const renderSidebarBody = () => (
    <div className="flex flex-col h-full bg-white/75 dark:bg-[#0B1120]/90 backdrop-blur-md border-r border-white/40 dark:border-slate-800/80 ring-1 ring-slate-900/[0.04]">
      {/* Subtle Tricolour Hairline */}
      <div
        aria-hidden="true"
        className="h-0.5 w-full bg-gradient-to-r from-[#FF9933] via-slate-100 dark:via-slate-800 to-[#138808]"
      />

      {/* Brand Header */}
      <div className="px-5 py-5 flex items-center justify-between border-b border-[#F1F5F9] dark:border-slate-800">
        <button
          type="button"
          onClick={() => {
            onNavigate('home');
            setMobileOpen(false);
          }}
          className="inline-flex items-center gap-3 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 rounded-lg"
        >
          <ParmanuLogo size="md" />
          <div>
            <span className="font-display text-lg font-bold tracking-tight text-[#0F172A] dark:text-slate-100 block leading-none">
              Parmanu<span className="text-orange-600 dark:text-orange-400">.</span>
            </span>
            <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 tracking-wide block mt-1">
              by Midnight Industries
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
          className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Command, Audio & Dark-Room Analyst Bar */}
      <div className="px-3 pt-3 flex items-center gap-1.5">
        {onOpenCommandPalette && (
          <button
            type="button"
            onClick={() => {
              onOpenCommandPalette();
              setMobileOpen(false);
            }}
            className="flex-1 h-8 px-2.5 rounded-xl bg-slate-100/80 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-slate-100 flex items-center justify-between transition-colors cursor-pointer min-w-0"
          >
            <span className="inline-flex items-center gap-1.5 truncate">
              <Command className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Jump</span>
            </span>
            <kbd className="text-[10px] font-mono px-1 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shrink-0">
              ⌘K
            </kbd>
          </button>
        )}

        <button
          type="button"
          onClick={() => toggleMusicEnabled()}
          title={musicOn ? 'Mute ambient OSINT music' : 'Play ambient OSINT music'}
          aria-label={musicOn ? 'Mute ambient music' : 'Play ambient music'}
          className={`h-8 w-8 rounded-xl border flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
            musicOn
              ? 'bg-indigo-50 dark:bg-indigo-950/70 border-indigo-200 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300'
              : 'bg-slate-100/80 dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-slate-100'
          }`}
        >
          <Music className={`w-3.5 h-3.5 ${musicOn ? 'animate-pulse' : ''}`} />
        </button>

        <button
          type="button"
          onClick={() => toggleSoundEnabled()}
          title={soundOn ? 'Mute sound effects' : 'Enable sound effects'}
          aria-label={soundOn ? 'Mute sound effects' : 'Enable sound effects'}
          className={`h-8 w-8 rounded-xl border flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
            soundOn
              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400'
              : 'bg-slate-100/80 dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 text-slate-400 hover:text-[#0F172A] dark:hover:text-slate-100'
          }`}
        >
          {soundOn ? (
            <Volume2 className="w-3.5 h-3.5" />
          ) : (
            <VolumeX className="w-3.5 h-3.5" />
          )}
        </button>

        {onToggleTheme && (
          <button
            type="button"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Obsidian Dark Analyst Mode'}
            aria-label="Toggle Obsidian Dark Mode"
            className="h-8 w-8 rounded-xl bg-slate-100/80 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-slate-600 dark:text-amber-300 hover:text-[#0F172A] dark:hover:text-amber-200 flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            {theme === 'dark' ? (
              <Sun className="w-3.5 h-3.5" />
            ) : (
              <Moon className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Grouped Navigation Items */}
      <nav
        aria-label="Primary sidebar navigation"
        className="flex-1 px-3 py-4 space-y-5 overflow-y-auto"
      >
        <div>
          <button
            type="button"
            onClick={() => {
              onNavigate('home');
              setMobileOpen(false);
            }}
            className="w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-[#F8FAFC] dark:hover:bg-slate-800/70 hover:text-[#0F172A] dark:hover:text-slate-100 transition-colors cursor-pointer"
          >
            <Home className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
            <span>Overview</span>
          </button>
        </div>

        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="space-y-1">
            <p className="px-3.5 pb-1 text-[10px] font-semibold tracking-wider uppercase text-slate-400 dark:text-slate-500">
              {group.title}
            </p>
            {group.items.map(({ route, label, Icon }) => {
              const active = effectiveActiveRoute === route;
              return (
                <button
                  key={route}
                  type="button"
                  onClick={() => {
                    onNavigate(route);
                    setMobileOpen(false);
                  }}
                  className={`relative w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-sm font-medium transition-colors duration-150 whitespace-nowrap cursor-pointer ${
                    active
                      ? 'text-[#0F172A] dark:text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-[#F8FAFC] dark:hover:bg-slate-800/70 hover:text-[#0F172A] dark:hover:text-slate-100'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="sidebar-active-pill"
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                      className="absolute inset-0 rounded-xl bg-[#F4F5F7] dark:bg-slate-800 border border-[#E5E7EB]/80 dark:border-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.03)] -z-0"
                    />
                  )}
                  <Icon
                    className={`relative z-10 w-4 h-4 shrink-0 ${
                      active ? 'text-[#0F172A] dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'
                    }`}
                  />
                  <span className="relative z-10 truncate">{label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Daily Search Quota Card */}
      {creditStatus && (
        <div className="px-3 pb-2">
          {creditStatus.unlimited ? (
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-50/90 via-indigo-50/70 to-amber-50/60 dark:from-emerald-950/50 dark:via-indigo-950/40 dark:to-amber-950/30 border border-emerald-200/80 dark:border-emerald-800/70">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                  <Crown className="w-3.5 h-3.5 text-amber-500" />
                  <span>Unlimited VIP Access</span>
                </span>
                <InfinityIcon className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
              </div>
              <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-1 truncate">
                Whitelisted analyst · {creditStatus.used} today
              </p>
            </div>
          ) : (
            <div className="p-2.5 rounded-xl bg-[#FAFAFA] dark:bg-slate-900 border border-[#E5E7EB]/90 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-[#0F172A] dark:text-slate-100">
                  {creditStatus.tier === 'guest' ? 'Guest Daily Limit' : 'Daily Credits'}
                </span>
                <span
                  className={`font-mono font-bold tabular-nums ${
                    (creditStatus.remaining ?? 0) === 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-indigo-600 dark:text-indigo-400'
                  }`}
                >
                  {creditStatus.remaining ?? 0}/{creditStatus.limit ?? 1}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    (creditStatus.remaining ?? 0) === 0
                      ? 'bg-rose-500'
                      : 'bg-indigo-600 dark:bg-indigo-500'
                  }`}
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(
                        0,
                        ((creditStatus.remaining ?? 0) /
                          Math.max(1, creditStatus.limit ?? 1)) *
                          100
                      )
                    )}%`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                {(creditStatus.remaining ?? 0) === 0 ? (
                  <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-medium">
                    <ShieldAlert className="w-3 h-3" />
                    <span>Resets 00:00 UTC</span>
                  </span>
                ) : (
                  <span>Resets daily 00:00 UTC</span>
                )}
                {creditStatus.tier === 'guest' && (
                  <span className="text-indigo-600 dark:text-indigo-400 font-medium">
                    2/day w/ Google
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bottom Section: Authenticated Profile OR Guest Sign-In Prompt */}
      <div className="p-4 border-t border-[#F1F5F9] dark:border-slate-800">
        {isSignedIn ? (
          <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#FAFAFA] dark:bg-slate-900 border border-[#E5E7EB]/80 dark:border-slate-800">
            {resolvedAvatar ? (
              <img
                src={resolvedAvatar}
                alt={username}
                referrerPolicy="no-referrer"
                onError={() => setAvatarErr(true)}
                className="w-9 h-9 rounded-full object-cover border border-[#E5E7EB] dark:border-slate-700 shrink-0"
              />
            ) : (
              <span className="w-9 h-9 rounded-full bg-[#0F172A] dark:bg-indigo-600 text-white text-xs font-semibold flex items-center justify-center shrink-0">
                {username.slice(0, 2).toUpperCase()}
              </span>
            )}

            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100 truncate">
                {username}
              </p>
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">
                Google Verified Analyst
              </p>
            </div>

            <button
              type="button"
              onClick={onSignOut}
              title="Sign out"
              aria-label="Sign out"
              className="p-1.5 rounded-lg text-slate-400 hover:text-[#0F172A] dark:hover:text-slate-100 hover:bg-white dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="p-3.5 rounded-2xl bg-[#FAFAFA] dark:bg-slate-900 border border-[#E5E7EB] dark:border-slate-800 space-y-2.5">
            <div>
              <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100">
                Save your investigations
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">
                Sign in with Google to save cases, alerts, and team shares.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void onSignIn()}
              disabled={signingIn}
              className="w-full h-9 px-3 rounded-xl bg-[#0F172A] dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-500 text-white text-xs font-medium inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>{signingIn ? 'Connecting...' : 'Continue with Google'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Header Bar */}
      <div className="lg:hidden sticky top-0 z-30 h-14 px-4 bg-white/95 dark:bg-[#0B1120]/95 backdrop-blur-md border-b border-[#E5E7EB] dark:border-slate-800 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onNavigate('home')}
          className="inline-flex items-center gap-2.5 font-display text-base font-bold text-[#0F172A] dark:text-slate-100"
        >
          <ParmanuLogo size="xs" />
          <span>Parmanu</span>
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => toggleMusicEnabled()}
            aria-label={musicOn ? 'Mute ambient music' : 'Play ambient music'}
            className={`p-2 rounded-lg transition-colors cursor-pointer ${
              musicOn
                ? 'text-indigo-600 dark:text-indigo-300 bg-indigo-50/80 dark:bg-indigo-950/60'
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Music className={`w-4 h-4 ${musicOn ? 'animate-pulse' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => toggleSoundEnabled()}
            aria-label={soundOn ? 'Mute sound effects' : 'Enable sound effects'}
            className={`p-2 rounded-lg transition-colors cursor-pointer ${
              soundOn
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          {onOpenCommandPalette && (
            <button
              type="button"
              onClick={onOpenCommandPalette}
              aria-label="Open command palette"
              className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Command className="w-4 h-4" />
            </button>
          )}
          {onToggleTheme && (
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label="Toggle theme"
              className="p-2 rounded-lg text-slate-600 dark:text-amber-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Desktop Fixed Left Sidebar */}
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-64 z-30">
        {renderSidebarBody()}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-slate-900/25 dark:bg-black/60 backdrop-blur-xs"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMobileOpen(false);
          }}
        >
          <div className="w-68 h-full">{renderSidebarBody()}</div>
        </div>
      )}
    </>
  );
}
