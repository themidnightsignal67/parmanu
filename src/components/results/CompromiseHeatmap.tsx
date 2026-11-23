import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  CircleMarker,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet';
import {
  ArrowUpRight,
  Flame,
  Globe2,
  LocateFixed,
  ShieldAlert,
} from 'lucide-react';
import type { InvestigationRecord } from '@/src/types/investigation';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';

interface CompromiseHeatmapProps {
  investigations: InvestigationRecord[];
  activeInvestigation?: InvestigationRecord | null;
  onOpenInvestigation?: (scanId: string) => void;
  compact?: boolean;
}

type HeatFilter = 'all' | 'breaches' | 'leaks_infra';

interface HeatPoint {
  id: string;
  lat: number;
  lng: number;
  intensity: number;
  category: 'breach' | 'leak_infra';
  region: string;
  country: string;
  target: string;
  targetType: string;
  scanId: string;
  breachedCount: number;
  leakedCount: number;
  sources: string[];
}

const KNOWN_COMPROMISE_GEO: Array<{
  keywords: string[];
  lat: number;
  lng: number;
  region: string;
  country: string;
}> = [
  { keywords: ['india', 'delhi', 'new delhi', 'ncr', 'noida', 'gurugram'], lat: 28.6139, lng: 77.209, region: 'New Delhi', country: 'India' },
  { keywords: ['mumbai', 'maharashtra', 'pune'], lat: 19.076, lng: 72.8777, region: 'Mumbai', country: 'India' },
  { keywords: ['bengaluru', 'bangalore', 'karnataka', 'hyderabad', 'chennai'], lat: 12.9716, lng: 77.5946, region: 'Bengaluru', country: 'India' },
  { keywords: ['adobe', 'linkedin', 'dropbox', 'twitter', 'x.com', 'yahoo', 'ebay', 'github', 'san francisco', 'california', 'usa', 'us-west', 'silicon'], lat: 37.7749, lng: -122.4194, region: 'San Francisco / US-West', country: 'United States' },
  { keywords: ['us-east', 'virginia', 'aws', 'new york', 'nyc', 'washington', 'verizon'], lat: 40.7128, lng: -74.006, region: 'New York / US-East', country: 'United States' },
  { keywords: ['london', 'uk', 'united kingdom', 'britain', 'british'], lat: 51.5074, lng: -0.1278, region: 'London', country: 'United Kingdom' },
  { keywords: ['frankfurt', 'germany', 'berlin', 'munich', 'hetzner', 'de'], lat: 50.1109, lng: 8.6821, region: 'Frankfurt', country: 'Germany' },
  { keywords: ['paris', 'france', 'ovh', 'dailymotion', 'deezer'], lat: 48.8566, lng: 2.3522, region: 'Paris', country: 'France' },
  { keywords: ['amsterdam', 'netherlands', 'nl', 'digitalocean'], lat: 52.3676, lng: 4.9041, region: 'Amsterdam', country: 'Netherlands' },
  { keywords: ['singapore', 'sg', 'lazada', 'shopee'], lat: 1.3521, lng: 103.8198, region: 'Singapore', country: 'Singapore' },
  { keywords: ['tokyo', 'japan', 'jp', 'rakuten', 'sony'], lat: 35.6762, lng: 139.6503, region: 'Tokyo', country: 'Japan' },
  { keywords: ['sydney', 'australia', 'au', 'canva', 'optus', 'medibank'], lat: -33.8688, lng: 151.2093, region: 'Sydney', country: 'Australia' },
  { keywords: ['toronto', 'canada', 'ca', 'shopify'], lat: 43.6532, lng: -79.3832, region: 'Toronto', country: 'Canada' },
  { keywords: ['sao paulo', 'brazil', 'br'], lat: -23.5505, lng: -46.6333, region: 'São Paulo', country: 'Brazil' },
  { keywords: ['dubai', 'uae', 'emirates'], lat: 25.2048, lng: 55.2708, region: 'Dubai', country: 'UAE' },
  { keywords: ['seoul', 'korea', 'kr'], lat: 37.5665, lng: 126.978, region: 'Seoul', country: 'South Korea' },
];

function matchGeoHint(text: string): {
  lat: number;
  lng: number;
  region: string;
  country: string;
} | null {
  const lower = text.toLowerCase();
  for (const entry of KNOWN_COMPROMISE_GEO) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return {
        lat: entry.lat,
        lng: entry.lng,
        region: entry.region,
        country: entry.country,
      };
    }
  }
  return null;
}

