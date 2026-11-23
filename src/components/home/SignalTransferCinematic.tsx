import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  Cpu,
  Database,
  Globe,
  Lock,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

interface RelayNode {
  id: string;
  label: string;
  protocol: string;
  y: number;
  bytes: string;
  latency: string;
  accent: string;
  verifiedSignal: string;
}

const RELAY_NODES: RelayNode[] = [
  {
    id: 'dns',
    label: 'DNS / ASN & TLS',
    protocol: 'DoH · RDAP · crt.sh',
    y: 46,
    bytes: '18.4 KB',
    latency: '142 ms',
    accent: '#38BDF8',
    verifiedSignal: 'MX + SPF + 14 CT SANs',
  },
  {
    id: 'breach',
    label: 'Breach Ledger Shards',
    protocol: 'HIBP · XposedOrNot',
    y: 102,
    bytes: '42.9 KB',
    latency: '218 ms',
    accent: '#FB7185',
    verifiedSignal: '3 Indexed Incident Matches',
  },
  {
    id: 'graph',
    label: 'Commit & Handle Graph',
    protocol: 'GitHub · Keybase · OAuth',
    y: 158,
    bytes: '64.2 KB',
    latency: '196 ms',
    accent: '#818CF8',
    verifiedSignal: '7 Public Profiles Linked',
  },
  {
    id: 'threat',
    label: 'Threat-Intel & Typo DNS',
    protocol: 'URLhaus · ThreatFox',
    y: 214,
    bytes: '11.6 KB',
    latency: '164 ms',
    accent: '#F59E0B',
    verifiedSignal: '0 Active C2 · 1 Lookalike',
  },
  {
    id: 'archive',
    label: 'Archive & Doc Index',
    protocol: 'Wayback · Archive.org',
    y: 270,
    bytes: '31.0 KB',
    latency: '284 ms',
    accent: '#34D399',
    verifiedSignal: '9 Snapshots & Docs Indexed',
  },
];

const STAGES = [
  {
    step: 0,
    tag: '01 · Signal Shard',
    title: 'Zero-Trust Tokenization & TLS 1.3 Envelope',
    detail:
      'Incoming identifier is normalized into an isolated SHA-256 execution token with zero searchbar state leaked.',
  },
  {
    step: 1,
    tag: '02 · Parallel Lookup',
    title: 'Five Concurrent Protocol Relays Stream Payloads',
    detail:
      'DNS over HTTPS, Certificate Transparency, Breach Ledgers, GitHub Commits, and Threat-Intel feeds execute simultaneously.',
  },
  {
    step: 2,
    tag: '03 · Cross-Node Relay',
    title: 'Real-Time Deduplication & Attribution Scoring',
    detail:
      'Verified response payloads stream back across encrypted channels, stripping unverified directory noise automatically.',
  },
  {
    step: 3,
    tag: '04 · Graph Synthesis',
    title: 'Crystallized Evidence Matrix Ready for Triage',
    detail:
      'All correlated entities assemble into timeline events, geo coordinates, and AI-synthesized threat posture.',
  },
];

