import {
  ArrowUpRight,
  AtSign,
  Bell,
  CheckCircle2,
  Cpu,
  FileSpreadsheet,
  FileText,
  FileUp,
  GitBranch,
  Globe,
  Layers,
  MapPin,
  Network,
  Phone,
  Search,
  ShieldAlert,
  Sparkles,
  Terminal,
  UserCheck,
  Users,
} from 'lucide-react';

/**
 * 01. HeroWorkspaceShowcase
 * Cohesive coded miniature of the live Parmanu workspace:
 * sidebar + top KPI strip + dark Signal Correlation Flowchart + platform signal cards.
 */
export function HeroWorkspaceShowcase() {
  const kpis = [
    { label: 'Total Results', val: '42', accent: 'text-[#0F172A]' },
    { label: 'Parmanu Signals', val: '38', accent: 'text-indigo-700' },
    { label: 'Registered', val: '29', accent: 'text-emerald-700' },
    { label: 'Breached', val: '4', accent: 'text-rose-600' },
    { label: 'Leaked', val: '1', accent: 'text-amber-600' },
  ];

  return (
    <div className="w-full rounded-2xl overflow-hidden border border-slate-200/85 bg-[#F6F7FA] shadow-[0_18px_50px_rgba(15,23,42,0.08)] text-left select-none">
      {/* Window Chrome */}
      <div className="px-4 py-2.5 bg-white/85 backdrop-blur-md border-b border-slate-200/75 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-200" />
          <span className="w-2.5 h-2.5 rounded-full bg-slate-200" />
          <span className="w-2.5 h-2.5 rounded-full bg-slate-200" />
          <span className="ml-2 text-[11px] font-mono text-slate-500 truncate">
            parmanu.in / scan / arjun.sharma@company.in
          </span>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-[11px] font-mono text-emerald-700 font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>8/8 modules settled · 1.9s</span>
        </div>
      </div>

      {/* Main Split: Compact Rail + Results Canvas */}
      <div className="grid grid-cols-12 min-h-[300px] sm:min-h-[350px]">
        {/* Compact Workspace Rail */}
        <aside className="hidden md:flex md:col-span-3 flex-col justify-between p-3.5 bg-white/80 backdrop-blur-md border-r border-slate-200/70">
          <div className="space-y-3">
            <div className="flex items-center gap-2 px-2 py-1">
              <span className="w-6 h-6 rounded-lg bg-[#0F172A] text-white flex items-center justify-center text-xs font-bold">
                ॐ
              </span>
              <span className="font-display text-sm font-bold text-[#0F172A]">
                Parmanu<span className="text-orange-600">.</span>
              </span>
            </div>

            <div className="space-y-1 text-xs">
              {[
                { label: 'New Search', Icon: Search, active: false },
                { label: 'Results Canvas', Icon: Layers, active: true },
                { label: 'Batch Queue', Icon: FileUp, active: false },
                { label: 'Modules (8)', Icon: Cpu, active: false },
                { label: 'Monitoring', Icon: Bell, active: false },
                { label: 'Team Workspace', Icon: Users, active: false },
              ].map(({ label, Icon, active }) => (
                <div
                  key={label}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg font-medium ${
                    active
                      ? 'bg-[#0F172A] text-white shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 text-[10px] text-slate-500 space-y-1">
            <p className="font-semibold text-[#0F172A]">Authorized Session</p>
            <p className="font-mono truncate">analyst@parmanu.in</p>
          </div>
        </aside>

        {/* Results Main Body */}
        <div className="col-span-12 md:col-span-9 p-4 sm:p-5 space-y-4">
          {/* Header Row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-mono text-sm sm:text-base font-bold text-[#0F172A] truncate">
                arjun.sharma@company.in
              </p>
              <p className="text-[11px] text-slate-500">
                <span className="text-orange-600 font-semibold uppercase">
                  EMAIL
                </span>{' '}
                · MailAccess · Holehe · GHunt · Maigret · Sherlock
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="px-2.5 py-1 rounded-lg bg-white border border-indigo-200 text-[11px] font-medium text-indigo-700 inline-flex items-center gap-1">
                <Terminal className="w-3 h-3" />
                <span>Google Dorking</span>
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-[#0F172A] text-[11px] font-medium text-white inline-flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-orange-400" />
                <span>AI Brief</span>
              </span>
            </div>
          </div>

          {/* 5 KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {kpis.map((k) => (
              <div
                key={k.label}
                className="p-2.5 rounded-xl bg-white/90 border border-slate-200/80 shadow-2xs"
              >
                <p className="text-[10px] text-slate-500 font-medium truncate">
                  {k.label}
                </p>
                <p
                  className={`font-display text-lg sm:text-xl font-bold tabular-nums mt-0.5 ${k.accent}`}
                >
                  {k.val}
                </p>
              </div>
            ))}
          </div>

          {/* Mini Dark Correlation Graph + Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-7 rounded-xl bg-[#060912] border border-slate-800 p-3.5 text-white space-y-2.5 relative overflow-hidden">
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span className="inline-flex items-center gap-1.5 font-semibold text-white">
                  <GitBranch className="w-3 h-3 text-orange-400" />
                  <span>Signal Correlation Flowchart</span>
                </span>
                <span className="font-mono text-slate-400">100% · Interactive</span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="px-2.5 py-2 rounded-lg bg-slate-900/90 border border-orange-500/40 text-[10px] font-mono text-orange-300 shrink-0">
                  Target Root
                </div>
                <div className="h-px flex-1 bg-gradient-to-r from-orange-500/60 via-indigo-400/60 to-emerald-400/60" />
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="px-2 py-1.5 rounded-lg bg-slate-900 border border-emerald-500/35 text-[10px]">
                    <p className="font-semibold text-emerald-300">GitHub</p>
                    <p className="text-slate-400 font-mono">14 commits</p>
                  </div>
                  <div className="px-2 py-1.5 rounded-lg bg-slate-900 border border-rose-500/40 text-[10px]">
                    <p className="font-semibold text-rose-300">XposedOrNot</p>
                    <p className="text-slate-400 font-mono">4 breaches</p>
                  </div>
                  <div className="px-2 py-1.5 rounded-lg bg-slate-900 border border-indigo-500/35 text-[10px]">
                    <p className="font-semibold text-indigo-300">GHunt Maps</p>
                    <p className="text-slate-400 font-mono">Profile ID</p>
                  </div>
                  <div className="px-2 py-1.5 rounded-lg bg-slate-900 border border-sky-500/35 text-[10px]">
                    <p className="font-semibold text-sky-300">Gravatar</p>
                    <p className="text-slate-400 font-mono">Avatar Match</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="sm:col-span-5 rounded-xl bg-white/90 border border-slate-200/80 p-3.5 flex flex-col justify-between gap-2.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#0F172A]">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                  <span>AI Executive Brief</span>
                </span>
                <span className="text-[10px] font-semibold text-amber-600">
                  Moderate Risk
                </span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Correlated 29 registered developer & social accounts, verified
                DMARC/MX mail posture, and 4 legacy breach exposures requiring
                credential rotation.
              </p>
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                <span>Key Slot #1 Active</span>
                <span className="text-indigo-600 font-sans font-semibold">
                  Ask follow-up →
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 02. FlowchartShowcase
 * Fits cleanly inside aspect-[16/10] containers for Tour Card 01.
 */
export function FlowchartShowcase() {
  return (
    <div className="w-full aspect-[16/10] rounded-2xl overflow-hidden bg-[#060912] border border-slate-800/90 p-4 sm:p-5 flex flex-col justify-between text-white relative select-none shadow-[0_14px_34px_rgba(15,23,42,0.16)]">
      {/* Subtle Blueprint Grid */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(148,163,184,0.45) 1px, transparent 0)',
          backgroundSize: '18px 18px',
        }}
      />

      {/* Top Toolbar */}
      <div className="relative z-10 flex items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-lg bg-orange-500/15 border border-orange-400/30 flex items-center justify-center text-orange-300">
            <GitBranch className="w-3.5 h-3.5" />
          </span>
          <span className="font-display font-semibold text-white">
            Signal Correlation Flowchart
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono">
          <span className="px-2 py-0.5 rounded-md bg-slate-800/90 border border-slate-700 text-slate-200">
            Flow Tree
          </span>
          <span className="px-2 py-0.5 rounded-md bg-slate-900/80 border border-slate-800 text-slate-400">
            125%
          </span>
        </div>
      </div>

      {/* Node Topology */}
      <div className="relative z-10 grid grid-cols-3 items-center gap-3 my-auto py-2">
        {/* Column 1: Root */}
        <div className="p-2.5 rounded-xl bg-slate-900/95 border border-orange-500/45 shadow-[0_0_24px_rgba(249,115,22,0.12)]">
          <p className="text-[9px] uppercase tracking-wider text-orange-400 font-mono">
            Root Signal
          </p>
          <p className="text-xs font-mono font-semibold text-white truncate mt-0.5">
            +919876543210
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">E.164 Validated</p>
        </div>

        {/* Column 2: Categories */}
        <div className="space-y-2">
          <div className="p-2 rounded-xl bg-slate-900/90 border border-indigo-500/40">
            <p className="text-[10px] font-semibold text-indigo-300">
              Telecom & Carrier
            </p>
            <p className="text-[10px] font-mono text-slate-400">
              IN · TRAI Series
            </p>
          </div>
          <div className="p-2 rounded-xl bg-slate-900/90 border border-emerald-500/40">
            <p className="text-[10px] font-semibold text-emerald-300">
              Google Dork Hits
            </p>
            <p className="text-[10px] font-mono text-slate-400">
              14 PDF / CSV files
            </p>
          </div>
        </div>

        {/* Column 3: Leaf Entities */}
        <div className="space-y-2">
          <div className="p-2 rounded-xl bg-slate-900/90 border border-slate-700">
            <p className="text-[10px] font-semibold text-white truncate">
              tender_vendor.pdf
            </p>
            <p className="text-[9px] font-mono text-orange-300">PDF Record</p>
          </div>
          <div className="p-2 rounded-xl bg-slate-900/90 border border-slate-700">
            <p className="text-[10px] font-semibold text-white truncate">
              WhatsApp · Telegram
            </p>
            <p className="text-[9px] font-mono text-emerald-300">
              Ignorant Probe
            </p>
          </div>
        </div>
      </div>

      {/* Bottom Legend */}
      <div className="relative z-10 flex items-center justify-between text-[10px] text-slate-400 border-t border-slate-800/80 pt-2">
        <span>Click any node to inspect raw telemetry & diffs</span>
        <span className="font-mono text-indigo-300">34 correlated edges</span>
      </div>
    </div>
  );
}

/**
 * 03. ResultsAiShowcase
 * Live streaming cards + Google Dorking hits + AI brief preview.
 */
export function ResultsAiShowcase() {
  const cards = [
    {
      name: 'GitHub Account',
      sub: 'github.com/torvalds · 1 consolidated card',
      tag: 'Registered',
      color: 'text-emerald-700',
      Icon: CheckCircle2,
    },
    {
      name: 'Google Dorking PDF',
      sub: 'vendor-directory-2025.pdf · Indexed match',
      tag: 'PDF File',
      color: 'text-orange-600',
      Icon: FileText,
    },
    {
      name: 'GHunt Profile & Maps',
      sub: 'Google Maps reviews + Workspace status',
      tag: 'Verified',
      color: 'text-indigo-600',
      Icon: MapPin,
    },
    {
      name: 'XposedOrNot Index',
      sub: 'Historical credential exposure check',
      tag: 'Breached',
      color: 'text-rose-600',
      Icon: ShieldAlert,
    },
  ];

  return (
    <div className="w-full aspect-[16/10] rounded-2xl overflow-hidden bg-gradient-to-br from-white via-[#F8FAFC] to-indigo-50/40 border border-slate-200/85 p-4 sm:p-5 flex flex-col justify-between select-none shadow-[0_12px_34px_rgba(15,23,42,0.06)]">
      {/* AI Executive Brief Header */}
      <div className="p-3 rounded-xl bg-white/95 border border-slate-200/80 shadow-2xs space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#0F172A]">
            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            <span>AI Executive Intelligence Summary</span>
          </span>
          <span className="text-[10px] font-semibold text-indigo-600">
            3-Key Auto Failover
          </span>
        </div>
        <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">
          Target displays active developer footprints with verified PGP keys,
          public Google Maps contribution links, and 6 indexed PDF/CSV mentions
          located via deep Google Dorking.
        </p>
      </div>

      {/* Evidence Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 my-auto py-2">
        {cards.map(({ name, sub, tag, color, Icon }) => (
          <div
            key={name}
            className="p-2.5 rounded-xl bg-white/95 border border-slate-200/80 flex items-start justify-between gap-2"
          >
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#0F172A] truncate">
                {name}
              </p>
              <p className="text-[10px] text-slate-500 truncate mt-0.5">{sub}</p>
            </div>
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-semibold shrink-0 ${color}`}
            >
              <Icon className="w-3 h-3" />
              <span>{tag}</span>
            </span>
          </div>
        ))}
      </div>

      {/* Bottom Action Bar */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-200/70 text-[10px] text-slate-500">
        <span className="font-mono">Live count-up · Zero terminal clutter</span>
        <span className="text-indigo-600 font-semibold inline-flex items-center gap-0.5">
          <span>Inspect JSON & Diffs</span>
          <ArrowUpRight className="w-3 h-3" />
        </span>
      </div>
    </div>
  );
}

/**
 * 04. BatchExtractorShowcase
 * Universal file extractor + parallel queue preview.
 */
export function BatchExtractorShowcase() {
  const rows = [
    { target: 'secops@acme.in', type: 'Email', hits: '18 signals', done: true },
    { target: '+919820112233', type: 'Phone', hits: '9 dork hits', done: true },
    { target: 'staging.acme.in', type: 'Domain', hits: 'DNS + TLS', done: true },
    { target: '49.36.112.18', type: 'IP', hits: 'ASN · Mumbai', done: false },
  ];

  return (
    <div className="w-full aspect-[16/10] rounded-2xl overflow-hidden bg-white border border-slate-200/85 p-4 sm:p-5 flex flex-col justify-between select-none shadow-[0_12px_34px_rgba(15,23,42,0.06)]">
      {/* Dropzone Header */}
      <div className="p-3 rounded-xl border border-dashed border-indigo-300/80 bg-indigo-50/40 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-lg bg-white border border-indigo-200 text-indigo-600 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#0F172A] truncate">
              incident_dump_2025.csv · 142 extracted targets
            </p>
            <p className="text-[10px] text-slate-500 truncate">
              Supports CSV, XLSX, JSON, PDF, DOCX, TXT & raw logs
            </p>
          </div>
        </div>
        <span className="px-2 py-1 rounded-md bg-[#0F172A] text-white text-[10px] font-medium shrink-0">
          3 Workers
        </span>
      </div>

      {/* Queue Rows */}
      <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl overflow-hidden bg-[#FAFAFA]/70 my-auto">
        {rows.map((r) => (
          <div
            key={r.target}
            className="px-3 py-2 flex items-center justify-between gap-2 text-[11px]"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  r.done ? 'bg-emerald-500' : 'bg-indigo-500 animate-pulse'
                }`}
              />
              <span className="font-mono font-medium text-[#0F172A] truncate">
                {r.target}
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-[10px] text-slate-500">{r.type}</span>
              <span className="font-mono text-[10px] text-indigo-700 font-medium">
                {r.hits}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1">
        <span>Auto-deduplicated identifiers</span>
        <span className="font-mono text-emerald-700 font-medium">
          Export CSV · Export JSON
        </span>
      </div>
    </div>
  );
}

/**
 * 05. TelemetryCollabShowcase
 * Geo map preview + Monitoring watchlist + Google team sync.
 */
export function TelemetryCollabShowcase() {
  return (
    <div className="w-full aspect-[16/10] rounded-2xl overflow-hidden bg-gradient-to-br from-slate-50 via-white to-emerald-50/40 border border-slate-200/85 p-4 sm:p-5 flex flex-col justify-between select-none shadow-[0_12px_34px_rgba(15,23,42,0.06)]">
      {/* Top Row: Map Mock + Pins */}
      <div className="relative h-32 sm:h-36 rounded-xl overflow-hidden border border-slate-200/80 bg-[#EBF1F5]">
        {/* Stylized Cartographic Roads */}
        <svg
          aria-hidden="true"
          viewBox="0 0 400 160"
          className="w-full h-full opacity-65"
          preserveAspectRatio="none"
        >
          <path
            d="M0 40 Q120 75 240 35 T400 60"
            fill="none"
            stroke="#CBD5E1"
            strokeWidth="2.5"
          />
          <path
            d="M40 0 Q90 80 180 160"
            fill="none"
            stroke="#CBD5E1"
            strokeWidth="2"
          />
          <path
            d="M250 0 Q290 70 340 160"
            fill="none"
            stroke="#CBD5E1"
            strokeWidth="2"
          />
          <circle cx="115" cy="64" r="22" fill="rgba(79,70,229,0.12)" />
          <circle cx="290" cy="48" r="26" fill="rgba(234,88,12,0.12)" />
        </svg>

        <div className="absolute top-2.5 left-2.5 px-2 py-1 rounded-lg bg-white/90 backdrop-blur-md border border-slate-200/80 text-[10px] font-semibold text-[#0F172A] inline-flex items-center gap-1 shadow-2xs">
          <Globe className="w-3 h-3 text-indigo-600" />
          <span>Carto Voyager Geo Telemetry</span>
        </div>

        {/* Geo Pins */}
        <div className="absolute top-12 left-[24%] flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[9px] font-mono shadow-sm">
          <MapPin className="w-2.5 h-2.5" />
          <span>Bengaluru, IN</span>
        </div>
        <div className="absolute top-8 right-[18%] flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-600 text-white text-[9px] font-mono shadow-sm">
          <Network className="w-2.5 h-2.5" />
          <span>ASN 55836</span>
        </div>
      </div>

      {/* Bottom Row: Watchlist + Team Collaborators */}
      <div className="grid grid-cols-2 gap-2.5 pt-2">
        <div className="p-2.5 rounded-xl bg-white/95 border border-slate-200/80 space-y-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="font-semibold text-[#0F172A] inline-flex items-center gap-1">
              <Bell className="w-3 h-3 text-emerald-700" />
              <span>Watchlists</span>
            </span>
            <span className="text-emerald-700 font-mono">Active</span>
          </div>
          <p className="text-[10px] font-mono text-slate-500 truncate">
            +919876543210 · Daily
          </p>
        </div>

        <div className="p-2.5 rounded-xl bg-white/95 border border-slate-200/80 space-y-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="font-semibold text-[#0F172A] inline-flex items-center gap-1">
              <UserCheck className="w-3 h-3 text-indigo-600" />
              <span>Team & PNG</span>
            </span>
            <span className="text-indigo-600 font-mono">Synced</span>
          </div>
          <p className="text-[10px] font-mono text-slate-500 truncate">
            3 Google Collaborators
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-slate-200/70 text-[10px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <AtSign className="w-3 h-3 text-orange-600" />
          <Phone className="w-3 h-3 text-indigo-600" />
          <span>Shown only when real geo telemetry resolves</span>
        </span>
      </div>
    </div>
  );
}
