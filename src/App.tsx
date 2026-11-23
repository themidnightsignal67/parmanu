import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { Loader2, LogIn } from 'lucide-react';
import { AuthProvider, useAuth } from '@/src/contexts/AuthContext';
import { getDefaultToolsForTarget } from '@/src/data/tools';
import {
  ApiClientError,
  cancelInvestigation,
  dispatchWebhookAlert,
  fetchInvestigationById,
  fetchToolsHealth,
  startInvestigation,
  type CreditStatusResponse,
  type GeminiPoolStatus,
} from '@/src/lib/api';
import {
  addTeamMemberToFirestore,
  createMonitorInFirestore,
  deleteMonitorInFirestore,
  deleteTeamMemberInFirestore,
  fetchInvestigationFromFirestore,
  recordMonitorCheckInFirestore,
  saveInvestigationToFirestore,
  saveSnapshotToFirestore,
  subscribeInvestigations,
  subscribeMonitors,
  subscribeSnapshots,
  subscribeTeamMembers,
  toggleMonitorInFirestore,
  updateTeamMemberRoleInFirestore,
} from '@/src/lib/firestoreStore';
import type {
  AppRoute,
  BatchQueueItem,
  CaseSnapshot,
  GeoMarker,
  GoogleDorkResponse,
  InvestigationRecord,
  InvestigationResultItem,
  MonitoringRule,
  TargetType,
  TeamMemberRecord,
  ToolAvailabilityStatus,
  ToolId,
} from '@/src/types/investigation';
import {
  loadAutoWebhookSettings,
  loadStoredTheme,
  savePivotLineage,
  saveStoredTheme,
} from '@/src/lib/annotationsStore';
import {
  attachAudioAutoResume,
  playAlertTone,
  playClickTick,
  playErrorTone,
  playHitChime,
  playSonarPing,
} from '@/src/lib/sound';
import { GoogleSignInGate } from '@/src/components/auth/GoogleSignInGate';
import { Sidebar } from '@/src/components/layout/Sidebar';
import { CrossCaseLinkerDialog } from '@/src/components/results/CrossCaseLinkerDialog';
import { FacialRecognitionDialog } from '@/src/components/results/FacialRecognitionDialog';
import { ForensicsDialog } from '@/src/components/results/ForensicsDialog';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { CommandPalette } from '@/src/components/ui/CommandPalette';
import { IndianFlag } from '@/src/components/ui/IndianFlag';
import { ToastContainer, type ToastItem } from '@/src/components/ui/Toast';
import { UniverseTransition } from '@/src/components/ui/UniverseTransition';
import { BatchPage } from '@/src/pages/BatchPage';
import { HistoryPage } from '@/src/pages/HistoryPage';
import { HomePage } from '@/src/pages/HomePage';
import { InvestigationsPage } from '@/src/pages/InvestigationsPage';
import { ModulesPage } from '@/src/pages/ModulesPage';
import { MonitoringPage } from '@/src/pages/MonitoringPage';
import { ResultDetailPage } from '@/src/pages/ResultDetailPage';
import { ResultsPage } from '@/src/pages/ResultsPage';
import { SearchPage } from '@/src/pages/SearchPage';
import { TeamPage } from '@/src/pages/TeamPage';
import { TimelinePage } from '@/src/pages/TimelinePage';

const DEFAULT_AVAILABILITY: Record<ToolId, ToolAvailabilityStatus> = {
  mailaccess: 'ready',
  holehe: 'ready',
  maigret: 'ready',
  ghunt: 'ready',
  blackbird: 'ready',
  sherlock: 'ready',
  phoneinfoga: 'ready',
  ignorant: 'ready',
};

function SignInRequiredCard({
  title,
  description,
  signingIn,
  onSignIn,
}: {
  title: string;
  description: string;
  signingIn: boolean;
  onSignIn: () => Promise<void>;
}) {
  return (
    <div className="max-w-xl mx-auto px-4 py-16">
      <Card className="p-8 text-center space-y-4">
        <div className="w-11 h-11 rounded-2xl bg-[#FAFAFA] border border-[#E5E7EB] flex items-center justify-center mx-auto text-[#0F172A]">
          <LogIn className="w-5 h-5 text-orange-600" />
        </div>
        <div className="space-y-1.5">
          <h2 className="font-display text-lg font-bold text-[#0F172A] dark:text-slate-100">
            {title}
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            {description}
          </p>
        </div>
        <div className="pt-1">
          <Button
            size="lg"
            disabled={signingIn}
            onClick={() => void onSignIn()}
          >
            <LogIn className="w-4 h-4" />
            <span>
              {signingIn ? 'Connecting with Google...' : 'Continue with Google'}
            </span>
          </Button>
        </div>
      </Card>
    </div>
  );
}

