import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  CheckCircle2,
  Clock,
  Code2,
  Cpu,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FileUp,
  FolderOpen,
  GitBranch,
  GitCommit,
  Globe,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Terminal,
  UserCheck,
  Users,
} from 'lucide-react';
import bgOsintMap from '@/src/assets/images/osint_signal_map_bg_1795349222553.jpg';
import bgOsintRadar from '@/src/assets/images/osint_radar_telemetry_bg_1795349223314.jpg';
import bgOsintNodes from '@/src/assets/images/osint_node_constellation_bg_1795349223184.jpg';
import bgSecurityLens from '@/src/assets/images/hero_security_lens_1794650561688.jpg';
import bgRedLens from '@/src/assets/images/hero_red_osint_lens_1794651963127.jpg';

const STAGE_PHOTOS = [
  bgOsintMap,
  bgOsintRadar,
  bgOsintNodes,
  bgSecurityLens,
  bgRedLens,
];

interface DemoScenario {
  id: 'phone' | 'email' | 'username';
  tabLabel: string;
  target: string;
  targetType: string;
  modules: string[];
  aiSummary: string;
  aiRisk: 'Low' | 'Moderate' | 'Elevated';
  takeaways: string[];
  kpis: {
    total: number;
    signals: number;
    registered: number;
    breached: number;
    leaked: number;
  };
  flowchartBranches: Array<{
    title: string;
    meta: string;
    tone: string;
    dotColor: string;
  }>;
  cards: Array<{
    platform: string;
    domain: string;
    handle: string;
    category: string;
    summary: string;
    statusLabel: string;
    isExposed?: boolean;
  }>;
  breachesList: Array<{
    name: string;
    domain: string;
    classes: string;
    date: string;
  }>;
  dorkSummary: {
    total: number;
    files: number;
    web: number;
    queries: number;
  };
  dorkHits: Array<{
    format: 'PDF' | 'XLSX' | 'CSV' | 'CODE' | 'DOCX' | 'TXT' | 'WEB';
    title: string;
    domain: string;
    url: string;
    snippet: string;
    engine: string;
    date?: string;
  }>;
  timelineEvents: Array<{
    date: string;
    kind: 'Breach' | 'Account' | 'Infra' | 'Archive';
    title: string;
    detail: string;
    sub: string;
  }>;
  detailInspect: {
    title: string;
    subtitle: string;
    properties: Array<{ label: string; value: string }>;
    diffLines: Array<{ type: 'add' | 'del' | 'ctx'; text: string }>;
  };
}