function buildHeatPoints(investigations: InvestigationRecord[]): HeatPoint[] {
  const buckets = new Map<string, HeatPoint>();

  const upsert = (pt: Omit<HeatPoint, 'id'>) => {
    const key = `${pt.lat.toFixed(2)},${pt.lng.toFixed(2)}:${pt.category}:${pt.scanId}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.intensity = Math.min(1, existing.intensity + pt.intensity * 0.35);
      existing.breachedCount = Math.max(existing.breachedCount, pt.breachedCount);
      existing.leakedCount = Math.max(existing.leakedCount, pt.leakedCount);
      for (const s of pt.sources) {
        if (!existing.sources.includes(s)) existing.sources.push(s);
      }
      return;
    }
    buckets.set(key, {
      ...pt,
      id: `heat-${buckets.size + 1}-${pt.scanId}`,
    });
  };

  for (const inv of investigations) {
    const breachedCount = inv.summary.breached || inv.breachedAccounts.length || 0;
    const leakedCount = inv.summary.leaked || 0;
    const hasCompromise = breachedCount > 0 || leakedCount > 0;

    // 1) Explicit geoMarkers attached to investigation
    for (const gm of inv.geoMarkers || []) {
      const cat: HeatPoint['category'] =
        breachedCount > 0 && /breach|leak|hibp|xposed|hudson|stealer/i.test(gm.source)
          ? 'breach'
          : hasCompromise && gm.source.toLowerCase().includes('breach')
          ? 'breach'
          : leakedCount > 0 || gm.source.toLowerCase().includes('exif')
          ? 'leak_infra'
          : breachedCount > 0
          ? 'breach'
          : 'leak_infra';

      const weight = Math.min(
        1,
        0.42 +
          Math.min(breachedCount, 8) * 0.06 +
          Math.min(leakedCount, 5) * 0.05 +
          Math.min(gm.count, 5) * 0.04
      );
      upsert({
        lat: gm.lat,
        lng: gm.lng,
        intensity: weight,
        category: cat,
        region: gm.region || 'Detected Node',
        country: gm.country || 'Unknown',
        target: inv.target,
        targetType: inv.targetType,
        scanId: inv.scanId,
        breachedCount,
        leakedCount,
        sources: [gm.source || gm.label],
      });
    }

    // 2) Derive historical breach/leak hotspots from breach incidents & exposed findings
    for (const breach of inv.breachedAccounts || []) {
      const hint = matchGeoHint(
        `${breach.breachName} ${breach.domain || ''} ${breach.platform} ${breach.summary || ''}`
      );
      if (hint) {
        upsert({
          lat: hint.lat,
          lng: hint.lng,
          intensity: breach.severity === 'high' ? 0.92 : breach.severity === 'medium' ? 0.72 : 0.55,
          category: 'breach',
          region: hint.region,
          country: hint.country,
          target: inv.target,
          targetType: inv.targetType,
          scanId: inv.scanId,
          breachedCount: Math.max(1, breachedCount),
          leakedCount,
          sources: [`Breach: ${breach.breachName || breach.platform}`],
        });
      }
    }

    for (const res of inv.results || []) {
      if (res.status !== 'found') continue;
      if (res.findingKind !== 'breached' && res.findingKind !== 'leaked') continue;
      const hint = matchGeoHint(
        `${res.platform} ${res.domain || ''} ${res.summary || ''} ${JSON.stringify(res.details || {})}`
      );
      if (hint) {
        upsert({
          lat: hint.lat,
          lng: hint.lng,
          intensity: res.findingKind === 'breached' ? 0.85 : 0.75,
          category: res.findingKind === 'breached' ? 'breach' : 'leak_infra',
          region: hint.region,
          country: hint.country,
          target: inv.target,
          targetType: inv.targetType,
          scanId: inv.scanId,
          breachedCount,
          leakedCount: Math.max(1, leakedCount),
          sources: [`${res.platform} (${res.findingKind})`],
        });
      }
    }
  }

  return Array.from(buckets.values());
}

function HeatmapCanvasOverlay({
  points,
  showHeat,
  isDark,
}: {
  points: HeatPoint[];
  showHeat: boolean;
  isDark: boolean;
}) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const pane = map.getPane('overlayPane');
    if (!pane) return;

    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '250';
    pane.appendChild(canvas);
    canvasRef.current = canvas;

    const redraw = () => {
      const size = map.getSize();
      const topLeft = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(canvas, topLeft);
      canvas.width = size.x;
      canvas.height = size.y;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!showHeat || points.length === 0) return;

      ctx.globalCompositeOperation = isDark ? 'lighter' : 'source-over';

      for (const pt of points) {
        const containerPt = map.latLngToContainerPoint([pt.lat, pt.lng]);
        const radius = 34 + pt.intensity * 36;
        const grad = ctx.createRadialGradient(
          containerPt.x,
          containerPt.y,
          2,
          containerPt.x,
          containerPt.y,
          radius
        );

        if (pt.category === 'breach') {
          grad.addColorStop(0, `rgba(244, 63, 94, ${0.42 + pt.intensity * 0.25})`);
          grad.addColorStop(0.45, `rgba(249, 115, 22, ${0.26 + pt.intensity * 0.14})`);
          grad.addColorStop(1, 'rgba(249, 115, 22, 0)');
        } else {
          grad.addColorStop(0, `rgba(245, 158, 11, ${0.38 + pt.intensity * 0.2})`);
          grad.addColorStop(0.5, `rgba(99, 102, 241, ${0.18 + pt.intensity * 0.12})`);
          grad.addColorStop(1, 'rgba(99, 102, 241, 0)');
        }

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(containerPt.x, containerPt.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    redraw();
    map.on('move zoom viewreset resize', redraw);

    return () => {
      map.off('move zoom viewreset resize', redraw);
      canvas.remove();
      canvasRef.current = null;
    };
  }, [map, points, showHeat, isDark]);

  return null;
}

function FitHeatmapBounds({
  points,
  fitToken,
}: {
  points: HeatPoint[];
  fitToken: number;
}) {
  const map = useMap();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      map.invalidateSize();
      if (points.length === 1) {
        map.setView([points[0].lat, points[0].lng], 4, { animate: true });
      } else if (points.length > 1) {
        const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
        map.fitBounds(bounds, { padding: [48, 48], maxZoom: 5, animate: true });
      } else {
        map.setView([20, 12], 2, { animate: false });
      }
    }, 90);
    return () => window.clearTimeout(timer);
  }, [map, points, fitToken]);

  return null;
}

export function CompromiseHeatmap({
  investigations,
  activeInvestigation,
  onOpenInvestigation,
  compact = false,
}: CompromiseHeatmapProps) {
  const [filter, setFilter] = useState<HeatFilter>('all');
  const [showHeatGlow, setShowHeatGlow] = useState(true);
  const [fitToken, setFitToken] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tileFallback, setTileFallback] = useState(false);
  const [isDark, setIsDark] = useState(
    () =>
      typeof document !== 'undefined' &&
      document.documentElement.classList.contains('dark')
  );

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  const combinedInvestigations = useMemo(() => {
    if (!activeInvestigation) return investigations;
    const seen = new Set(investigations.map((i) => i.scanId));
    return seen.has(activeInvestigation.scanId)
      ? investigations
      : [activeInvestigation, ...investigations];
  }, [investigations, activeInvestigation]);

  const allPoints = useMemo(
    () => buildHeatPoints(combinedInvestigations),
    [combinedInvestigations]
  );

  const filteredPoints = useMemo(() => {
    if (filter === 'breaches') {
      return allPoints.filter((p) => p.category === 'breach');
    }
    if (filter === 'leaks_infra') {
      return allPoints.filter((p) => p.category === 'leak_infra');
    }
    return allPoints;
  }, [allPoints, filter]);

  const selectedPoint =
    filteredPoints.find((p) => p.id === selectedId) || filteredPoints[0] || null;

  const maptilerKey = (import.meta.env.VITE_MAPTILER_API_KEY || '').trim();
  const cartoApiKey = (import.meta.env.VITE_CARTO_API_KEY || '').trim();
  const useMapTiler = Boolean(maptilerKey) && !tileFallback;
  const tileStyle = useMapTiler
    ? isDark
      ? 'maptiler-streets-v2-dark'
      : 'maptiler-streets-v2'
    : isDark
    ? 'dark_all'
    : 'voyager';
  const tileUrl = useMapTiler
    ? `https://api.maptiler.com/maps/${
        isDark ? 'streets-v2-dark' : 'streets-v2'
      }/256/{z}/{x}/{y}.png?key=${encodeURIComponent(maptilerKey)}`
    : cartoApiKey
    ? `https://basemaps.cartocdn.com/${tileStyle}/{z}/{x}/{y}.png?key=${encodeURIComponent(
        cartoApiKey
      )}`
    : `https://basemaps.cartocdn.com/${tileStyle}/{z}/{x}/{y}.png`;
  const tileAttribution = useMapTiler
    ? '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

  const uniqueCountries = useMemo(
    () => new Set(filteredPoints.map((p) => p.country)).size,
    [filteredPoints]
  );

  return (
    <Card className="p-5 sm:p-6 space-y-4 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-rose-500 shrink-0" />
            <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-slate-100">
              Global Compromise & Breach Heatmap
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Interactive react-leaflet thermal density map across{' '}
            <span className="font-mono font-semibold text-[#0F172A] dark:text-slate-200 tabular-nums">
              {filteredPoints.length}
            </span>{' '}
            compromised hotspot{filteredPoints.length === 1 ? '' : 's'} spanning{' '}
            <span className="font-mono font-semibold text-[#0F172A] dark:text-slate-200 tabular-nums">
              {uniqueCountries}
            </span>{' '}
            region{uniqueCountries === 1 ? '' : 's'}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center p-0.5 rounded-xl bg-slate-100/90 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 text-[11px]">
            {(
              [
                { id: 'all', label: 'All Compromises' },
                { id: 'breaches', label: 'Breaches Only' },
                { id: 'leaks_infra', label: 'Leaks & Infra' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFilter(opt.id)}
                className={`px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  filter === opt.id
                    ? 'bg-white dark:bg-indigo-600 text-[#0F172A] dark:text-white shadow-2xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-[#0F172A] dark:hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <Button
            size="sm"
            variant={showHeatGlow ? 'primary' : 'outline'}
            onClick={() => setShowHeatGlow((v) => !v)}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Thermal Glow</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setFitToken((t) => t + 1)}
          >
            <LocateFixed className="w-3.5 h-3.5" />
            <span>Fit Global</span>
          </Button>
        </div>
      </div>

      <div className="relative rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden bg-slate-100 dark:bg-[#090F1D]">
        <div className={compact ? 'h-[280px] w-full' : 'h-[340px] sm:h-[380px] w-full'}>
          <MapContainer
            center={[20, 12]}
            zoom={2}
            minZoom={2}
            maxZoom={11}
            zoomControl={false}
            worldCopyJump
            className="h-full w-full z-10"
          >
            <TileLayer
              key={tileStyle}
              url={tileUrl}
              attribution={tileAttribution}
              eventHandlers={{
                tileerror: () => {
                  if (useMapTiler) setTileFallback(true);
                },
              }}
            />
            <HeatmapCanvasOverlay
              points={filteredPoints}
              showHeat={showHeatGlow}
              isDark={isDark}
            />
            <FitHeatmapBounds points={filteredPoints} fitToken={fitToken} />

            {filteredPoints.map((pt) => {
              const isSelected = selectedPoint?.id === pt.id;
              const isBreach = pt.category === 'breach';
              return (
                <CircleMarker
                  key={pt.id}
                  center={[pt.lat, pt.lng]}
                  radius={isSelected ? 8 : 5 + Math.round(pt.intensity * 3)}
                  pathOptions={{
                    color: '#FFFFFF',
                    weight: isSelected ? 2.5 : 1.5,
                    fillColor: isBreach ? '#F43F5E' : '#F59E0B',
                    fillOpacity: 0.95,
                  }}
                  eventHandlers={{
                    click: () => setSelectedId(pt.id),
                  }}
                >
                  <Tooltip direction="top" offset={[0, -6]}>
                    <div className="text-[11px] leading-snug">
                      <p className="font-semibold">
                        {pt.region}, {pt.country}
                      </p>
                      <p className="text-slate-600">
                        Target: <span className="font-mono">{pt.target}</span>
                      </p>
                      <p className="text-rose-600 font-medium">
                        {pt.breachedCount} breach · {pt.leakedCount} leak signals
                      </p>
                    </div>
                  </Tooltip>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>

        {/* Thermal Legend */}
        <div className="absolute left-3 bottom-14 z-[400] px-3 py-1.5 rounded-xl bg-white/90 dark:bg-[#0D1424]/90 backdrop-blur-md border border-slate-200/80 dark:border-slate-700 flex items-center gap-3 text-[11px] shadow-xs">
          <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200 font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span>Breach Exposure</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200 font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span>Leak / Infra Node</span>
          </span>
        </div>

        {/* Selected Hotspot Bar */}
        <div className="relative z-20 px-4 py-3 bg-white/90 dark:bg-[#0D1424]/95 backdrop-blur-md border-t border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          {selectedPoint ? (
            <>
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <ShieldAlert
                  className={`w-4 h-4 shrink-0 ${
                    selectedPoint.category === 'breach'
                      ? 'text-rose-500'
                      : 'text-amber-500'
                  }`}
                />
                <span className="font-semibold text-[#0F172A] dark:text-slate-100">
                  {selectedPoint.region}, {selectedPoint.country}
                </span>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span className="font-mono text-indigo-600 dark:text-indigo-400 truncate max-w-[200px]">
                  {selectedPoint.target}
                </span>
                <span className="text-slate-400 tabular-nums">
                  ({selectedPoint.sources[0]})
                </span>
              </div>

              {onOpenInvestigation && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onOpenInvestigation(selectedPoint.scanId)}
                >
                  <span>Open Case</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </Button>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <Globe2 className="w-4 h-4 shrink-0" />
              <span>
                Run or open investigations with regional signals or breaches to populate historical compromise density.
              </span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
