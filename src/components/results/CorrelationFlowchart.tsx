import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUpRight,
  AtSign,
  Cpu,
  GitBranch,
  Globe,
  Link2,
  MapPin,
  Maximize2,
  Minimize2,
  Minus,
  Network,
  Orbit,
  Phone,
  Plus,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  User,
} from 'lucide-react';
import type {
  InvestigationRecord,
  InvestigationResultItem,
  TargetType,
} from '@/src/types/investigation';
import { PlatformMark } from '@/src/components/ui/PlatformMark';

interface CorrelationFlowchartProps {
  investigation: InvestigationRecord;
  onSelectResult: (item: InvestigationResultItem) => void;
  onSelectBranch?: (branch: 'all' | 'accounts' | 'exposures' | 'attributes' | 'geo') => void;
}

type NodeKind = 'root' | 'hub' | 'account' | 'breach' | 'attribute' | 'geo';
type BranchKey = 'accounts' | 'exposures' | 'attributes' | 'geo';

interface FlowNode {
  id: string;
  label: string;
  sublabel?: string;
  kind: NodeKind;
  branch: BranchKey | 'root';
  x: number;
  y: number;
  width: number;
  platform?: string;
  domain?: string;
  url?: string;
  resultItem?: InvestigationResultItem;
}

interface FlowEdge {
  id: string;
  from: string;
  to: string;
  branch: BranchKey;
  fromSide: 'center' | 'right';
  toSide: 'center' | 'left';
  active: boolean;
}

const BRANCH_META: Record<
  BranchKey,
  {
    shortLabel: string;
    stroke: string;
    accentHex: string;
    glow: string;
    hubClass: string;
    chipActive: string;
    dot: string;
  }
> = {
  accounts: {
    shortLabel: 'Platforms',
    stroke: '#818CF8',
    accentHex: '#6366F1',
    glow: 'rgba(99, 102, 241, 0.35)',
    hubClass:
      'border-indigo-400/30 bg-[#101833]/90 text-indigo-100 shadow-[0_10px_28px_rgba(30,27,75,0.45)]',
    chipActive: 'bg-indigo-500/20 border-indigo-400/50 text-indigo-200',
    dot: '#818CF8',
  },
  attributes: {
    shortLabel: 'Identifiers',
    stroke: '#FBBF24',
    accentHex: '#F59E0B',
    glow: 'rgba(245, 158, 11, 0.32)',
    hubClass:
      'border-amber-400/30 bg-[#1D160B]/85 text-amber-100 shadow-[0_10px_28px_rgba(69,26,3,0.38)]',
    chipActive: 'bg-amber-500/20 border-amber-400/50 text-amber-200',
    dot: '#FBBF24',
  },
  exposures: {
    shortLabel: 'Exposures',
    stroke: '#FB7185',
    accentHex: '#F43F5E',
    glow: 'rgba(244, 63, 94, 0.35)',
    hubClass:
      'border-rose-400/35 bg-[#240D16]/90 text-rose-100 shadow-[0_10px_28px_rgba(76,5,25,0.45)]',
    chipActive: 'bg-rose-500/20 border-rose-400/50 text-rose-200',
    dot: '#FB7185',
  },
  geo: {
    shortLabel: 'Geo',
    stroke: '#34D399',
    accentHex: '#10B981',
    glow: 'rgba(16, 185, 129, 0.32)',
    hubClass:
      'border-emerald-400/30 bg-[#0A1E18]/90 text-emerald-100 shadow-[0_10px_28px_rgba(2,44,34,0.42)]',
    chipActive: 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200',
    dot: '#34D399',
  },
};

function getTargetIcon(type: TargetType) {
  if (type === 'email') return AtSign;
  if (type === 'phone') return Phone;
  if (type === 'domain') return Globe;
  if (type === 'ip') return Network;
  return User;
}

function getAnchorPoint(
  node: FlowNode,
  side: 'center' | 'left' | 'right'
): { x: number; y: number } {
  if (side === 'left') return { x: node.x - node.width / 2, y: node.y };
  if (side === 'right') return { x: node.x + node.width / 2, y: node.y };
  return { x: node.x, y: node.y };
}

function makeEdgePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  radial: boolean
): string {
  if (radial) {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const cx = mx - dy * 0.1;
    const cy = my + dx * 0.1;
    return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
  }
  const span = Math.max(48, Math.abs(x2 - x1) * 0.54);
  return `M ${x1} ${y1} C ${x1 + span} ${y1}, ${x2 - span} ${y2}, ${x2} ${y2}`;
}

