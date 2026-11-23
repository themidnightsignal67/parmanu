import { useEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useScroll,
  useSpring,
  useTransform,
  type Variants,
} from 'motion/react';
import {
  ArrowRight,
  AtSign,
  Bell,
  ChevronDown,
  Cpu,
  FileCheck2,
  FileUp,
  GitBranch,
  Globe,
  HelpCircle,
  Lock,
  MapPin,
  Music,
  Network,
  Phone,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  User,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  getDefaultToolsForTarget,
  INVESTIGATION_TOOLS,
  TOOL_BY_ID,
} from '@/src/data/tools';
import { detectTargetTypeFromInput } from '@/src/lib/api';
import {
  isMusicEnabled,
  isSoundEnabled,
  playClickTick,
  subscribeAudioState,
  toggleMusicEnabled,
  toggleSoundEnabled,
} from '@/src/lib/sound';
import {
  BatchExtractorShowcase,
  FlowchartShowcase,
  HeroWorkspaceShowcase,
  ResultsAiShowcase,
  TelemetryCollabShowcase,
} from '@/src/components/home/LandingShowcases';
import { DynamicHeroBackdrop } from '@/src/components/home/DynamicHeroBackdrop';
import { InteractiveCursorDemo } from '@/src/components/home/InteractiveCursorDemo';
import { SignalTransferCinematic } from '@/src/components/home/SignalTransferCinematic';
import { Button } from '@/src/components/ui/Button';
import { Dialog } from '@/src/components/ui/Dialog';
import { IndianFlag } from '@/src/components/ui/IndianFlag';
import { ParmanuLogo } from '@/src/components/ui/ParmanuLogo';

interface HomePageProps {
  isSignedIn: boolean;
  userEmail?: string;
  signingIn: boolean;
  onStartSearching: () => void;
  onSignIn: () => Promise<void>;
  onOpenModules: () => void;
}

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

const heroContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.12,
      delayChildren: 0.06,
    },
  },
};

const heroItemVariants: Variants = {
  hidden: { opacity: 0, y: 24, filter: 'blur(6px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: {
      duration: 0.78,
      ease: EASE_OUT_EXPO,
    },
  },
};

const sectionRevealVariants: Variants = {
  hidden: { opacity: 0, y: 28, filter: 'blur(5px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: {
      duration: 0.82,
      ease: EASE_OUT_EXPO,
    },
  },
};

const staggerGridVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.14,
      delayChildren: 0.08,
    },
  },
};

const staggerCardVariants: Variants = {
  hidden: { opacity: 0, y: 26, scale: 0.97, filter: 'blur(4px)' },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: {
      duration: 0.85,
      ease: EASE_OUT_EXPO,
    },
  },
};

type ShowcaseKind = 'hero' | 'flowchart' | 'results' | 'batch' | 'telemetry';

function ShowcaseRenderer({ kind }: { kind: ShowcaseKind }) {
  if (kind === 'hero') return <HeroWorkspaceShowcase />;
  if (kind === 'flowchart') return <FlowchartShowcase />;
  if (kind === 'results') return <ResultsAiShowcase />;
  if (kind === 'batch') return <BatchExtractorShowcase />;
  return <TelemetryCollabShowcase />;
}

const PRODUCT_TOUR_CARDS: Array<{
  id: string;
  kicker: string;
  title: string;
  description: string;
  highlights: string;
  showcase: ShowcaseKind;
}> = [
  {
    id: 'flowchart',
    kicker: '01 · Dark Signal Correlation Flowchart',
    title: 'Map every linked account, leak, and geo node visually',
    description:
      'Every search renders a zoomable, draggable dark relationship graph connecting the target root to verified platforms, leaked exposures, Google Dork hits, and geographic markers—with Flow Tree & Constellation views plus Fullscreen inspection.',
    highlights: 'Flow Tree & Constellation · 45%–250% Zoom · Fullscreen Mode',
    showcase: 'flowchart',
  },
  {
    id: 'results',
    kicker: '02 · Live Streaming, Dorking & Breach Timeline',
    title: 'Odometer counters + Google Dorking + Breach Timeline',
    description:
      'Counters climb live from zero while platform cards display real favicons, GHunt links, consolidated GitHub commit diffs, a chronological breach & signal timeline, AI executive briefs, and an on-demand Google Dorking bar.',
    highlights: 'Deep Google Dorking · Breach Timeline · 9-key AI failover',
    showcase: 'results',
  },
  {
    id: 'batch',
    kicker: '03 · Universal Any-File Batch Extraction',
    title: 'Drop CSV, JSON, PDF, DOCX, logs, or raw dumps to scan at scale',
    description:
      'Upload any file up to 15 MB or paste raw incident text. Parmanu automatically extracts every valid email, username, domain, IP address, and phone number into a parallel multi-worker queue with one-click CSV and JSON export.',
    highlights: '1–3 concurrent workers · Zero target limits · CSV & JSON reports',
    showcase: 'batch',
  },
  {
    id: 'telemetry',
    kicker: '04 · Watchlists, Geo Maps & Team Collaboration',
    title: 'Conditional MapTiler maps & Google-synced team workspaces',
    description:
      'When geographic coordinates exist in ASN, WHOIS, or profile metadata, Parmanu plots an interactive MapTiler street map (with dark-mode support). Invite teammates via Google Sign-In, export PNG case cards, and run watchlist re-scans anytime.',
    highlights: 'Conditional MapTiler map · Google collaborator sharing · PNG snapshots',
    showcase: 'telemetry',
  },
];

const IDENTIFIER_PIPELINES = [
  {
    type: 'Email Addresses',
    sample: 'arjun.sharma@company.in',
    Icon: AtSign,
    summary:
      'Dispatches MailAccess (MX/SPF/DMARC, Gravatar, GitHub commit emails, OpenPGP), Holehe registration checks, GHunt Profile & Maps links, XposedOrNot breach timelines, and on-demand Google Dorking.',
    modules: 'MailAccess · Holehe · GHunt · Maigret · Blackbird · Sherlock',
  },
  {
    type: 'Usernames & Handles',
    sample: '@torvalds',
    Icon: User,
    summary:
      'Scans 325+ developer, gaming, education, cloud hosting, AI, and social platforms (GitHub, Replit, Render, Vercel, Duolingo, Quizizz, Kahoot, CrazyGames) and consolidates repository diffs.',
    modules: 'MailAccess · Maigret · Blackbird · Sherlock',
  },
  {
    type: 'Domains & Infrastructure',
    sample: 'github.com',
    Icon: Globe,
    summary:
      'Inspects live DNS A/AAAA/MX/TXT/NS/DMARC records, TLS certificate chains, RDAP/WHOIS registrar metadata, security headers, server IP geolocation, and site: Google Dorking.',
    modules: 'MailAccess Infrastructure · DNS · TLS · RDAP',
  },
  {
    type: 'IPv4 / IPv6 Addresses',
    sample: '8.8.8.8',
    Icon: Network,
    summary:
      'Resolves ASN ownership, ISP organization, reverse PTR records, routing blocks, exposed file/index dorks, and live geographic coordinates for conditional map plotting.',
    modules: 'MailAccess IP Telemetry · ASN · Geo Pinning',
  },
  {
    type: 'International Phone Numbers',
    sample: '+919876543210',
    Icon: Phone,
    summary:
      'Normalizes dialing formats, checks TRAI telecom circles, OVH VoIP & 370+ Ignorant website probes, with optional opt-in PhoneInfoga multi-format Google Dorking across PDFs, XLSX/CSV sheets, and archives.',
    modules: 'MailAccess · PhoneInfoga (Opt-In Dorks) · Ignorant',
  },
];

const WORKFLOW_SPOTLIGHTS: Array<{
  id: string;
  label: string;
  title: string;
  description: string;
  metrics: string;
  showcase: ShowcaseKind;
}> = [
  {
    id: 'cases',
    label: 'Live Workspace',
    title: 'Zero-to-live counters + permanent correlation graph',
    description:
      'As soon as you launch an authorized search, Parmanu opens the results canvas at zero and streams platform cards, breached site icons, profile avatars, dark correlation nodes, and on-demand Google Dorking in real time.',
    metrics: '8 parallel adapters · 365+ websites checked · Real-time count-up',
    showcase: 'hero',
  },
  {
    id: 'collab',
    label: 'Batch & Team',
    title: 'Universal file extraction, watchlists & teammate sharing',
    description:
      'Drop spreadsheets, PDFs, or server logs in Batch Mode to extract hundreds of identifiers, collaborate live with Google Sign-In teammates, and track ongoing exposures in Monitoring.',
    metrics: 'Cloud Firestore sync · PNG case snapshots · Multi-format batch queue',
    showcase: 'batch',
  },
  {
    id: 'ai',
    label: 'AI & Dorking',
    title: 'Executive AI briefs, Deep Google Dorking & interactive Q&A',
    description:
      'Once modules settle, Parmanu’s 3-key rotating AI engine synthesizes a concise executive brief grounded in verified telemetry—paired with one-click Deep Google Dorking across PDFs, spreadsheets, pastes, and web records.',
    metrics: '3-key AI failover · Deep Google Dorking · Pivot keyword refinement',
    showcase: 'results',
  },
];