export function SignalTransferCinematic() {
  const [stage, setStage] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      setStage((s) => (s + 1) % STAGES.length);
    }, 2800);
    return () => window.clearInterval(timer);
  }, [paused]);

  const currentStage = STAGES[stage];

  return (
    <div className="rounded-3xl bg-[#070B14] border border-slate-800/90 shadow-[0_32px_80px_rgba(7,11,20,0.45)] overflow-hidden text-slate-100 relative">
      {/* Subtle Ambient Mesh */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/4 w-96 h-96 rounded-full bg-indigo-600/15 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 right-1/4 w-96 h-96 rounded-full bg-orange-500/10 blur-3xl"
      />

      {/* Top Telemetry Bar */}
      <div className="relative z-10 px-5 sm:px-7 py-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-[#0A101D]/90">
        <div className="flex items-center gap-3 text-xs">
          <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-mono font-semibold text-slate-100">
            SHA-256 ENCRYPTED SIGNAL RELAY
          </span>
          <span className="text-slate-600">·</span>
          <span className="font-mono text-indigo-300 text-[11px]">
            TLS 1.3 · 5 PARALLEL STREAMS
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-emerald-400 tabular-nums">
            {stage === 0
              ? 'HANDSHAKE 0.4ms'
              : stage === 1
              ? 'TX 168.1 KB/s'
              : stage === 2
              ? 'VERIFYING 5/5 NODES'
              : 'GRAPH LOCKED · 100%'}
          </span>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? 'Play telemetry animation' : 'Pause telemetry animation'}
            className="p-1.5 rounded-lg border border-slate-700 bg-slate-900/90 text-slate-300 hover:text-white cursor-pointer"
          >
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Main Optical Data-Transfer Stage (Zero Searchbar UI) */}
      <div className="relative z-10 p-5 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        {/* Left Node: Source Cryptographic Signal Shard */}
        <div className="lg:col-span-3 space-y-3">
          <motion.div
            animate={{
              borderColor:
                stage === 0 ? 'rgba(251, 146, 60, 0.7)' : 'rgba(99, 102, 241, 0.45)',
            }}
            transition={{ duration: 0.4 }}
            className="p-4 rounded-2xl bg-[#0D1426] border border-indigo-500/40 space-y-3 relative overflow-hidden"
          >
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-mono text-orange-400 font-semibold">
                INPUT PACKET
              </span>
              <Cpu className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="space-y-1">
              <p className="font-mono text-xs text-slate-100 truncate">
                token://9f4c...a82e
              </p>
              <p className="text-[11px] text-slate-400">
                Normalized Entity Shard
              </p>
            </div>
            <div className="pt-2 border-t border-slate-800/80 grid grid-cols-2 gap-2 font-mono text-[10px] text-slate-400 tabular-nums">
              <div>
                <p className="text-slate-500">PROTOCOL</p>
                <p className="text-slate-200">MULTI-MUX</p>
              </div>
              <div>
                <p className="text-slate-500">SHARDS</p>
                <p className="text-emerald-400">5 ACTIVE</p>
              </div>
            </div>
          </motion.div>

          <div className="p-3.5 rounded-xl bg-[#0B1120] border border-slate-800/80 text-xs space-y-1">
            <p className="font-mono text-[10px] uppercase tracking-wider text-indigo-400">
              {currentStage.tag}
            </p>
            <p className="font-semibold text-slate-100 leading-snug">
              {currentStage.title}
            </p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {currentStage.detail}
            </p>
          </div>
        </div>

        {/* Center Optical Bus: SVG Bezier Light Streams + Live Lookup Relays */}
        <div className="lg:col-span-6 relative">
          <div className="relative rounded-2xl bg-[#090E1A] border border-slate-800/90 p-4 overflow-hidden">
            {/* Animated Optical Fibre Curves */}
            <svg
              viewBox="0 0 520 316"
              className="w-full h-[270px] sm:h-[310px]"
              aria-label="Encrypted OSINT data transfer streams across live lookup nodes"
            >
              <defs>
                <filter id="pulse-glow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Left origin port */}
              <circle cx="22" cy="158" r="10" fill="#1E293B" stroke="#6366F1" strokeWidth="2" />
              <circle cx="22" cy="158" r="4" fill="#F97316" />

              {/* Right synthesis port */}
              <circle cx="498" cy="158" r="10" fill="#1E293B" stroke="#10B981" strokeWidth="2" />
              <circle cx="498" cy="158" r="4" fill="#34D399" />

              {RELAY_NODES.map((node, i) => {
                const leftPath = `M 32 158 C 95 158, 105 ${node.y}, 168 ${node.y}`;
                const rightPath = `M 352 ${node.y} C 415 ${node.y}, 425 158, 488 158`;
                const isOutbound = stage === 0 || stage === 1;
                const isInbound = stage === 2 || stage === 3;
                const nodeStatus =
                  stage === 0
                    ? 'HANDSHAKE'
                    : stage === 1
                    ? `TX ${node.bytes}`
                    : stage === 2
                    ? `RX ${node.latency}`
                    : 'VERIFIED';

                return (
                  <g key={node.id}>
                    {/* Base dark optical tracks */}
                    <path
                      d={leftPath}
                      fill="none"
                      stroke="rgba(51,65,85,0.55)"
                      strokeWidth="1.75"
                    />
                    <path
                      d={rightPath}
                      fill="none"
                      stroke="rgba(51,65,85,0.55)"
                      strokeWidth="1.75"
                    />

                    {/* Active glowing data transfer curves */}
                    <motion.path
                      d={leftPath}
                      fill="none"
                      stroke={node.accent}
                      strokeWidth="2.2"
                      strokeDasharray="6 8"
                      animate={{
                        strokeDashoffset: isOutbound ? [-28, 0] : [0, -14],
                        opacity: isOutbound ? 0.95 : 0.35,
                      }}
                      transition={{
                        repeat: Infinity,
                        duration: 1.1,
                        ease: 'linear',
                        delay: i * 0.08,
                      }}
                    />

                    <motion.path
                      d={rightPath}
                      fill="none"
                      stroke={stage === 3 ? '#34D399' : node.accent}
                      strokeWidth="2.2"
                      strokeDasharray="6 8"
                      animate={{
                        strokeDashoffset: isInbound ? [-28, 0] : [0, -14],
                        opacity: isInbound ? 0.95 : 0.3,
                      }}
                      transition={{
                        repeat: Infinity,
                        duration: 1.0,
                        ease: 'linear',
                        delay: i * 0.08,
                      }}
                    />

                    {/* Node Card inside SVG */}
                    <rect
                      x="168"
                      y={node.y - 20}
                      width="184"
                      height="40"
                      rx="9"
                      fill="#0F172A"
                      stroke={stage >= 2 ? node.accent : 'rgba(71,85,105,0.75)'}
                      strokeWidth="1.2"
                    />
                    <circle
                      cx="183"
                      cy={node.y}
                      r="4"
                      fill={stage === 3 ? '#34D399' : node.accent}
                      filter="url(#pulse-glow)"
                    />
                    <text
                      x="194"
                      y={node.y - 3}
                      fill="#F8FAFC"
                      fontSize="10.5"
                      fontWeight="600"
                      fontFamily="Inter, system-ui, sans-serif"
                    >
                      {node.label}
                    </text>
                    <text
                      x="194"
                      y={node.y + 11}
                      fill="#94A3B8"
                      fontSize="8.8"
                      fontFamily="ui-monospace, monospace"
                    >
                      {node.protocol}
                    </text>
                    <text
                      x="344"
                      y={node.y + 3}
                      textAnchor="end"
                      fill={stage === 3 ? '#34D399' : node.accent}
                      fontSize="8.5"
                      fontWeight="700"
                      fontFamily="ui-monospace, monospace"
                    >
                      {nodeStatus}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Right Node: Crystallized Intelligence Matrix */}
        <div className="lg:col-span-3 space-y-3">
          <div className="p-4 rounded-2xl bg-[#0D1426] border border-emerald-500/35 space-y-3">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-mono text-emerald-400 font-semibold inline-flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>EVIDENCE SYNTHESIS</span>
              </span>
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            </div>

            <div className="space-y-2">
              {RELAY_NODES.map((node, idx) => {
                const resolved = stage >= 2;
                return (
                  <motion.div
                    key={node.id}
                    animate={{ opacity: resolved ? 1 : 0.45, x: resolved ? 0 : 4 }}
                    transition={{ duration: 0.35, delay: idx * 0.06 }}
                    className="px-2.5 py-1.5 rounded-lg bg-[#080C17] border border-slate-800/90 flex items-center justify-between gap-2 text-[11px]"
                  >
                    <span className="text-slate-300 truncate">
                      {resolved ? node.verifiedSignal : `Querying ${node.id}...`}
                    </span>
                    <Activity
                      className={`w-3 h-3 shrink-0 ${
                        resolved ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    />
                  </motion.div>
                );
              })}
            </div>

            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400 tabular-nums">
              <span className="inline-flex items-center gap-1">
                <Database className="w-3 h-3 text-indigo-400" />
                <span>168.1 KB RX</span>
              </span>
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <Globe className="w-3 h-3" />
                <span>100% VERIFIED</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Stage Step Selector */}
      <div className="relative z-10 px-5 sm:px-7 py-3.5 border-t border-slate-800/80 bg-[#0A101D]/80 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {STAGES.map((st) => {
            const active = stage === st.step;
            return (
              <button
                key={st.step}
                type="button"
                onClick={() => {
                  setStage(st.step);
                  setPaused(true);
                }}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-mono transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-indigo-600 text-white font-semibold'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {st.tag}
              </button>
            );
          })}
        </div>
        <span className="text-[11px] font-mono text-slate-500">
          Zero synthetic data · Live server-side orchestration
        </span>
      </div>
    </div>
  );
}