const SCENARIOS: DemoScenario[] = [
  {
    id: 'phone',
    tabLabel: '01. Phone + Deep Dorking',
    target: '+919876543210',
    targetType: 'Phone Number',
    modules: ['MailAccess', 'PhoneInfoga', 'Ignorant'],
    aiRisk: 'Moderate',
    aiSummary:
      'Validated E.164 Indian mobile number across TRAI circle series with active messaging signals on WhatsApp/Telegram and 18 indexed documents surfaced via multi-engine Google Dorking.',
    takeaways: [
      'E.164 & RFC3966 carrier structure verified (IN · Mobile Series).',
      '18 public PDF/CSV/DOCX files & 41 web directory references located.',
      'Ignorant passive checks confirmed 4 associated consumer platform hooks.',
    ],
    kpis: { total: 59, signals: 54, registered: 14, breached: 1, leaked: 4 },
    flowchartBranches: [
      { title: 'TRAI India Series', meta: 'Mobile · IN Circle', tone: 'border-indigo-500/45 text-indigo-300', dotColor: 'bg-indigo-400' },
      { title: 'WhatsApp / Telegram', meta: 'Messaging Hooks', tone: 'border-emerald-500/45 text-emerald-300', dotColor: 'bg-emerald-400' },
      { title: '18 Exposed PDF/CSV', meta: 'Google Dork Files', tone: 'border-orange-500/45 text-orange-300', dotColor: 'bg-orange-400' },
      { title: 'Tender & Tax Notices', meta: 'procure.gov.in', tone: 'border-amber-500/45 text-amber-300', dotColor: 'bg-amber-400' },
      { title: 'Caller Directories', meta: 'Justdial · IndiaMART', tone: 'border-sky-500/45 text-sky-300', dotColor: 'bg-sky-400' },
      { title: 'Pastebin Code Leak', meta: '1 Raw Snippet', tone: 'border-rose-500/45 text-rose-300', dotColor: 'bg-rose-400' },
    ],
    cards: [
      {
        platform: 'PhoneInfoga Carrier Intel',
        domain: 'phoneinfoga.local',
        handle: '+91 98765 43210',
        category: 'Phone & Telecom',
        summary: 'E.164 India (+91) · TRAI DoT 98xx Mobile Series · Active format match',
        statusLabel: 'Verified',
      },
      {
        platform: 'Deep Google Dork Sweep',
        domain: 'google.com',
        handle: '10 Queries · 59 Hits',
        category: 'Files & Records',
        summary: 'Surfaced 18 PDF/CSV/XLSX docs, tender PDFs & business directories',
        statusLabel: '59 Hits Found',
        isExposed: true,
      },
      {
        platform: 'WhatsApp Click-to-Chat',
        domain: 'wa.me',
        handle: 'wa.me/919876543210',
        category: 'Social & Community',
        summary: 'Public messaging URI endpoint & business profile metadata reachable',
        statusLabel: 'Registered',
      },
      {
        platform: 'Ignorant App Probe',
        domain: 'amazon.in',
        handle: '+919876543210',
        category: 'Registered Apps',
        summary: 'Password recovery check confirmed active registration signal',
        statusLabel: 'Registered',
      },
      {
        platform: 'IndiaMART & Justdial Index',
        domain: 'indiamart.com',
        handle: 'Vendor Contact',
        category: 'Web Directories',
        summary: 'Matched regional supplier listing & GST contact block',
        statusLabel: 'Indexed',
      },
      {
        platform: 'Pastebin Raw Export',
        domain: 'pastebin.com',
        handle: 'CSV Contact Leak',
        category: 'Breach & Exposure',
        summary: 'Number appeared in public client contact sheet snapshot',
        statusLabel: 'Leaked',
        isExposed: true,
      },
    ],
    breachesList: [
      { name: 'Vendor CSV Dump', domain: 'pastebin.com', classes: 'Phone, Name, City', date: '2024-09' },
      { name: 'Unlisted Support Ticket', domain: 'archive.org', classes: 'Phone, Order ID', date: '2023-11' },
    ],
    dorkSummary: { total: 59, files: 18, web: 36, queries: 10 },
    dorkHits: [
      {
        format: 'PDF',
        title: 'GeM_Vendor_Empanelment_Roster_2025.pdf',
        domain: 'procure.gov.in',
        url: 'https://procure.gov.in/docs/GeM_Vendor_Empanelment_Roster_2025.pdf',
        snippet: 'Authorized signatory contact: +91 98765 43210 · Regional supply contract notice.',
        engine: 'Google Search Grounding',
        date: '2025-02-14',
      },
      {
        format: 'CSV',
        title: 'north_zone_distributor_contacts.csv',
        domain: 'archive.org',
        url: 'https://archive.org/details/north_zone_distributor_contacts',
        snippet: 'Column match "9876543210" in archived distributor directory CSV export.',
        engine: 'Archive.org Search',
        date: '2024-09-03',
      },
      {
        format: 'XLSX',
        title: 'TradeFair_Exhibitor_Directory_2024.xlsx',
        domain: 'indiatrade.org',
        url: 'https://indiatrade.org/files/TradeFair_Exhibitor_Directory_2024.xlsx',
        snippet: 'Booth #B-14 · Contact helpline 09876543210 · Electronics & Logistics.',
        engine: 'Bing Search Index',
        date: '2024-06-18',
      },
      {
        format: 'DOCX',
        title: 'Authorized_Service_Center_SOP.docx',
        domain: 'docs.google.com',
        url: 'https://docs.google.com/document/d/service-sop-public',
        snippet: 'Escalation desk phone: +91-98765-43210 · Open Google Docs index.',
        engine: 'DuckDuckGo Dork',
        date: '2024-03-11',
      },
      {
        format: 'CODE',
        title: 'JSON webhook payload fixture on GitHub',
        domain: 'github.com',
        url: 'https://github.com/public-samples/crm-seed/blob/main/contacts.json',
        snippet: '"phone": "+919876543210", "region": "Delhi-NCR"',
        engine: 'GitHub Code Search',
        date: '2023-12-09',
      },
      {
        format: 'WEB',
        title: 'Authorized Partner Listing — Delhi NCR',
        domain: 'indiamart.com',
        url: 'https://www.indiamart.com/proddetail/partner-listing.html',
        snippet: 'Verified merchant telephone record matching dashed and spaced variants.',
        engine: 'Google Search Grounding',
        date: '2023-06-21',
      },
    ],
    timelineEvents: [
      {
        date: '2025-02-14',
        kind: 'Archive',
        title: 'Public Tender PDF Indexed (procure.gov.in)',
        detail: 'Phone number cited inside PDF signatory appendix on procure.gov.in',
        sub: 'Google Search Grounding · PDF Document',
      },
      {
        date: '2024-09-03',
        kind: 'Breach',
        title: 'Exposed CSV Contact Roster Captured on Archive.org',
        detail: 'Bulk distributor contact spreadsheet containing phone and city fields',
        sub: 'Archive.org Search · CSV Export',
      },
      {
        date: '2024-06-18',
        kind: 'Archive',
        title: 'Exhibitor XLSX Spreadsheet Discovered',
        detail: 'Trade fair booth contact sheet matched zero-prefixed number format',
        sub: 'Bing Search Index · XLSX File',
      },
      {
        date: '2023-12-09',
        kind: 'Account',
        title: 'GitHub JSON Contact Reference Committed',
        detail: 'Phone string detected in public repository fixture JSON',
        sub: 'GitHub Code Search · JSON Artifact',
      },
      {
        date: '2023-06-21',
        kind: 'Infra',
        title: 'Business Directory Profile Verified',
        detail: 'Initial indexed business listing on IndiaMART & Justdial caches',
        sub: 'PhoneInfoga Web Dork · Directory',
      },
    ],
    detailInspect: {
      title: 'Deep Dork Evidence · procure.gov.in PDF',
      subtitle: 'Matched format variants: +919876543210 · 98765 43210 · 09876543210',
      properties: [
        { label: 'Target Variant', value: '+91 98765 43210' },
        { label: 'File Format', value: 'PDF (Public Index)' },
        { label: 'Source Engine', value: 'Google Search Grounding' },
        { label: 'Indexed Date', value: '2025-02-14' },
      ],
      diffLines: [
        { type: 'ctx', text: 'Document: GeM_Vendor_Empanelment_Roster_2025.pdf' },
        { type: 'add', text: '+ Signatory Contact: +91 98765 43210 (Delhi NCR Circle)' },
        { type: 'add', text: '+ Matched Dork: (filetype:pdf OR filetype:xlsx) ("+919876543210" OR "98765 43210")' },
      ],
    },
  },
  {
    id: 'email',
    tabLabel: '02. Email + Breach Timeline',
    target: 'arjun.sharma@company.in',
    targetType: 'Email Address',
    modules: ['MailAccess', 'Holehe', 'GHunt', 'Maigret', 'Blackbird'],
    aiRisk: 'Elevated',
    aiSummary:
      'Correlated 29 registered platforms, active GitHub commit author emails, GHunt Google Maps contributions, and 4 historical XposedOrNot breaches containing password hashes.',
    takeaways: [
      'GitHub commit patches directly expose author email & repository history.',
      '4 historical breach incidents indexed via XposedOrNot (2018–2023).',
      'DMARC & SPF strictly enforced on corporate domain company.in.',
    ],
    kpis: { total: 42, signals: 38, registered: 29, breached: 4, leaked: 2 },
    flowchartBranches: [
      { title: 'GitHub Account', meta: '14 commits · Patches', tone: 'border-emerald-500/45 text-emerald-300', dotColor: 'bg-emerald-400' },
      { title: 'XposedOrNot (4)', meta: 'Elevated Breaches', tone: 'border-rose-500/45 text-rose-300', dotColor: 'bg-rose-400' },
      { title: 'GHunt Profile & Maps', meta: 'Google Gaia Trace', tone: 'border-indigo-500/45 text-indigo-300', dotColor: 'bg-indigo-400' },
      { title: 'Holehe 120+ Apps', meta: '24 Registered', tone: 'border-sky-500/45 text-sky-300', dotColor: 'bg-sky-400' },
      { title: 'Gravatar Identity', meta: 'Avatar + OpenPGP', tone: 'border-orange-500/45 text-orange-300', dotColor: 'bg-orange-400' },
      { title: 'MX / SPF / DMARC', meta: 'company.in · IN', tone: 'border-amber-500/45 text-amber-300', dotColor: 'bg-amber-400' },
    ],
    cards: [
      {
        platform: 'GitHub Commit Identity',
        domain: 'github.com',
        handle: '@arjunsharma-in',
        category: 'Developer & Code',
        summary: '1 consolidated card · 14 commits with live diff patches',
        statusLabel: 'Registered',
      },
      {
        platform: 'XposedOrNot Analytics',
        domain: 'xposedornot.com',
        handle: '4 Breach Incidents',
        category: 'Breach & Exposure',
        summary: 'Passwords, usernames, and IP logs flagged across 4 datasets',
        statusLabel: 'Breached',
        isExposed: true,
      },
      {
        platform: 'GHunt Profile & Maps',
        domain: 'google.com',
        handle: 'Maps Reviews Link',
        category: 'Productivity & Cloud',
        summary: 'Resolved public Google Profile URL & Maps contribution timeline',
        statusLabel: 'Verified',
      },
      {
        platform: 'Holehe Platform Matrix',
        domain: 'spotify.com',
        handle: '24 Confirmed Apps',
        category: 'Social & Community',
        summary: 'Verified Spotify, Adobe, GitLab, Notion, and Slack registrations',
        statusLabel: 'Registered',
      },
      {
        platform: 'Gravatar & OpenPGP Key',
        domain: 'gravatar.com',
        handle: 'PGP 0x8F4C92A1',
        category: 'Email & Domain',
        summary: 'Matched MD5 avatar hash and verified PGP signing key',
        statusLabel: 'Verified',
      },
      {
        platform: 'Corporate DNS & TLS',
        domain: 'company.in',
        handle: 'ASN 13335 · IN',
        category: 'Network & Infrastructure',
        summary: 'SPF + DMARC p=reject active · Valid TLS through 2026',
        statusLabel: 'Infrastructure',
      },
    ],
    breachesList: [
      { name: 'CloudForum 2023', domain: 'cloudforum.io', classes: 'Email, Password Hash, IP', date: '2023-08' },
      { name: 'DevBoard Leak', domain: 'devboard.net', classes: 'Email, Username, Bio', date: '2021-11' },
      { name: 'StoreFront DB', domain: 'storefront.in', classes: 'Email, Phone, Address', date: '2019-04' },
    ],
    dorkSummary: { total: 34, files: 9, web: 21, queries: 6 },
    dorkHits: [
      {
        format: 'PDF',
        title: 'CloudInfra_Architecture_Speaker_Notes.pdf',
        domain: 'company.in',
        url: 'https://company.in/events/CloudInfra_Architecture_Speaker_Notes.pdf',
        snippet: 'Author contact: arjun.sharma@company.in · Principal Security Architect.',
        engine: 'Google Search Grounding',
        date: '2025-01-19',
      },
      {
        format: 'CODE',
        title: 'Commit 4f9a21d: terraform/prod.tfvars author trail',
        domain: 'github.com',
        url: 'https://github.com/company-oss/infra/commit/4f9a21d',
        snippet: 'Author: Arjun Sharma <arjun.sharma@company.in> · Added WAF rules.',
        engine: 'GitHub Code Search',
        date: '2024-10-02',
      },
      {
        format: 'CSV',
        title: 'OSS_Maintainers_Roster_2024.csv',
        domain: 'github.com',
        url: 'https://gist.github.com/maintainers/OSS_Maintainers_Roster_2024.csv',
        snippet: 'arjun.sharma@company.in, arjunsharma-in, PGP verified',
        engine: 'Bing Search Index',
        date: '2024-04-15',
      },
      {
        format: 'WEB',
        title: 'Hacker News AMA Thread Mention',
        domain: 'news.ycombinator.com',
        url: 'https://news.ycombinator.com/item?id=39104281',
        snippet: 'Reach out directly via arjun.sharma@company.in for security advisories.',
        engine: 'Hacker News',
        date: '2024-02-07',
      },
      {
        format: 'XLSX',
        title: 'CERT_IN_Workshop_Delegates_2024.xlsx',
        domain: 'cert-in.org.in',
        url: 'https://cert-in.org.in/delegates/workshop_2024.xlsx',
        snippet: 'Arjun Sharma · company.in · Incident Response Panelist',
        engine: 'DuckDuckGo Dork',
        date: '2024-01-14',
      },
      {
        format: 'DOCX',
        title: 'Security_Advisory_Disclosure_Template.docx',
        domain: 'company.in',
        url: 'https://company.in/security/disclosure-policy.docx',
        snippet: 'Primary PGP-verified security contact: arjun.sharma@company.in.',
        engine: 'Google Search Grounding',
        date: '2023-10-28',
      },
    ],
    timelineEvents: [
      {
        date: '2025-01-19',
        kind: 'Archive',
        title: 'Conference Speaker PDF Indexed (company.in)',
        detail: 'Contact email published in architecture slide deck PDF',
        sub: 'Google Search Grounding · PDF Document',
      },
      {
        date: '2024-10-02',
        kind: 'Account',
        title: 'GitHub Commit 4f9a21d Exposed Email Header',
        detail: 'Author patch header confirmed on public company-oss/infra repo',
        sub: 'GitHub Commit Diff · @arjunsharma-in',
      },
      {
        date: '2023-08-14',
        kind: 'Breach',
        title: 'CloudForum Security Breach (High Severity)',
        detail: 'Exposed classes: Emails, Password Hashes, IP Addresses',
        sub: 'XposedOrNot Breach Index · cloudforum.io',
      },
      {
        date: '2021-11-08',
        kind: 'Breach',
        title: 'DevBoard Credential & Handle Exposure',
        detail: 'Exposed classes: Email, Username, Profile Bio',
        sub: 'XposedOrNot Breach Index · devboard.net',
      },
      {
        date: '2019-04-12',
        kind: 'Breach',
        title: 'StoreFront E-Commerce Customer DB Leak',
        detail: 'Exposed classes: Email, Phone Number, Shipping City',
        sub: 'XposedOrNot Breach Index · storefront.in',
      },
    ],
    detailInspect: {
      title: 'GitHub Commit Diff · company-oss/infra',
      subtitle: 'Commit SHA 4f9a21d · Author email arjun.sharma@company.in',
      properties: [
        { label: 'Repository', value: 'company-oss/infra' },
        { label: 'Commit Author', value: 'arjun.sharma@company.in' },
        { label: 'Date', value: '2024-10-02' },
        { label: 'Files Changed', value: '2 files (+18 / -3)' },
      ],
      diffLines: [
        { type: 'ctx', text: '@@ -12,4 +12,6 @@ resource "aws_wafv2_web_acl" "edge" {' },
        { type: 'del', text: '-  default_action = "allow"' },
        { type: 'add', text: '+  default_action = "block_rate_limited"' },
        { type: 'add', text: '+  contact_email  = "arjun.sharma@company.in"' },
      ],
    },
  },
  {
    id: 'username',
    tabLabel: '03. Username + GitHub',
    target: '@torvalds',
    targetType: 'Username Handle',
    modules: ['MailAccess', 'Maigret', 'Blackbird', 'Sherlock'],
    aiRisk: 'Low',
    aiSummary:
      'High-confidence public developer footprint across 34 platforms led by GitHub (torvalds/linux), Hacker News discussions, Reddit threads, and Linux Foundation keynote archives.',
    takeaways: [
      'GitHub consolidated into 1 clean primary card with commit diffs.',
      'Cross-platform handle consistency confirmed across 34 developer networks.',
      'Zero breach/credential exposure flagged across indexed leak sets.',
    ],
    kpis: { total: 36, signals: 36, registered: 34, breached: 0, leaked: 0 },
    flowchartBranches: [
      { title: 'GitHub · torvalds', meta: 'torvalds/linux', tone: 'border-emerald-500/45 text-emerald-300', dotColor: 'bg-emerald-400' },
      { title: 'Hacker News', meta: '48 Archive Hits', tone: 'border-orange-500/45 text-orange-300', dotColor: 'bg-orange-400' },
      { title: 'Reddit Mentions', meta: 'r/linux · Discussions', tone: 'border-indigo-500/45 text-indigo-300', dotColor: 'bg-indigo-400' },
      { title: 'Keybase PGP', meta: 'Identity Proof', tone: 'border-sky-500/45 text-sky-300', dotColor: 'bg-sky-400' },
      { title: 'Linux Foundation', meta: 'PDF Keynotes', tone: 'border-amber-500/45 text-amber-300', dotColor: 'bg-amber-400' },
      { title: 'Maigret / Sherlock', meta: '34 Confirmed', tone: 'border-teal-500/45 text-teal-300', dotColor: 'bg-teal-400' },
    ],
    cards: [
      {
        platform: 'GitHub Developer Profile',
        domain: 'github.com',
        handle: '@torvalds',
        category: 'Developer & Code',
        summary: '200k+ followers · torvalds/linux · Consolidated commits & patch viewer',
        statusLabel: 'Registered',
      },
      {
        platform: 'Hacker News Archive',
        domain: 'news.ycombinator.com',
        handle: '48 Discussions',
        category: 'Social & Community',
        summary: 'Kernel announcements, patches, and engineering thread references',
        statusLabel: 'Verified',
      },
      {
        platform: 'Keybase Identity Proof',
        domain: 'keybase.io',
        handle: 'torvalds',
        category: 'Developer & Code',
        summary: 'Cryptographically linked PGP fingerprint and domain proofs',
        statusLabel: 'Registered',
      },
      {
        platform: 'Linux Foundation Docs',
        domain: 'linuxfoundation.org',
        handle: 'PDF Whitepapers',
        category: 'Productivity & Cloud',
        summary: 'Keynote transcripts & annual kernel development reports',
        statusLabel: 'Indexed',
      },
      {
        platform: 'Wikipedia & Wikidata',
        domain: 'wikipedia.org',
        handle: 'Linus Torvalds',
        category: 'Social & Community',
        summary: 'Biographical record & verified public handle aliases',
        statusLabel: 'Verified',
      },
      {
        platform: 'Wayback CDX Snapshots',
        domain: 'web.archive.org',
        handle: '2001–2025 Captures',
        category: 'Archives & Records',
        summary: 'Historical mailing list & profile snapshots archived cleanly',
        statusLabel: 'Archived',
      },
    ],
    breachesList: [],
    dorkSummary: { total: 48, files: 14, web: 22, queries: 6 },
    dorkHits: [
      {
        format: 'CODE',
        title: 'torvalds/linux: Linux kernel source tree',
        domain: 'github.com',
        url: 'https://github.com/torvalds/linux',
        snippet: 'Primary kernel tree maintained under @torvalds with live commit history.',
        engine: 'GitHub Code Search',
        date: '2025-03-01',
      },
      {
        format: 'PDF',
        title: 'Linux_Kernel_History_Report_2024.pdf',
        domain: 'linuxfoundation.org',
        url: 'https://linuxfoundation.org/reports/Linux_Kernel_History_Report_2024.pdf',
        snippet: 'Maintainer insights & contributor breakdown referencing @torvalds.',
        engine: 'Google Search Grounding',
        date: '2024-11-12',
      },
      {
        format: 'WEB',
        title: 'Git 20th Anniversary Retrospective',
        domain: 'news.ycombinator.com',
        url: 'https://news.ycombinator.com/item?id=40129011',
        snippet: 'Detailed technical breakdown of initial Git design commits by torvalds.',
        engine: 'Hacker News',
        date: '2024-04-07',
      },
      {
        format: 'TXT',
        title: 'lkml_kernel_release_notes_v6.txt',
        domain: 'kernel.org',
        url: 'https://cdn.kernel.org/pub/linux/kernel/v6.x/ChangeLog',
        snippet: 'Signed-off-by: Linus Torvalds · Plaintext release log.',
        engine: 'DuckDuckGo Dork',
        date: '2024-01-20',
      },
      {
        format: 'CSV',
        title: 'Kernel_Maintainers_Directory_2024.csv',
        domain: 'kernel.org',
        url: 'https://kernel.org/doc/maintainers.csv',
        snippet: 'Subsystem: Core / Tree · Maintainer handle: @torvalds',
        engine: 'Bing Search Index',
        date: '2023-11-05',
      },
      {
        format: 'DOCX',
        title: 'OSS_Summit_Keynote_Transcript.docx',
        domain: 'events.linuxfoundation.org',
        url: 'https://events.linuxfoundation.org/archive/keynote-transcript.docx',
        snippet: 'Fireside chat transcript featuring Linus Torvalds (@torvalds).',
        engine: 'Archive.org Search',
        date: '2023-09-18',
      },
    ],
    timelineEvents: [
      {
        date: '2025-03-01',
        kind: 'Account',
        title: 'torvalds/linux Mainline Commit Pushed',
        detail: 'Merge tag pull request verified on GitHub public timeline',
        sub: 'GitHub Events · github.com/torvalds/linux',
      },
      {
        date: '2024-11-12',
        kind: 'Archive',
        title: 'Linux Foundation Annual Report PDF Indexed',
        detail: 'Whitepaper PDF surfaced by Google Search Grounding',
        sub: 'linuxfoundation.org · PDF Document',
      },
      {
        date: '2024-01-20',
        kind: 'Archive',
        title: 'Kernel.org Plaintext ChangeLog Captured',
        detail: 'Public release note file indexed with TXT dork operator',
        sub: 'kernel.org · TXT File',
      },
      {
        date: '2011-09-04',
        kind: 'Account',
        title: 'GitHub Profile Created (@torvalds)',
        detail: 'Initial public GitHub account registration timestamp',
        sub: 'GitHub Users API · Profile Anchor',
      },
    ],
    detailInspect: {
      title: 'GitHub Repository & Live Commit · torvalds/linux',
      subtitle: 'SHA 8d3c90a · Consolidated primary developer card',
      properties: [
        { label: 'Handle', value: '@torvalds' },
        { label: 'Primary Repo', value: 'torvalds/linux' },
        { label: 'Followers', value: '218,400+' },
        { label: 'Last Activity', value: '2025-03-01' },
      ],
      diffLines: [
        { type: 'ctx', text: '@@ -1,3 +1,4 @@ Makefile — Linux 6.14' },
        { type: 'del', text: '- EXTRAVERSION = -rc4' },
        { type: 'add', text: '+ EXTRAVERSION = -rc5' },
        { type: 'add', text: '+ Signed-off-by: Linus Torvalds' },
      ],
    },
  },
];