const HOW_TO_STEPS = [
  {
    step: '01',
    title: 'Collide the signal',
    description:
      'Enter any authorized username, email address, domain, IP, or E.164 phone number—or drop any CSV, JSON, PDF, DOCX, or log file in Batch Mode.',
    detail: 'Auto-detected target routing isolates the exact OSINT pipeline.',
  },
  {
    step: '02',
    title: 'Inspect the graph & dorks',
    description:
      'Watch KPI counters climb from zero while the dark Signal Correlation Flowchart, platform cards, PhoneInfoga web/file hits, and Deep Google Dorking stream in.',
    detail: 'Click Show Google Dorking Results anytime without re-running scans.',
  },
  {
    step: '03',
    title: 'Synthesize & collaborate',
    description:
      'Review the automated AI Analyst executive brief, export clean JSON, CSV, or PNG snapshots, share cases with teammates, and set Monitoring watchlists.',
    detail: '1 guest search/day · 2/day signed in · VIP whitelisted unlimited.',
  },
];

const FAQS = [
  {
    q: 'Is using Parmanu legal in India and globally?',
    a: 'Yes—when used for authorized investigations, threat defense, due diligence, journalism, academic research, or auditing your own digital footprint. Parmanu performs passive Open-Source Intelligence (OSINT) strictly on publicly reachable endpoints and never bypasses logins, cracks passwords, or sends unauthorized OTPs, operating in alignment with India’s DPDP Act 2023 (Section 3(c)(ii) publicly available data exemption), Constitution Article 19(1)(a), BSA 2023 Section 63, and IT Act 2000 defensive boundaries.',
  },
  {
    q: 'Where does Parmanu get its data from?',
    a: 'Every result is resolved on-demand from publicly accessible web records, open network and domain registries, public caller reputation and breach disclosure notices, and standard web search indexes—never from private shadow databases, leaked banking silos, or unauthorized intrusions.',
  },
  {
    q: 'Why do OAuth-gated sites or certain private profiles mark as Inconclusive?',
    a: 'Platforms protected by third-party sign-in gates or strict anti-enumeration controls do not disclose account existence passively. Rather than guessing or sending password-reset prompts, Parmanu transparently flags them as Inconclusive and checks only publicly published deployments, avatars, or contributor traces.',
  },
  {
    q: 'What phone, payment, OTT, and utility checks run without sending SMS OTPs?',
    a: 'Phone investigations normalize international dialing formats and passively inspect telecom numbering metadata, public caller-reputation notices, UPI handle mappings, gateway storefronts, streaming portals, and LPG/utility web portals—strictly without dispatching SMS OTPs or triggering authentication alerts.',
  },
  {
    q: 'How do daily search credits and Google Sign-In tiers work?',
    a: 'Guest browsers receive 1 live investigation per day. Signing in with Google unlocks 2 daily search credits, persistent case history, Watchlists, and teammate sharing, while VIP-whitelisted analyst accounts receive unlimited access.',
  },
  {
    q: 'How does Show Google Dorking Results work without re-running a scan?',
    a: 'Every results view includes an on-demand Show Google Dorking Results bar. Clicking it queries public web indexes and document archives for your active target—plus custom pivot keywords—without restarting your main scan.',
  },
  {
    q: 'When does the geographic map appear and how are exported PDFs formatted?',
    a: 'The interactive map appears whenever real geographic coordinates (host locations, regional telecom series, or public review pins) exist. Exports generate a multi-page branded Parmanu Intelligence · Midnight Industries PDF dossier with optional one-click PII masking.',
  },
];

const INDIAN_OSINT_LAWS = [
  {
    index: '01',
    statute: 'Constitution of India · Art. 19(1)(a) & Art. 21',
    title: 'Right to Public Information & Privacy Balance',
    summary:
      'Article 19(1)(a) protects the freedom to receive and impart publicly accessible facts, research, and journalism. Balanced against Article 21 privacy safeguards in Justice K.S. Puttaswamy (Retd.) v. Union of India (2017), lawful passive observation of open public disclosures remains distinct from unlawful surveillance.',
  },
  {
    index: '02',
    statute: 'DPDP Act, 2023 · Section 3(c)(ii)',
    title: 'Publicly Available Personal Data Exemption',
    summary:
      'Under Section 3(c)(ii) of India’s Digital Personal Data Protection Act, 2023, statutory obligations of notice and consent do not apply to personal data that is made publicly available by the Data Principal themselves or published under an obligation of law.',
  },
  {
    index: '03',
    statute: 'IT Act, 2000 · Sec. 43, 66, 66B, 66C & 70B',
    title: 'Passive Defense vs. Unauthorized Access (CERT-In)',
    summary:
      'Sections 43, 66, 66B, and 66C penalize unauthorized system access, credential theft, or identity impersonation—not authorized passive lookups on open public records. Section 70B and CERT-In Directions (2022) mandate incident triage and defensive breach verification.',
  },
  {
    index: '04',
    statute: 'Bharatiya Sakshya Adhiniyam (BSA), 2023 · Sec. 63',
    title: 'Admissible Electronic Evidence & Cyber Forensics',
    summary:
      'Section 63 of the Bharatiya Sakshya Adhiniyam, 2023 (succeeding IEA Section 65B) governs certification of electronic records with documented hashes and timestamps—allowing compliance teams and cyber investigators to preserve verifiable digital audit trails.',
  },
  {
    index: '05',
    statute: 'Bharatiya Nyaya Sanhita (BNS), 2023 · Public Good & Truth Exceptions',
    title: 'Lawful Due Diligence, Journalism & Cyber Fraud Triage',
    summary:
      'BNS Section 356(2) protects truthful imputations made in good faith for the public good, alongside anti-fraud and cyber-cheating provisions under Section 318—supporting legitimate OSINT due diligence, fact-checking, and scam verification when conducted without harassment or extortion.',
  },
  {
    index: '06',
    statute: 'Telecommunications Act, 2023 & TRAI Zero-OTP Compliance',
    title: 'Passive Numbering Telemetry Without Unsolicited Alerts',
    summary:
      'Parmanu strictly separates passive public telecom numbering lookup from unauthorized interception or SMS spoofing under the Telecommunications Act, 2023—guaranteeing zero unsolicited OTP floods, zero SIM interrogation, and zero carrier signaling intrusion.',
  },
];

type LegalModalKey = 'privacy' | 'terms' | 'aup' | 'disclosure';

const LEGAL_MODAL_DOCS: Record<
  LegalModalKey,
  { title: string; subtitle: string; sections: Array<{ heading: string; body: string }> }
> = {
  privacy: {
    title: 'Privacy & Data Processing Policy',
    subtitle: 'Parmanu by Midnight Industries · Zero Shadow-Database Commitment',
    sections: [
      {
        heading: '1. Live Passive Resolution Only',
        body: 'Parmanu does not operate an illicit private person-dossier database. Searches execute on-demand against live public web endpoints, DNS/RDAP registries, developer APIs, and public search indexes.',
      },
      {
        heading: '2. Workspace Storage & Redaction',
        body: 'Signed-in analysts choose whether to save cases in Cloud Firestore. Every results canvas supports one-click PII masking before exporting PDFs, STIX 2.1 bundles, JSON reports, or PNG snapshots.',
      },
      {
        heading: '3. Telemetry & Quota Attestation',
        body: 'Daily quota enforcement stores only hashed client/IP credit counters so guest and signed-in usage limits operate fairly without tracking unrelated browsing activity.',
      },
    ],
  },
  terms: {
    title: 'Terms of Authorized Use',
    subtitle: 'Midnight Industries · Governed by Applicable Indian & International Law',
    sections: [
      {
        heading: '1. Authorized Investigations Only',
        body: 'You may query identifiers only for lawful cybersecurity defense, fraud prevention, threat intelligence, journalist/academic verification with public interest, or personal exposure auditing.',
      },
      {
        heading: '2. Strict Prohibition of Harassment or Doxxing',
        body: 'Using Parmanu outputs for stalking, extortion, intimidation, identity theft, or unauthorized profiling violates these Terms and is prohibited under Indian penal and IT statutes.',
      },
      {
        heading: '3. Accuracy & Verification Responsibility',
        body: 'OSINT signals reflect real-time public responses. Analysts must independently corroborate findings before making legal, employment, or enforcement decisions.',
      },
    ],
  },
  aup: {
    title: 'Acceptable Use & Zero-OTP Policy',
    subtitle: 'Engineering Safeguards Enforced Across Every Module',
    sections: [
      {
        heading: '1. Zero-SMS / Zero-OTP Guarantee',
        body: 'Parmanu prohibits triggering SMS OTP floods, account lockout attempts, or password-reset spam. Phone, UPI, OTT, and utility checks strictly inspect passive pre-OTP endpoints or public directories.',
      },
      {
        heading: '2. Respect for Upstream Anti-Enumeration',
        body: 'When a platform enforces Google/GitHub OAuth, CAPTCHA, or WAF protection (such as Lovable), Parmanu classifies the probe honestly as Inconclusive rather than attempting bypasses.',
      },
    ],
  },
  disclosure: {
    title: 'Responsible Security Disclosure',
    subtitle: 'Midnight Industries Security Response · /.well-known/security.txt',
    sections: [
      {
        heading: '1. Reporting Vulnerabilities',
        body: 'Security researchers discovering issues in Parmanu infrastructure or APIs can contact Midnight Industries via security@midnightindustries.in as published in /.well-known/security.txt.',
      },
      {
        heading: '2. Good-Faith Safe Harbor',
        body: 'We welcome coordinated disclosure performed without degrading service availability, exfiltrating user records, or violating privacy boundaries.',
      },
    ],
  },
};

