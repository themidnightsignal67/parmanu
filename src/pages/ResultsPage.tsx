import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Crosshair,
  Download,
  FileWarning,
  Flame,
  GitCompare,
  Globe,
  Layers,
  LayoutGrid,
  List,
  Loader2,
  MapPin,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { TOOL_BY_ID } from '@/src/data/tools';
import {
  formatTimestamp,
  getAvatarDownloadUrl,
  regenerateInvestigationBrief,
  runDeepGoogleDorkingClient,
} from '@/src/lib/api';
import {
  loadCaseNote,
  loadPivotLineage,
  loadScanAnnotations,
  maskIdentifierLabel,
  maskPiiString,
  saveResultAnnotation,
} from '@/src/lib/annotationsStore';
import { playClickTick, playSonarPing } from '@/src/lib/sound';
import type {
  CaseSnapshot,
  EvidenceTag,
  GhuntIntelligenceData,
  GoogleDorkResponse,
  InvestigationRecord,
  InvestigationResultItem,
  ResultAnnotation,
  TargetType,
  TyposquatCandidate,
  UsernamePermutationItem,
} from '@/src/types/investigation';
import { AiAnalystDialog } from '@/src/components/results/AiAnalystDialog';
import { BharatRegistryPivotCard } from '@/src/components/results/BharatRegistryPivotCard';
import { CompromiseHeatmap } from '@/src/components/results/CompromiseHeatmap';
import { CorrelationFlowchart } from '@/src/components/results/CorrelationFlowchart';
import { DeepGoogleDorkingCard } from '@/src/components/results/DeepGoogleDorkingCard';
import { DossierDialog } from '@/src/components/results/DossierDialog';
import { GeographicDistributionCard } from '@/src/components/results/GeographicDistributionCard';
import { GhuntProfileCard } from '@/src/components/results/GhuntProfileCard';
import { RecordInspectorDrawer } from '@/src/components/results/RecordInspectorDrawer';
import { ResultCard } from '@/src/components/results/ResultCard';
import { TyposquatRadarCard } from '@/src/components/results/TyposquatRadarCard';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { PlatformMark, resolveSiteDomain } from '@/src/components/ui/PlatformMark';
import { SafeAvatar } from '@/src/components/ui/SafeAvatar';

interface ResultsPageProps {
  investigation: InvestigationRecord;
  investigations?: InvestigationRecord[];
  cachedDorkReport?: GoogleDorkResponse | null;
  redactPii?: boolean;
  onToggleRedactPii?: () => void;
  onCacheDorkReport?: (scanId: string, report: GoogleDorkResponse) => void;
  onOpenTimeline?: () => void;
  onOpenInvestigation?: (scanId: string) => void;
  onPivotScan?: (
    target: string,
    targetType: TargetType,
    parentInvestigation: InvestigationRecord
  ) => void;
  onSelectResult: (item: InvestigationResultItem) => void;
  onUpdateInvestigation: (record: InvestigationRecord) => void;
  onSaveSnapshot: (snap: CaseSnapshot) => void;
  onCancelRunningScan?: (scanId: string) => void;
  onNewSearch: () => void;
  onNotify: (toast: {
    type: 'success' | 'error' | 'info';
    title: string;
    message?: string;
  }) => void;
}

const BREACH_PAGE_SIZE = 4;
const PHOTO_PAGE_SIZE = 4;
const AUDIT_PAGE_SIZE = 36;

function buildPageNumbers(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 5) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: Array<number | 'ellipsis'> = [1];
  if (current > 3) pages.push('ellipsis');
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }
  if (current < total - 2) pages.push('ellipsis');
  pages.push(total);
  return pages;
}