export function CorrelationFlowchart({
  investigation,
  onSelectResult,
  onSelectBranch,
}: CorrelationFlowchartProps) {
  const [layoutMode, setLayoutMode] = useState<'tree' | 'constellation'>('tree');
  const [branchFilter, setBranchFilter] = useState<'all' | BranchKey>('all');
  const [zoom, setZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const manualZoomRef = useRef(false);
  const dragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (!isFullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isFullscreen]);

  const handleResetView = () => {
    manualZoomRef.current = false;
    setZoom(fitZoom);
    setPan({ x: 0, y: 0 });
  };

  const handleCanvasWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!isFullscreen && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    manualZoomRef.current = true;
    const factor = e.deltaY < 0 ? 0.1 : -0.1;
    setZoom((z) => Math.min(2.5, Math.max(0.3, +(z + factor).toFixed(2))));
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      originX: pan.x,
      originY: pan.y,
      moved: false,
    };
    suppressClickRef.current = false;
    setIsDragging(true);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    const dx = e.clientX - start.pointerX;
    const dy = e.clientY - start.pointerY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      start.moved = true;
      suppressClickRef.current = true;
    }
    if (start.moved) {
      setPan({ x: start.originX + dx, y: start.originY + dy });
    }
  };

  const handleCanvasPointerUp = () => {
    dragStartRef.current = null;
    setIsDragging(false);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 60);
  };

  const isRunning = investigation.status === 'running';
  const foundResults = useMemo(
    () => investigation.results.filter((r) => r.status === 'found'),
    [investigation.results]
  );

  const graph = useMemo(() => {
    const accounts = foundResults
      .filter((r) => r.findingKind !== 'breached' && r.findingKind !== 'leaked')
      .slice(0, 8);

    const exposures: Array<{
      id: string;
      label: string;
      sublabel: string;
      platform: string;
      domain?: string;
      item?: InvestigationResultItem;
    }> = [];

    for (const b of investigation.breachedAccounts.slice(0, 6)) {
      const linked = investigation.results.find((r) => r.id === b.resultId);
      exposures.push({
        id: `exp-b-${b.id}`,
        label: b.platform,
        sublabel: b.relativeTime || 'Breached',
        platform: b.platform,
        domain: b.domain,
        item: linked,
      });
    }
    for (const r of foundResults.filter(
      (x) => x.findingKind === 'leaked' || x.findingKind === 'breached'
    )) {
      if (exposures.length >= 6) break;
      if (exposures.some((e) => e.item?.id === r.id)) continue;
      exposures.push({
        id: `exp-r-${r.id}`,
        label: r.platform,
        sublabel: r.findingKind === 'breached' ? 'Breached' : 'Leaked',
        platform: r.platform,
        domain: r.domain,
        item: r,
      });
    }

    const attrSeen = new Set<string>();
    const attributes: Array<{
      id: string;
      label: string;
      sublabel: string;
      item?: InvestigationResultItem;
    }> = [];

    const pushAttr = (
      label: string,
      sublabel: string,
      item?: InvestigationResultItem
    ) => {
      const clean = label.trim();
      if (
        !clean ||
        clean === '—' ||
        clean.toLowerCase() === investigation.target.toLowerCase()
      ) {
        return;
      }
      const key = `${sublabel}:${clean}`.toLowerCase();
      if (attrSeen.has(key) || attributes.length >= 6) return;
      attrSeen.add(key);
      attributes.push({
        id: `attr-${attributes.length}-${clean.slice(0, 10)}`,
        label: clean.length > 24 ? `${clean.slice(0, 22)}…` : clean,
        sublabel,
        item,
      });
    };

    for (const r of foundResults) {
      if (r.displayName && r.displayName !== r.platform) {
        pushAttr(r.displayName, `${r.platform} Name`, r);
      }
      if (r.handle && r.handle !== investigation.target) {
        pushAttr(r.handle, `${r.platform} Handle`, r);
      }
      if (r.accountType) {
        pushAttr(r.accountType, `${r.platform} Type`, r);
      }
      for (const sig of r.linkedInfo || []) {
        pushAttr(sig, r.platform, r);
      }
    }

    const geos = investigation.geoMarkers.slice(0, 5);

    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];

    const availableBranches: Array<{
      key: BranchKey;
      title: string;
      count: number;
    }> = [
      { key: 'accounts', title: 'Verified Platforms', count: accounts.length },
      { key: 'attributes', title: 'Linked Identifiers', count: attributes.length },
    ];
    if (exposures.length > 0 || isRunning) {
      availableBranches.push({
        key: 'exposures',
        title: 'Breaches & Leaks',
        count: exposures.length,
      });
    }
    if (geos.length > 0) {
      availableBranches.push({
        key: 'geo',
        title: 'Geographic Nodes',
        count: geos.length,
      });
    }

    const activeBranches =
      branchFilter === 'all'
        ? availableBranches
        : availableBranches.filter((b) => b.key === branchFilter);

    if (layoutMode === 'tree') {
      const width = 1080;
      const leafRows = Math.max(
        5,
        activeBranches.reduce((sum, b) => sum + Math.max(1, b.count), 0)
      );
      const height = Math.max(460, Math.min(820, 140 + leafRows * 52));
      const rootY = height / 2;

      const rootWidth = 236;
      const hubWidth = 196;
      const leafWidth = 228;

      nodes.push({
        id: 'root',
        label: investigation.target,
        sublabel: `${investigation.targetType.toUpperCase()} ROOT`,
        kind: 'root',
        branch: 'root',
        x: 152,
        y: rootY,
        width: rootWidth,
      });

      const hubX = 485;
      const leafX = 875;

      const weights = activeBranches.map((b) => Math.max(1.5, b.count));
      const totalWeight = Math.max(
        1,
        weights.reduce((a, b) => a + b, 0)
      );
      let cursorY = 44;
      const usableHeight = height - 88;

      activeBranches.forEach((b, idx) => {
        const bandH = (weights[idx] / totalWeight) * usableHeight;
        const hubY = cursorY + bandH / 2;
        const hubId = `hub-${b.key}`;

        nodes.push({
          id: hubId,
          label: b.title,
          sublabel:
            b.count > 0
              ? `${b.count} connected`
              : isRunning
              ? 'Probing…'
              : '0 signals',
          kind: 'hub',
          branch: b.key,
          x: hubX,
          y: hubY,
          width: hubWidth,
        });

        edges.push({
          id: `e-root-${hubId}`,
          from: 'root',
          to: hubId,
          branch: b.key,
          fromSide: 'right',
          toSide: 'left',
          active: b.count > 0 || isRunning,
        });

        const itemsList: Array<{
          id: string;
          label: string;
          sublabel?: string;
          kind: NodeKind;
          platform?: string;
          domain?: string;
          url?: string;
          item?: InvestigationResultItem;
        }> = [];

        if (b.key === 'accounts') {
          accounts.forEach((a) =>
            itemsList.push({
              id: `acc-${a.id}`,
              label: a.platform,
              sublabel: a.handle || a.domain || a.category,
              kind: 'account',
              platform: a.platform,
              domain: a.domain,
              url: a.url,
              item: a,
            })
          );
        } else if (b.key === 'exposures') {
          exposures.forEach((e) =>
            itemsList.push({
              id: e.id,
              label: e.label,
              sublabel: e.sublabel,
              kind: 'breach',
              platform: e.platform,
              domain: e.domain,
              item: e.item,
            })
          );
        } else if (b.key === 'attributes') {
          attributes.forEach((a) =>
            itemsList.push({
              id: a.id,
              label: a.label,
              sublabel: a.sublabel,
              kind: 'attribute',
              item: a.item,
            })
          );
        } else if (b.key === 'geo') {
          geos.forEach((g) =>
            itemsList.push({
              id: `geo-${g.id}`,
              label: `${g.region}, ${g.country}`,
              sublabel: g.source,
              kind: 'geo',
            })
          );
        }

        itemsList.forEach((leaf, lIdx) => {
          const step = bandH / Math.max(1, itemsList.length);
          const ly = cursorY + step * (lIdx + 0.5);
          nodes.push({
            id: leaf.id,
            label: leaf.label,
            sublabel: leaf.sublabel,
            kind: leaf.kind,
            branch: b.key,
            x: leafX,
            y: ly,
            width: leafWidth,
            platform: leaf.platform,
            domain: leaf.domain,
            url: leaf.url,
            resultItem: leaf.item,
          });
          edges.push({
            id: `e-${hubId}-${leaf.id}`,
            from: hubId,
            to: leaf.id,
            branch: b.key,
            fromSide: 'right',
            toSide: 'left',
            active: true,
          });
        });

        cursorY += bandH;
      });

      return {
        width,
        height,
        rootPoint: { x: 152, y: rootY },
        nodes,
        edges,
        availableBranches,
      };
    }

    // Radial Constellation Mode
    const width = 1080;
    const height = 580;
    const cx = width / 2;
    const cy = height / 2;

    nodes.push({
      id: 'root',
      label: investigation.target,
      sublabel: `${investigation.targetType.toUpperCase()} ROOT`,
      kind: 'root',
      branch: 'root',
      x: cx,
      y: cy,
      width: 224,
    });

    const sectors: Array<{
      key: BranchKey;
      title: string;
      angleDeg: number;
      items: Array<{
        id: string;
        label: string;
        sublabel?: string;
        kind: NodeKind;
        platform?: string;
        domain?: string;
        url?: string;
        item?: InvestigationResultItem;
      }>;
    }> = [
      {
        key: 'accounts',
        title: 'Verified Platforms',
        angleDeg: -146,
        items: accounts.map((a) => ({
          id: `acc-${a.id}`,
          label: a.platform,
          sublabel: a.handle || a.domain,
          kind: 'account',
          platform: a.platform,
          domain: a.domain,
          url: a.url,
          item: a,
        })),
      },
      {
        key: 'attributes',
        title: 'Linked Identifiers',
        angleDeg: -34,
        items: attributes.map((a) => ({
          id: a.id,
          label: a.label,
          sublabel: a.sublabel,
          kind: 'attribute',
          item: a.item,
        })),
      },
      {
        key: 'exposures',
        title: 'Breaches & Leaks',
        angleDeg: 146,
        items: exposures.map((e) => ({
          id: e.id,
          label: e.label,
          sublabel: e.sublabel,
          kind: 'breach',
          platform: e.platform,
          domain: e.domain,
          item: e.item,
        })),
      },
      {
        key: 'geo',
        title: 'Geographic Nodes',
        angleDeg: 34,
        items: geos.map((g) => ({
          id: `geo-${g.id}`,
          label: `${g.region}, ${g.country}`,
          sublabel: g.source,
          kind: 'geo',
        })),
      },
    ];

    for (const sec of sectors) {
      if (branchFilter !== 'all' && sec.key !== branchFilter) continue;
      if (sec.key === 'geo' && sec.items.length === 0) continue;
      if (sec.key === 'exposures' && sec.items.length === 0 && !isRunning) continue;

      const rad = (sec.angleDeg * Math.PI) / 180;
      const hubR = 165;
      const hx = cx + Math.cos(rad) * hubR;
      const hy = cy + Math.sin(rad) * hubR * 0.78;
      const hubId = `hub-${sec.key}`;

      nodes.push({
        id: hubId,
        label: sec.title,
        sublabel:
          sec.items.length > 0
            ? `${sec.items.length} signals`
            : isRunning
            ? 'Probing…'
            : '0 signals',
        kind: 'hub',
        branch: sec.key,
        x: hx,
        y: hy,
        width: 184,
      });

      edges.push({
        id: `e-root-${hubId}`,
        from: 'root',
        to: hubId,
        branch: sec.key,
        fromSide: 'center',
        toSide: 'center',
        active: sec.items.length > 0 || isRunning,
      });

      const count = sec.items.length;
      const spreadDeg = Math.min(78, Math.max(26, count * 14));
      sec.items.forEach((leaf, idx) => {
        const offsetDeg =
          count === 1 ? 0 : -spreadDeg / 2 + (idx / (count - 1)) * spreadDeg;
        const leafRad = ((sec.angleDeg + offsetDeg) * Math.PI) / 180;
        const leafR = 345 + (idx % 2) * 58;
        const lx = Math.max(125, Math.min(width - 125, cx + Math.cos(leafRad) * leafR));
        const ly = Math.max(48, Math.min(height - 48, cy + Math.sin(leafRad) * leafR * 0.66));

        nodes.push({
          id: leaf.id,
          label: leaf.label,
          sublabel: leaf.sublabel,
          kind: leaf.kind,
          branch: sec.key,
          x: lx,
          y: ly,
          width: 212,
          platform: leaf.platform,
          domain: leaf.domain,
          url: leaf.url,
          resultItem: leaf.item,
        });

        edges.push({
          id: `e-${hubId}-${leaf.id}`,
          from: hubId,
          to: leaf.id,
          branch: sec.key,
          fromSide: 'center',
          toSide: 'center',
          active: true,
        });
      });
    }

    return {
      width,
      height,
      rootPoint: { x: cx, y: cy },
      nodes,
      edges,
      availableBranches,
    };
  }, [branchFilter, foundResults, investigation, isRunning, layoutMode]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const computeFit = (w: number) => {
      if (w <= 0 || graph.width <= 0) return;
      const nextFit = Math.max(0.32, Math.min(1, +(w / graph.width).toFixed(2)));
      setFitZoom(nextFit);
      if (!manualZoomRef.current) {
        setZoom(nextFit);
      }
    };
    computeFit(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width ?? el.clientWidth;
      computeFit(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [graph.width]);

  const nodeById = useMemo(() => {
    const map = new Map<string, FlowNode>();
    for (const n of graph.nodes) map.set(n.id, n);
    return map;
  }, [graph.nodes]);

  const hoveredNode = hoveredNodeId ? nodeById.get(hoveredNodeId) || null : null;

  const TargetIcon = getTargetIcon(investigation.targetType);

  return (
    <section
      aria-label="OSINT Signal Correlation Flowchart"
      className={
        isFullscreen
          ? 'fixed inset-0 z-[100] bg-[#060912] flex flex-col overflow-hidden text-slate-100'
          : 'rounded-2xl bg-[#060912] border border-slate-800/90 shadow-[0_24px_64px_rgba(2,6,23,0.42)] overflow-hidden text-slate-100'
      }
    >
      {/* Top Precision Toolbar */}
      <div className="px-3.5 sm:px-5 py-3 sm:py-3.5 border-b border-white/[0.07] bg-[#090E1C]/95 backdrop-blur-md flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 shrink-0">
        <div className="space-y-0.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-orange-500/20 to-indigo-500/20 border border-orange-400/35 flex items-center justify-center shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-orange-300" />
            </span>
            <h2 className="font-display text-sm sm:text-base font-bold tracking-tight text-white">
              Signal Correlation Flowchart
            </h2>
            <span className="text-xs text-slate-400 tabular-nums">
              · {Math.max(0, graph.nodes.length - 1)} nodes · {graph.edges.length} links
            </span>
          </div>
          <p className="text-xs text-slate-400 truncate max-w-2xl">
            Verified entity relationship map anchored at{' '}
            <span className="font-mono text-slate-200">{investigation.target}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 min-w-0">
          {/* Branch Focus Filter */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/80 border border-white/[0.07] text-[11px] overflow-x-auto max-w-full no-scrollbar">
            <button
              type="button"
              onClick={() => {
                setBranchFilter('all');
                onSelectBranch?.('all');
              }}
              className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
                branchFilter === 'all'
                  ? 'bg-white/12 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({graph.availableBranches.reduce((s, b) => s + b.count, 0)})
            </button>
            {graph.availableBranches.map((b) => {
              const meta = BRANCH_META[b.key];
              const active = branchFilter === b.key;
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => {
                    const next = active ? 'all' : b.key;
                    setBranchFilter(next);
                    onSelectBranch?.(next);
                  }}
                  className={`px-2.5 py-1 rounded-lg font-medium inline-flex items-center gap-1.5 border transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? meta.chipActive
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: meta.dot }}
                  />
                  <span>
                    {meta.shortLabel} ({b.count})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Layout Mode Switch */}
          <div className="inline-flex items-center p-1 rounded-xl bg-slate-900/90 border border-white/[0.07] text-[11px] sm:text-xs">
            <button
              type="button"
              onClick={() => setLayoutMode('tree')}
              className={`px-2 sm:px-2.5 py-1.5 rounded-lg font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                layoutMode === 'tree'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>Flow Tree</span>
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode('constellation')}
              className={`px-2 sm:px-2.5 py-1.5 rounded-lg font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                layoutMode === 'constellation'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Orbit className="w-3.5 h-3.5" />
              <span>Constellation</span>
            </button>
          </div>

          {/* Zoom Controls */}
          <div className="inline-flex items-center rounded-xl bg-slate-900/90 border border-white/[0.07] overflow-hidden">
            <button
              type="button"
              onClick={() => {
                manualZoomRef.current = true;
                setZoom((z) => Math.max(0.3, +(z - 0.15).toFixed(2)));
              }}
              aria-label="Zoom out flowchart"
              className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleResetView}
              title="Reset zoom and pan"
              className="h-8 px-2 sm:px-2.5 flex items-center justify-center gap-1 text-[11px] font-mono tabular-nums text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors border-x border-white/[0.07] cursor-pointer"
            >
              <span>{Math.round(zoom * 100)}%</span>
              <RotateCcw className="w-3 h-3 text-slate-400" />
            </button>
            <button
              type="button"
              onClick={() => {
                manualZoomRef.current = true;
                setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)));
              }}
              aria-label="Zoom in flowchart"
              className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Fullscreen Toggle */}
          <button
            type="button"
            onClick={() => setIsFullscreen((prev) => !prev)}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Open fullscreen flowchart'}
            className={`h-8 px-2.5 sm:px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              isFullscreen
                ? 'bg-orange-500/15 border-orange-400/50 text-orange-200 hover:bg-orange-500/25'
                : 'bg-slate-900/90 border-white/[0.07] text-slate-300 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Exit</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Fullscreen</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Obsidian Dot-Grid Interactive Graph Viewport */}
      <div
        ref={viewportRef}
        onWheel={handleCanvasWheel}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
        onPointerLeave={handleCanvasPointerUp}
        className={`relative overflow-hidden select-none touch-none ${
          isFullscreen
            ? 'flex-1 min-h-0 flex items-center justify-center'
            : 'flex items-center justify-center'
        } ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{
          minHeight: isFullscreen
            ? undefined
            : `${Math.max(300, Math.round(graph.height * Math.min(1, zoom + 0.12)))}px`,
          backgroundColor: '#060912',
          backgroundImage:
            'radial-gradient(circle at 20% 48%, rgba(249, 115, 22, 0.08), transparent 44%), radial-gradient(circle at 75% 42%, rgba(99, 102, 241, 0.12), transparent 48%), radial-gradient(rgba(148, 163, 184, 0.14) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 100% 100%, 26px 26px',
        }}
      >
        {/* Subtle Edge Vignette */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 shadow-[inset_0_0_90px_rgba(2,6,23,0.72)] z-10"
        />

        <div
          className="relative origin-center shrink-0"
          style={{
            width: `${graph.width}px`,
            height: `${graph.height}px`,
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
            transition: isDragging
              ? 'none'
              : 'transform 160ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {/* Precision Architectural SVG Layer: Orbit Reticles, Gradient Curves, Port Sockets */}
          <svg
            width={graph.width}
            height={graph.height}
            viewBox={`0 0 ${graph.width} ${graph.height}`}
            className="absolute inset-0 pointer-events-none"
          >
            <defs>
              <filter id="parmanu-line-glow" x="-25%" y="-25%" width="150%" height="150%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              {(Object.keys(BRANCH_META) as BranchKey[]).map((key) => (
                <linearGradient
                  key={key}
                  id={`grad-root-${key}`}
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="0%"
                >
                  <stop offset="0%" stopColor="#FB923C" stopOpacity="0.85" />
                  <stop
                    offset="100%"
                    stopColor={BRANCH_META[key].stroke}
                    stopOpacity="0.95"
                  />
                </linearGradient>
              ))}
            </defs>

            {/* Subtle Orbital Telemetry Rings anchored on the Root Node */}
            <g opacity={0.35}>
              <circle
                cx={graph.rootPoint.x}
                cy={graph.rootPoint.y}
                r={155}
                fill="none"
                stroke="rgba(148,163,184,0.12)"
                strokeDasharray="2 6"
              />
              <circle
                cx={graph.rootPoint.x}
                cy={graph.rootPoint.y}
                r={310}
                fill="none"
                stroke="rgba(148,163,184,0.08)"
              />
            </g>

            {graph.edges.map((edge, idx) => {
              const fromNode = nodeById.get(edge.from);
              const toNode = nodeById.get(edge.to);
              if (!fromNode || !toNode) return null;

              const p1 = getAnchorPoint(fromNode, edge.fromSide);
              const p2 = getAnchorPoint(toNode, edge.toSide);
              const d = makeEdgePath(
                p1.x,
                p1.y,
                p2.x,
                p2.y,
                layoutMode === 'constellation'
              );
              const meta = BRANCH_META[edge.branch];
              const isRootEdge = edge.from === 'root';
              const isRelated =
                hoveredNode &&
                (hoveredNode.id === edge.from ||
                  hoveredNode.id === edge.to ||
                  hoveredNode.branch === edge.branch);
              const isDimmed =
                hoveredNode && hoveredNode.id !== 'root' && !isRelated;

              return (
                <g
                  key={edge.id}
                  style={{
                    opacity: isDimmed ? 0.14 : 1,
                    transition: 'opacity 180ms ease',
                  }}
                >
                  {/* Soft ambient luminance halo */}
                  <path
                    d={d}
                    fill="none"
                    stroke={meta.glow}
                    strokeWidth={isRelated ? 4.5 : 3}
                    strokeLinecap="round"
                    filter="url(#parmanu-line-glow)"
                  />

                  {/* Crisp continuous structural spline */}
                  <motion.path
                    d={d}
                    fill="none"
                    stroke={
                      isRootEdge
                        ? `url(#grad-root-${edge.branch})`
                        : meta.stroke
                    }
                    strokeWidth={isRelated ? 2.1 : 1.5}
                    strokeOpacity={edge.active ? 0.85 : 0.35}
                    strokeLinecap="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{
                      duration: 0.48,
                      delay: Math.min(0.35, idx * 0.025),
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  />

                  {/* Smooth traveling energy photon */}
                  {edge.active && (
                    <circle
                      r={isRelated ? 2.8 : 2.1}
                      fill={meta.dot}
                      opacity={0.95}
                    >
                      <animateMotion
                        dur={`${2.6 + (idx % 4) * 0.45}s`}
                        repeatCount="indefinite"
                        path={d}
                      />
                    </circle>
                  )}

                  {/* Precision Port Terminal Sockets on Tree Mode */}
                  {layoutMode === 'tree' && (
                    <>
                      <circle
                        cx={p1.x}
                        cy={p1.y}
                        r={2.8}
                        fill="#060912"
                        stroke={isRootEdge ? '#FB923C' : meta.stroke}
                        strokeWidth={1.5}
                      />
                      <circle
                        cx={p2.x}
                        cy={p2.y}
                        r={2.8}
                        fill="#060912"
                        stroke={meta.stroke}
                        strokeWidth={1.5}
                      />
                    </>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Elevated Glassmorphic Entity Nodes */}
          <AnimatePresence>
            {graph.nodes.map((node) => {
              const isRelated =
                !hoveredNode ||
                hoveredNode.id === 'root' ||
                node.id === 'root' ||
                hoveredNode.branch === node.branch;

              if (node.kind === 'root') {
                return (
                  <motion.div
                    key={node.id}
                    layout
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    onMouseEnter={() => setHoveredNodeId(node.id)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                    style={{ left: node.x, top: node.y, width: node.width }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-20"
                  >
                    <div className="relative rounded-2xl bg-[#0D1426]/95 backdrop-blur-xl border border-orange-400/40 shadow-[0_0_40px_rgba(249,115,22,0.22),inset_0_1px_0_rgba(255,255,255,0.14)] px-3.5 py-3 flex items-center gap-3 overflow-hidden">
                      <div
                        aria-hidden="true"
                        className="absolute top-0 inset-x-4 h-px bg-gradient-to-r from-transparent via-orange-400/75 to-transparent"
                      />
                      {isRunning && (
                        <span
                          aria-hidden="true"
                          className="absolute -inset-1 rounded-2xl border border-orange-400/35 animate-ping pointer-events-none"
                          style={{ animationDuration: '2.4s' }}
                        />
                      )}
                      <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500/25 via-amber-500/15 to-indigo-500/20 border border-orange-400/40 flex items-center justify-center text-orange-300 shrink-0 shadow-inner">
                        <TargetIcon className="w-4 h-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold tracking-wider text-orange-300/95 uppercase leading-none">
                          {node.sublabel}
                        </p>
                        <p className="font-mono text-xs sm:text-[13px] font-bold text-white truncate mt-1">
                          {node.label}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                );
              }

              if (node.kind === 'hub') {
                const branchKey =
                  node.branch === 'root' ? 'accounts' : node.branch;
                const palette = BRANCH_META[branchKey];
                const HubIcon =
                  node.branch === 'exposures'
                    ? ShieldAlert
                    : node.branch === 'geo'
                    ? MapPin
                    : node.branch === 'attributes'
                    ? Link2
                    : Cpu;

                return (
                  <motion.div
                    key={node.id}
                    layout
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: isRelated ? 1 : 0.25, scale: 1 }}
                    transition={{ duration: 0.22 }}
                    onMouseEnter={() => setHoveredNodeId(node.id)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                    style={{ left: node.x, top: node.y, width: node.width }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 z-15"
                  >
                    <div
                      className={`relative px-3.5 py-2.5 rounded-xl border backdrop-blur-md flex items-center gap-2.5 overflow-hidden ${palette.hubClass}`}
                    >
                      <div
                        aria-hidden="true"
                        className="absolute top-0 inset-x-3 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
                      />
                      <span className="w-6 h-6 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center shrink-0">
                        <HubIcon className="w-3.5 h-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold leading-none truncate">
                          {node.label}
                        </p>
                        {node.sublabel && (
                          <p className="text-[10px] opacity-75 mt-1 tabular-nums leading-none">
                            {node.sublabel}
                          </p>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              }

              // Leaf Node Card
              const branchKey = node.branch === 'root' ? 'accounts' : node.branch;
              const branchPalette = BRANCH_META[branchKey];
              const clickable = Boolean(node.resultItem);

              return (
                <motion.button
                  key={node.id}
                  type="button"
                  layout
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: isRelated ? 1 : 0.22, scale: 1 }}
                  whileHover={clickable ? { scale: 1.03, y: -1 } : undefined}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  onClick={() => {
                    if (suppressClickRef.current) return;
                    if (node.resultItem) onSelectResult(node.resultItem);
                  }}
                  style={{ left: node.x, top: node.y, width: node.width }}
                  className={`group absolute -translate-x-1/2 -translate-y-1/2 z-20 px-3 py-2 rounded-xl bg-[#0B1222]/92 backdrop-blur-md border border-white/[0.09] hover:border-white/25 shadow-[0_10px_26px_rgba(2,6,23,0.55),inset_0_1px_0_rgba(255,255,255,0.08)] flex items-center gap-2.5 text-left transition-colors ${
                    clickable ? 'cursor-pointer' : 'cursor-default'
                  }`}
                >
                  {node.platform ? (
                    <PlatformMark
                      platform={node.platform}
                      domain={node.domain}
                      url={node.url}
                      size="sm"
                    />
                  ) : (
                    <span
                      className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 border border-white/10 bg-slate-900/90"
                      style={{ color: branchPalette.stroke }}
                    >
                      {node.kind === 'geo' ? (
                        <MapPin className="w-3.5 h-3.5" />
                      ) : (
                        <Link2 className="w-3.5 h-3.5" />
                      )}
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-100 truncate">
                      {node.label}
                    </p>
                    {node.sublabel && (
                      <p className="text-[10px] font-mono text-slate-400 truncate mt-0.5">
                        {node.sublabel}
                      </p>
                    )}
                  </div>

                  {clickable ? (
                    <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-white transition-colors shrink-0" />
                  ) : (
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: branchPalette.dot }}
                    />
                  )}
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Floating Quick Inspection Pill on Hover */}
        <AnimatePresence>
          {hoveredNode && hoveredNode.kind !== 'root' && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.14 }}
              className="pointer-events-none absolute bottom-3 left-4 z-30 px-3.5 py-2 rounded-xl bg-[#0B1222]/90 backdrop-blur-md border border-white/10 text-xs flex items-center gap-2.5 shadow-lg"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{
                  backgroundColor:
                    BRANCH_META[
                      hoveredNode.branch === 'root' ? 'accounts' : hoveredNode.branch
                    ].dot,
                }}
              />
              <span className="font-semibold text-white">
                {hoveredNode.label}
              </span>
              {hoveredNode.sublabel && (
                <>
                  <span className="text-slate-600">·</span>
                  <span className="font-mono text-slate-400">
                    {hoveredNode.sublabel}
                  </span>
                </>
              )}
              {hoveredNode.resultItem && (
                <span className="text-indigo-300 font-medium">
                  · Click to inspect
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom Legend Bar */}
      <div className="px-5 py-2.5 border-t border-white/[0.07] bg-[#090E1C]/95 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-400 shrink-0">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-indigo-400" />
            <span>Registered Platforms</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span>Linked Identifiers</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            <span>Breaches & Leaks</span>
          </span>
          {investigation.geoMarkers.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Geographic Signals</span>
            </span>
          )}
        </div>
        <span className="text-slate-400">
          Drag to pan ·{' '}
          {isFullscreen
            ? 'Scroll to zoom · Esc to exit'
            : 'Ctrl+Scroll or Fullscreen to zoom'}{' '}
          · Click platform cards to open
        </span>
      </div>
    </section>
  );
}