const GLASS_SURFACE =
  'bg-white/82 backdrop-blur-2xl border border-white/90 ring-1 ring-slate-900/[0.06] shadow-[0_14px_44px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.95)]';

const DEMO_SAMPLES = [
  'name@domain.com',
  'torvalds',
  '+919876543210',
  'github.com',
  '8.8.8.8',
];

const CHAPTERS = [
  { id: 'platform-tour', label: 'Inside Parmanu' },
  { id: 'targets', label: 'Pipelines' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'modules', label: '8 Modules' },
  { id: 'faq', label: 'FAQ' },
  { id: 'legal', label: 'Indian Laws' },
];

const MODULE_PREVIEWS: Record<
  string,
  { target: string; latency: string; fields: Array<{ k: string; v: string }> }
> = {
  mailaccess: {
    target: 'arjun.sharma@company.in',
    latency: '420ms',
    fields: [
      { k: 'MX / SPF / DMARC', v: 'aspmx.l.google.com · SPF Pass · DMARC Reject' },
      { k: 'Gravatar MD5 Match', v: 'Profile linked (last modified 2025-11)' },
      { k: 'GitHub Commit Author', v: '3 public commits traced' },
    ],
  },
  holehe: {
    target: 'arjun.sharma@company.in',
    latency: '680ms',
    fields: [
      { k: 'Registered Checks', v: 'Microsoft, Adobe, Spotify, Firefox, GitHub, Atlassian' },
      { k: 'Rate-Limit Handling', v: 'Explicit Inconclusive classification' },
      { k: 'False-Positive Filter', v: 'Strict HTTP recovery-endpoint match' },
    ],
  },
  ghunt: {
    target: 'arjun.sharma@gmail.com',
    latency: '510ms',
    fields: [
      { k: 'Google Workspace / Gaia', v: 'Public Google Calendar & Profile signals' },
      { k: 'Google Maps Contributions', v: 'Direct Maps Contributor Link extracted' },
      { k: 'Avatar Forensics', v: 'One-click SHA-256 + EXIF inspection' },
    ],
  },
  maigret: {
    target: '@torvalds',
    latency: '920ms',
    fields: [
      { k: 'Developer & Social Networks', v: 'GitHub, GitLab, Reddit, HackerNews, Dev.to' },
      { k: 'Consolidated Artifacts', v: 'Public repositories + commit diffs' },
      { k: 'Profile Extraction', v: 'Bio, follower telemetry, verified URLs' },
    ],
  },
  blackbird: {
    target: '@torvalds',
    latency: '740ms',
    fields: [
      { k: 'Cross-Platform Correlation', v: 'Keybase, Mastodon, StackOverflow, PyPI' },
      { k: 'Avatar Comparison', v: 'Perceptual & MD5 Gravatar linkage' },
      { k: 'Pivot Triggers', v: 'Instant handle/email pivot scanning' },
    ],
  },
  sherlock: {
    target: '@torvalds',
    latency: '890ms',
    fields: [
      { k: 'High-Confidence Hits', v: '325+ curated web, gaming, edtech & developer sites' },
      { k: 'Redirect Verification', v: 'Filters soft-404s and parking pages' },
      { k: 'Timeline Integration', v: 'Account creation dates in Chronology' },
    ],
  },
  phoneinfoga: {
    target: '+919876543210',
    latency: '560ms',
    fields: [
      { k: 'Telecom Region & Line', v: 'India (+91) · TRAI Carrier & Circle verified' },
      { k: 'Deep Google Dorking', v: 'Opt-in multi-query phone footprint queries' },
      { k: 'Geo Plotting', v: 'Mapped on MapTiler interactive street layer' },
    ],
  },
  ignorant: {
    target: '+919876543210',
    latency: '630ms',
    fields: [
      { k: 'Live Phone Checks', v: 'Microsoft, Zoho, LeakCheck breaches, GitHub & HN' },
      { k: 'OTP-Safe Protection', v: 'Flipkart, Jio, Amazon.in & Paytm passive zero-SMS checks' },
      { k: 'Dossier Ready', v: 'Included in PDF & STIX 2.1 exports' },
    ],
  },
};