function AnimatedCounter({
  value,
  scanKey,
}: {
  value: number;
  scanKey: string;
}) {
  const [display, setDisplay] = useState(0);
  const [climbing, setClimbing] = useState(false);
  const currentRef = useRef(0);
  const prevScanKeyRef = useRef(scanKey);

  useEffect(() => {
    if (prevScanKeyRef.current !== scanKey) {
      prevScanKeyRef.current = scanKey;
      currentRef.current = 0;
      setDisplay(0);
      setClimbing(false);
    }

    const startVal = currentRef.current;
    if (startVal === value) {
      setClimbing(false);
      return;
    }

    setClimbing(true);
    const delta = Math.abs(value - startVal);
    const duration = Math.min(1700, Math.max(850, delta * 95));
    const startTime = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const p = Math.min(1, (now - startTime) / duration);
      const steady = 0.62 * p + 0.38 * (1 - Math.pow(1 - p, 2));
      const next = Math.round(startVal + (value - startVal) * steady);
      if (next !== currentRef.current) {
        currentRef.current = next;
        setDisplay(next);
      }
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        currentRef.current = value;
        setDisplay(value);
        setClimbing(false);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, scanKey]);

  const chars = String(display).split('');

  return (
    <span
      className={`inline-flex items-baseline transition-colors duration-200 ${
        climbing
          ? 'text-indigo-600 dark:text-indigo-400'
          : 'text-[#0F172A] dark:text-slate-100'
      }`}
    >
      {chars.map((ch, idx) => (
        <span
          key={`slot-${chars.length - idx}`}
          className="relative inline-block overflow-hidden leading-none py-0.5"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={`${idx}-${ch}`}
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -12, opacity: 0 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="inline-block"
            >
              {ch}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
}

function StreamedBriefText({ text }: { text: string }) {
  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);
  return (
    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
      {words.map((word, idx) => (
        <motion.span
          key={`${idx}-${word.slice(0, 6)}`}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, delay: Math.min(idx * 0.015, 0.65) }}
          className="inline-block mr-1"
        >
          {word}
        </motion.span>
      ))}
    </p>
  );
}

export function ResultsPage({
  investigation,
  investigations = [],
  cachedDorkReport = null,
  redactPii: controlledRedact,
  onToggleRedactPii: _onToggleRedactPii,
  onCacheDorkReport,
  onOpenTimeline,
  onOpenInvestigation,
  onPivotScan,
  onSelectResult,
  onUpdateInvestigation,
  onSaveSnapshot: _onSaveSnapshot,
  onCancelRunningScan,
  onNewSearch,
  onNotify,
}: ResultsPageProps) {
  const [activeTab, setActiveTab] = useState<
    'all' | 'signals' | 'registered' | 'leaked' | 'payments_ott' | 'audit'
  >('all');
  const [auditStatusFilter, setAuditStatusFilter] = useState<
    'all' | 'not_found' | 'not_checked'
  >('all');
  const [paymentOttFilter, setPaymentOttFilter] = useState<
    'all' | 'upi' | 'ott' | 'lpg'
  >('all');
  const [copiedVpa, setCopiedVpa] = useState<string | null>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [viewMode, setViewMode] = useState<'cards' | 'grouped'>('cards');
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [flowchartBranch, setFlowchartBranch] = useState<
    'all' | 'accounts' | 'exposures' | 'attributes' | 'geo'
  >('all');
  const [tagFilter, setTagFilter] = useState<'all' | EvidenceTag>('all');
  const [breachPage, setBreachPage] = useState(1);
  const [photoPage, setPhotoPage] = useState(1);
  const [downloadedPhotoId, setDownloadedPhotoId] = useState<string | null>(
    null
  );

  const [aiOpen, setAiOpen] = useState(false);
  const [dossierOpen, setDossierOpen] = useState(false);
  const [geoViewMode, setGeoViewMode] = useState<'case' | 'heatmap'>('case');
  const [geoFocusRequest, setGeoFocusRequest] = useState<{
    lat: number;
    lng: number;
    zoom?: number;
    markerId?: string;
    nonce: number;
  } | null>(null);
  const [diffDetailsOpen, setDiffDetailsOpen] = useState(false);
  const [drawerItem, setDrawerItem] = useState<InvestigationResultItem | null>(null);
  const redactPii = Boolean(controlledRedact);

  const [annotations, setAnnotations] = useState<Record<string, ResultAnnotation>>(() =>
    loadScanAnnotations(investigation.scanId)
  );
  const [caseNote, setCaseNote] = useState<string>(() =>
    loadCaseNote(investigation.scanId)
  );
  const [stickyVisible, setStickyVisible] = useState(false);

  const [generatingAi, setGeneratingAi] = useState(false);
  const [dorkOpen, setDorkOpen] = useState(Boolean(cachedDorkReport));
  const [dorkLoading, setDorkLoading] = useState(false);
  const [dorkError, setDorkError] = useState<string | null>(null);
  const [dorkReport, setDorkReport] = useState<GoogleDorkResponse | null>(
    cachedDorkReport
  );

  const autoRequestedAiRef = useRef<Set<string>>(new Set());
  const dorkSectionRef = useRef<HTMLDivElement>(null);
  const geoSectionRef = useRef<HTMLDivElement>(null);
  const flowchartSectionRef = useRef<HTMLDivElement>(null);
  const cardsSectionRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  const ghuntIntel = useMemo(() => {
    const ghItem = investigation.results.find((r) => r.id === 'ghunt-google-workspace');
    const raw = (ghItem?.details as { ghuntIntel?: GhuntIntelligenceData } | undefined)
      ?.ghuntIntel;
    return raw || null;
  }, [investigation.results]);

  const handleFocusMapLocation = (
    lat: number,
    lng: number,
    zoom?: number,
    markerId?: string
  ) => {
    setGeoViewMode('case');
    setGeoFocusRequest({
      lat,
      lng,
      zoom: zoom ?? 12,
      markerId,
      nonce: Date.now(),
    });
    geoSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const pivotLineage = useMemo(
    () => loadPivotLineage(investigation.scanId),
    [investigation.scanId]
  );

  useEffect(() => {
    const onScroll = () => {
      setStickyVisible(window.scrollY > 260);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setActiveTab('all');
    setAuditStatusFilter('all');
    setAuditPage(1);
    setSearchFilter('');
    setSelectedCategory('all');
    setFlowchartBranch('all');
    setTagFilter('all');
    setBreachPage(1);
    setPhotoPage(1);
    setDrawerItem(null);
    setAnnotations(loadScanAnnotations(investigation.scanId));
    setCaseNote(loadCaseNote(investigation.scanId));
    setDiffDetailsOpen(false);
    setGeoViewMode(investigation.geoMarkers.length > 0 ? 'case' : 'heatmap');
    setGeneratingAi(false);
    setDorkLoading(false);
    setDorkError(null);
    if (cachedDorkReport) {
      setDorkReport(cachedDorkReport);
      setDorkOpen(true);
    } else {
      setDorkReport(null);
      setDorkOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [investigation.scanId]);

  useEffect(() => {
    if (cachedDorkReport && !dorkReport) {
      setDorkReport(cachedDorkReport);
      setDorkOpen(true);
    }
  }, [cachedDorkReport, dorkReport]);

  // Only hydrate & open embedded dorkReport automatically if the user explicitly opted into Google Dorking for this scan
  useEffect(() => {
    if (dorkReport || investigation.enableGoogleDorking !== true) return;
    const liveCard = investigation.results.find((r) => Boolean(r.details?.dorkReport));
    if (liveCard?.details?.dorkReport) {
      const hydrated = liveCard.details.dorkReport as GoogleDorkResponse;
      setDorkReport(hydrated);
      if (hydrated.hits.length > 0) {
        setDorkOpen(true);
      }
      onCacheDorkReport?.(investigation.scanId, hydrated);
    }
  }, [investigation.enableGoogleDorking, investigation.results, investigation.scanId, dorkReport, onCacheDorkReport]);

  const isRunning = investigation.status === 'running';

  const handleShowGoogleDorking = async (customKeyword?: string) => {
    playSonarPing();
    setDorkOpen(true);
    window.setTimeout(() => {
      dorkSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 80);

    if (dorkLoading) return;
    setDorkLoading(true);
    setDorkError(null);

    try {
      const discoveredTerms = investigation.results
        .filter((r) => r.status === 'found')
        .flatMap((r) => [r.handle, r.displayName, r.domain])
        .filter(
          (v): v is string =>
            typeof v === 'string' &&
            v.trim().length >= 3 &&
            v.trim().toLowerCase() !== investigation.target.toLowerCase() &&
            (investigation.targetType !== 'email' || v.includes('@'))
        );

      const extraTerms = Array.from(
        new Set([
          ...(customKeyword?.trim() ? [customKeyword.trim()] : []),
          ...discoveredTerms,
        ])
      ).slice(0, 6);

      const report = await runDeepGoogleDorkingClient({
        target: investigation.target,
        targetType: investigation.targetType,
        extraTerms,
        strictPivot: customKeyword?.trim() || undefined,
        scanId: investigation.scanId,
      });
      setDorkReport(report);
      onCacheDorkReport?.(investigation.scanId, report);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Unable to run deep Google Dorking right now.';
      setDorkError(msg);
      onNotify({
        type: 'error',
        title: 'Google Dorking unavailable',
        message: msg,
      });
    } finally {
      setDorkLoading(false);
    }
  };

  const handleGenerateAiSummary = async () => {
    if (generatingAi) return;
    setGeneratingAi(true);
    try {
      const updated = await regenerateInvestigationBrief(
        investigation.scanId,
        investigation
      );
      onUpdateInvestigation(updated);
    } catch {
      onNotify({
        type: 'error',
        title: 'AI summary unavailable',
        message: 'Could not generate summary right now.',
      });
    } finally {
      setGeneratingAi(false);
    }
  };

  // Safety fallback: if scan finished without an AI summary after 4.5s, trigger /summarize (server deduplicates in-flight)
  useEffect(() => {
    if (isRunning || investigation.status === 'cancelled' || investigation.aiSummary) {
      return;
    }
    if (autoRequestedAiRef.current.has(investigation.scanId)) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (autoRequestedAiRef.current.has(investigation.scanId)) return;
      autoRequestedAiRef.current.add(investigation.scanId);
      void handleGenerateAiSummary();
    }, 4500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, investigation.scanId, investigation.status, investigation.aiSummary]);

  const foundResults = useMemo(
    () => investigation.results.filter((r) => r.status === 'found'),
    [investigation.results]
  );

  const auditResults = useMemo(() => {
    const nonFound = investigation.results.filter((r) => r.status !== 'found');
    // Surface deterministic Verified Clean (not_found) sites before Auth/WAF Gated sites
    return [...nonFound].sort((a, b) => {
      const rank = (s: InvestigationResultItem['status']) =>
        s === 'not_found' ? 0 : s === 'not_checked' ? 1 : 2;
      return rank(a.status) - rank(b.status);
    });
  }, [investigation.results]);

  const verifiedCleanCount = useMemo(
    () => auditResults.filter((r) => r.status === 'not_found').length,
    [auditResults]
  );

  const gatedAuditCount = auditResults.length - verifiedCleanCount;

  const isPaymentOttItem = (item: InvestigationResultItem): boolean => {
    if (
      item.id === 'mailaccess-payment-upi-intel' ||
      item.id === 'mailaccess-ott-footprint-index' ||
      item.id === 'mailaccess-lpg-utility-intel'
    ) {
      return true;
    }
    return /paytm|phonepe|google pay|bhim|amazon pay|mobikwik|cred|freecharge|fampay|jupiter|fi money|slice|navi|bharatpe|bajaj pay|whatsapp pay|super\.money|flipkart upi|pop upi|kotak 811|au bank upi|bob world|groww|zerodha|upstox|razorpay|paypal|instamojo|stripe|sonyliv|zee5|hotstar|jiocinema|mx player|netflix|prime video|tata play|airtel xstream|fancode|aha video|hoichoi|sun nxt|manoramamax|apple tv|lionsgate|discovery\+|eros now|shemaroo|stage ott|chaupal|docubay|crunchyroll|mubi|spotify|youtube music|amazon music|jiosaavn|gaana|wynk|audible|pocket fm|kuku fm|storytel|bookmyshow|paytm insider|district by zomato|pvr inox|indane|hp gas|bharatgas|mylpg|ujjwala|igl |mahanagar gas|adani|gujarat gas|torrent gas|gail gas|mngl|sabarmati|green gas|think gas|tata power|bses|bescom|msedcl|tangedco|uppcl|cesc|billpay|fastag|dishtv|act fibernet|twitch|steam|epic games/i.test(
      item.platform
    );
  };

  const classifyPaymentOttBucket = (
    item: InvestigationResultItem
  ): 'upi' | 'ott' | 'lpg' => {
    if (
      item.id === 'mailaccess-lpg-utility-intel' ||
      /indane|hp gas|bharatgas|mylpg|ujjwala|igl |mahanagar gas|adani|gujarat gas|torrent gas|gail gas|mngl|sabarmati|green gas|think gas|tata power|bses|bescom|msedcl|tangedco|uppcl|cesc|billpay|fastag|dishtv|act fibernet|lpg/i.test(
        item.platform
      )
    ) {
      return 'lpg';
    }
    if (
      item.id === 'mailaccess-ott-footprint-index' ||
      /sonyliv|zee5|hotstar|jiocinema|mx player|netflix|prime video|tata play|airtel xstream|fancode|aha video|hoichoi|sun nxt|manoramamax|apple tv|lionsgate|discovery\+|eros now|shemaroo|stage ott|chaupal|docubay|crunchyroll|mubi|spotify|youtube music|amazon music|jiosaavn|gaana|wynk|audible|pocket fm|kuku fm|storytel|bookmyshow|paytm insider|district by zomato|pvr inox|twitch|steam|epic games|ott/i.test(
        item.platform
      )
    ) {
      return 'ott';
    }
    return 'upi';
  };

  const paymentOttResults = useMemo(() => {
    const matched = investigation.results.filter(isPaymentOttItem);
    const statusRank = (r: InvestigationResultItem) => {
      if (
        r.id === 'mailaccess-payment-upi-intel' ||
        r.id === 'mailaccess-ott-footprint-index' ||
        r.id === 'mailaccess-lpg-utility-intel'
      ) {
        return r.status === 'found' ? 0 : 2;
      }
      if (r.status === 'found') return 1;
      if (r.status === 'not_found') return 3;
      return 4;
    };
    return [...matched].sort((a, b) => statusRank(a) - statusRank(b));
  }, [investigation.results]);

  const derivedUpiHandles = useMemo(() => {
    if (investigation.targetType !== 'phone') return [];
    const digits = investigation.target.replace(/\D/g, '');
    const national = digits.length >= 10 ? digits.slice(-10) : digits;
    if (national.length < 8) return [];
    return [
      { app: 'PhonePe', handle: `${national}@ybl` },
      { app: 'Paytm', handle: `${national}@paytm` },
      { app: 'GPay (SBI)', handle: `${national}@oksbi` },
      { app: 'GPay (ICICI)', handle: `${national}@okicici` },
      { app: 'GPay (Axis)', handle: `${national}@okaxis` },
      { app: 'GPay (HDFC)', handle: `${national}@okhdfcbank` },
      { app: 'BHIM UPI', handle: `${national}@upi` },
      { app: 'Amazon Pay', handle: `${national}@apl` },
    ];
  }, [investigation.target, investigation.targetType]);

  const availableCategories = useMemo(() => {
    const source =
      activeTab === 'audit'
        ? auditResults
        : activeTab === 'payments_ott'
        ? paymentOttResults
        : foundResults;
    const set = new Set<string>();
    for (const r of source) {
      if (r.category) set.add(r.category);
    }
    return Array.from(set).sort();
  }, [activeTab, auditResults, paymentOttResults, foundResults]);

  useEffect(() => {
    setAuditPage(1);
  }, [activeTab, auditStatusFilter, paymentOttFilter, selectedCategory, searchFilter]);

  const tabResults = useMemo(() => {
    const byTab =
      activeTab === 'audit'
        ? auditStatusFilter === 'not_found'
          ? auditResults.filter((r) => r.status === 'not_found')
          : auditStatusFilter === 'not_checked'
          ? auditResults.filter((r) => r.status !== 'not_found')
          : auditResults
        : activeTab === 'payments_ott'
        ? paymentOttFilter === 'all'
          ? paymentOttResults
          : paymentOttResults.filter(
              (r) => classifyPaymentOttBucket(r) === paymentOttFilter
            )
        : activeTab === 'signals'
        ? foundResults.filter((r) => r.findingKind !== 'breached')
        : activeTab === 'registered'
        ? foundResults.filter((r) => r.findingKind === 'registered')
        : activeTab === 'leaked'
        ? foundResults.filter(
            (r) => r.findingKind === 'leaked' || r.findingKind === 'breached'
          )
        : foundResults;

    const byCat =
      selectedCategory === 'all'
        ? byTab
        : byTab.filter((item) => item.category === selectedCategory);

    const byBranch =
      activeTab === 'audit' ||
      activeTab === 'payments_ott' ||
      flowchartBranch === 'all'
        ? byCat
        : flowchartBranch === 'exposures'
        ? byCat.filter(
            (i) => i.findingKind === 'breached' || i.findingKind === 'leaked'
          )
        : flowchartBranch === 'accounts'
        ? byCat.filter(
            (i) => i.findingKind !== 'breached' && i.findingKind !== 'leaked'
          )
        : flowchartBranch === 'attributes'
        ? byCat.filter(
            (i) =>
              (i.linkedInfo && i.linkedInfo.length > 0) ||
              (i.displayFields && i.displayFields.length > 0)
          )
        : byCat.filter((i) =>
            Boolean(
              i.details?.location ||
                i.details?.country ||
                i.category === 'Network & Infrastructure'
            )
          );

    const byTag =
      activeTab === 'audit' || activeTab === 'payments_ott' || tagFilter === 'all'
        ? byBranch
        : byBranch.filter((item) => annotations[item.id]?.tag === tagFilter);

    const q = searchFilter.trim().toLowerCase();
    if (!q) return byTag;

    return byTag.filter((item) =>
      `${item.platform} ${item.domain || ''} ${item.category} ${item.handle || ''} ${
        item.displayName || ''
      } ${item.summary || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [
    foundResults,
    auditResults,
    paymentOttResults,
    activeTab,
    auditStatusFilter,
    paymentOttFilter,
    selectedCategory,
    flowchartBranch,
    tagFilter,
    annotations,
    searchFilter,
  ]);

  const domainSecurityPosture = useMemo(() => {
    if (investigation.targetType !== 'domain') return null;
    const domItem = investigation.results.find(
      (r) => r.id === 'mailaccess-domain-dns' || r.details?.securityGrade
    );
    if (!domItem?.details?.securityGrade) return null;
    const d = domItem.details;
    return {
      grade: String(d.securityGrade),
      score: Number(d.postureScore || 0),
      headerChecks: Array.isArray(d.headerChecks)
        ? (d.headerChecks as Array<{ key: string; label: string; present: boolean }>)
        : [],
      subdomains: Array.isArray(d.subdomains) ? (d.subdomains as string[]) : [],
      dkimSelectors: Array.isArray(d.dkimSelectors)
        ? (d.dkimSelectors as string[])
        : [],
      hasSpf: Boolean(d.spf),
      hasDmarc: Boolean(d.dmarc),
      securityTxtFound: Boolean(d.securityTxtFound),
      robotsTxtFound: Boolean(d.robotsTxtFound),
    };
  }, [investigation.targetType, investigation.results]);

  const typosquatCandidates = useMemo<TyposquatCandidate[]>(() => {
    if (investigation.targetType !== 'domain') return [];
    const domItem = investigation.results.find(
      (r) => r.id === 'mailaccess-domain-dns' || Array.isArray(r.details?.typosquats)
    );
    const list = domItem?.details?.typosquats;
    return Array.isArray(list) ? (list as TyposquatCandidate[]) : [];
  }, [investigation.targetType, investigation.results]);

  const usernamePermutations = useMemo<UsernamePermutationItem[]>(() => {
    if (investigation.targetType !== 'username') return [];
    const permItem = investigation.results.find(
      (r) => r.id === 'mailaccess-username-permutations'
    );
    const list = permItem?.details?.permutations;
    return Array.isArray(list) ? (list as UsernamePermutationItem[]) : [];
  }, [investigation.targetType, investigation.results]);

  const rescanDiff = useMemo(() => {
    const targetLower = investigation.target.trim().toLowerCase();
    const currentTs = new Date(investigation.createdAt).getTime();
    const priors = investigations
      .filter(
        (i) =>
          i.scanId !== investigation.scanId &&
          i.target.trim().toLowerCase() === targetLower &&
          i.targetType === investigation.targetType &&
          new Date(i.createdAt).getTime() <= currentTs
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    const prev = priors[0];
    if (!prev) return null;

    const prevPlatforms = new Set(
      prev.results.filter((r) => r.status === 'found').map((r) => r.platform)
    );
    const currFound = investigation.results.filter((r) => r.status === 'found');
    const currPlatforms = new Set(currFound.map((r) => r.platform));
    const addedResultIds = new Set(
      currFound.filter((r) => !prevPlatforms.has(r.platform)).map((r) => r.id)
    );
    const addedPlatforms = Array.from(currPlatforms).filter(
      (p) => !prevPlatforms.has(p)
    );
    const removedPlatforms = Array.from(prevPlatforms).filter(
      (p) => !currPlatforms.has(p)
    );

    const prevBreaches = new Set(
      prev.breachedAccounts.map((b) =>
        (b.breachName || b.platform).toLowerCase()
      )
    );
    const currBreaches = new Set(
      investigation.breachedAccounts.map((b) =>
        (b.breachName || b.platform).toLowerCase()
      )
    );
    const addedBreaches = Array.from(currBreaches).filter(
      (b) => !prevBreaches.has(b)
    );
    const removedBreaches = Array.from(prevBreaches).filter(
      (b) => !currBreaches.has(b)
    );

    return {
      previousScanId: prev.scanId,
      previousCreatedAt: prev.createdAt,
      addedResultIds,
      addedPlatforms,
      removedPlatforms,
      addedBreaches,
      removedBreaches,
      totalNew: addedPlatforms.length + addedBreaches.length,
      totalRemoved: removedPlatforms.length + removedBreaches.length,
    };
  }, [investigations, investigation]);

  const breachSeverityStats = useMemo(() => {
    let high = 0;
    let medium = 0;
    let low = 0;
    let passwordExposed = 0;
    for (const b of investigation.breachedAccounts) {
      if (b.severity === 'high') high += 1;
      else if (b.severity === 'medium') medium += 1;
      else low += 1;
      if (b.dataClasses.some((c) => /password|hash|token|secret/i.test(c))) {
        passwordExposed += 1;
      }
    }
    return { high, medium, low, passwordExposed, total: investigation.breachedAccounts.length };
  }, [investigation.breachedAccounts]);

  const handleUpdateAnnotation = (
    resultId: string,
    patch: { tag?: EvidenceTag | null; note?: string }
  ) => {
    const next = saveResultAnnotation(investigation.scanId, resultId, patch);
    setAnnotations(next);
  };

  const groupedByCategory = useMemo(() => {
    const map = new Map<string, InvestigationResultItem[]>();
    for (const item of tabResults) {
      const cat = item.category || 'Other';
      const arr = map.get(cat) || [];
      arr.push(item);
      map.set(cat, arr);
    }
    return Array.from(map.entries());
  }, [tabResults]);

  const totalBreachPages = Math.max(
    1,
    Math.ceil(investigation.breachedAccounts.length / BREACH_PAGE_SIZE)
  );
  const safeBreachPage = Math.min(breachPage, totalBreachPages);
  const visibleBreaches = investigation.breachedAccounts.slice(
    (safeBreachPage - 1) * BREACH_PAGE_SIZE,
    safeBreachPage * BREACH_PAGE_SIZE
  );

  const totalPhotoPages = Math.max(
    1,
    Math.ceil(investigation.profilePhotos.length / PHOTO_PAGE_SIZE)
  );
  const safePhotoPage = Math.min(photoPage, totalPhotoPages);
  const visiblePhotos = investigation.profilePhotos.slice(
    (safePhotoPage - 1) * PHOTO_PAGE_SIZE,
    safePhotoPage * PHOTO_PAGE_SIZE
  );

  const totalAuditPages = Math.max(
    1,
    Math.ceil(
      (activeTab === 'audit' || activeTab === 'payments_ott' ? tabResults.length : 0) /
        AUDIT_PAGE_SIZE
    )
  );
  const safeAuditPage = Math.min(auditPage, totalAuditPages);
  const visibleAuditResults =
    activeTab === 'audit' || activeTab === 'payments_ott'
      ? tabResults.slice(
          (safeAuditPage - 1) * AUDIT_PAGE_SIZE,
          safeAuditPage * AUDIT_PAGE_SIZE
        )
      : [];



  const handleExportGeo = () => {
    const payload = JSON.stringify(
      {
        target: investigation.target,
        targetType: investigation.targetType,
        geoMarkers: investigation.geoMarkers,
      },
      null,
      2
    );
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parmanu-geo-${investigation.scanId}.json`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 15_000);
    onNotify({ type: 'success', title: 'Geographic distribution exported' });
  };

  const handleDownloadPhoto = (
    photoId: string,
    photoUrl: string,
    platform: string
  ) => {
    const a = document.createElement('a');
    a.href = getAvatarDownloadUrl(photoUrl, platform);
    a.download = `${platform.toLowerCase().replace(/\W+/g, '-')}-avatar.jpg`;
    a.click();
    setDownloadedPhotoId(photoId);
    window.setTimeout(() => {
      setDownloadedPhotoId((prev) => (prev === photoId ? null : prev));
    }, 1500);
  };

  const completedModules = investigation.toolExecutions.filter(
    (e) => e.status !== 'running' && e.status !== 'queued'
  ).length;
  const totalModules = Math.max(1, investigation.toolExecutions.length);
  const brahmandSignalsCount = Math.max(
    0,
    investigation.summary.found - investigation.summary.breached
  );

  // 5-Card KPI Header Row matching reference layout
  const summaryCards = [
    {
      label: 'Total Results',
      sublabel: 'All discovered records',
      value: investigation.summary.total,
      Icon: Layers,
    },
    {
      label: 'Parmanu Signals',
      sublabel: 'Platform & domain matches',
      value: brahmandSignalsCount,
      Icon: Sparkles,
    },
    {
      label: 'Registered Accounts',
      sublabel: 'Verified profiles found',
      value: investigation.summary.registered,
      Icon: UserCheck,
    },
    {
      label: 'Breached Results',
      sublabel: 'Security breaches',
      value: investigation.summary.breached,
      Icon: ShieldAlert,
    },
    {
      label: 'Leaked Results',
      sublabel: 'Exposed credentials/logs',
      value: investigation.summary.leaked,
      Icon: FileWarning,
    },
  ];

  const totalWebsitesScanned = Math.max(
    investigation.results.length,
    investigation.toolExecutions.reduce(
      (sum, e) => sum + (e.platformsChecked || 0),
      0
    )
  );

  const shownTarget = maskIdentifierLabel(
    investigation.target,
    investigation.targetType,
    redactPii
  );
  const emailLocalPart =
    investigation.targetType === 'email'
      ? (investigation.target.split('@')[0] || '').trim()
      : '';
  const shownEmailLocalPart = emailLocalPart
    ? maskIdentifierLabel(emailLocalPart, 'username', redactPii)
    : '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="max-w-6xl mx-auto px-3.5 sm:px-8 py-5 sm:py-8 space-y-5 sm:space-y-6"
    >
      {/* Sticky Investigation Mini-Header on Scroll */}
      <AnimatePresence>
        {stickyVisible && (
          <motion.div
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.16 }}
            className="no-print fixed top-16 lg:top-3 left-1/2 -translate-x-1/2 lg:left-[calc(50%+130px)] z-30 w-[calc(100%-1.5rem)] max-w-4xl px-3.5 sm:px-4 py-2 rounded-2xl bg-white/92 dark:bg-[#0D1424]/94 backdrop-blur-xl border border-slate-200/80 dark:border-slate-700/80 shadow-[0_12px_36px_rgba(15,23,42,0.12)] flex items-center justify-between gap-2.5 sm:gap-3"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-[11px] font-semibold uppercase text-orange-600 shrink-0">
                {investigation.targetType}
              </span>
              <span className="font-mono text-xs sm:text-sm font-bold text-[#0F172A] dark:text-slate-100 truncate">
                {shownTarget}
              </span>
              <span className="hidden md:inline text-xs text-slate-400 tabular-nums shrink-0">
                · {totalWebsitesScanned.toLocaleString()} websites scanned · {investigation.summary.found} found · {investigation.summary.breached} breached
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() =>
                  flowchartSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
                }
                className="hidden sm:inline-flex px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Graph
              </button>
              <button
                type="button"
                onClick={() =>
                  cardsSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
                }
                className="hidden sm:inline-flex px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cards
              </button>
              {onOpenTimeline && (
                <Button size="sm" variant="outline" onClick={onOpenTimeline}>
                  <Clock className="w-3.5 h-3.5 text-orange-600" />
                  <span>Show Timeline</span>
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={dorkLoading}
                onClick={() => void handleShowGoogleDorking()}
              >
                <Terminal className="w-3.5 h-3.5 text-indigo-600" />
                <span className="hidden md:inline">Google Dorking</span>
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pivot Lineage Breadcrumb if spawned via Pivot Scan */}
      {pivotLineage && (
        <div className="px-4 py-2.5 rounded-xl bg-orange-50/70 dark:bg-orange-950/30 border border-orange-200/80 dark:border-orange-900/50 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-orange-900 dark:text-orange-200">
            <Crosshair className="w-3.5 h-3.5 text-orange-600 shrink-0" />
            <span>
              Pivoted from{' '}
              <span className="font-mono font-semibold">
                {maskIdentifierLabel(
                  pivotLineage.parentTarget,
                  pivotLineage.parentTargetType,
                  redactPii
                )}
              </span>{' '}
              ({pivotLineage.parentTargetType.toUpperCase()})
            </span>
          </div>
        </div>
      )}

      {/* Top Header: Searched Target on Left, Clean Actions on Right */}
      <header ref={headerRef} className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 pb-1">
        <div className="min-w-0">
          <h1 className="font-display text-xl sm:text-3xl font-bold tracking-tight text-[#0F172A] dark:text-slate-100 font-mono break-all sm:break-words">
            {shownTarget}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-1">
            <span className="uppercase font-semibold text-orange-600">
              {investigation.targetType}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">Scan {investigation.scanId}</span>
            <span aria-hidden="true">·</span>
            <span>{formatTimestamp(investigation.createdAt)}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-slate-500 dark:text-slate-400">
              {new Intl.DateTimeFormat('en-IN', {
                timeZone: 'Asia/Kolkata',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              }).format(new Date(investigation.createdAt))}{' '}
              IST
            </span>
            {totalWebsitesScanned > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-slate-600 dark:text-slate-300 tabular-nums">
                  {totalWebsitesScanned.toLocaleString()} websites scanned
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col items-start lg:items-end gap-2 w-full lg:w-auto">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 w-full lg:w-auto lg:justify-end">
            {onOpenTimeline && (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenTimeline}
                className="border-orange-200/80 dark:border-orange-900/60 text-orange-700 dark:text-orange-300 hover:bg-orange-50/70 dark:hover:bg-orange-950/40"
              >
                <Clock className="w-3.5 h-3.5 text-orange-600" />
                <span>Show Timeline</span>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleShowGoogleDorking()}
              disabled={dorkLoading}
              className="border-indigo-200/80 dark:border-indigo-900/60 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50/70 dark:hover:bg-indigo-950/40"
            >
              {dorkLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
              ) : (
                <Terminal className="w-3.5 h-3.5 text-indigo-600" />
              )}
              <span>
                {dorkLoading ? 'Dorking...' : 'Show Google Dorking Results'}
              </span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDossierOpen(true)}
              disabled={isRunning && investigation.results.length === 0}
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>PDF Download</span>
            </Button>
            <Button
              variant="gradient"
              size="sm"
              onClick={() => setAiOpen(true)}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Analyst</span>
            </Button>
            <Button size="sm" onClick={onNewSearch}>
              <Search className="w-3.5 h-3.5" />
              <span>New Search</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Module Orbital Progress Strip when scan is still resolving */}
      {isRunning && (
        <Card className="px-4 py-3.5 space-y-2.5 border-indigo-200/70 dark:border-indigo-900/60 bg-white/85 dark:bg-[#0E1526]/90">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5">
              <Loader2 className="w-4 h-4 text-indigo-600 animate-spin shrink-0" />
              <span className="font-semibold text-[#0F172A] dark:text-slate-100">
                Streaming live results ({completedModules}/{totalModules} modules complete)
              </span>
            </div>

            {onCancelRunningScan && (
              <button
                type="button"
                onClick={() => onCancelRunningScan(investigation.scanId)}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-rose-600 cursor-pointer"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>Stop scan</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {investigation.toolExecutions.map((exec) => {
              const done = exec.status !== 'running' && exec.status !== 'queued';
              return (
                <div
                  key={exec.tool}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                    done
                      ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200/80 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-300'
                      : 'bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-200/70 dark:border-indigo-900/60 text-indigo-700 dark:text-indigo-300'
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                  ) : (
                    <Loader2 className="w-3 h-3 animate-spin text-indigo-600 shrink-0" />
                  )}
                  <span>{TOOL_BY_ID[exec.tool]?.name || exec.tool}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Re-Scan Diff Banner compared against previous scan of same target */}
      {rescanDiff && !isRunning && (
        <Card className="p-4 border-indigo-200/70 dark:border-indigo-900/60 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <GitCompare className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span className="font-semibold text-[#0F172A] dark:text-slate-100">
                Re-Scan Baseline Diff vs. {formatTimestamp(rescanDiff.previousCreatedAt)}:
              </span>
              <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                +{rescanDiff.totalNew} New
              </span>
              <span className="text-slate-300 dark:text-slate-700">·</span>
              <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">
                -{rescanDiff.totalRemoved} Removed
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDiffDetailsOpen((v) => !v)}
                className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
              >
                {diffDetailsOpen ? 'Hide Diff Details' : 'Inspect Diff Details'}
              </button>
              {onOpenInvestigation && (
                <button
                  type="button"
                  onClick={() => onOpenInvestigation(rescanDiff.previousScanId)}
                  className="font-medium text-slate-500 hover:text-[#0F172A] dark:hover:text-white cursor-pointer"
                >
                  Open Baseline →
                </button>
              )}
            </div>
          </div>

          {diffDetailsOpen && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
              <div className="space-y-1">
                <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                  + Newly Appeared ({rescanDiff.totalNew})
                </p>
                {rescanDiff.totalNew === 0 ? (
                  <p className="text-[11px] text-slate-400">No new exposures or accounts since previous scan.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {rescanDiff.addedBreaches.map((b) => (
                      <span key={`nb-${b}`} className="px-2 py-0.5 rounded bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 font-mono text-[11px]">
                        + Breach: {b}
                      </span>
                    ))}
                    {rescanDiff.addedPlatforms.map((p) => (
                      <span key={`np-${p}`} className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-mono text-[11px]">
                        + {p}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <p className="font-semibold text-slate-600 dark:text-slate-300">
                  - Removed / No Longer Present ({rescanDiff.totalRemoved})
                </p>
                {rescanDiff.totalRemoved === 0 ? (
                  <p className="text-[11px] text-slate-400">All prior baseline signals remain intact.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {rescanDiff.removedBreaches.map((b) => (
                      <span key={`rb-${b}`} className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                        - Breach: {b}
                      </span>
                    ))}
                    {rescanDiff.removedPlatforms.map((p) => (
                      <span key={`rp-${p}`} className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                        - {p}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Strict Email-to-Handle 1-Click Pivot Strip */}
      {investigation.targetType === 'email' &&
        Boolean(onPivotScan) &&
        emailLocalPart.length >= 3 && (
          <Card className="p-4 border-indigo-200/70 dark:border-indigo-900/60 bg-gradient-to-r from-indigo-50/60 via-white to-slate-50/70 dark:from-indigo-950/25 dark:via-[#0E1526] dark:to-[#0B1120] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <Crosshair className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
              <div className="min-w-0 text-xs leading-relaxed">
                <p className="font-semibold text-[#0F172A] dark:text-slate-100">
                  Strict Email Verification Active (Zero False Positives)
                </p>
                <p className="text-slate-600 dark:text-slate-300 mt-0.5">
                  Profiles on GitHub, Reddit, or Replit with private email settings are excluded from exact-email hits. Sweep handle{' '}
                  <span className="font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                    @{shownEmailLocalPart}
                  </span>{' '}
                  across 400+ username platforms if the owner reuses this alias.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPivotScan?.(emailLocalPart, 'username', investigation)}
              className="border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 w-full sm:w-auto justify-center shrink-0"
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>Pivot to @{shownEmailLocalPart} Handle Scan</span>
            </Button>
          </Card>
        )}

      {/* Phone Website Account Audit Summary Strip */}
      {investigation.targetType === 'phone' && (
        <Card className="p-3.5 sm:p-4 border-indigo-200/70 dark:border-indigo-900/60 bg-gradient-to-r from-indigo-50/60 via-white to-slate-50/70 dark:from-indigo-950/25 dark:via-[#0E1526] dark:to-[#0B1120] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
            <div className="min-w-0 text-xs leading-relaxed">
              <p className="font-semibold text-[#0F172A] dark:text-slate-100">
                Phone Website Account Audit · Zero Unsolicited SMS Sent
              </p>
              <p className="text-slate-600 dark:text-slate-300 mt-0.5 tabular-nums">
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                  {foundResults.length} Account / Exposure Hit{foundResults.length === 1 ? '' : 's'}
                </span>
                {' · '}
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {verifiedCleanCount} Verified Not Registered
                </span>
                {' · '}
                <span className="text-slate-500 dark:text-slate-400">
                  {gatedAuditCount} OTP / Auth Gated
                </span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              variant={activeTab === 'registered' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => {
                playClickTick();
                setActiveTab('registered');
                setSelectedCategory('all');
                cardsSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="flex-1 sm:flex-initial justify-center"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Registered ({investigation.summary.registered})</span>
            </Button>
            <Button
              variant={activeTab === 'payments_ott' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => {
                playClickTick();
                setActiveTab('payments_ott');
                setPaymentOttFilter('all');
                setSelectedCategory('all');
                cardsSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="flex-1 sm:flex-initial justify-center"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Payments, UPI & OTT ({paymentOttResults.length})</span>
            </Button>
            <Button
              variant={activeTab === 'audit' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => {
                playClickTick();
                setActiveTab('audit');
                setAuditStatusFilter('all');
                setSelectedCategory('all');
                cardsSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="flex-1 sm:flex-initial justify-center"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>All Checked Websites ({auditResults.length})</span>
            </Button>
          </div>
        </Card>
      )}

      {/* Top Summary Cards: 5 Cards starting at 0 and counting up live */}
      <section
        aria-label="Summary metrics"
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5"
      >
        {summaryCards.map(({ label, sublabel, value, Icon }) => (
          <motion.div
            key={label}
            animate={value > 0 ? { scale: [1, 1.015, 1] } : undefined}
            transition={{ duration: 0.25 }}
            className="h-full"
          >
            <Card className="p-3.5 sm:p-5 flex flex-col justify-between gap-2 sm:gap-2.5 h-full">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100 truncate">
                  {label}
                </p>
                <span className="w-7 h-7 rounded-lg bg-[#F8FAFC] dark:bg-slate-800 border border-[#E5E7EB]/80 dark:border-slate-700 text-slate-400 flex items-center justify-center shrink-0">
                  <Icon className="w-3.5 h-3.5" />
                </span>
              </div>
              <span className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#0F172A] dark:text-slate-100 tabular-nums">
                <AnimatedCounter value={value} scanKey={investigation.scanId} />
              </span>
              <p className="text-[11px] text-slate-400 truncate">{sublabel}</p>
            </Card>
          </motion.div>
        ))}
      </section>

      {/* AI Executive Intelligence Summary (Word-stream reveal + sequential takeaway tiles) */}
      {(investigation.aiSummary || !isRunning) && (
        <Card className="p-5 sm:p-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <h2 className="font-display text-sm font-semibold text-[#0F172A] dark:text-slate-100">
                AI Executive Summary
              </h2>
              {investigation.aiSummary?.riskPosture && (
                <span
                  className={`text-[11px] font-semibold ${
                    investigation.aiSummary.riskPosture === 'Elevated'
                      ? 'text-rose-600 dark:text-rose-400'
                      : investigation.aiSummary.riskPosture === 'Moderate'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  · {investigation.aiSummary.riskPosture} Exposure Posture
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setAiOpen(true)}
              className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 cursor-pointer"
            >
              Ask follow-up question →
            </button>
          </div>

          {investigation.aiSummary ? (
            <div className="space-y-2.5">
              <StreamedBriefText
                text={
                  redactPii
                    ? maskPiiString(investigation.aiSummary.executiveBrief, true)
                    : investigation.aiSummary.executiveBrief
                }
              />
              {investigation.aiSummary.keyTakeaways.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1">
                  {investigation.aiSummary.keyTakeaways.slice(0, 3).map((t, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.24, delay: 0.15 + idx * 0.08 }}
                      className="p-3 rounded-xl bg-[#FAFAFA] dark:bg-[#0B1120] border border-[#E5E7EB]/80 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 leading-relaxed"
                    >
                      {redactPii ? maskPiiString(t, true) : t}
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                <span>Synthesizing cross-module intelligence brief...</span>
              </div>
              <button
                type="button"
                disabled={generatingAi}
                onClick={() => void handleGenerateAiSummary()}
                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 cursor-pointer disabled:opacity-50"
              >
                {generatingAi ? 'Generating...' : 'Generate now'}
              </button>
            </div>
          )}
        </Card>
      )}

      {/* Domain Attack Surface & Security Posture Card (Domain Scans) */}
      {domainSecurityPosture && (
        <Card className="p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span
                className={`w-11 h-11 rounded-xl flex items-center justify-center font-display text-lg font-extrabold border ${
                  domainSecurityPosture.grade.startsWith('A')
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                    : domainSecurityPosture.grade === 'B'
                    ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300'
                    : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                }`}
              >
                {domainSecurityPosture.grade}
              </span>
              <div>
                <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-slate-100 flex items-center gap-2">
                  <span>Domain Attack Surface & Security Posture</span>
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                    ({domainSecurityPosture.score}/100)
                  </span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Mail auth (SPF/DMARC/DKIM), HTTP security headers, disclosure files & crt.sh Certificate Transparency subdomains.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`px-2.5 py-1 rounded-lg border font-medium ${domainSecurityPosture.hasSpf ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300' : 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-300'}`}>
                SPF: {domainSecurityPosture.hasSpf ? 'Active' : 'Missing'}
              </span>
              <span className={`px-2.5 py-1 rounded-lg border font-medium ${domainSecurityPosture.hasDmarc ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300' : 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-300'}`}>
                DMARC: {domainSecurityPosture.hasDmarc ? 'Active' : 'Missing'}
              </span>
              <span className={`px-2.5 py-1 rounded-lg border font-medium ${domainSecurityPosture.dkimSelectors.length > 0 ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300' : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'}`}>
                DKIM: {domainSecurityPosture.dkimSelectors.length > 0 ? domainSecurityPosture.dkimSelectors.join(', ') : 'Unverified'}
              </span>
              <span className={`px-2.5 py-1 rounded-lg border font-medium ${domainSecurityPosture.securityTxtFound ? 'bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900 text-indigo-700 dark:text-indigo-300' : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'}`}>
                security.txt: {domainSecurityPosture.securityTxtFound ? 'Present' : 'Absent'}
              </span>
            </div>
          </div>

          {domainSecurityPosture.headerChecks.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
              {domainSecurityPosture.headerChecks.map((hc) => (
                <div
                  key={hc.key}
                  className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 ${
                    hc.present
                      ? 'bg-emerald-50/50 dark:bg-emerald-950/30 border-emerald-200/80 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-200'
                      : 'bg-slate-50/70 dark:bg-slate-900/50 border-slate-200/80 dark:border-slate-800 text-slate-500 dark:text-slate-400'
                  }`}
                >
                  <span className="font-medium truncate">{hc.label}</span>
                  {hc.present ? (
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  )}
                </div>
              ))}
            </div>
          )}

          {domainSecurityPosture.subdomains.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-indigo-600" />
                <span>
                  Certificate Transparency Subdomains ({domainSecurityPosture.subdomains.length}) — Click to Pivot
                </span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {domainSecurityPosture.subdomains.slice(0, 18).map((sub) => (
                  <button
                    key={sub}
                    type="button"
                    onClick={() => onPivotScan?.(sub, 'domain', investigation)}
                    className="px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 hover:border-indigo-400 text-[11px] font-mono text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                  >
                    {sub}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Typosquat & Lookalike Domain Radar (Domain Scans) */}
      {typosquatCandidates.length > 0 && (
        <TyposquatRadarCard
          domain={investigation.target}
          candidates={typosquatCandidates}
          onPivotDomain={(dom) => onPivotScan?.(dom, 'domain', investigation)}
        />
      )}

      {/* Username Permutation Pivot Chips (Username Scans) */}
      {usernamePermutations.length > 0 && (
        <Card className="p-5 sm:p-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-slate-100">
                Username Permutation Pivot Suggestions
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Common handle mutations probed against developer indexes—click any permutation to launch a live pivot scan.
              </p>
            </div>
            <span className="text-xs font-mono text-indigo-600 dark:text-indigo-400 tabular-nums">
              {usernamePermutations.filter((p) => p.githubExists).length} active on GitHub
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {usernamePermutations.map((perm) => (
              <button
                key={perm.handle}
                type="button"
                onClick={() => onPivotScan?.(perm.handle, 'username', investigation)}
                className={`px-3 py-1.5 rounded-xl border text-xs font-mono inline-flex items-center gap-2 transition-colors cursor-pointer ${
                  perm.githubExists
                    ? 'bg-emerald-50/75 dark:bg-emerald-950/35 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100/80'
                    : 'bg-slate-50 dark:bg-[#0B1120] border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-indigo-400'
                }`}
                title={perm.reason}
              >
                <Crosshair className="w-3 h-3 shrink-0" />
                <span>@{perm.handle}</span>
                {perm.githubExists && (
                  <span className="text-[10px] font-sans font-bold uppercase text-emerald-600 dark:text-emerald-400">
                    Active
                  </span>
                )}
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Permanent Dark Signal Correlation Flowchart */}
      <div ref={flowchartSectionRef}>
        <CorrelationFlowchart
          investigation={investigation}
          onSelectResult={(item) => setDrawerItem(item)}
          onSelectBranch={(b) => setFlowchartBranch(b)}
        />
      </div>

      {/* Main Content Section: Two Cards Side by Side */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
        {/* Left Card – Breached Accounts with Severity Strip & Real Site Favicons */}
        <Card className="p-4 sm:p-6 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-slate-100">
                  Breached Accounts
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Indexed security incidents connected to this target.
                </p>
              </div>
              <span className="text-xs text-slate-400 tabular-nums">
                {investigation.breachedAccounts.length} total
              </span>
            </div>

            {/* Dedicated Breach Exposure Severity Strip */}
            {breachSeverityStats.total > 0 && (
              <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-[#0B1120] border border-slate-200/70 dark:border-slate-800 space-y-2">
                <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden flex">
                  {breachSeverityStats.high > 0 && (
                    <div
                      style={{
                        width: `${(breachSeverityStats.high / breachSeverityStats.total) * 100}%`,
                      }}
                      className="bg-rose-500 h-full"
                    />
                  )}
                  {breachSeverityStats.medium > 0 && (
                    <div
                      style={{
                        width: `${(breachSeverityStats.medium / breachSeverityStats.total) * 100}%`,
                      }}
                      className="bg-amber-500 h-full"
                    />
                  )}
                  {breachSeverityStats.low > 0 && (
                    <div
                      style={{
                        width: `${(breachSeverityStats.low / breachSeverityStats.total) * 100}%`,
                      }}
                      className="bg-slate-400 h-full"
                    />
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] tabular-nums">
                  <div className="flex items-center gap-3">
                    <span className="text-rose-600 dark:text-rose-400 font-semibold">
                      High Risk: {breachSeverityStats.high}
                    </span>
                    <span className="text-amber-600 dark:text-amber-400 font-semibold">
                      Medium: {breachSeverityStats.medium}
                    </span>
                  </div>
                  {breachSeverityStats.passwordExposed > 0 && (
                    <span className="text-rose-600 dark:text-rose-400 font-medium">
                      {breachSeverityStats.passwordExposed} include password/hash data
                    </span>
                  )}
                </div>
              </div>
            )}

            {visibleBreaches.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400 border border-dashed border-[#E5E7EB] dark:border-slate-800 rounded-xl">
                {isRunning
                  ? 'Checking public breach & leak indexes...'
                  : 'No breached accounts detected in public indexes for this target.'}
              </div>
            ) : (
              <div className="divide-y divide-[#F1F5F9] dark:divide-slate-800">
                {visibleBreaches.map((breach) => {
                  const linkedResult =
                    investigation.results.find((r) => r.id === breach.resultId) ||
                    investigation.results.find(
                      (r) =>
                        r.platform.toLowerCase() ===
                        breach.platform.toLowerCase()
                    ) ||
                    investigation.results.find(
                      (r) => r.findingKind === 'breached'
                    );
                  return (
                    <div
                      key={breach.id}
                      className="w-full py-2.5 px-2.5 -mx-2.5 rounded-xl flex items-center justify-between gap-2 hover:bg-[#F8FAFC] dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (linkedResult) {
                            setDrawerItem(linkedResult);
                          } else {
                            onNotify({
                              type: 'info',
                              title: breach.breachName,
                              message: `Exposed: ${breach.dataClasses.join(', ') || 'Email record'}`,
                            });
                          }
                        }}
                        className="flex-1 min-w-0 flex items-center justify-between gap-3 text-left py-0.5 cursor-pointer"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <PlatformMark
                            platform={breach.platform}
                            domain={breach.domain}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-medium text-[#0F172A] dark:text-slate-100 truncate">
                                {breach.platform}
                              </p>
                              {breach.severity === 'high' && (
                                <span className="text-[10px] font-semibold uppercase text-rose-600 dark:text-rose-400 shrink-0">
                                  · High
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-400 truncate">
                              {breach.domain ? `${breach.domain} · ` : ''}
                              {breach.dataClasses.slice(0, 3).join(', ') || 'Indexed exposure'}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0 tabular-nums">
                          {breach.relativeTime}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-[#F1F5F9] dark:border-slate-800 flex items-center justify-center gap-1.5 text-xs">
            <button
              type="button"
              disabled={safeBreachPage <= 1}
              onClick={() => setBreachPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Previous</span>
            </button>

            {buildPageNumbers(safeBreachPage, totalBreachPages).map((p, i) =>
              p === 'ellipsis' ? (
                <span key={`be-${i}`} className="px-1.5 text-slate-400">
                  ...
                </span>
              ) : (
                <button
                  key={`bp-${p}`}
                  type="button"
                  onClick={() => setBreachPage(p)}
                  className={`w-7 h-7 rounded-lg text-xs font-medium tabular-nums transition-colors cursor-pointer ${
                    p === safeBreachPage
                      ? 'border border-[#E5E7EB] dark:border-slate-700 bg-[#FAFAFA] dark:bg-slate-800 text-[#0F172A] dark:text-white font-semibold'
                      : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {p}
                </button>
              )
            )}

            <button
              type="button"
              disabled={safeBreachPage >= totalBreachPages}
              onClick={() =>
                setBreachPage((p) => Math.min(totalBreachPages, p + 1))
              }
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </Card>

        {/* Right Card – Profile Pictures */}
        <Card className="p-4 sm:p-6 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-slate-100">
                  Profile Pictures
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Profile imagery resolved across public platforms.
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-xs text-slate-400 tabular-nums">
                  {investigation.profilePhotos.length} total
                </span>
              </div>
            </div>

            {visiblePhotos.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400 border border-dashed border-[#E5E7EB] dark:border-slate-800 rounded-xl">
                {isRunning
                  ? 'Resolving public profile avatars...'
                  : 'No public profile avatars were returned by checked platforms.'}
              </div>
            ) : (
              <div className="divide-y divide-[#F1F5F9] dark:divide-slate-800">
                {visiblePhotos.map((photo) => {
                  const linkedResult =
                    investigation.results.find(
                      (r) => r.id === photo.resultId || r.avatarUrl === photo.url
                    ) ||
                    investigation.results.find(
                      (r) =>
                        r.platform.toLowerCase() ===
                        photo.platform.toLowerCase()
                    );
                  return (
                    <div
                      key={photo.id}
                      className="py-3 px-2.5 -mx-2.5 rounded-xl flex items-center justify-between gap-3 hover:bg-[#F8FAFC] dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (linkedResult) {
                            setDrawerItem(linkedResult);
                          }
                        }}
                        className="flex items-center gap-3 min-w-0 text-left cursor-pointer"
                      >
                        <span className="relative w-10 h-10 rounded-full shrink-0 overflow-hidden border border-[#E5E7EB] dark:border-slate-700 bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                          <SafeAvatar
                            src={photo.url}
                            alt={`${photo.platform} avatar`}
                            className="w-full h-full object-cover"
                            fallback={
                              <PlatformMark
                                platform={photo.platform}
                                domain={linkedResult?.domain}
                                url={linkedResult?.url}
                                size="sm"
                              />
                            }
                          />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#0F172A] dark:text-slate-100 truncate">
                            {photo.platform}
                          </p>
                          {photo.handle && (
                            <p className="text-xs font-mono text-slate-400 truncate">
                              {photo.handle.includes('@')
                                ? maskPiiString(photo.handle, redactPii)
                                : `@${maskPiiString(photo.handle, redactPii)}`}
                            </p>
                          )}
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleDownloadPhoto(photo.id, photo.url, photo.platform)
                        }
                        aria-label={`Download ${photo.platform} image`}
                        className="p-2 rounded-lg text-slate-400 hover:text-[#0F172A] dark:hover:text-white hover:bg-white dark:hover:bg-slate-800 border border-transparent hover:border-[#E5E7EB] dark:hover:border-slate-700 transition-colors cursor-pointer shrink-0"
                      >
                        <AnimatePresence mode="wait">
                          {downloadedPhotoId === photo.id ? (
                            <motion.span
                              key="dl-done"
                              initial={{ scale: 0.7, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={{ scale: 0.7, opacity: 0 }}
                              transition={{ duration: 0.14 }}
                              className="inline-flex text-emerald-600"
                            >
                              <Check className="w-4 h-4" />
                            </motion.span>
                          ) : (
                            <motion.span
                              key="dl-idle"
                              initial={{ scale: 0.85, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              exit={{ scale: 0.85, opacity: 0 }}
                              transition={{ duration: 0.12 }}
                              className="inline-flex"
                            >
                              <Download className="w-4 h-4" />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-[#F1F5F9] dark:border-slate-800 flex items-center justify-center gap-1.5 text-xs">
            <button
              type="button"
              disabled={safePhotoPage <= 1}
              onClick={() => setPhotoPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Previous</span>
            </button>

            {buildPageNumbers(safePhotoPage, totalPhotoPages).map((p, i) =>
              p === 'ellipsis' ? (
                <span key={`pe-${i}`} className="px-1.5 text-slate-400">
                  ...
                </span>
              ) : (
                <button
                  key={`pp-${p}`}
                  type="button"
                  onClick={() => setPhotoPage(p)}
                  className={`w-7 h-7 rounded-lg text-xs font-medium tabular-nums transition-colors cursor-pointer ${
                    p === safePhotoPage
                      ? 'border border-[#E5E7EB] dark:border-slate-700 bg-[#FAFAFA] dark:bg-slate-800 text-[#0F172A] dark:text-white font-semibold'
                      : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {p}
                </button>
              )
            )}

            <button
              type="button"
              disabled={safePhotoPage >= totalPhotoPages}
              onClick={() =>
                setPhotoPage((p) => Math.min(totalPhotoPages, p + 1))
              }
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </Card>
      </section>

      {/* Google Account, Maps Reviews & Approximate Location Ring (Live-Native GHunt) */}
      {investigation.targetType === 'email' && ghuntIntel && (
        <GhuntProfileCard
          intel={ghuntIntel}
          redactPii={redactPii}
          onFocusMapLocation={handleFocusMapLocation}
        />
      )}

      {/* Geographic Distribution & Global Compromise Heatmap (react-leaflet) */}
      {(investigation.geoMarkers.length > 0 || investigations.length > 0) && (
        <div ref={geoSectionRef} className="space-y-3 scroll-mt-16">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-white/80 dark:bg-[#0E1526] border border-slate-200/80 dark:border-slate-800 text-xs">
              {investigation.geoMarkers.length > 0 && (
                <button
                  type="button"
                  onClick={() => setGeoViewMode('case')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    geoViewMode === 'case'
                      ? 'bg-[#0F172A] dark:bg-indigo-600 text-white'
                      : 'text-slate-500 dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white'
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>Case Geo Pins ({investigation.geoMarkers.length})</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setGeoViewMode('heatmap')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  geoViewMode === 'heatmap' || investigation.geoMarkers.length === 0
                    ? 'bg-[#0F172A] dark:bg-indigo-600 text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white'
                }`}
              >
                <Flame className="w-3.5 h-3.5" />
                <span>Global Compromise Heatmap</span>
              </button>
            </div>
          </div>

          {geoViewMode === 'case' && investigation.geoMarkers.length > 0 ? (
            <GeographicDistributionCard
              markers={investigation.geoMarkers}
              target={shownTarget}
              onExportGeo={handleExportGeo}
              focusRequest={geoFocusRequest}
            />
          ) : (
            <CompromiseHeatmap
              investigations={investigations}
              activeInvestigation={investigation}
              onOpenInvestigation={onOpenInvestigation}
            />
          )}
        </div>
      )}

      {/* Bharat Sovereign Registry & Public Compliance Pivots */}
      <BharatRegistryPivotCard
        target={shownTarget}
        targetType={investigation.targetType}
        createdAt={investigation.createdAt}
        redactPii={redactPii}
      />

      {/* Quick Action Bars: Separate Timeline Trigger + Deep Google Dorking Trigger */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {onOpenTimeline && (
          <Card className="p-4 sm:px-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-8 h-8 rounded-xl bg-orange-50 dark:bg-orange-950/50 border border-orange-200/80 dark:border-orange-900/60 text-orange-600 flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" />
              </span>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-semibold text-[#0F172A] dark:text-slate-100">
                  Chronological Breach & Signal Timeline
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  Opens in a dedicated timeline view with breach, commit & archive chronology.
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={onOpenTimeline} className="shrink-0">
              <Clock className="w-3.5 h-3.5 text-orange-600" />
              <span>Show Timeline</span>
            </Button>
          </Card>
        )}

        <Card className={`p-4 sm:px-5 flex flex-wrap items-center justify-between gap-4 ${onOpenTimeline ? '' : 'lg:col-span-2'}`}>
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200/80 dark:border-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <Terminal className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-semibold text-[#0F172A] dark:text-slate-100">
                Deep Google Dorking & Public Files
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                Query PDFs, spreadsheets, open directories & archives without re-running scans.
              </p>
            </div>
          </div>
          <Button
            variant="gradient"
            size="sm"
            disabled={dorkLoading}
            onClick={() => void handleShowGoogleDorking()}
            className="shrink-0"
          >
            {dorkLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Search className="w-3.5 h-3.5" />
            )}
            <span>
              {dorkLoading
                ? 'Running Deep Dorks...'
                : dorkReport
                ? 'Refresh Google Dorking Results'
                : 'Show Google Dorking Results'}
            </span>
          </Button>
        </Card>
      </div>

      {/* Deep Google Dorking Discovery Panel */}
      {(dorkOpen || dorkLoading || dorkReport) && (
        <div ref={dorkSectionRef} className="scroll-mt-6">
          <DeepGoogleDorkingCard
            target={investigation.target}
            targetType={investigation.targetType}
            report={dorkReport}
            loading={dorkLoading}
            error={dorkError}
            onRunDork={(kw) => void handleShowGoogleDorking(kw)}
          />
        </div>
      )}

      {/* Bottom Filter Tabs + Inline Search + Cards/Grouped Toggle */}
      <section ref={cardsSectionRef} className="space-y-5 pt-2 scroll-mt-20">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 sm:gap-4 border-b border-[#E5E7EB] dark:border-slate-800 pb-3">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-full pb-0.5">
            {(
              [
                {
                  id: 'all',
                  label: `All Results (${foundResults.length})`,
                },
                {
                  id: 'signals',
                  label: `Parmanu Signals (${brahmandSignalsCount})`,
                },
                {
                  id: 'registered',
                  label: `Registered Accounts (${investigation.summary.registered})`,
                },
                {
                  id: 'leaked',
                  label: `Leaked Results (${investigation.summary.leaked + investigation.summary.breached})`,
                },
                ...(investigation.targetType === 'phone'
                  ? [
                      {
                        id: 'payments_ott' as const,
                        label: `Payments, UPI & OTT (${paymentOttResults.length})`,
                      },
                    ]
                  : []),
                {
                  id: 'audit' as const,
                  label: `Site Audit (${auditResults.length})`,
                },
              ] as Array<{
                id: 'all' | 'signals' | 'registered' | 'leaked' | 'payments_ott' | 'audit';
                label: string;
              }>
            ).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    playClickTick();
                    setActiveTab(tab.id);
                    setSelectedCategory('all');
                  }}
                  className={`relative px-3.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    active
                      ? 'text-white'
                      : 'text-slate-500 dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="results-tab-pill"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                      className="absolute inset-0 rounded-xl bg-[#0F172A] dark:bg-indigo-600 -z-0"
                    />
                  )}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
            <select
              aria-label="Filter by analyst evidence tag"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value as 'all' | EvidenceTag)}
              className="h-9 px-3 rounded-xl bg-white/70 dark:bg-[#0E1526] backdrop-blur-md border border-white/40 dark:border-slate-700 ring-1 ring-slate-900/5 text-xs font-medium text-[#0F172A] dark:text-slate-100 focus:outline-none cursor-pointer w-full sm:w-auto"
            >
              <option value="all">All Tags</option>
              <option value="verified">Verified Only</option>
              <option value="needs_review">Needs Review</option>
              <option value="false_positive">False Positive</option>
            </select>

            {availableCategories.length > 1 && (
              <select
                aria-label="Filter by category"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="h-9 px-3 rounded-xl bg-white/70 dark:bg-[#0E1526] backdrop-blur-md border border-white/40 dark:border-slate-700 ring-1 ring-slate-900/5 text-xs font-medium text-[#0F172A] dark:text-slate-100 focus:outline-none focus:border-slate-400 cursor-pointer w-full sm:w-auto"
              >
                <option value="all">All Categories</option>
                {availableCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            )}

            <div className="relative flex-1 sm:w-52">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Search results..."
                className="w-full h-9 pl-8 pr-3 rounded-xl bg-white/70 dark:bg-[#0E1526] backdrop-blur-md border border-white/40 dark:border-slate-700 ring-1 ring-slate-900/5 text-xs text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-slate-400"
              />
            </div>

            <div className="inline-flex items-center p-0.5 rounded-xl bg-white/70 dark:bg-[#0E1526] backdrop-blur-md border border-white/40 dark:border-slate-700 ring-1 ring-slate-900/5 shrink-0">
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`relative px-2.5 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                  viewMode === 'cards'
                    ? 'text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white'
                }`}
              >
                {viewMode === 'cards' && (
                  <motion.span
                    layoutId="results-view-pill"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-lg bg-[#0F172A] dark:bg-indigo-600 -z-0"
                  />
                )}
                <List className="relative z-10 w-3.5 h-3.5" />
                <span className="relative z-10">Cards</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('grouped')}
                className={`relative px-2.5 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                  viewMode === 'grouped'
                    ? 'text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white'
                }`}
              >
                {viewMode === 'grouped' && (
                  <motion.span
                    layoutId="results-view-pill"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-lg bg-[#0F172A] dark:bg-indigo-600 -z-0"
                  />
                )}
                <LayoutGrid className="relative z-10 w-3.5 h-3.5" />
                <span className="relative z-10">Grouped</span>
              </button>
            </div>
          </div>
        </div>

        {/* Active Flowchart Cross-Filter Chip */}
        {flowchartBranch !== 'all' && (
          <div className="px-4 py-2 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900/60 flex items-center justify-between gap-2 text-xs">
            <span className="text-indigo-900 dark:text-indigo-200 font-medium">
              Cross-filtered by Correlation Flowchart branch:{' '}
              <span className="uppercase font-mono font-semibold">{flowchartBranch}</span>
            </span>
            <button
              type="button"
              onClick={() => setFlowchartBranch('all')}
              className="font-semibold text-indigo-600 dark:text-indigo-300 hover:underline cursor-pointer"
            >
              Reset Branch Filter
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-slate-100">
              {activeTab === 'signals'
                ? 'Parmanu Signals'
                : activeTab === 'registered'
                ? 'Registered Accounts'
                : activeTab === 'leaked'
                ? 'Leaked & Breached Results'
                : activeTab === 'payments_ott'
                ? 'Payments, UPI VPAs, OTT Streaming & LPG Utilities'
                : activeTab === 'audit'
                ? investigation.targetType === 'phone'
                  ? 'Checked Websites Account Status'
                  : 'Scanned Websites Audit Log'
                : 'All results'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {activeTab === 'payments_ott'
                ? 'Live payment gateways (PayPal.Me, Razorpay.me, Instamojo), NPCI UPI handles, OTT platforms & LPG/utility portals checked with zero unsolicited SMS OTPs.'
                : activeTab === 'audit'
                ? investigation.targetType === 'phone'
                  ? 'Not Registered sites confirmed no account exists via passive pre-OTP lookup; OTP / Auth Gated services require a live user SMS OTP.'
                  : 'Zero-false-positive attribution: Verified Clean sites confirmed no account exists; Auth/WAF Gated sites require sign-in or block unauthenticated checks.'
                : 'Click Inspect on any card for split-pane evidence tagging, analyst notes & one-click pivot scans.'}
            </p>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {activeTab === 'audit'
              ? investigation.targetType === 'phone'
                ? `${verifiedCleanCount} Not Registered · ${gatedAuditCount} OTP / Auth Gated`
                : `${verifiedCleanCount} Verified Clean · ${gatedAuditCount} Auth/WAF Gated`
              : `Showing ${tabResults.length} finding${tabResults.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {activeTab === 'payments_ott' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 px-3 sm:px-4 py-2.5 rounded-xl bg-slate-50/80 dark:bg-slate-900/60 border border-[#E5E7EB] dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'all', label: `All Payment, OTT & LPG (${paymentOttResults.length})` },
                    {
                      id: 'upi',
                      label: `UPI & Payment Apps (${
                        paymentOttResults.filter((r) => classifyPaymentOttBucket(r) === 'upi').length
                      })`,
                    },
                    {
                      id: 'ott',
                      label: `OTT & Streaming (${
                        paymentOttResults.filter((r) => classifyPaymentOttBucket(r) === 'ott').length
                      })`,
                    },
                    {
                      id: 'lpg',
                      label: `LPG & Utilities (${
                        paymentOttResults.filter((r) => classifyPaymentOttBucket(r) === 'lpg').length
                      })`,
                    },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setPaymentOttFilter(f.id)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      paymentOttFilter === f.id
                        ? 'bg-[#0F172A] dark:bg-indigo-600 text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              {totalAuditPages > 1 && (
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <button
                    type="button"
                    disabled={safeAuditPage <= 1}
                    onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-white dark:hover:bg-slate-800 cursor-pointer disabled:cursor-not-allowed"
                    aria-label="Previous payment/OTT page"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="tabular-nums font-medium">
                    Page {safeAuditPage} of {totalAuditPages}
                  </span>
                  <button
                    type="button"
                    disabled={safeAuditPage >= totalAuditPages}
                    onClick={() => setAuditPage((p) => Math.min(totalAuditPages, p + 1))}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-white dark:hover:bg-slate-800 cursor-pointer disabled:cursor-not-allowed"
                    aria-label="Next payment/OTT page"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {derivedUpiHandles.length > 0 && (paymentOttFilter === 'all' || paymentOttFilter === 'upi') && (
              <Card className="p-4 space-y-2.5 border-indigo-200/70 dark:border-indigo-900/60 bg-white/85 dark:bg-[#0E1526]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100">
                    Derived NPCI UPI VPA Handles (Zero-OTP Quick Copy)
                  </p>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Click any VPA handle to copy for manual app lookup
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {derivedUpiHandles.map((u) => {
                    const displayHandle = redactPii ? maskPiiString(u.handle, true) : u.handle;
                    const isCopied = copiedVpa === u.handle;
                    return (
                      <button
                        key={u.handle}
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(u.handle);
                          setCopiedVpa(u.handle);
                          window.setTimeout(() => setCopiedVpa((p) => (p === u.handle ? null : p)), 1500);
                        }}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 hover:border-indigo-400 text-left transition-colors cursor-pointer"
                      >
                        <div className="min-w-0">
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">{u.app}</p>
                          <p className="font-mono text-xs font-medium text-[#0F172A] dark:text-slate-100 truncate">
                            {displayHandle}
                          </p>
                        </div>
                        {isCopied ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 sm:px-4 py-2.5 rounded-xl bg-slate-50/80 dark:bg-slate-900/60 border border-[#E5E7EB] dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'all', label: `All Checked (${auditResults.length})` },
                  {
                    id: 'not_found',
                    label:
                      investigation.targetType === 'phone'
                        ? `Not Registered (${verifiedCleanCount})`
                        : `Verified Clean (${verifiedCleanCount})`,
                  },
                  {
                    id: 'not_checked',
                    label:
                      investigation.targetType === 'phone'
                        ? `OTP / Auth Gated (${gatedAuditCount})`
                        : `Auth / WAF Gated (${gatedAuditCount})`,
                  },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setAuditStatusFilter(f.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    auditStatusFilter === f.id
                      ? 'bg-[#0F172A] dark:bg-indigo-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {totalAuditPages > 1 && (
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <button
                  type="button"
                  disabled={safeAuditPage <= 1}
                  onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-white dark:hover:bg-slate-800 cursor-pointer disabled:cursor-not-allowed"
                  aria-label="Previous audit page"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="tabular-nums font-medium">
                  Page {safeAuditPage} of {totalAuditPages}
                </span>
                <button
                  type="button"
                  disabled={safeAuditPage >= totalAuditPages}
                  onClick={() => setAuditPage((p) => Math.min(totalAuditPages, p + 1))}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:bg-white dark:hover:bg-slate-800 cursor-pointer disabled:cursor-not-allowed"
                  aria-label="Next audit page"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {tabResults.length === 0 ? (
          <Card className="p-12 text-center space-y-2">
            <p className="text-sm font-semibold text-[#0F172A] dark:text-slate-100">
              {isRunning ? 'Collecting live OSINT signals...' : 'No matching findings'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isRunning
                ? 'Cards populate automatically below as each module completes.'
                : 'Adjust your search filter or switch tabs above to inspect verified accounts and checked websites.'}
            </p>
          </Card>
        ) : activeTab === 'payments_ott' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleAuditResults.map((item) => (
                <ResultCard
                  key={item.id}
                  item={item}
                  annotation={annotations[item.id]}
                  redactPii={redactPii}
                  highlighted={item.status === 'found'}
                  isNewInRescan={Boolean(rescanDiff?.addedResultIds.has(item.id))}
                  onSelect={(selected) => setDrawerItem(selected)}
                />
              ))}
            </div>
            {totalAuditPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E5E7EB] dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                <span className="tabular-nums">
                  Showing {(safeAuditPage - 1) * AUDIT_PAGE_SIZE + 1}–
                  {Math.min(safeAuditPage * AUDIT_PAGE_SIZE, tabResults.length)} of{' '}
                  {tabResults.length.toLocaleString()} Payment, OTT & LPG portals
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={safeAuditPage <= 1}
                    onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Previous</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={safeAuditPage >= totalAuditPages}
                    onClick={() => setAuditPage((p) => Math.min(totalAuditPages, p + 1))}
                  >
                    <span>Next</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : activeTab === 'audit' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {visibleAuditResults.map((item) => {
                const isClean = item.status === 'not_found';
                const isPhone = investigation.targetType === 'phone';
                const host =
                  resolveSiteDomain(item.platform, item.domain, item.url) || '';
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setDrawerItem(item)}
                    className="text-left p-3.5 rounded-xl bg-white/80 dark:bg-[#0E1526] border border-[#E5E7EB] dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-colors flex items-start gap-3 cursor-pointer"
                  >
                    <PlatformMark
                      platform={item.platform}
                      domain={item.domain}
                      url={item.url}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100 truncate">
                          {item.platform}
                        </p>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-md shrink-0 ${
                            isClean
                              ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-900/60'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {isClean
                            ? isPhone
                              ? 'Not Registered'
                              : 'Verified Clean'
                            : isPhone
                            ? 'OTP / Auth Gated'
                            : 'Auth / WAF Gated'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate">
                        {host ? `${host} · ` : ''}
                        {item.category}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
                        {item.summary ||
                          (isClean
                            ? 'No account registered.'
                            : isPhone
                            ? 'Requires live SMS OTP or authenticated session.'
                            : 'Endpoint gated.')}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
            {totalAuditPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E5E7EB] dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                <span className="tabular-nums">
                  Showing {(safeAuditPage - 1) * AUDIT_PAGE_SIZE + 1}–
                  {Math.min(safeAuditPage * AUDIT_PAGE_SIZE, tabResults.length)} of{' '}
                  {tabResults.length.toLocaleString()} checked websites
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={safeAuditPage <= 1}
                    onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Previous</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={safeAuditPage >= totalAuditPages}
                    onClick={() => setAuditPage((p) => Math.min(totalAuditPages, p + 1))}
                  >
                    <span>Next</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : viewMode === 'cards' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tabResults.map((item, idx) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.22,
                  delay: isRunning ? Math.min((idx % 6) * 0.04, 0.2) : 0,
                  ease: 'easeOut',
                }}
              >
                <ResultCard
                  item={item}
                  annotation={annotations[item.id]}
                  redactPii={redactPii}
                  highlighted={flowchartBranch !== 'all'}
                  isNewInRescan={Boolean(rescanDiff?.addedResultIds.has(item.id))}
                  onSelect={(selected) => setDrawerItem(selected)}
                />
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            {groupedByCategory.map(([category, items]) => (
              <Card key={category} className="p-5 space-y-4">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#F1F5F9] dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-[#0F172A] dark:text-slate-100">
                      {category}
                    </h3>
                    <span className="text-xs text-slate-400 tabular-nums">
                      {items.length}
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    <span>Verified</span>
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {items.map((item) => {
                    const isExposed =
                      item.findingKind === 'breached' ||
                      item.findingKind === 'leaked';
                    const host =
                      resolveSiteDomain(item.platform, item.domain, item.url) ||
                      item.handle ||
                      '';

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setDrawerItem(item)}
                        className={`relative p-3.5 rounded-xl border text-center flex flex-col items-center justify-center gap-2 transition-all cursor-pointer hover:shadow-xs ${
                          isExposed
                            ? 'bg-rose-50/30 dark:bg-rose-950/25 border-rose-200/80 dark:border-rose-900/60 hover:border-rose-300'
                            : 'bg-emerald-50/20 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-900/60 hover:border-emerald-300'
                        }`}
                      >
                        <span
                          className={`absolute top-2.5 right-2.5 w-2 h-2 rounded-full ${
                            isExposed ? 'bg-rose-500' : 'bg-emerald-500'
                          }`}
                        />
                        <PlatformMark
                          platform={item.platform}
                          domain={item.domain}
                          url={item.url}
                          size="sm"
                        />
                        <div className="min-w-0 w-full">
                          <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100 truncate">
                            {item.platform}
                          </p>
                          {host && (
                            <p className="text-[11px] text-slate-400 truncate mt-0.5">
                              {maskPiiString(host, redactPii)}
                            </p>
                          )}
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                            isExposed ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          <Check className="w-3 h-3" />
                          <span>
                            {isExposed
                              ? item.findingKind === 'breached'
                                ? 'Breached'
                                : 'Leaked'
                              : 'Registered'}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Split-Pane Record Inspector Drawer */}
      <RecordInspectorDrawer
        item={drawerItem}
        annotation={drawerItem ? annotations[drawerItem.id] : undefined}
        redactPii={redactPii}
        onClose={() => setDrawerItem(null)}
        onOpenFullDetail={(item) => {
          setDrawerItem(null);
          onSelectResult(item);
        }}
        onUpdateAnnotation={handleUpdateAnnotation}
        onPivotScan={(target, targetType) => {
          setDrawerItem(null);
          onPivotScan?.(target, targetType, investigation);
        }}
      />

      <AiAnalystDialog
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        investigation={investigation}
        onUpdateInvestigation={onUpdateInvestigation}
      />

      <DossierDialog
        open={dossierOpen}
        onClose={() => setDossierOpen(false)}
        investigation={investigation}
        annotations={annotations}
        caseNote={caseNote}
        dorkReport={dorkReport}
        defaultRedactPii={redactPii}
        onNotify={onNotify}
      />
    </motion.div>
  );
}