type DemoPhase =
  | 'search_type'
  | 'click_launch'
  | 'stream_results'
  | 'click_dork'
  | 'show_dork'
  | 'click_timeline'
  | 'show_timeline'
  | 'click_detail'
  | 'show_detail';

function DorkFormatIcon({
  format,
}: {
  format: 'PDF' | 'XLSX' | 'CSV' | 'CODE' | 'DOCX' | 'TXT' | 'WEB';
}) {
  if (format === 'XLSX' || format === 'CSV') {
    return <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />;
  }
  if (format === 'PDF' || format === 'DOCX' || format === 'TXT') {
    return <FileText className="w-3.5 h-3.5 text-orange-600 shrink-0" />;
  }
  if (format === 'CODE') {
    return <Code2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />;
  }
  return <Globe className="w-3.5 h-3.5 text-slate-500 shrink-0" />;
}

export function InteractiveCursorDemo() {
  const prefersReducedMotion = useReducedMotion();
  const [scenarioIdx, setScenarioIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [phase, setPhase] = useState<DemoPhase>(
    prefersReducedMotion ? 'stream_results' : 'search_type'
  );
  const [typedLength, setTypedLength] = useState(0);
  const [cursorPos, setCursorPos] = useState({ x: 320, y: 180 });
  const [clickRippleKey, setClickRippleKey] = useState(0);
  const [counterProgress, setCounterProgress] = useState(0);

  const stageRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const launchBtnRef = useRef<HTMLDivElement>(null);
  const dorkBtnRef = useRef<HTMLDivElement>(null);
  const timelineBtnRef = useRef<HTMLDivElement>(null);
  const inspectBtnRef = useRef<HTMLDivElement>(null);

  const scenario = SCENARIOS[scenarioIdx];

  const moveCursorTo = useCallback((targetEl: HTMLElement | null) => {
    const stage = stageRef.current;
    if (!stage || !targetEl) return;
    const sRect = stage.getBoundingClientRect();
    const tRect = targetEl.getBoundingClientRect();
    if (sRect.width === 0 || tRect.width === 0) return;
    setCursorPos({
      x: Math.round(tRect.left - sRect.left + tRect.width * 0.52),
      y: Math.round(tRect.top - sRect.top + tRect.height * 0.52),
    });
  }, []);

  const triggerClick = useCallback(() => {
    setClickRippleKey((k) => k + 1);
  }, []);

  const startScenario = useCallback((nextIdx: number) => {
    setScenarioIdx(nextIdx);
    setTypedLength(0);
    setCounterProgress(0);
    setPhase('search_type');
  }, []);

  // Character-by-character typing in Search Phase
  useEffect(() => {
    if (!playing || prefersReducedMotion) return;
    if (phase !== 'search_type') return;

    setTypedLength(0);
    const full = scenario.target;
    let count = 0;
    const iv = window.setInterval(() => {
      count += 1;
      setTypedLength(count);
      if (count >= full.length) {
        window.clearInterval(iv);
      }
    }, Math.max(42, Math.min(80, Math.floor(1650 / full.length))));

    return () => window.clearInterval(iv);
  }, [phase, scenario.target, playing, prefersReducedMotion]);

  // Smooth odometer counter animation across results phases
  useEffect(() => {
    if (prefersReducedMotion) {
      setCounterProgress(1);
      return;
    }
    if (phase !== 'search_type' && phase !== 'click_launch') {
      if (counterProgress >= 1) return;
      const start = performance.now();
      let raf = 0;
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / 1450);
        setCounterProgress(1 - Math.pow(1 - p, 3));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    } else {
      setCounterProgress(0);
    }
  }, [phase, counterProgress, prefersReducedMotion]);

  // Autonomous cursor targeting per phase
  useEffect(() => {
    if (prefersReducedMotion) return;

    const timer = window.setTimeout(() => {
      if (phase === 'search_type') {
        moveCursorTo(inputRef.current);
      } else if (phase === 'click_launch') {
        moveCursorTo(launchBtnRef.current);
        window.setTimeout(triggerClick, 320);
      } else if (phase === 'stream_results') {
        moveCursorTo(dorkBtnRef.current);
      } else if (phase === 'click_dork') {
        moveCursorTo(dorkBtnRef.current);
        window.setTimeout(triggerClick, 240);
      } else if (phase === 'show_dork') {
        moveCursorTo(timelineBtnRef.current);
      } else if (phase === 'click_timeline') {
        moveCursorTo(timelineBtnRef.current);
        window.setTimeout(triggerClick, 240);
      } else if (phase === 'show_timeline') {
        moveCursorTo(inspectBtnRef.current);
      } else if (phase === 'click_detail') {
        moveCursorTo(inspectBtnRef.current);
        window.setTimeout(triggerClick, 240);
      }
    }, 80);

    return () => window.clearTimeout(timer);
  }, [phase, scenarioIdx, moveCursorTo, triggerClick, prefersReducedMotion]);

  // Playback loop state machine
  useEffect(() => {
    if (!playing || prefersReducedMotion) return;

    const durations: Record<DemoPhase, number> = {
      search_type: 2450,
      click_launch: 900,
      stream_results: 3000,
      click_dork: 750,
      show_dork: 3200,
      click_timeline: 750,
      show_timeline: 2900,
      click_detail: 750,
      show_detail: 2900,
    };

    const nextMap: Record<DemoPhase, DemoPhase | 'NEXT_SCENARIO'> = {
      search_type: 'click_launch',
      click_launch: 'stream_results',
      stream_results: 'click_dork',
      click_dork: 'show_dork',
      show_dork: 'click_timeline',
      click_timeline: 'show_timeline',
      show_timeline: 'click_detail',
      click_detail: 'show_detail',
      show_detail: 'NEXT_SCENARIO',
    };

    const t = window.setTimeout(() => {
      const next = nextMap[phase];
      if (next === 'NEXT_SCENARIO') {
        startScenario((scenarioIdx + 1) % SCENARIOS.length);
      } else {
        setPhase(next);
      }
    }, durations[phase]);

    return () => window.clearTimeout(t);
  }, [phase, playing, scenarioIdx, startScenario, prefersReducedMotion]);

  const inSearchView = phase === 'search_type' || phase === 'click_launch';
  const showingDork = phase === 'show_dork' || phase === 'click_timeline';
  const showingTimeline =
    phase === 'show_timeline' || phase === 'click_detail';
  const showingDetail = phase === 'show_detail';
  const displayedTyped =
    phase === 'search_type'
      ? scenario.target.slice(0, typedLength)
      : scenario.target;

  const stepIndex = inSearchView
    ? 0
    : phase === 'stream_results' || phase === 'click_dork'
    ? 1
    : showingDork
    ? 2
    : showingTimeline
    ? 3
    : 4;

  const stageThemes = [
    // 0: Saffron -> Indigo
    {
      gradient: 'linear-gradient(135deg, #fff7ed 0%, #eef2ff 52%, #e0f2fe 100%)',
      orbA: 'rgba(249, 115, 22, 0.28)',
      orbB: 'rgba(99, 102, 241, 0.26)',
      orbC: 'rgba(56, 189, 248, 0.22)',
    },
    // 1: Emerald -> Sky
    {
      gradient: 'linear-gradient(135deg, #ecfdf5 0%, #f0f9ff 52%, #eef2ff 100%)',
      orbA: 'rgba(16, 185, 129, 0.28)',
      orbB: 'rgba(14, 165, 233, 0.25)',
      orbC: 'rgba(99, 102, 241, 0.2)',
    },
    // 2: Sky -> Violet
    {
      gradient: 'linear-gradient(135deg, #e0f2fe 0%, #f5f3ff 52%, #fef3c7 100%)',
      orbA: 'rgba(56, 189, 248, 0.28)',
      orbB: 'rgba(139, 92, 246, 0.26)',
      orbC: 'rgba(245, 158, 11, 0.22)',
    },
    // 3: Amber -> Rose
    {
      gradient: 'linear-gradient(135deg, #fef3c7 0%, #fff1f2 52%, #eef2ff 100%)',
      orbA: 'rgba(245, 158, 11, 0.28)',
      orbB: 'rgba(244, 63, 94, 0.24)',
      orbC: 'rgba(99, 102, 241, 0.2)',
    },
    // 4: Teal -> Cyan -> Indigo
    {
      gradient: 'linear-gradient(135deg, #f0fdfa 0%, #ecfeff 50%, #e0e7ff 100%)',
      orbA: 'rgba(20, 184, 166, 0.28)',
      orbB: 'rgba(79, 70, 229, 0.26)',
      orbC: 'rgba(6, 182, 212, 0.24)',
    },
  ];
  const activeTheme = stageThemes[(scenarioIdx + stepIndex) % stageThemes.length];
  const orbPositions = [
    { ax: '62%', ay: '-14%', bx: '8%', by: '62%', cx: '40%', cy: '25%', scale: 1.0 },
    { ax: '14%', ay: '-10%', bx: '68%', by: '55%', cx: '45%', cy: '15%', scale: 1.15 },
    { ax: '72%', ay: '22%', bx: '16%', by: '-12%', cx: '52%', cy: '68%', scale: 1.08 },
    { ax: '28%', ay: '48%', bx: '70%', by: '-8%', cx: '12%', cy: '18%', scale: 1.18 },
    { ax: '50%', ay: '-16%', bx: '18%', by: '50%', cx: '78%', cy: '60%', scale: 1.05 },
  ][stepIndex % 5];

  const activeStagePhotoIdx = (scenarioIdx + stepIndex) % STAGE_PHOTOS.length;

  return (
    <motion.div
      animate={{ backgroundImage: activeTheme.gradient }}
      transition={{ duration: 0.9, ease: 'easeInOut' }}
      className="w-full rounded-2xl overflow-hidden border border-slate-200/85 shadow-[0_22px_60px_rgba(15,23,42,0.1)] text-left select-none relative"
      style={{ backgroundImage: activeTheme.gradient }}
    >
      {/* Top Interactive Walkthrough Control Bar */}
      <div className="relative z-10 px-4 py-2.5 bg-white/95 backdrop-blur-md border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {SCENARIOS.map((sc, idx) => {
            const active = idx === scenarioIdx;
            return (
              <button
                key={sc.id}
                type="button"
                onClick={() => {
                  startScenario(idx);
                  setPlaying(true);
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[#0F172A] text-white'
                    : 'text-slate-600 hover:text-[#0F172A] hover:bg-slate-100'
                }`}
              >
                {sc.tabLabel}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          <div className="hidden xl:flex items-center gap-1.5 mr-2 text-slate-500 font-medium">
            {[
              { label: '1. Search', target: 'search_type' as DemoPhase },
              { label: '2. Live Canvas', target: 'stream_results' as DemoPhase },
              { label: '3. Deep Dorking', target: 'show_dork' as DemoPhase },
              { label: '4. Timeline', target: 'show_timeline' as DemoPhase },
              { label: '5. Diff & Detail', target: 'show_detail' as DemoPhase },
            ].map((item, i) => (
              <React.Fragment key={item.label}>
                <button
                  type="button"
                  onClick={() => {
                    setPhase(item.target);
                    setPlaying(false);
                  }}
                  className={`cursor-pointer transition-colors whitespace-nowrap ${
                    stepIndex === i
                      ? 'text-indigo-700 font-semibold'
                      : 'text-slate-400 hover:text-slate-700'
                  }`}
                >
                  {item.label}
                </button>
                {i < 4 && (
                  <span className="text-slate-300" aria-hidden="true">
                    /
                  </span>
                )}
              </React.Fragment>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 hover:text-[#0F172A] cursor-pointer whitespace-nowrap"
          >
            {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            <span>{playing ? 'Pause' : 'Play'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              startScenario(scenarioIdx);
              setPlaying(true);
            }}
            aria-label="Replay walkthrough"
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-[#0F172A] cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Simulated Full Workspace Frame with Floating Automated Cursor */}
      <div
        ref={stageRef}
        className="relative grid grid-cols-12 min-h-[540px] sm:min-h-[580px] overflow-hidden"
      >
        {/* Crossfading Architectural Backdrop Photography inside Preview Stage */}
        {STAGE_PHOTOS.map((photoSrc, idx) => {
          const isActive = idx === activeStagePhotoIdx;
          return (
            <motion.img
              key={photoSrc}
              src={photoSrc}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              initial={false}
              animate={
                prefersReducedMotion
                  ? { opacity: idx === 0 ? 0.38 : 0, scale: 1 }
                  : isActive
                  ? { opacity: 0.45, scale: 1.05 }
                  : { opacity: 0, scale: 1.01 }
              }
              transition={{
                opacity: { duration: 1.05, ease: 'easeInOut' },
                scale: { duration: 3.4, ease: 'easeOut' },
              }}
              className="pointer-events-none absolute inset-0 w-full h-full object-cover object-center"
            />
          );
        })}

        <motion.div
          aria-hidden="true"
          animate={{
            left: orbPositions.ax,
            top: orbPositions.ay,
            scale: orbPositions.scale,
            backgroundColor: activeTheme.orbA,
          }}
          transition={{ duration: 1.25, ease: 'easeInOut' }}
          className="pointer-events-none absolute w-80 h-80 rounded-full blur-3xl"
        />
        <motion.div
          aria-hidden="true"
          animate={{
            left: orbPositions.bx,
            top: orbPositions.by,
            scale: orbPositions.scale * 0.95,
            backgroundColor: activeTheme.orbB,
          }}
          transition={{ duration: 1.35, ease: 'easeInOut' }}
          className="pointer-events-none absolute w-80 h-80 rounded-full blur-3xl"
        />
        <motion.div
          aria-hidden="true"
          animate={{
            left: orbPositions.cx,
            top: orbPositions.cy,
            scale: orbPositions.scale * 1.05,
            backgroundColor: activeTheme.orbC,
          }}
          transition={{ duration: 1.45, ease: 'easeInOut' }}
          className="pointer-events-none absolute w-72 h-72 rounded-full blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-35"
          style={{
            backgroundImage:
              'radial-gradient(rgba(15, 23, 42, 0.08) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        />
        {/* Realistic Parmanu Left Sidebar Rail */}
        <aside className="relative z-10 hidden lg:flex lg:col-span-2 flex-col justify-between p-3.5 bg-white/88 backdrop-blur-md border-r border-slate-200/75">
          <div className="space-y-4">
            <div className="flex items-center gap-2 px-1.5 py-1">
              <span className="w-6 h-6 rounded-lg bg-[#0F172A] text-white flex items-center justify-center text-xs font-bold">
                ॐ
              </span>
              <span className="font-display text-sm font-bold text-[#0F172A]">
                Parmanu<span className="text-orange-600">.</span>
              </span>
            </div>

            <div className="space-y-1 text-[11px]">
              {[
                { label: 'New Search', Icon: Search, active: inSearchView },
                { label: 'Results Canvas', Icon: Layers, active: !inSearchView && !showingDetail },
                { label: 'Record Detail', Icon: FolderOpen, active: showingDetail },
                { label: 'Batch Queue', Icon: FileUp, active: false },
                { label: 'Modules (8)', Icon: Cpu, active: false },
                { label: 'Monitoring', Icon: Bell, active: false },
                { label: 'Team Workspace', Icon: Users, active: false },
              ].map(({ label, Icon, active }) => (
                <div
                  key={label}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                    active
                      ? 'bg-[#0F172A] text-white shadow-2xs'
                      : 'text-slate-600'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-[#FAFAFA] border border-slate-200/80 text-[10px] space-y-0.5">
            <p className="font-semibold text-[#0F172A] truncate">Authorized Mode</p>
            <p className="font-mono text-slate-500 truncate">analyst@parmanu.in</p>
          </div>
        </aside>

        {/* Main Simulated Workspace Canvas */}
        <div className="relative z-10 col-span-12 lg:col-span-10 p-4 sm:p-5 flex flex-col justify-between overflow-hidden">
          <AnimatePresence mode="wait">
            {inSearchView ? (
              <motion.div
                key="stage-search"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="my-auto max-w-3xl mx-auto w-full space-y-5"
              >
                <div className="text-center space-y-1.5">
                  <p className="text-[11px] font-semibold text-orange-600">
                    Authorized Intelligence Workspace
                  </p>
                  <h3 className="font-display text-xl sm:text-2xl font-bold text-[#0F172A]">
                    Launch a unified multi-module investigation
                  </h3>
                  <p className="text-xs text-slate-500">
                    Automatic identifier classification isolates strict OSINT
                    adapters per target format.
                  </p>
                </div>

                <div className="rounded-2xl bg-white/95 backdrop-blur-xl border border-slate-200/85 shadow-sm p-5 sm:p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-[#0F172A]">
                      Target Identifier
                    </span>
                    <span className="font-mono text-[11px] text-indigo-700 font-medium">
                      Detected:{' '}
                      {displayedTyped.length > 2
                        ? scenario.targetType
                        : 'Awaiting input'}
                    </span>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <div
                      ref={inputRef}
                      className={`flex-1 h-12 px-4 rounded-xl border flex items-center gap-2.5 bg-white transition-all ${
                        phase === 'search_type'
                          ? 'border-indigo-500 ring-2 ring-indigo-500/15'
                          : 'border-slate-200'
                      }`}
                    >
                      <Search className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="font-mono text-sm sm:text-base text-[#0F172A] truncate">
                        {displayedTyped}
                        {phase === 'search_type' && (
                          <span className="inline-block w-0.5 h-4 bg-orange-600 align-middle ml-0.5 animate-pulse" />
                        )}
                      </span>
                    </div>

                    <div
                      ref={launchBtnRef}
                      className={`h-12 px-5 rounded-xl flex items-center justify-center gap-2 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-all ${
                        phase === 'click_launch'
                          ? 'bg-indigo-700 scale-[0.97]'
                          : 'bg-[#0F172A]'
                      }`}
                    >
                      <span>
                        {phase === 'click_launch'
                          ? 'Dispatching Modules...'
                          : 'Authorize & Launch'}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  </div>

                  {/* Active OSINT Modules Matrix */}
                  <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span className="text-slate-500 font-medium">
                      Strict Pipeline Active:
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {scenario.modules.map((mod) => (
                        <span
                          key={mod}
                          className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200/70 font-mono text-[10px] font-medium"
                        >
                          {mod}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="stage-results"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-3.5 w-full"
              >
                {/* Results Top Header + Interactive Action Buttons */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-base sm:text-lg font-bold text-[#0F172A] truncate">
                        {scenario.target}
                      </p>
                      <span className="text-[11px] font-semibold uppercase text-orange-600">
                        · {scenario.targetType}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      {scenario.modules.map((mod) => (
                        <span
                          key={mod}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50/90 border border-emerald-200/80 text-[10px] font-medium text-emerald-700"
                        >
                          <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
                          <span>{mod}</span>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div
                      ref={dorkBtnRef}
                      className={`px-3 py-1.5 rounded-xl border text-[11px] font-semibold inline-flex items-center gap-1.5 transition-all whitespace-nowrap ${
                        phase === 'click_dork' || showingDork
                          ? 'bg-indigo-600 text-white border-indigo-600 scale-[0.98]'
                          : 'bg-white border-indigo-200 text-indigo-700'
                      }`}
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      <span>
                        {phase === 'click_dork'
                          ? 'Dorking Web & Files...'
                          : 'Show Google Dorking Results'}
                      </span>
                    </div>

                    <div
                      ref={timelineBtnRef}
                      className={`px-3 py-1.5 rounded-xl border text-[11px] font-semibold inline-flex items-center gap-1.5 transition-all whitespace-nowrap ${
                        showingTimeline || phase === 'click_timeline'
                          ? 'bg-[#0F172A] text-white border-[#0F172A]'
                          : 'bg-white border-slate-200 text-[#0F172A]'
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Breach & Signal Timeline</span>
                    </div>
                  </div>
                </div>

                {/* 5 Live Odometer KPI Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  {[
                    {
                      label: 'Total Results',
                      sub: 'All discovered',
                      val: Math.round(scenario.kpis.total * counterProgress),
                      color: 'text-[#0F172A]',
                    },
                    {
                      label: 'Parmanu Signals',
                      sub: 'Platform & web',
                      val: Math.round(scenario.kpis.signals * counterProgress),
                      color: 'text-indigo-700',
                    },
                    {
                      label: 'Registered Accounts',
                      sub: 'Verified profiles',
                      val: Math.round(scenario.kpis.registered * counterProgress),
                      color: 'text-emerald-700',
                    },
                    {
                      label: 'Breached Results',
                      sub: 'Security breaches',
                      val: Math.round(scenario.kpis.breached * counterProgress),
                      color: 'text-rose-600',
                    },
                    {
                      label: 'Leaked Results',
                      sub: 'Exposed files/logs',
                      val: Math.round(scenario.kpis.leaked * counterProgress),
                      color: 'text-amber-600',
                    },
                  ].map((k) => (
                    <div
                      key={k.label}
                      className="p-3 rounded-xl bg-white/95 border border-slate-200/80 shadow-2xs"
                    >
                      <p className="text-[10px] font-semibold text-slate-600 truncate">
                        {k.label}
                      </p>
                      <p
                        className={`font-display text-xl sm:text-2xl font-bold tabular-nums mt-0.5 ${k.color}`}
                      >
                        {k.val}
                      </p>
                      <p className="text-[9px] text-slate-400 truncate">
                        {k.sub}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Main Detailed Switching View */}
                <AnimatePresence mode="wait">
                  {showingDork ? (
                    <motion.div
                      key="sub-dork-full"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.25 }}
                      className="rounded-2xl bg-white/95 border border-indigo-200/80 p-4 space-y-3.5 shadow-2xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="w-7 h-7 rounded-lg bg-[#0F172A] text-white flex items-center justify-center">
                            <Terminal className="w-3.5 h-3.5 text-orange-400" />
                          </span>
                          <div>
                            <p className="text-xs font-bold text-[#0F172A]">
                              Deep Google Dorking & Public Record Discovery
                            </p>
                            <p className="text-[10px] text-slate-500">
                              Google Search Grounding · Bing RSS · DuckDuckGo ·
                              Archive.org · GitHub · crt.sh
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums">
                          <span className="text-[#0F172A] font-semibold">
                            {scenario.dorkSummary.total} Live Hits
                          </span>
                          <span className="text-orange-600 font-semibold">
                            {scenario.dorkSummary.files} Files
                          </span>
                          <span className="text-indigo-600 font-semibold">
                            {scenario.dorkSummary.queries} Queries
                          </span>
                        </div>
                      </div>

                      {/* 6 Rich Dork Hit Cards */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                        {scenario.dorkHits.map((hit) => (
                          <div
                            key={hit.title}
                            className="p-3 rounded-xl bg-[#FAFAFA] border border-slate-200/85 space-y-1.5 flex flex-col justify-between"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center justify-between gap-2 text-[10px]">
                                <span className="inline-flex items-center gap-1 font-mono font-semibold text-slate-700">
                                  <DorkFormatIcon format={hit.format} />
                                  <span>{hit.format}</span>
                                  <span className="text-slate-300">·</span>
                                  <span className="truncate max-w-[95px]">
                                    {hit.domain}
                                  </span>
                                </span>
                                {hit.date && (
                                  <span className="font-mono text-slate-400 tabular-nums shrink-0">
                                    {hit.date}
                                  </span>
                                )}
                              </div>

                              <p className="text-xs font-semibold text-[#0F172A] line-clamp-1">
                                {hit.title}
                              </p>

                              <p className="text-[10px] text-slate-500 line-clamp-2 leading-relaxed">
                                {hit.snippet}
                              </p>
                            </div>

                            <div className="pt-1.5 border-t border-slate-200/70 flex items-center justify-between text-[10px]">
                              <span className="font-medium text-indigo-600 truncate">
                                {hit.engine}
                              </span>
                              <ArrowUpRight className="w-3 h-3 text-slate-400 shrink-0" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  ) : showingTimeline ? (
                    <motion.div
                      key="sub-timeline-full"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.25 }}
                      className="rounded-2xl bg-white/95 border border-slate-200/85 p-4 space-y-3 shadow-2xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-orange-600" />
                          <span className="text-xs font-bold text-[#0F172A]">
                            Chronological Breach & Signal Timeline
                          </span>
                          <span className="text-[10px] text-slate-400">
                            · {scenario.timelineEvents.length} dated events
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-500">
                          Breaches · Commits · PDF Dorks · Archives
                        </span>
                      </div>

                      <div className="relative pl-5 space-y-2 before:content-[''] before:absolute before:left-[9px] before:top-2 before:bottom-2 before:w-px before:bg-slate-200">
                        {scenario.timelineEvents.map((ev, idx) => (
                          <div
                            key={ev.date + ev.title}
                            className="relative p-2.5 rounded-xl bg-[#FAFAFA] border border-slate-200/85 flex items-center justify-between gap-3"
                          >
                            <span
                              className={`absolute -left-5 top-3.5 w-4.5 h-4.5 rounded-full bg-white border flex items-center justify-center ${
                                ev.kind === 'Breach'
                                  ? 'border-rose-300 text-rose-600'
                                  : ev.kind === 'Account'
                                  ? 'border-emerald-300 text-emerald-700'
                                  : ev.kind === 'Archive'
                                  ? 'border-orange-300 text-orange-600'
                                  : 'border-indigo-300 text-indigo-600'
                              }`}
                            >
                              {ev.kind === 'Breach' ? (
                                <ShieldAlert className="w-2.5 h-2.5" />
                              ) : (
                                <UserCheck className="w-2.5 h-2.5" />
                              )}
                            </span>

                            <div className="min-w-0">
                              <div className="flex items-center gap-2 text-[10px]">
                                <span className="font-mono font-bold text-[#0F172A] tabular-nums">
                                  {ev.date}
                                </span>
                                <span className="text-slate-300">·</span>
                                <span
                                  className={`font-semibold ${
                                    ev.kind === 'Breach'
                                      ? 'text-rose-600'
                                      : ev.kind === 'Archive'
                                      ? 'text-orange-600'
                                      : 'text-emerald-700'
                                  }`}
                                >
                                  {ev.kind}
                                </span>
                                <span className="text-slate-300 hidden sm:inline">·</span>
                                <span className="text-slate-400 font-mono hidden sm:inline truncate">
                                  {ev.sub}
                                </span>
                              </div>
                              <p className="text-xs font-semibold text-[#0F172A] truncate mt-0.5">
                                {ev.title}
                              </p>
                              <p className="text-[10px] text-slate-500 truncate">
                                {ev.detail}
                              </p>
                            </div>

                            {idx === 0 && (
                              <div
                                ref={inspectBtnRef}
                                className={`px-2.5 py-1 rounded-lg border text-[10px] font-semibold shrink-0 whitespace-nowrap transition-all ${
                                  phase === 'click_detail'
                                    ? 'bg-indigo-600 text-white border-indigo-600 scale-95'
                                    : 'bg-white border-slate-200 text-[#0F172A]'
                                }`}
                              >
                                Inspect Record
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  ) : showingDetail ? (
                    <motion.div
                      key="sub-detail-full"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.25 }}
                      className="rounded-2xl bg-white/95 border border-slate-200/85 p-4 space-y-3.5 shadow-2xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
                        <div>
                          <p className="text-xs sm:text-sm font-bold text-[#0F172A]">
                            {scenario.detailInspect.title}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500">
                            {scenario.detailInspect.subtitle}
                          </p>
                        </div>
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600">
                          <span>Verified Source</span>
                          <ExternalLink className="w-3 h-3" />
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        {scenario.detailInspect.properties.map((prop) => (
                          <div
                            key={prop.label}
                            className="p-2.5 rounded-xl bg-[#FAFAFA] border border-slate-200/80"
                          >
                            <p className="text-[10px] text-slate-500">
                              {prop.label}
                            </p>
                            <p className="text-xs font-mono font-semibold text-[#0F172A] truncate mt-0.5">
                              {prop.value}
                            </p>
                          </div>
                        ))}
                      </div>

                      <div className="rounded-xl bg-[#0B1120] border border-slate-800 p-3.5 space-y-1.5 font-mono text-[11px]">
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 pb-1 border-b border-slate-800">
                          <GitCommit className="w-3 h-3 text-orange-400" />
                          <span>Live Artifact & Diff Inspection</span>
                        </div>
                        {scenario.detailInspect.diffLines.map((line, i) => (
                          <p
                            key={i}
                            className={`truncate ${
                              line.type === 'add'
                                ? 'text-emerald-300'
                                : line.type === 'del'
                                ? 'text-rose-300'
                                : 'text-slate-400'
                            }`}
                          >
                            {line.text}
                          </p>
                        ))}
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="sub-overview-full"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.25 }}
                      className="space-y-3"
                    >
                      {/* Row 1: AI Executive Summary + Dark Signal Correlation Flowchart */}
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                        {/* AI Executive Brief Card */}
                        <div className="lg:col-span-5 rounded-xl bg-white/95 border border-slate-200/85 p-3.5 space-y-2.5 flex flex-col justify-between">
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="inline-flex items-center gap-1.5 font-bold text-[#0F172A]">
                                <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                                <span>AI Executive Summary</span>
                              </span>
                              <span
                                className={`text-[10px] font-semibold ${
                                  scenario.aiRisk === 'Elevated'
                                    ? 'text-rose-600'
                                    : scenario.aiRisk === 'Moderate'
                                    ? 'text-amber-600'
                                    : 'text-emerald-700'
                                }`}
                              >
                                · {scenario.aiRisk} Posture
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-600 leading-relaxed">
                              {scenario.aiSummary}
                            </p>
                          </div>

                          <div className="space-y-1 pt-2 border-t border-slate-100">
                            {scenario.takeaways.slice(0, 2).map((tk) => (
                              <p
                                key={tk}
                                className="text-[10px] text-slate-500 truncate"
                              >
                                · {tk}
                              </p>
                            ))}
                          </div>
                        </div>

                        {/* Dark Signal Correlation Flowchart */}
                        <div className="lg:col-span-7 rounded-xl bg-[#060912] border border-slate-800 p-3.5 text-white space-y-2.5 relative overflow-hidden">
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="inline-flex items-center gap-1.5 font-semibold text-white">
                              <GitBranch className="w-3.5 h-3.5 text-orange-400" />
                              <span>Signal Correlation Flowchart</span>
                            </span>
                            <span className="font-mono">
                              Flow Tree · 125% Zoom
                            </span>
                          </div>

                          <div className="flex items-center gap-2.5 pt-0.5">
                            <div className="px-2.5 py-2.5 rounded-xl bg-slate-900/95 border border-orange-500/45 text-[10px] shrink-0">
                              <p className="text-[9px] font-mono text-orange-400">
                                Target Root
                              </p>
                              <p className="font-mono font-semibold text-white truncate max-w-[95px]">
                                {scenario.target}
                              </p>
                            </div>

                            <div className="h-px w-4 bg-gradient-to-r from-orange-500/70 to-indigo-400/70 shrink-0" />

                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 flex-1">
                              {scenario.flowchartBranches.map((b) => (
                                <div
                                  key={b.title}
                                  className={`px-2 py-1.5 rounded-lg bg-slate-900/95 border text-[10px] ${b.tone}`}
                                >
                                  <p className="font-semibold truncate">
                                    {b.title}
                                  </p>
                                  <p className="font-mono text-[9px] text-slate-400 truncate">
                                    {b.meta}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Row 2: 6 Live Discovered Result Cards */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                        {scenario.cards.map((c) => (
                          <div
                            key={c.platform}
                            className={`p-3 rounded-xl border bg-white/95 flex flex-col justify-between gap-1.5 ${
                              c.isExposed
                                ? 'border-rose-200/90'
                                : 'border-slate-200/85'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-[#0F172A] truncate">
                                  {c.platform}
                                </p>
                                <p className="text-[10px] font-mono text-slate-400 truncate">
                                  {c.domain} · {c.handle}
                                </p>
                              </div>
                              <span
                                className={`text-[10px] font-semibold shrink-0 ${
                                  c.isExposed
                                    ? 'text-rose-600'
                                    : 'text-emerald-700'
                                }`}
                              >
                                {c.statusLabel}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-600 line-clamp-1">
                              {c.summary}
                            </p>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Animated Claude-Style Pointer Cursor + Click Ripple */}
        {!prefersReducedMotion && (
          <motion.div
            aria-hidden="true"
            animate={{
              x: cursorPos.x,
              y: cursorPos.y,
            }}
            transition={{
              type: 'spring',
              stiffness: 165,
              damping: 24,
              mass: 0.7,
            }}
            className="pointer-events-none absolute top-0 left-0 z-30"
          >
            {clickRippleKey > 0 && (
              <motion.span
                key={clickRippleKey}
                initial={{ scale: 0.25, opacity: 0.85 }}
                animate={{ scale: 2.35, opacity: 0 }}
                transition={{ duration: 0.55, ease: 'easeOut' }}
                className="absolute -top-3 -left-3 w-6 h-6 rounded-full border-2 border-indigo-500 bg-indigo-400/20"
              />
            )}

            <motion.svg
              animate={
                phase.startsWith('click_')
                  ? { scale: [1, 0.8, 1] }
                  : { scale: 1 }
              }
              transition={{ duration: 0.28 }}
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              className="drop-shadow-[0_4px_10px_rgba(15,23,42,0.3)]"
            >
              <path
                d="M4.5 2.5L19.5 11.2L12.6 13.4L9.2 19.8L4.5 2.5Z"
                fill="#0F172A"
                stroke="#FFFFFF"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </motion.svg>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