export function HomePage({
  isSignedIn,
  userEmail,
  signingIn,
  onStartSearching,
  onSignIn,
  onOpenModules,
}: HomePageProps) {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [activeWorkflow, setActiveWorkflow] = useState<string>('cases');
  const [activePreviewModule, setActivePreviewModule] = useState<string>('mailaccess');
  const [activeChapter, setActiveChapter] = useState<string>('platform-tour');
  const [activeLegalModal, setActiveLegalModal] = useState<LegalModalKey | null>(null);
  const [demoInput, setDemoInput] = useState('name@domain.com');
  const [soundOn, setSoundOn] = useState<boolean>(() => isSoundEnabled());
  const [musicOn, setMusicOn] = useState<boolean>(() => isMusicEnabled());

  useEffect(() => {
    return subscribeAudioState(({ soundEnabled, musicEnabled }) => {
      setSoundOn(soundEnabled);
      setMusicOn(musicEnabled);
    });
  }, []);

  const pageContainerRef = useRef<HTMLDivElement>(null);
  const heroSectionRef = useRef<HTMLElement>(null);

  const { scrollYProgress: pageScrollProgress } = useScroll({
    target: pageContainerRef,
    offset: ['start start', 'end end'],
  });
  const smoothScrollBar = useSpring(pageScrollProgress, {
    stiffness: 110,
    damping: 26,
    restDelta: 0.001,
  });

  const { scrollYProgress: heroScrollProgress } = useScroll({
    target: heroSectionRef,
    offset: ['start start', 'end start'],
  });
  const heroShowcaseY = useTransform(heroScrollProgress, [0, 1], [0, -34]);
  const heroOrbDriftY = useTransform(heroScrollProgress, [0, 1], [0, 56]);
  const ambientOrbUpperY = useTransform(pageScrollProgress, [0, 1], [0, 220]);
  const ambientOrbLowerY = useTransform(pageScrollProgress, [0, 1], [0, -180]);

  useEffect(() => {
    const onScroll = () => {
      const marker = window.scrollY + window.innerHeight * 0.35;
      let current = CHAPTERS[0].id;
      for (const ch of CHAPTERS) {
        const el = document.getElementById(ch.id);
        if (el && el.offsetTop <= marker) {
          current = ch.id;
        }
      }
      setActiveChapter(current);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const demoDetectedType = detectTargetTypeFromInput(demoInput) || 'username';
  const demoActiveTools = getDefaultToolsForTarget(demoDetectedType);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const selectedWorkflow =
    WORKFLOW_SPOTLIGHTS.find((w) => w.id === activeWorkflow) ||
    WORKFLOW_SPOTLIGHTS[0];
  const selectedPreviewTool =
    INVESTIGATION_TOOLS.find((t) => t.id === activePreviewModule) ||
    INVESTIGATION_TOOLS[0];
  const selectedModuleSample =
    MODULE_PREVIEWS[selectedPreviewTool.id] || MODULE_PREVIEWS.mailaccess;

  return (
    <div
      ref={pageContainerRef}
      className="min-h-screen bg-gradient-to-b from-[#FFFFFF] via-[#F4F7FF] to-[#EDF3FC] text-[#0F172A] flex flex-col relative overflow-x-hidden"
    >
      {/* Luminous Atmospheric Color Fields & Architectural Dot Matrix */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              'radial-gradient(rgba(30, 58, 138, 0.08) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
        <motion.div
          style={{ y: ambientOrbUpperY }}
          className="absolute -top-44 -right-24 w-[48rem] h-[48rem] rounded-full bg-gradient-to-br from-amber-300/30 via-indigo-300/25 to-transparent blur-3xl"
        />
        <motion.div
          style={{ y: ambientOrbLowerY }}
          className="absolute top-[38%] -left-32 w-[44rem] h-[44rem] rounded-full bg-gradient-to-tr from-sky-300/25 via-emerald-200/20 to-amber-100/25 blur-3xl"
        />
        <div className="absolute bottom-[-12rem] right-[12%] w-[40rem] h-[40rem] rounded-full bg-gradient-to-tl from-indigo-200/30 via-sky-200/20 to-transparent blur-3xl" />
      </div>

      {/* Top Tricolour Hairline */}
      <div
        aria-hidden="true"
        className="relative z-50 h-0.5 w-full bg-gradient-to-r from-[#FF9933] via-white to-[#138808]"
      />

      {/* Sticky Three-Zone Frosted Glass Top Bar + Scroll Progress Line */}
      <header className="sticky top-0 z-40 bg-white/70 backdrop-blur-2xl border-b border-white/70 ring-1 ring-slate-900/[0.04] shadow-[0_6px_30px_rgba(15,23,42,0.04)]">
        <div className="max-w-7xl mx-auto px-3.5 sm:px-8 h-16 flex items-center justify-between gap-2 sm:gap-8">
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="inline-flex items-center gap-2.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <ParmanuLogo size="sm" />
            <span className="font-display text-lg font-bold tracking-tight text-[#0F172A] whitespace-nowrap">
              Parmanu<span className="text-orange-600">.</span>
            </span>
          </button>

          <nav
            aria-label="Homepage navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600"
          >
            <button
              type="button"
              onClick={() => scrollTo('platform-tour')}
              className="hover:text-[#0F172A] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Inside Parmanu
            </button>
            <button
              type="button"
              onClick={() => scrollTo('targets')}
              className="hover:text-[#0F172A] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Targets
            </button>
            <button
              type="button"
              onClick={() => scrollTo('modules')}
              className="hover:text-[#0F172A] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Modules
            </button>
            <button
              type="button"
              onClick={() => scrollTo('faq')}
              className="hover:text-[#0F172A] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              FAQ
            </button>
            <button
              type="button"
              onClick={() => scrollTo('legal')}
              className="hover:text-[#0F172A] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Indian Laws
            </button>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => toggleMusicEnabled()}
                title={musicOn ? 'Mute ambient music' : 'Play ambient OSINT music'}
                aria-label={musicOn ? 'Mute ambient music' : 'Play ambient music'}
                className={`h-8 px-2 sm:px-2.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                  musicOn
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    : 'bg-white/80 border-slate-200/80 text-slate-600 hover:text-[#0F172A]'
                }`}
              >
                <Music className={`w-3.5 h-3.5 ${musicOn ? 'animate-pulse text-indigo-600' : ''}`} />
                <span className="hidden sm:inline">{musicOn ? 'Music On' : 'Music'}</span>
              </button>
              <button
                type="button"
                onClick={() => toggleSoundEnabled()}
                title={soundOn ? 'Mute sound effects' : 'Enable sound effects'}
                aria-label={soundOn ? 'Mute sound effects' : 'Enable sound effects'}
                className={`h-8 w-8 rounded-lg border inline-flex items-center justify-center transition-colors cursor-pointer ${
                  soundOn
                    ? 'bg-emerald-50/80 border-emerald-200 text-emerald-700'
                    : 'bg-white/80 border-slate-200/80 text-slate-400 hover:text-slate-700'
                }`}
              >
                {soundOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              </button>
            </div>

            {isSignedIn ? (
              <span className="hidden sm:inline-block text-xs font-mono text-slate-500 truncate max-w-[140px]">
                {userEmail}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  playClickTick();
                  void onSignIn();
                }}
                disabled={signingIn}
                className="text-xs sm:text-sm font-medium text-slate-700 hover:text-[#0F172A] transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {signingIn ? 'Signing in...' : 'Sign in'}
              </button>
            )}
            <Button
              size="sm"
              onClick={() => {
                playClickTick();
                onStartSearching();
              }}
              className="rounded-xl px-3 sm:px-4 h-9 whitespace-nowrap shrink-0"
            >
              <span>{isSignedIn ? 'Open Workspace' : 'Get Started'}</span>
            </Button>
          </div>
        </div>

        {/* Cinematic Spring Scroll Progress Hairline */}
        <motion.div
          aria-hidden="true"
          style={{ scaleX: smoothScrollBar, transformOrigin: '0% 50%' }}
          className="h-[2px] w-full bg-gradient-to-r from-[#FF9933] via-indigo-500 to-[#138808] opacity-85"
        />
      </header>

      {/* Atmospheric Luminous Hero Section */}
      <section
        ref={heroSectionRef}
        className="relative z-10 overflow-hidden border-b border-slate-200/70 bg-white"
      >
        <motion.div
          aria-hidden="true"
          style={{ y: heroOrbDriftY }}
          className="absolute inset-0 overflow-hidden"
        >
          <DynamicHeroBackdrop />
        </motion.div>

        <motion.div
          variants={heroContainerVariants}
          initial="hidden"
          animate="visible"
          className="relative z-10 max-w-6xl mx-auto px-4 sm:px-8 pt-14 pb-20 sm:pt-20 sm:pb-24 text-center space-y-8"
        >
          {/* Origin Kicker */}
          <motion.div
            variants={heroItemVariants}
            className="inline-flex flex-wrap items-center justify-center gap-2.5 px-4 py-1.5 rounded-full bg-white/80 backdrop-blur-xl border border-white/80 ring-1 ring-slate-900/5 shadow-xs text-xs text-slate-700"
          >
            <IndianFlag className="w-5 h-3.5" />
            <span className="font-devanagari font-bold text-orange-600">
              परमाणु
            </span>
            <span className="text-slate-300" aria-hidden="true">
              ·
            </span>
            <span className="font-semibold text-[#0F172A]">
              Bharat’s Atomic OSINT Engine
            </span>
            <span className="text-slate-400" aria-hidden="true">
              ·
            </span>
            <button
              type="button"
              onClick={() => scrollTo('modules')}
              className="text-indigo-600 hover:text-indigo-700 font-medium inline-flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap"
            >
              <span>8 live modules · Deep Google Dorking</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </motion.div>

          {/* Headline */}
          <motion.h1
            variants={heroItemVariants}
            className="font-display font-extrabold tracking-tight text-[#0F172A] leading-[1.06] max-w-4xl mx-auto"
            style={{
              fontSize: 'clamp(2.45rem, 5.2vw, 4.15rem)',
              textWrap: 'balance',
            }}
          >
            Trace Every Signal Down to the Atom.
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            variants={heroItemVariants}
            className="text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed"
          >
            One Signal. Every Trace. Zero Blind Spots. Investigate authorized
            emails, usernames, domains, IP addresses, and phone numbers in one
            workspace—with live odometer streaming, dark Signal Correlation
            Flowcharts, exhaustive Google Dorking, and AI executive briefs.
          </motion.p>

          {/* Primary CTA */}
          <motion.div
            variants={heroItemVariants}
            className="flex flex-wrap items-center justify-center gap-3 pt-1"
          >
            <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.985 }}>
              <Button
                size="lg"
                onClick={onStartSearching}
                className="h-12 px-8 rounded-xl text-sm font-semibold shadow-[0_14px_32px_rgba(15,23,42,0.18)] whitespace-nowrap"
              >
                <span>Start Searching</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </motion.div>

            {!isSignedIn && (
              <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.985 }}>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={onSignIn}
                  disabled={signingIn}
                  className="h-12 px-6 rounded-xl text-sm bg-white/85 backdrop-blur-xl border-slate-200 shadow-sm whitespace-nowrap"
                >
                  <span>
                    {signingIn ? 'Connecting...' : 'Sign in with Google'}
                  </span>
                </Button>
              </motion.div>
            )}
          </motion.div>

          <motion.p
            variants={heroItemVariants}
            className="text-xs text-slate-500 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1"
          >
            <span className="font-medium text-slate-700">Engineered in India by Midnight Industries</span>
            <span aria-hidden="true">·</span>
            <span>DPDP Act 2023 Compliant</span>
            <span aria-hidden="true">·</span>
            <span>Zero-OTP Passive Verification</span>
          </motion.p>

          {/* Cohesive Parmanu Workspace Showcase + Live Auto-Router */}
          <motion.div
            variants={heroItemVariants}
            style={{ y: heroShowcaseY }}
            className="pt-6"
          >
            <div
              className={`rounded-3xl ${GLASS_SURFACE} p-3.5 sm:p-5 text-left space-y-4 relative overflow-hidden`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-1 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-medium text-[#0F172A]">
                    parmanu / workspace / results
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Email · Username · Domain · IP · Phone</span>
                </div>
                <button
                  type="button"
                  onClick={onStartSearching}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                >
                  <span>Launch Accelerator</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>

              {/* Interactive Live Auto-Routing Preview Bar */}
              <div className="rounded-2xl bg-white/85 backdrop-blur-md border border-slate-200/80 p-3 sm:p-4 space-y-3">
                <div className="flex flex-col md:flex-row md:items-center gap-3">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      aria-label="Test Parmanu auto-routing classification"
                      value={demoInput}
                      onChange={(e) => setDemoInput(e.target.value)}
                      placeholder="Try typing an email, @handle, domain, IP, or +phone..."
                      className="w-full h-9 pl-8 pr-3 rounded-xl border border-slate-200 bg-white text-xs font-mono text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {DEMO_SAMPLES.map((sample) => {
                      const active = demoInput.trim() === sample;
                      return (
                        <button
                          key={sample}
                          type="button"
                          onClick={() => setDemoInput(sample)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-colors cursor-pointer whitespace-nowrap shrink-0 border ${
                            active
                              ? 'bg-[#0F172A] text-white border-[#0F172A]'
                              : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300 hover:text-[#0F172A]'
                          }`}
                        >
                          {sample}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="text-slate-500">
                    Auto-routed pipeline:{' '}
                    <span className="font-semibold text-indigo-700 capitalize">
                      {demoDetectedType}
                    </span>
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {INVESTIGATION_TOOLS.map((tool) => {
                      const active = demoActiveTools.includes(tool.id);
                      return (
                        <span
                          key={tool.id}
                          className={`px-2 py-0.5 rounded-md font-mono text-[10px] transition-all duration-200 ${
                            active
                              ? 'bg-indigo-50 text-indigo-700 font-semibold ring-1 ring-indigo-200'
                              : 'text-slate-400 opacity-55'
                          }`}
                        >
                          {TOOL_BY_ID[tool.id]?.name || tool.name}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>

              <InteractiveCursorDemo />
            </div>
          </motion.div>
        </motion.div>
      </section>

      {/* Signal Transfer & Parallel Relay Cinematic (Zero Searchbar UI) */}
      <section
        id="signal-relay"
        className="relative z-10 max-w-6xl mx-auto px-4 sm:px-8 pt-6 pb-16 space-y-8 w-full"
      >
        <motion.div
          variants={sectionRevealVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.18 }}
          className="max-w-3xl space-y-2.5"
        >
          <p className="text-xs font-semibold text-indigo-600">
            Live Telemetry Architecture
          </p>
          <h2
            className="font-display text-3xl font-bold tracking-tight text-[#0F172A]"
            style={{ textWrap: 'balance' }}
          >
            How encrypted signal sharding resolves five OSINT layers in parallel.
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Watch tokenized packets dispatch simultaneously across DNS, breach ledgers,
            developer commit graphs, threat-intel feeds, and web archives before crystallizing into verified evidence.
          </p>
        </motion.div>

        <motion.div
          variants={sectionRevealVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.14 }}
        >
          <SignalTransferCinematic />
        </motion.div>
      </section>

      {/* Section 1: Complete Product Tour with Cohesive Glassmorphic UI Showcases */}
      <section
        id="platform-tour"
        className="relative z-10 max-w-6xl mx-auto px-4 sm:px-8 py-24 space-y-12 w-full"
      >
        <motion.div
          variants={sectionRevealVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.18 }}
          className="max-w-3xl space-y-2.5"
        >
          <p className="text-xs font-semibold text-orange-600">
            Inside Parmanu
          </p>
          <h2
            className="font-display text-3xl font-bold tracking-tight text-[#0F172A]"
            style={{ textWrap: 'balance' }}
          >
            Every surface inside the platform, built for real investigations.
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            From your initial query to dark correlation flowcharts, batch file
            extraction, geographic telemetry, Deep Google Dorking, and AI
            Analyst reporting—each view stays crisp and unified.
          </p>
        </motion.div>

        <motion.div
          variants={staggerGridVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.12 }}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6"
        >
          {PRODUCT_TOUR_CARDS.map((card) => (
            <motion.div
              key={card.id}
              variants={staggerCardVariants}
              whileHover={{ y: -4, transition: { duration: 0.25 } }}
              className={`rounded-3xl ${GLASS_SURFACE} p-5 sm:p-6 flex flex-col justify-between gap-5`}
            >
              <ShowcaseRenderer kind={card.showcase} />

              <div className="space-y-2.5">
                <p className="text-xs font-semibold text-indigo-600">
                  {card.kicker}
                </p>
                <h3 className="font-display text-xl font-bold tracking-tight text-[#0F172A]">
                  {card.title}
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  {card.description}
                </p>
                <p className="pt-2.5 border-t border-slate-200/70 text-[11px] font-mono text-slate-500">
                  {card.highlights}
                </p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Section 2: All 5 Identifier Pipelines Explained */}
      <section
        id="targets"
        className="relative z-10 bg-white/55 backdrop-blur-xl border-y border-white/75 py-24"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-8 space-y-10">
          <motion.div
            variants={sectionRevealVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.18 }}
            className="flex flex-wrap items-end justify-between gap-4"
          >
            <div className="max-w-2xl space-y-2.5">
              <p className="text-xs font-semibold text-indigo-600">
                Supported Targets
              </p>
              <h2
                className="font-display text-3xl font-bold tracking-tight text-[#0F172A]"
                style={{ textWrap: 'balance' }}
              >
                One omnibar. Five strict OSINT pipelines.
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Parmanu detects your input format automatically and runs only the
                relevant OSINT modules—zero irrelevant probes or false noise.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={onStartSearching}>
              <span>Try Live Search</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </motion.div>

          <motion.div
            variants={staggerGridVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.12 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {IDENTIFIER_PIPELINES.map((item) => {
              const Icon = item.Icon;
              return (
                <motion.div
                  key={item.type}
                  variants={staggerCardVariants}
                  whileHover={{ y: -3, transition: { duration: 0.25 } }}
                  className={`rounded-2xl ${GLASS_SURFACE} p-5 flex flex-col justify-between gap-4`}
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2 font-display text-sm font-bold text-[#0F172A]">
                        <Icon className="w-4 h-4 text-orange-600 shrink-0" />
                        <span>{item.type}</span>
                      </span>
                      <span className="text-[11px] font-mono text-indigo-600 truncate">
                        {item.sample}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {item.summary}
                    </p>
                  </div>
                  <p className="pt-2.5 border-t border-slate-200/70 text-[11px] font-mono text-slate-500">
                    {item.modules}
                  </p>
                </motion.div>
              );
            })}

            {/* Card 6: Complete Workspace Highlights */}
            <motion.div
              variants={staggerCardVariants}
              whileHover={{ y: -3, transition: { duration: 0.25 } }}
              className={`rounded-2xl ${GLASS_SURFACE} p-5 flex flex-col justify-between gap-4 bg-gradient-to-br from-orange-50/55 via-white/80 to-indigo-50/55`}
            >
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 font-display text-sm font-bold text-[#0F172A]">
                  <GitBranch className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span>Full Evidence & Export Suite</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Click any discovered card to filter structured JSON fields,
                  inspect GitHub commit file patches, pivot with Show Google
                  Dorking Results, export CSV/JSON/PNG snapshots, and share
                  links with teammates.
                </p>
              </div>
              <button
                type="button"
                onClick={onStartSearching}
                className="pt-2.5 border-t border-slate-200/70 text-left text-xs font-semibold text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1 cursor-pointer"
              >
                <span>Open Investigation Workspace</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          </motion.div>

          {/* Bharat Sovereign Intelligence Coverage Strip */}
          <div className={`rounded-2xl ${GLASS_SURFACE} overflow-hidden`}>
            <div
              aria-hidden="true"
              className="h-[2px] w-full bg-gradient-to-r from-[#FF9933] via-slate-100 to-[#138808]"
            />
            <div className="p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <IndianFlag className="w-5 h-3.5" />
                  <h3 className="font-display text-sm font-bold text-[#0F172A]">
                    <span className="font-devanagari text-orange-600 mr-1.5">भारत</span>
                    Swadeshi Intelligence & Sovereign Coverage
                  </h3>
                </div>
                <span className="text-[11px] font-medium text-slate-500">
                  Built natively for Indian telecom, fintech & regulatory investigations
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-slate-200/70 text-xs">
                <div className="space-y-1">
                  <p className="font-semibold text-[#0F172A]">TRAI & DoT Circles</p>
                  <p className="text-slate-600 leading-relaxed">
                    22 Indian telecom circles with MSC operator mapping across Jio, Airtel, Vi & BSNL.
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-[#0F172A]">NPCI UPI & Fintech Matrix</p>
                  <p className="text-slate-600 leading-relaxed">
                    Derived VPA handle formatting plus Razorpay & Instamojo merchant footprint checks.
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-[#0F172A]">OTT, LPG & Caller Indexes</p>
                  <p className="text-slate-600 leading-relaxed">
                    Zero-OTP public checks for Truecaller No-API indexes, Indian OTT & LPG utility portals.
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-[#0F172A]">BSA 2023 Sec. 63 Ready</p>
                  <p className="text-slate-600 leading-relaxed">
                    SHA-256 avatar forensics, IST timestamps, and PII-redacted tricolour PDF dossiers.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Interactive Investigation Workflows */}
      <section
        id="workflows"
        className="relative z-10 max-w-6xl mx-auto px-4 sm:px-8 py-24 space-y-10 w-full"
      >
        <motion.div
          variants={sectionRevealVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.18 }}
          className="flex flex-col md:flex-row md:items-end justify-between gap-6"
        >
          <div className="max-w-2xl space-y-2.5">
            <p className="text-xs font-semibold text-orange-600">Workflows</p>
            <h2
              className="font-display text-3xl font-bold tracking-tight text-[#0F172A]"
              style={{ textWrap: 'balance' }}
            >
              Built for real analyst investigations.
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Switch between core Parmanu workflows to see how single lookups,
              universal batch uploads, Deep Google Dorking, and AI synthesis fit
              together.
            </p>
          </div>

          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-white/80 backdrop-blur-lg border border-slate-200/80 shadow-2xs shrink-0 self-start">
            {WORKFLOW_SPOTLIGHTS.map((wf) => {
              const active = wf.id === activeWorkflow;
              return (
                <button
                  key={wf.id}
                  type="button"
                  onClick={() => setActiveWorkflow(wf.id)}
                  className={`relative px-3.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    active
                      ? 'text-white'
                      : 'text-slate-600 hover:text-[#0F172A]'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="workflow-tab-pill"
                      transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                      className="absolute inset-0 rounded-lg bg-[#0F172A] shadow-xs"
                    />
                  )}
                  <span className="relative z-10">{wf.label}</span>
                </button>
              );
            })}
          </div>
        </motion.div>

        <motion.div
          variants={sectionRevealVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.14 }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedWorkflow.id}
              initial={{ opacity: 0, y: 14, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
              transition={{ duration: 0.36, ease: EASE_OUT_EXPO }}
              className={`rounded-3xl ${GLASS_SURFACE} p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center`}
            >
              <div className="lg:col-span-5 space-y-4">
                <p className="text-xs font-medium text-indigo-600">
                  {selectedWorkflow.label}
                </p>
                <h3
                  className="font-display text-2xl font-bold tracking-tight text-[#0F172A]"
                  style={{ textWrap: 'balance' }}
                >
                  {selectedWorkflow.title}
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {selectedWorkflow.description}
                </p>
                <p className="pt-2 border-t border-slate-200/70 text-xs font-mono text-slate-500">
                  {selectedWorkflow.metrics}
                </p>
                <div className="pt-2">
                  <Button size="sm" onClick={onStartSearching}>
                    <span>Try this workflow</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <div className="lg:col-span-7">
                <ShowcaseRenderer kind={selectedWorkflow.showcase} />
              </div>
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </section>

      {/* Section 4: Asymmetric Frosted Glass Capabilities Grid */}
      <section
        id="capabilities"
        className="relative z-10 bg-gradient-to-b from-white/55 via-[#EEF2F9]/60 to-white/55 backdrop-blur-xl border-y border-white/75 py-24 overflow-hidden"
      >
        <div className="relative max-w-6xl mx-auto px-4 sm:px-8 space-y-10">
          <motion.div
            variants={sectionRevealVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.18 }}
            className="max-w-2xl space-y-2.5"
          >
            <p className="text-xs font-semibold text-indigo-600">Capabilities</p>
            <h2
              className="font-display text-3xl font-bold tracking-tight text-[#0F172A]"
              style={{ textWrap: 'balance' }}
            >
              Everything you need to investigate faster—with zero limits.
            </h2>
          </motion.div>

          <motion.div
            variants={staggerGridVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.12 }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch"
          >
            <motion.div
              variants={staggerCardVariants}
              whileHover={{ y: -3, transition: { duration: 0.25 } }}
              className={`lg:col-span-7 rounded-2xl ${GLASS_SURFACE} p-6 sm:p-7 flex flex-col justify-between gap-4`}
            >
              <div className="flex items-center justify-between text-xs text-slate-500">
                <Users className="w-5 h-5 text-orange-600" />
                <span>01 · Team Collaboration & Case Sharing</span>
              </div>
              <div className="space-y-2">
                <h3 className="font-display text-lg font-bold text-[#0F172A]">
                  Shared investigations synced with Google Sign-In
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  Invite verified teammate emails to any case, export clean PNG
                  investigation snapshots, and preserve breach histories inside
                  cloud-backed Firestore case folders.
                </p>
              </div>
            </motion.div>

            <motion.div
              variants={staggerCardVariants}
              whileHover={{ y: -3, transition: { duration: 0.25 } }}
              className={`lg:col-span-5 rounded-2xl ${GLASS_SURFACE} p-6 sm:p-7 flex flex-col justify-between gap-4`}
            >
              <div className="flex items-center justify-between text-xs text-slate-500">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                <span>02 · AI-Powered Synthesis</span>
              </div>
              <div className="space-y-2">
                <h3 className="font-display text-lg font-bold text-[#0F172A]">
                  Automatic AI Analyst brief after every search
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  Server-side 3-key rotation summarizes cross-platform accounts,
                  GitHub exposure, and breach timelines the moment modules
                  complete, plus interactive Q&A.
                </p>
              </div>
            </motion.div>

            <motion.div
              variants={staggerCardVariants}
              whileHover={{ y: -3, transition: { duration: 0.25 } }}
              className={`lg:col-span-4 rounded-2xl ${GLASS_SURFACE} p-6 flex flex-col justify-between gap-4`}
            >
              <div className="flex items-center justify-between text-xs text-slate-500">
                <Bell className="w-5 h-5 text-emerald-700" />
                <span>03 · Unlimited Monitoring</span>
              </div>
              <div className="space-y-2">
                <h3 className="font-display text-base font-bold text-[#0F172A]">
                  Watchlists & Alert Re-Scans
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Track critical emails, domains, phone numbers, or usernames
                  and run on-demand exposure checks without query caps.
                </p>
              </div>
            </motion.div>

            <motion.div
              variants={staggerCardVariants}
              whileHover={{ y: -3, transition: { duration: 0.25 } }}
              className={`lg:col-span-4 rounded-2xl ${GLASS_SURFACE} p-6 flex flex-col justify-between gap-4`}
            >
              <div className="flex items-center justify-between text-xs text-slate-500">
                <FileUp className="w-5 h-5 text-orange-600" />
                <span>04 · Any-File Batch Mode</span>
              </div>
              <div className="space-y-2">
                <h3 className="font-display text-base font-bold text-[#0F172A]">
                  Extract & Scan Any Document
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Parse CSV, XLSX, PDF, DOCX, JSON, or raw server logs into a
                  multi-worker scan queue and export verified CSV/JSON tables.
                </p>
              </div>
            </motion.div>

            <motion.div
              variants={staggerCardVariants}
              whileHover={{ y: -3, transition: { duration: 0.25 } }}
              className={`lg:col-span-4 rounded-2xl ${GLASS_SURFACE} p-6 flex flex-col justify-between gap-4`}
            >
              <div className="flex items-center justify-between text-xs text-slate-500">
                <MapPin className="w-5 h-5 text-indigo-600" />
                <span>05 · Deep Dorking & Geo Maps</span>
              </div>
              <div className="space-y-2">
                <h3 className="font-display text-base font-bold text-[#0F172A]">
                  On-Demand Dorks & MapTiler Maps
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Query PDFs, spreadsheets, open directories, and archives
                  without re-running scans, plus MapTiler geo pinning.
                </p>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Section 5: How to Use — 3-Step Visual Guide */}
      <section
        id="how-to-use"
        className="relative z-10 max-w-6xl mx-auto px-4 sm:px-8 py-24 space-y-12 w-full"
      >
        <motion.div
          variants={sectionRevealVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.18 }}
          className="max-w-2xl space-y-2.5"
        >
          <p className="text-xs font-semibold text-emerald-700">How to Use</p>
          <h2
            className="font-display text-3xl font-bold tracking-tight text-[#0F172A]"
            style={{ textWrap: 'balance' }}
          >
            Turn public signals into actionable context in three steps.
          </h2>
        </motion.div>

        <div className="relative">
          <div
            aria-hidden="true"
            className="hidden md:block absolute top-10 left-[12%] right-[12%] h-[2px] bg-slate-200/70 rounded-full overflow-hidden pointer-events-none"
          >
            <motion.div
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true, amount: 0.35 }}
              transition={{ duration: 1.05, ease: EASE_OUT_EXPO }}
              style={{ originX: 0 }}
              className="h-full w-full bg-gradient-to-r from-[#FF9933] via-indigo-500 to-[#138808]"
            />
          </div>

          <motion.div
            variants={staggerGridVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.14 }}
            className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-5"
          >
            {HOW_TO_STEPS.map((item) => (
              <motion.div
                key={item.step}
                variants={staggerCardVariants}
                whileHover={{ y: -3, transition: { duration: 0.25 } }}
                className={`rounded-2xl ${GLASS_SURFACE} p-6 flex flex-col justify-between gap-5`}
              >
                <div className="space-y-3">
                  <span className="font-mono text-xs font-semibold text-orange-600 tabular-nums">
                    {item.step}.
                  </span>
                  <h3 className="font-display text-lg font-bold text-[#0F172A]">
                    {item.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                    {item.description}
                  </p>
                </div>

                <p className="pt-3 border-t border-slate-200/70 text-[11px] font-medium text-slate-500">
                  {item.detail}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Section 6: All 8 Live OSINT Modules */}
      <section
        id="modules"
        className="relative z-10 bg-white/55 backdrop-blur-xl border-t border-white/75 py-24"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-8 space-y-10">
          <motion.div
            variants={sectionRevealVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.18 }}
            className="flex flex-wrap items-end justify-between gap-4"
          >
            <div className="max-w-2xl space-y-2.5">
              <p className="text-xs font-semibold text-indigo-600">
                OSINT Modules
              </p>
              <h2
                className="font-display text-3xl font-bold tracking-tight text-[#0F172A]"
                style={{ textWrap: 'balance' }}
              >
                Eight specialized adapters—strictly isolated by target type.
              </h2>
            </div>
            <button
              type="button"
              onClick={onOpenModules}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <span>Inspect live server health</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </motion.div>

          <motion.div
            variants={staggerGridVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.1 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
          >
            {INVESTIGATION_TOOLS.map((tool, idx) => {
              const selected = activePreviewModule === tool.id;
              return (
                <motion.button
                  key={tool.id}
                  type="button"
                  variants={staggerCardVariants}
                  whileHover={{ y: -3, transition: { duration: 0.25 } }}
                  onClick={() => setActivePreviewModule(tool.id)}
                  className={`text-left rounded-2xl ${GLASS_SURFACE} p-5 flex flex-col justify-between gap-4 transition-all cursor-pointer ${
                    selected
                      ? 'ring-2 ring-indigo-500/40 border-indigo-300 bg-white/95'
                      : 'hover:bg-white/90'
                  }`}
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="font-mono tabular-nums font-medium text-slate-500">
                        {String(idx + 1).padStart(2, '0')}.
                      </span>
                      <span className="capitalize">
                        {tool.supportedTargets.join(' · ')}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${
                          selected
                            ? 'bg-indigo-600 border-indigo-600 text-white'
                            : 'bg-white border-slate-200/70 text-indigo-600'
                        }`}
                      >
                        <Cpu className="w-3.5 h-3.5" />
                      </span>
                      <h3 className="font-display text-sm font-bold text-[#0F172A]">
                        {tool.name}
                      </h3>
                    </div>

                    <p className="text-[11px] font-medium text-indigo-600">
                      {tool.scope}
                    </p>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {tool.description}
                    </p>
                  </div>

                  <div className="pt-2.5 border-t border-slate-200/60 space-y-1 text-[11px] text-slate-500">
                    {tool.capabilities.slice(0, 2).map((cap, i) => (
                      <p key={i} className="truncate">
                        · {cap}
                      </p>
                    ))}
                  </div>
                </motion.button>
              );
            })}
          </motion.div>

          {/* Interactive Module Telemetry Previewer */}
          <div className={`rounded-2xl ${GLASS_SURFACE} p-6 space-y-4`}>
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200/60">
              <div>
                <p className="text-xs font-semibold text-indigo-600">
                  Interactive Adapter Preview · {selectedPreviewTool.name}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  Sample structured telemetry emitted on target{' '}
                  <span className="font-mono font-semibold text-[#0F172A]">
                    {selectedModuleSample.target}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="font-mono text-slate-500 tabular-nums">
                  Avg Latency: {selectedModuleSample.latency}
                </span>
                <Button size="sm" onClick={onStartSearching}>
                  <span>Test in Workspace</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              {selectedModuleSample.fields.map((f) => (
                <div
                  key={f.k}
                  className="p-3.5 rounded-xl bg-white/80 border border-slate-200/70 space-y-1"
                >
                  <p className="text-[11px] font-semibold text-slate-500">
                    {f.k}
                  </p>
                  <p className="font-mono text-xs font-medium text-[#0F172A]">
                    {f.v}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Section 7: FAQ Accordion */}
      <section
        id="faq"
        className="relative z-10 bg-white/70 backdrop-blur-xl border-t border-white/80 py-24"
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-8 space-y-10">
          <motion.div
            variants={sectionRevealVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.2 }}
            className="text-center space-y-2"
          >
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600">
              <HelpCircle className="w-3.5 h-3.5" />
              <span>Frequently Asked Questions</span>
            </div>
            <h2
              className="font-display text-3xl font-bold tracking-tight text-[#0F172A]"
              style={{ textWrap: 'balance' }}
            >
              Everything you need to know about Parmanu
            </h2>
          </motion.div>

          <motion.div
            variants={staggerGridVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.1 }}
            className="space-y-3"
          >
            {FAQS.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <motion.div
                  key={item.q}
                  variants={staggerCardVariants}
                  className={`rounded-2xl ${GLASS_SURFACE} overflow-hidden`}
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="w-full px-6 py-4 flex items-center justify-between gap-4 text-left hover:bg-white/60 transition-colors cursor-pointer"
                  >
                    <span className="text-sm font-semibold text-[#0F172A]">
                      {item.q}
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
                        isOpen ? 'rotate-180 text-orange-600' : ''
                      }`}
                    />
                  </button>
                  <div
                    className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                      isOpen
                        ? 'grid-rows-[1fr] opacity-100'
                        : 'grid-rows-[0fr] opacity-0'
                    }`}
                  >
                    <div className="overflow-hidden">
                      <p className="px-6 pb-5 text-xs sm:text-sm text-slate-600 leading-relaxed border-t border-slate-200/60 pt-3">
                        {item.a}
                      </p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>

          <motion.div
            variants={sectionRevealVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, amount: 0.25 }}
            className="text-center pt-4"
          >
            <motion.div
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.985 }}
              className="inline-block"
            >
              <Button
                size="lg"
                onClick={onStartSearching}
                className="rounded-xl px-8 h-12 shadow-[0_12px_28px_rgba(15,23,42,0.16)] whitespace-nowrap"
              >
                <span>Launch Parmanu Accelerator</span>
                <ArrowRight className="w-4 h-4" />
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Section 8: Indian Legal & Compliance Framework Permitting Authorized OSINT */}
      <section
        id="legal"
        className="relative z-10 max-w-6xl mx-auto px-4 sm:px-8 py-20 space-y-10 w-full"
      >
        <motion.div
          variants={sectionRevealVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.16 }}
          className="flex flex-col md:flex-row md:items-end justify-between gap-4"
        >
          <div className="max-w-3xl space-y-2.5">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-indigo-600">
              <Scale className="w-3.5 h-3.5" />
              <span>Indian Legal Framework & Statutory Boundaries</span>
            </div>
            <h2
              className="font-display text-3xl font-bold tracking-tight text-[#0F172A]"
              style={{ textWrap: 'balance' }}
            >
              Indian laws permitting lawful, passive Open-Source Intelligence.
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Parmanu by Midnight Industries strictly aggregates publicly accessible records—never accessing private databases, cracking credentials, or triggering unauthorized OTPs. Below are the core constitutional and statutory provisions governing lawful OSINT in India.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 shrink-0">
            <IndianFlag className="w-5 h-3.5" />
            <span>Passive Public Reconnaissance Only</span>
          </div>
        </motion.div>

        <motion.div
          variants={staggerGridVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.12 }}
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          {INDIAN_OSINT_LAWS.map((law) => (
            <motion.div
              key={law.index}
              variants={staggerCardVariants}
              className={`rounded-2xl ${GLASS_SURFACE} p-5 sm:p-6 flex flex-col justify-between gap-3`}
            >
              <div className="space-y-2">
                <p className="text-xs font-semibold text-indigo-600">
                  {law.index}. {law.statute}
                </p>
                <h3 className="font-display text-base sm:text-lg font-bold tracking-tight text-[#0F172A]">
                  {law.title}
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  {law.summary}
                </p>
              </div>
            </motion.div>
          ))}
        </motion.div>

        <div
          className={`rounded-2xl ${GLASS_SURFACE} p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4`}
        >
          <div className="flex items-start gap-3 max-w-3xl">
            <ShieldCheck className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs sm:text-sm">
              <p className="font-semibold text-[#0F172A]">
                Compliance Disclaimer & Lawful Usage Requirement
              </p>
              <p className="text-slate-600 leading-relaxed">
                This summary provides statutory context for Indian cybersecurity researchers, auditors, compliance teams, and citizens auditing their own public exposure—not formal legal advice. Users remain solely responsible for ensuring investigations comply with applicable laws and organizational authorization.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveLegalModal('terms')}
              className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-[#0F172A] hover:border-indigo-400 transition-colors cursor-pointer whitespace-nowrap"
            >
              Read Authorized Use Terms
            </button>
          </div>
        </div>
      </section>

      {/* Complete Professional Multi-Column Footer */}
      <footer className="relative z-10 border-t border-slate-200/90 bg-white/88 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-14 space-y-10">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 text-xs">
            {/* Brand & Midnight Industries Attribution */}
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="inline-flex items-center gap-2.5 text-left cursor-pointer"
              >
                <ParmanuLogo size="md" />
                <div>
                  <span className="font-display text-base font-bold tracking-tight text-[#0F172A] block leading-none">
                    Parmanu<span className="text-orange-600">.</span>
                  </span>
                  <span className="text-[11px] font-medium text-slate-500 block mt-1">
                    Made by Midnight Industries
                  </span>
                </div>
              </button>

              <p className="text-slate-600 leading-relaxed">
                One Signal. Every Trace. Zero Blind Spots. Passive open-source intelligence platform engineered in India for lawful digital footprint auditing, breach triage, and verification.
              </p>

              <div className="flex flex-wrap items-center gap-2 text-slate-600 font-medium">
                <IndianFlag className="w-4.5 h-3" />
                <span className="font-devanagari text-orange-600 font-semibold">परमाणु</span>
                <span aria-hidden="true">·</span>
                <span>Made in India</span>
                <span aria-hidden="true">·</span>
                <span>Swadeshi Cyber-Intelligence</span>
              </div>
            </div>

            {/* Platform Navigation */}
            <div className="space-y-3">
              <p className="font-display text-xs font-bold text-[#0F172A] tracking-wide">
                Platform
              </p>
              <ul className="space-y-2 text-slate-600">
                <li>
                  <button
                    type="button"
                    onClick={() => scrollTo('platform-tour')}
                    className="hover:text-[#0F172A] transition-colors cursor-pointer"
                  >
                    Inside Parmanu
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => scrollTo('targets')}
                    className="hover:text-[#0F172A] transition-colors cursor-pointer"
                  >
                    5 Identifier Pipelines
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => scrollTo('workflows')}
                    className="hover:text-[#0F172A] transition-colors cursor-pointer"
                  >
                    Workspace Workflows
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => scrollTo('modules')}
                    className="hover:text-[#0F172A] transition-colors cursor-pointer"
                  >
                    8 Live OSINT Modules
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={onOpenModules}
                    className="hover:text-[#0F172A] transition-colors cursor-pointer"
                  >
                    Module Catalog
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={onStartSearching}
                    className="font-semibold text-indigo-600 hover:text-indigo-700 transition-colors cursor-pointer"
                  >
                    Launch Investigation Workspace
                  </button>
                </li>
              </ul>
            </div>

            {/* Intelligence Engines */}
            <div className="space-y-3">
              <p className="font-display text-xs font-bold text-[#0F172A] tracking-wide">
                Intelligence Engines
              </p>
              <ul className="space-y-2 text-slate-600">
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setDemoInput('name@domain.com');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="hover:text-[#0F172A] transition-colors cursor-pointer"
                  >
                    Email, Holehe & GHunt Maps
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setDemoInput('+919876543210');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="hover:text-[#0F172A] transition-colors cursor-pointer"
                  >
                    Truecaller No-API & TRAI Telecom
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setDemoInput('+919876543210');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="hover:text-[#0F172A] transition-colors cursor-pointer"
                  >
                    UPI Handles, OTT & LPG Utilities
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setDemoInput('torvalds');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="hover:text-[#0F172A] transition-colors cursor-pointer"
                  >
                    325+ Username & Commit Graphs
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => scrollTo('faq')}
                    className="hover:text-[#0F172A] transition-colors cursor-pointer"
                  >
                    Data Sources & Accuracy FAQ
                  </button>
                </li>
              </ul>
            </div>

            {/* Legal, Security & Trust */}
            <div className="space-y-3">
              <p className="font-display text-xs font-bold text-[#0F172A] tracking-wide">
                Legal & Security
              </p>
              <ul className="space-y-2 text-slate-600">
                <li>
                  <button
                    type="button"
                    onClick={() => scrollTo('legal')}
                    className="hover:text-[#0F172A] transition-colors cursor-pointer"
                  >
                    Indian OSINT Legal Framework
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => setActiveLegalModal('privacy')}
                    className="hover:text-[#0F172A] transition-colors cursor-pointer"
                  >
                    Privacy & Zero-Database Policy
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => setActiveLegalModal('terms')}
                    className="hover:text-[#0F172A] transition-colors cursor-pointer"
                  >
                    Terms of Authorized Use
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => setActiveLegalModal('aup')}
                    className="hover:text-[#0F172A] transition-colors cursor-pointer"
                  >
                    Acceptable Use & Zero-OTP Policy
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => setActiveLegalModal('disclosure')}
                    className="hover:text-[#0F172A] transition-colors cursor-pointer"
                  >
                    Responsible Security Disclosure
                  </button>
                </li>
                <li className="flex items-center gap-3 pt-1 text-[11px] font-mono text-slate-500">
                  <a
                    href="/.well-known/security.txt"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-[#0F172A] transition-colors"
                  >
                    security.txt
                  </a>
                  <span aria-hidden="true">·</span>
                  <a
                    href="/sitemap.xml"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-[#0F172A] transition-colors"
                  >
                    sitemap.xml
                  </a>
                  <span aria-hidden="true">·</span>
                  <a
                    href="/robots.txt"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-[#0F172A] transition-colors"
                  >
                    robots.txt
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-6 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
            <p className="font-medium text-slate-600">
              © {new Date().getFullYear()} Midnight Industries. Built with Parmanu Atomic OSINT Architecture.
            </p>
            <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                <span>DPDP Act 2023 · Sec. 3(c)(ii)</span>
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                <FileCheck2 className="w-3.5 h-3.5 text-slate-400" />
                <span>BSA 2023 · Sec. 63 Ready</span>
              </span>
            </div>
          </div>
        </div>
      </footer>

      {/* Interactive Legal & Policy Dialog */}
      <Dialog
        open={Boolean(activeLegalModal)}
        onClose={() => setActiveLegalModal(null)}
        title={activeLegalModal ? LEGAL_MODAL_DOCS[activeLegalModal].title : ''}
        description={
          activeLegalModal ? LEGAL_MODAL_DOCS[activeLegalModal].subtitle : undefined
        }
        maxWidthClass="max-w-2xl"
      >
        {activeLegalModal && (
          <div className="space-y-4">
            {LEGAL_MODAL_DOCS[activeLegalModal].sections.map((sec) => (
              <div
                key={sec.heading}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120] space-y-1.5"
              >
                <h3 className="text-sm font-semibold text-[#0F172A] dark:text-slate-100">
                  {sec.heading}
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  {sec.body}
                </p>
              </div>
            ))}
            <div className="pt-2 flex items-center justify-between text-xs text-slate-500">
              <span>Midnight Industries Compliance & Trust</span>
              <Button size="sm" onClick={() => setActiveLegalModal(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Vertical Scroll Progress Chapter Rail (2XL viewports) */}
      <aside
        aria-label="Section progress rail"
        className="hidden 2xl:flex fixed right-6 top-1/2 -translate-y-1/2 z-40 flex-col gap-2 p-2.5 rounded-2xl bg-white/75 backdrop-blur-xl border border-white/80 ring-1 ring-slate-900/5 shadow-sm"
      >
        {CHAPTERS.map((ch) => {
          const isActive = activeChapter === ch.id;
          return (
            <button
              key={ch.id}
              type="button"
              onClick={() => scrollTo(ch.id)}
              className={`text-left px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                isActive
                  ? 'bg-[#0F172A] text-white'
                  : 'text-slate-500 hover:text-[#0F172A] hover:bg-slate-100/70'
              }`}
            >
              {ch.label}
            </button>
          );
        })}
      </aside>
    </div>
  );
}