function BrahmandWorkspace() {
  const {
    user,
    profile,
    authReady,
    signingIn,
    creditStatus,
    refreshCredits,
    signInWithGoogle,
    signOut,
  } = useAuth();

  const [route, setRoute] = useState<AppRoute>('home');
  const [showUniverseTransition, setShowUniverseTransition] = useState(false);

  const [investigations, setInvestigations] = useState<InvestigationRecord[]>(
    []
  );
  const [activeInvestigation, setActiveInvestigation] =
    useState<InvestigationRecord | null>(null);
  const [selectedResult, setSelectedResult] =
    useState<InvestigationResultItem | null>(null);

  const [snapshots, setSnapshots] = useState<CaseSnapshot[]>([]);
  const [monitoringRules, setMonitoringRules] = useState<MonitoringRule[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMemberRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [batchItems, setBatchItems] = useState<BatchQueueItem[]>([]);
  const [batchFiles, setBatchFiles] = useState<
    Array<{
      id: string;
      fileName: string;
      fileSize: number;
      detectedFormat: string;
      totalExtracted: number;
      notes: string[];
    }>
  >([]);

  const [toolAvailability, setToolAvailability] =
    useState<Record<ToolId, ToolAvailabilityStatus>>(DEFAULT_AVAILABILITY);
  const [geminiStatus, setGeminiStatus] = useState<GeminiPoolStatus | null>(
    null
  );
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dorkReportsByScanId, setDorkReportsByScanId] = useState<
    Record<string, GoogleDorkResponse>
  >({});

  const [theme, setTheme] = useState<'light' | 'dark'>(() => loadStoredTheme());
  const [redactPii, setRedactPii] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [forensicsOpen, setForensicsOpen] = useState(false);
  const [facialOpen, setFacialOpen] = useState(false);
  const [compareCasesOpen, setCompareCasesOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    saveStoredTheme(theme);
  }, [theme]);

  useEffect(() => {
    return attachAudioAutoResume();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        playClickTick();
        setCmdOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const toggleTheme = useCallback(() => {
    playClickTick();
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const handleCacheDorkReport = useCallback(
    (scanId: string, report: GoogleDorkResponse) => {
      setDorkReportsByScanId((prev) => ({ ...prev, [scanId]: report }));
    },
    []
  );

  // Track active streaming scans so AI summary + final persistence fire cleanly once
  const liveStartedAtRef = useRef<Record<string, number>>({});
  const settledScansRef = useRef<Set<string>>(new Set());
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const notify = useCallback((toast: Omit<ToastItem, 'id'>) => {
    if (toast.type === 'error') playErrorTone();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3800);
  }, []);

  const finalizeSettledScan = useCallback(
    async (record: InvestigationRecord) => {
      if (settledScansRef.current.has(record.scanId)) return;
      settledScansRef.current.add(record.scanId);

      if (record.status !== 'cancelled') {
        if (record.summary.breached > 0 || record.summary.leaked > 0) {
          playAlertTone();
        } else if (record.summary.found > 0) {
          playHitChime();
        }
      }

      const currentUser = userRef.current;
      const ownedRecord: InvestigationRecord = currentUser
        ? {
            ...record,
            ownerId: currentUser.uid,
            ownerEmail: currentUser.email || '',
            collaboratorEmails: record.collaboratorEmails || [],
          }
        : record;

      setInvestigations((prev) => [
        ownedRecord,
        ...prev.filter((i) => i.scanId !== ownedRecord.scanId),
      ]);
      setActiveInvestigation((prev) =>
        prev && prev.scanId === ownedRecord.scanId ? ownedRecord : prev
      );

      if (currentUser && ownedRecord.status !== 'cancelled') {
        try {
          await saveInvestigationToFirestore(ownedRecord, currentUser, { isNew: true });
        } catch (err) {
          notify({
            type: 'error',
            title: 'Cloud sync warning',
            message: err instanceof Error ? err.message : undefined,
          });
        }
      }
    },
    [notify]
  );

  // Live progressive streaming poller: runs whenever activeInvestigation is running
  // or waiting up to 9s for Gemini AI summary on a newly launched scan
  const activeScanId = activeInvestigation?.scanId || null;
  const activeStatus = activeInvestigation?.status || null;
  const activeHasAi = Boolean(activeInvestigation?.aiSummary);

  useEffect(() => {
    if (!activeScanId) return;

    const launchedTs = liveStartedAtRef.current[activeScanId];
    const isRunning = activeStatus === 'running';
    const waitingForAi =
      Boolean(launchedTs) &&
      !activeHasAi &&
      activeStatus !== 'cancelled' &&
      Date.now() - launchedTs < 25000;

    if (!isRunning && !waitingForAi) {
      if (
        launchedTs &&
        !settledScansRef.current.has(activeScanId) &&
        activeInvestigation
      ) {
        void finalizeSettledScan(activeInvestigation);
      }
      return;
    }

    let cancelled = false;
    const pollDelay = isRunning ? 220 : 450;
    const timer = window.setTimeout(async () => {
      try {
        const latest = await fetchInvestigationById(activeScanId);
        if (cancelled) return;

        setActiveInvestigation((prev) => {
          if (!prev || prev.scanId !== activeScanId) return prev;
          return {
            ...latest,
            ownerId: prev.ownerId,
            ownerEmail: prev.ownerEmail,
            collaboratorEmails: prev.collaboratorEmails || latest.collaboratorEmails,
          };
        });

        const isTerminal =
          latest.status === 'completed' ||
          latest.status === 'partial' ||
          latest.status === 'failed' ||
          latest.status === 'cancelled';

        const aiReadyOrTimedOut =
          Boolean(latest.aiSummary) ||
          !launchedTs ||
          Date.now() - launchedTs >= 25000;

        if (isTerminal && (latest.status === 'cancelled' || aiReadyOrTimedOut)) {
          await finalizeSettledScan(latest);
        }
      } catch {
        // Keep current partial view; retry on next cycle if still running
      }
    }, pollDelay);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    activeScanId,
    activeStatus,
    activeHasAi,
    activeInvestigation,
    finalizeSettledScan,
  ]);

  const loadHealth = useCallback(async () => {
    const health = await fetchToolsHealth().catch(() => null);
    if (health) {
      setToolAvailability((prev) => ({ ...prev, ...health.availability }));
      if (health.gemini) setGeminiStatus(health.gemini);
    }
  }, []);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  // Attach Firestore real-time subscriptions when Google auth is active
  useEffect(() => {
    if (!authReady || !user) {
      setInvestigations([]);
      setSnapshots([]);
      setMonitoringRules([]);
      setTeamMembers([]);
      setHistoryLoading(false);
      return;
    }

    setHistoryLoading(true);
    const unsubInv = subscribeInvestigations(
      user.uid,
      user.email || '',
      (list) => {
        setInvestigations(list);
        setHistoryLoading(false);
      },
      () => {
        setHistoryLoading(false);
      }
    );
    const unsubMon = subscribeMonitors(user.uid, setMonitoringRules);
    const unsubSnap = subscribeSnapshots(user.uid, setSnapshots);
    const unsubTeam = subscribeTeamMembers(user.uid, setTeamMembers);

    return () => {
      unsubInv();
      unsubMon();
      unsubSnap();
      unsubTeam();
    };
  }, [authReady, user]);

  // Support opening shared deep-links like /?scan=scan_xyz
  const scanParam =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('scan')
      : null;

  useEffect(() => {
    if (!authReady || !user || !scanParam) return;

    void (async () => {
      try {
        const fsRecord = await fetchInvestigationFromFirestore(scanParam);
        if (fsRecord) {
          setActiveInvestigation(fsRecord);
          setRoute('results');
          return;
        }
        const apiRecord = await fetchInvestigationById(scanParam);
        setActiveInvestigation(apiRecord);
        setRoute('results');
      } catch {
        notify({
          type: 'error',
          title: 'Shared case unavailable',
          message: 'Ask the case owner to add your Google email as a collaborator.',
        });
      }
    })();
  }, [authReady, user, scanParam, notify]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin text-orange-600" />
          <span>Initializing Parmanu workspace...</span>
        </div>
      </div>
    );
  }

  // If visitor opened a shared ?scan= deep-link while signed out, require Google sign-in
  if (scanParam && !user) {
    return <GoogleSignInGate />;
  }

  const username = user ? profile?.email || user.email || 'Analyst' : 'Guest';
  const displayName = user
    ? profile?.displayName || user.displayName || username.split('@')[0]
    : 'Guest';

  const navigate = (nextRoute: AppRoute) => {
    playClickTick();
    setRoute(nextRoute);
    if (nextRoute !== 'detail') setSelectedResult(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleEnterCosmosSearch = () => {
    playSonarPing();
    setShowUniverseTransition(true);
  };

  const handleBatchScanFinished = async (record: InvestigationRecord) => {
    const ownedRecord: InvestigationRecord = user
      ? {
          ...record,
          ownerId: user.uid,
          ownerEmail: user.email || '',
          collaboratorEmails: record.collaboratorEmails || [],
        }
      : record;

    setInvestigations((prev) => [
      ownedRecord,
      ...prev.filter((i) => i.scanId !== ownedRecord.scanId),
    ]);

    if (user) {
      try {
        await saveInvestigationToFirestore(ownedRecord, user, { isNew: true });
      } catch (err) {
        notify({
          type: 'error',
          title: 'Cloud sync warning',
          message: err instanceof Error ? err.message : undefined,
        });
      }
    }
  };

  const handleScanStarted = (
    initialRecord: InvestigationRecord & { creditStatus?: CreditStatusResponse }
  ) => {
    if (initialRecord.creditStatus) {
      void refreshCredits(initialRecord.creditStatus);
    } else {
      void refreshCredits();
    }
    liveStartedAtRef.current[initialRecord.scanId] = Date.now();
    const ownedInitial: InvestigationRecord = user
      ? {
          ...initialRecord,
          ownerId: user.uid,
          ownerEmail: user.email || '',
          collaboratorEmails: initialRecord.collaboratorEmails || [],
        }
      : initialRecord;

    setActiveInvestigation(ownedInitial);
    setSelectedResult(null);
    playSonarPing();
    setRoute('results');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelRunningScan = async (scanId: string) => {
    settledScansRef.current.add(scanId);
    await cancelInvestigation(scanId).catch(() => {});
    setActiveInvestigation((prev) =>
      prev && prev.scanId === scanId
        ? { ...prev, status: 'cancelled' }
        : prev
    );
    notify({ type: 'info', title: 'Live scan stopped' });
  };

  const handleOpenInvestigation = async (scanId: string) => {
    const existing = investigations.find((i) => i.scanId === scanId) || null;
    if (existing) {
      setActiveInvestigation(existing);
      setSelectedResult(null);
      setRoute('results');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    try {
      const fresh =
        (user ? await fetchInvestigationFromFirestore(scanId) : null) ||
        (await fetchInvestigationById(scanId));
      setActiveInvestigation(fresh);
      setSelectedResult(null);
      setRoute('results');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      notify({ type: 'error', title: 'Could not load investigation' });
    }
  };

  const handleUpdateInvestigation = async (updated: InvestigationRecord) => {
    setActiveInvestigation(updated);
    setInvestigations((prev) =>
      prev.map((i) => (i.scanId === updated.scanId ? updated : i))
    );
    if (user && (!updated.ownerId || updated.ownerId === user.uid)) {
      await saveInvestigationToFirestore(updated, user).catch(() => {});
    }
  };

  const handlePivotScan = async (
    pivotTarget: string,
    pivotType: TargetType,
    parentInvestigation?: InvestigationRecord
  ) => {
    const clean = pivotTarget.trim();
    if (!clean) return;
    try {
      const tools = getDefaultToolsForTarget(pivotType);
      const initial = await startInvestigation({
        target: clean,
        targetType: pivotType,
        tools,
        authorizedConfirmed: true,
      });
      if (parentInvestigation) {
        savePivotLineage(initial.scanId, {
          parentScanId: parentInvestigation.scanId,
          parentTarget: parentInvestigation.target,
          parentTargetType: parentInvestigation.targetType,
          pivotedAt: new Date().toISOString(),
        });
      }
      handleScanStarted(initial);
      notify({
        type: 'info',
        title: `Pivot scan started: ${clean}`,
        message: `${pivotType.toUpperCase()} pipeline dispatched`,
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.creditStatus) {
        void refreshCredits(err.creditStatus);
      } else {
        void refreshCredits();
      }
      notify({
        type: 'error',
        title:
          err instanceof ApiClientError && (err.status === 429 || err.status === 403)
            ? 'Daily Search Credit Limit Reached'
            : 'Pivot scan failed',
        message: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleRunMonitorCheck = async (rule: MonitoringRule) => {
    if (!user) return;
    try {
      const baseline =
        (rule.lastScanId &&
          investigations.find((i) => i.scanId === rule.lastScanId)) ||
        investigations.find(
          (i) =>
            i.target.toLowerCase() === rule.target.toLowerCase() &&
            i.targetType === rule.targetType
        ) ||
        null;

      const tools = getDefaultToolsForTarget(rule.targetType);
      const initial = await startInvestigation({
        target: rule.target,
        targetType: rule.targetType,
        tools,
        authorizedConfirmed: true,
      });
      void refreshCredits(initial.creditStatus);

      const waitDone = async (): Promise<InvestigationRecord> => {
        let latest = initial as InvestigationRecord;
        for (let i = 0; i < 80; i++) {
          await new Promise((r) => setTimeout(r, 750));
          try {
            latest = await fetchInvestigationById(initial.scanId);
            if (
              latest.status === 'completed' ||
              latest.status === 'partial' ||
              latest.status === 'failed' ||
              latest.status === 'cancelled'
            ) {
              return latest;
            }
          } catch {
            // transient poll error; continue waiting
          }
        }
        return fetchInvestigationById(initial.scanId).catch(() => latest);
      };

      const completed = await waitDone();
      const owned: InvestigationRecord = {
        ...completed,
        ownerId: user.uid,
        ownerEmail: user.email || '',
        collaboratorEmails: [],
      };
      await saveInvestigationToFirestore(owned, user, { isNew: true });
      const exposureCount = owned.summary.breached + owned.summary.leaked;
      await recordMonitorCheckInFirestore(rule.id, owned.scanId, exposureCount);

      let newBreachesCount = owned.breachedAccounts.length;
      let newPlatformsCount = owned.summary.found;
      if (baseline) {
        const prevBreaches = new Set(
          baseline.breachedAccounts.map((b) =>
            (b.breachName || b.platform).toLowerCase()
          )
        );
        const prevPlatforms = new Set(
          baseline.results
            .filter((r) => r.status === 'found')
            .map((r) => r.platform)
        );
        newBreachesCount = owned.breachedAccounts.filter(
          (b) => !prevBreaches.has((b.breachName || b.platform).toLowerCase())
        ).length;
        newPlatformsCount = owned.results.filter(
          (r) => r.status === 'found' && !prevPlatforms.has(r.platform)
        ).length;
      }

      const autoWh = loadAutoWebhookSettings();
      const hasNewDiff = newBreachesCount > 0 || newPlatformsCount > 0;
      if (
        autoWh.enabled &&
        autoWh.url.trim().startsWith('https://') &&
        (!autoWh.onlyOnNewExposures || hasNewDiff || !baseline)
      ) {
        const whRes = await dispatchWebhookAlert({
          url: autoWh.url.trim(),
          provider: autoWh.provider,
          payload: {
            title: `Parmanu Watchlist Alert: ${rule.target}`,
            target: rule.target,
            targetType: rule.targetType,
            summary: baseline
              ? `+${newBreachesCount} new breaches, +${newPlatformsCount} new signals (${exposureCount} total exposures)`
              : `Initial watchlist baseline: ${owned.summary.found} signals, ${exposureCount} exposures`,
            scanId: owned.scanId,
            breachedCount: owned.summary.breached,
            foundCount: owned.summary.found,
          },
        }).catch(() => null);
        if (whRes?.ok) {
          notify({
            type: 'info',
            title: 'Auto-Alert Webhook Dispatched',
            message: `${rule.target} diff pushed to ${autoWh.provider.toUpperCase()}`,
          });
        }
      }

      notify({
        type: 'success',
        title: 'Monitor Check Completed',
        message: `${rule.target} · ${owned.summary.total} signal(s), ${exposureCount} exposure(s)`,
      });
    } catch (err) {
      if (err instanceof ApiClientError && err.creditStatus) {
        void refreshCredits(err.creditStatus);
      } else {
        void refreshCredits();
      }
      notify({
        type: 'error',
        title:
          err instanceof ApiClientError && (err.status === 429 || err.status === 403)
            ? 'Daily Search Credit Limit Reached'
            : 'Monitor check failed',
        message: err instanceof Error ? err.message : undefined,
      });
    }
  };

  // Public Editorial Homepage renders full-width without workspace sidebar
  if (route === 'home') {
    return (
      <>
        <HomePage
          isSignedIn={Boolean(user)}
          userEmail={user?.email || undefined}
          signingIn={signingIn}
          onStartSearching={handleEnterCosmosSearch}
          onSignIn={signInWithGoogle}
          onOpenModules={() => navigate('modules')}
        />
        <AnimatePresence>
          {showUniverseTransition && (
            <UniverseTransition
              open={showUniverseTransition}
              onComplete={() => {
                setShowUniverseTransition(false);
                navigate('search');
              }}
            />
          )}
        </AnimatePresence>
        <ToastContainer
          toasts={toasts}
          onDismiss={(id) =>
            setToasts((prev) => prev.filter((t) => t.id !== id))
          }
        />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F6FA] dark:bg-[#070B14] text-[#0F172A] dark:text-slate-100 flex flex-col lg:flex-row relative transition-colors duration-200">
      {/* Soft Fixed Ambient Gradient Mesh for Glassmorphism Refraction */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 lg:left-64 -z-0 overflow-hidden"
      >
        <div className="absolute -top-32 right-12 w-[34rem] h-[34rem] rounded-full bg-gradient-to-br from-orange-100/50 via-indigo-100/40 to-transparent dark:from-indigo-950/35 dark:via-orange-950/15 blur-3xl" />
        <div className="absolute bottom-0 left-12 w-[30rem] h-[30rem] rounded-full bg-gradient-to-tr from-emerald-100/35 via-purple-100/35 to-transparent dark:from-emerald-950/20 dark:via-slate-900/30 blur-3xl" />
      </div>

      <Sidebar
        currentRoute={route}
        onNavigate={navigate}
        isSignedIn={Boolean(user)}
        signingIn={signingIn}
        username={username}
        avatarUrl={profile?.photoURL || user?.photoURL || undefined}
        onSignIn={signInWithGoogle}
        onSignOut={signOut}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenCommandPalette={() => setCmdOpen(true)}
        creditStatus={creditStatus}
      />

      <main className="relative z-10 flex-1 lg:pl-64 min-w-0 flex flex-col">
        <div className="flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={route + (selectedResult?.id || '')}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
            >
              {route === 'search' && (
                <SearchPage
                  isSignedIn={Boolean(user)}
                  signingIn={signingIn}
                  creditStatus={creditStatus}
                  onCreditsUpdated={(s) => void refreshCredits(s)}
                  recentInvestigations={investigations}
                  onOpenInvestigation={handleOpenInvestigation}
                  onOpenBatchMode={() => navigate('batch')}
                  onSignIn={signInWithGoogle}
                  onScanStarted={handleScanStarted}
                />
              )}

              {route === 'batch' && (
                <BatchPage
                  items={batchItems}
                  setItems={setBatchItems}
                  uploadedFiles={batchFiles}
                  setUploadedFiles={setBatchFiles}
                  isSignedIn={Boolean(user)}
                  signingIn={signingIn}
                  creditStatus={creditStatus}
                  onCreditsUpdated={(s) => void refreshCredits(s)}
                  onSignIn={signInWithGoogle}
                  onScanFinished={handleBatchScanFinished}
                  onOpenInvestigation={(record) => {
                    setActiveInvestigation(record);
                    setSelectedResult(null);
                    setRoute('results');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  onNotify={notify}
                />
              )}

              {route === 'modules' && (
                <ModulesPage
                  toolAvailability={toolAvailability}
                  geminiStatus={geminiStatus}
                  onRefresh={() => {
                    void loadHealth();
                    notify({ type: 'info', title: 'Module status refreshed' });
                  }}
                  onRunSearch={() => navigate('search')}
                />
              )}

              {route === 'results' &&
                (activeInvestigation ? (
                  <ResultsPage
                    investigation={activeInvestigation}
                    investigations={investigations}
                    cachedDorkReport={
                      dorkReportsByScanId[activeInvestigation.scanId] || null
                    }
                    redactPii={redactPii}
                    onToggleRedactPii={() => setRedactPii((p) => !p)}
                    onCacheDorkReport={handleCacheDorkReport}
                    onOpenTimeline={() => navigate('timeline')}
                    onOpenInvestigation={handleOpenInvestigation}
                    onPivotScan={handlePivotScan}
                    onSelectResult={(item) => {
                      setSelectedResult(item);
                      setRoute('detail');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    onUpdateInvestigation={handleUpdateInvestigation}
                    onSaveSnapshot={async (snap) => {
                      try {
                        if (user) {
                          await saveSnapshotToFirestore(snap, user.uid);
                        } else {
                          setSnapshots((prev) => [snap, ...prev]);
                        }
                      } catch (err) {
                        notify({
                          type: 'error',
                          title: 'Could not archive snapshot',
                          message: err instanceof Error ? err.message : undefined,
                        });
                      }
                    }}
                    onCancelRunningScan={handleCancelRunningScan}
                    onNewSearch={() => navigate('search')}
                    onNotify={notify}
                  />
                ) : (
                  <SearchPage
                    isSignedIn={Boolean(user)}
                    signingIn={signingIn}
                    creditStatus={creditStatus}
                    onCreditsUpdated={(s) => void refreshCredits(s)}
                    recentInvestigations={investigations}
                    onOpenInvestigation={handleOpenInvestigation}
                    onOpenBatchMode={() => navigate('batch')}
                    onSignIn={signInWithGoogle}
                    onScanStarted={handleScanStarted}
                  />
                ))}

              {route === 'timeline' &&
                (activeInvestigation ? (
                  <TimelinePage
                    investigation={activeInvestigation}
                    dorkReport={
                      dorkReportsByScanId[activeInvestigation.scanId] || null
                    }
                    redactPii={redactPii}
                    onToggleRedactPii={() => setRedactPii((p) => !p)}
                    onBackToResults={() => {
                      setRoute('results');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    onSelectResult={(item) => {
                      setSelectedResult(item);
                      setRoute('detail');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    onOpenForensics={() => setForensicsOpen(true)}
                  />
                ) : (
                  <SearchPage
                    isSignedIn={Boolean(user)}
                    signingIn={signingIn}
                    creditStatus={creditStatus}
                    onCreditsUpdated={(s) => void refreshCredits(s)}
                    recentInvestigations={investigations}
                    onOpenInvestigation={handleOpenInvestigation}
                    onOpenBatchMode={() => navigate('batch')}
                    onSignIn={signInWithGoogle}
                    onScanStarted={handleScanStarted}
                  />
                ))}

              {route === 'detail' &&
                (activeInvestigation && selectedResult ? (
                  <ResultDetailPage
                    investigation={activeInvestigation}
                    item={selectedResult}
                    redactPii={redactPii}
                    onPivotScan={(target, targetType) =>
                      void handlePivotScan(target, targetType, activeInvestigation)
                    }
                    onBack={() => {
                      setSelectedResult(null);
                      setRoute('results');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  />
                ) : activeInvestigation ? (
                  <ResultsPage
                    investigation={activeInvestigation}
                    investigations={investigations}
                    cachedDorkReport={
                      dorkReportsByScanId[activeInvestigation.scanId] || null
                    }
                    redactPii={redactPii}
                    onToggleRedactPii={() => setRedactPii((p) => !p)}
                    onCacheDorkReport={handleCacheDorkReport}
                    onOpenTimeline={() => navigate('timeline')}
                    onOpenInvestigation={handleOpenInvestigation}
                    onPivotScan={handlePivotScan}
                    onSelectResult={(item) => {
                      setSelectedResult(item);
                      setRoute('detail');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    onUpdateInvestigation={handleUpdateInvestigation}
                    onSaveSnapshot={async (snap) => {
                      try {
                        if (user) {
                          await saveSnapshotToFirestore(snap, user.uid);
                        } else {
                          setSnapshots((prev) => [snap, ...prev]);
                        }
                      } catch (err) {
                        notify({
                          type: 'error',
                          title: 'Could not archive snapshot',
                          message: err instanceof Error ? err.message : undefined,
                        });
                      }
                    }}
                    onCancelRunningScan={handleCancelRunningScan}
                    onNewSearch={() => navigate('search')}
                    onNotify={notify}
                  />
                ) : (
                  <SearchPage
                    isSignedIn={Boolean(user)}
                    signingIn={signingIn}
                    creditStatus={creditStatus}
                    onCreditsUpdated={(s) => void refreshCredits(s)}
                    recentInvestigations={investigations}
                    onOpenInvestigation={handleOpenInvestigation}
                    onOpenBatchMode={() => navigate('batch')}
                    onSignIn={signInWithGoogle}
                    onScanStarted={handleScanStarted}
                  />
                ))}

              {route === 'history' &&
                (user ? (
                  <HistoryPage
                    investigations={investigations}
                    isLoading={historyLoading}
                    onRefresh={loadHealth}
                    onOpenInvestigation={handleOpenInvestigation}
                    onNewSearch={() => navigate('search')}
                  />
                ) : (
                  <SignInRequiredCard
                    title="Sign in to view History"
                    description="Your cloud investigation archive and shared cases sync automatically with your Google account."
                    signingIn={signingIn}
                    onSignIn={signInWithGoogle}
                  />
                ))}

              {route === 'investigations' &&
                (user ? (
                  <InvestigationsPage
                    investigations={investigations}
                    snapshots={snapshots}
                    onOpenInvestigation={handleOpenInvestigation}
                    onNewSearch={() => navigate('search')}
                  />
                ) : (
                  <SignInRequiredCard
                    title="Sign in to manage Investigations"
                    description="Connect with Google to store case folders, exported PNG report snapshots, and analyst findings."
                    signingIn={signingIn}
                    onSignIn={signInWithGoogle}
                  />
                ))}

              {route === 'monitoring' &&
                (user ? (
                  <MonitoringPage
                    rules={monitoringRules}
                    investigations={investigations}
                    onAddRule={async (rule) => {
                      try {
                        await createMonitorInFirestore(rule, user.uid);
                        notify({ type: 'success', title: 'Monitor rule saved' });
                      } catch (err) {
                        notify({
                          type: 'error',
                          title: 'Could not save monitor rule',
                          message: err instanceof Error ? err.message : undefined,
                        });
                      }
                    }}
                    onToggleRule={async (id, nextActive) => {
                      try {
                        await toggleMonitorInFirestore(id, nextActive);
                      } catch (err) {
                        notify({
                          type: 'error',
                          title: 'Could not update monitor rule',
                          message: err instanceof Error ? err.message : undefined,
                        });
                      }
                    }}
                    onDeleteRule={async (id) => {
                      try {
                        await deleteMonitorInFirestore(id);
                        notify({ type: 'info', title: 'Monitor rule removed' });
                      } catch (err) {
                        notify({
                          type: 'error',
                          title: 'Could not remove monitor rule',
                          message: err instanceof Error ? err.message : undefined,
                        });
                      }
                    }}
                    onRunRuleCheck={handleRunMonitorCheck}
                    onOpenInvestigation={handleOpenInvestigation}
                  />
                ) : (
                  <SignInRequiredCard
                    title="Sign in to configure Monitoring & Alerts"
                    description="Authenticate with Google to create continuous OSINT watchlists and trigger live re-scans."
                    signingIn={signingIn}
                    onSignIn={signInWithGoogle}
                  />
                ))}

              {route === 'team' &&
                (user ? (
                  <TeamPage
                    currentUser={username}
                    displayName={displayName}
                    members={teamMembers}
                    toolAvailability={toolAvailability}
                    geminiStatus={geminiStatus}
                    onAddMember={async (email, role) => {
                      try {
                        await addTeamMemberToFirestore(
                          {
                            id: `mem-${Date.now().toString(36)}`,
                            email,
                            role,
                            status: 'Invited',
                          },
                          user.uid
                        );
                      } catch (err) {
                        notify({
                          type: 'error',
                          title: 'Could not invite teammate',
                          message: err instanceof Error ? err.message : undefined,
                        });
                      }
                    }}
                    onChangeMemberRole={async (memberId, role) => {
                      try {
                        await updateTeamMemberRoleInFirestore(memberId, role);
                        notify({ type: 'success', title: 'Member role updated' });
                      } catch (err) {
                        notify({
                          type: 'error',
                          title: 'Could not update member role',
                          message: err instanceof Error ? err.message : undefined,
                        });
                      }
                    }}
                    onRemoveMember={async (memberId) => {
                      try {
                        await deleteTeamMemberInFirestore(memberId);
                        notify({ type: 'info', title: 'Team member removed' });
                      } catch (err) {
                        notify({
                          type: 'error',
                          title: 'Could not remove teammate',
                          message: err instanceof Error ? err.message : undefined,
                        });
                      }
                    }}
                    onSignOut={signOut}
                    onNotify={notify}
                  />
                ) : (
                  <SignInRequiredCard
                    title="Sign in to access Team Workspace"
                    description="Sign in with Google to invite analysts, manage permissions, and inspect engine readiness."
                    signingIn={signingIn}
                    onSignIn={signInWithGoogle}
                  />
                ))}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Subtle Frosted Workspace Footer */}
        <footer className="mt-10 border-t border-white/50 dark:border-slate-800/80 bg-white/40 dark:bg-[#0B1120]/75 backdrop-blur-md">
          <div className="max-w-6xl mx-auto px-4 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex items-center gap-2">
              <IndianFlag className="w-4.5 h-3" />
              <span className="text-orange-600 dark:text-orange-400 font-semibold" aria-hidden="true">
                ॐ
              </span>
              <span className="font-display font-semibold text-[#0F172A] dark:text-slate-100">
                Parmanu
              </span>
              <span aria-hidden="true">·</span>
              <span>One Signal. Every Trace. Zero Blind Spots.</span>
            </div>

            <div className="flex items-center gap-5">
              <button
                type="button"
                onClick={() => navigate('home')}
                className="hover:text-[#0F172A] dark:hover:text-slate-100 transition-colors cursor-pointer"
              >
                Overview
              </button>
              <button
                type="button"
                onClick={() => navigate('modules')}
                className="hover:text-[#0F172A] dark:hover:text-slate-100 transition-colors cursor-pointer"
              >
                Modules
              </button>
              <a
                href="/.well-known/security.txt"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[#0F172A] dark:hover:text-slate-100 transition-colors"
              >
                security.txt
              </a>
            </div>
          </div>
        </footer>
      </main>

      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        theme={theme}
        onToggleTheme={toggleTheme}
        onNavigate={navigate}
        investigations={investigations}
        activeInvestigation={activeInvestigation}
        redactPii={redactPii}
        onToggleRedactPii={() => setRedactPii((p) => !p)}
        onOpenInvestigation={handleOpenInvestigation}
        onQuickPivotScan={(t, tp) =>
          void handlePivotScan(t, tp, activeInvestigation || undefined)
        }
        onOpenTimeline={() => navigate('timeline')}
        onOpenForensics={() => setForensicsOpen(true)}
        onOpenFacial={() => setFacialOpen(true)}
        onOpenCompareCases={() => setCompareCasesOpen(true)}
      />

      {activeInvestigation && (
        <>
          <ForensicsDialog
            open={forensicsOpen}
            onClose={() => setForensicsOpen(false)}
            target={activeInvestigation.target}
            targetType={activeInvestigation.targetType}
            profilePhotos={activeInvestigation.profilePhotos}
            onAddExifGeoMarker={(marker: GeoMarker) => {
              const exists = activeInvestigation.geoMarkers.some(
                (m) =>
                  Math.abs(m.lat - marker.lat) < 0.001 &&
                  Math.abs(m.lng - marker.lng) < 0.001
              );
              if (exists) return;
              void handleUpdateInvestigation({
                ...activeInvestigation,
                geoMarkers: [marker, ...activeInvestigation.geoMarkers],
              });
              notify({
                type: 'success',
                title: 'EXIF GPS Plotted on Map',
                message: `${marker.lat.toFixed(4)}, ${marker.lng.toFixed(4)} added to investigation.`,
              });
            }}
          />
          <FacialRecognitionDialog
            open={facialOpen}
            onClose={() => setFacialOpen(false)}
            target={activeInvestigation.target}
            profilePhotos={activeInvestigation.profilePhotos}
          />
        </>
      )}

      <CrossCaseLinkerDialog
        open={compareCasesOpen}
        onClose={() => setCompareCasesOpen(false)}
        investigations={investigations}
        initialScanId={activeInvestigation?.scanId}
        redactPii={redactPii}
        onOpenInvestigation={handleOpenInvestigation}
        onPivotScan={(t, tp) =>
          void handlePivotScan(t, tp, activeInvestigation || undefined)
        }
      />

      <ToastContainer
        toasts={toasts}
        onDismiss={(id) =>
          setToasts((prev) => prev.filter((t) => t.id !== id))
        }
      />
    </div>
  );
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <AuthProvider>
        <BrahmandWorkspace />
      </AuthProvider>
    </MotionConfig>
  );
}
