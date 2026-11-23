import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Download, MapPin, Minus, Plus, RotateCcw } from 'lucide-react';
import type { GeoMarker } from '@/src/types/investigation';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';

interface GeographicDistributionCardProps {
  markers: GeoMarker[];
  target: string;
  onExportGeo: () => void;
  focusRequest?: {
    lat: number;
    lng: number;
    zoom?: number;
    markerId?: string;
    nonce: number;
  } | null;
}

function resolveTileConfig(isDark: boolean, forceFallback: boolean) {
  const maptilerKey = (import.meta.env.VITE_MAPTILER_API_KEY || '').trim();
  const cartoApiKey = (import.meta.env.VITE_CARTO_API_KEY || '').trim();
  if (maptilerKey && !forceFallback) {
    const style = isDark ? 'streets-v2-dark' : 'streets-v2';
    return {
      url: `https://api.maptiler.com/maps/${style}/256/{z}/{x}/{y}.png?key=${encodeURIComponent(
        maptilerKey
      )}`,
      attribution:
        '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    };
  }
  const cartoStyle = isDark ? 'dark_all' : 'rastertiles/voyager';
  return {
    url: cartoApiKey
      ? `https://basemaps.cartocdn.com/${cartoStyle}/{z}/{x}/{y}.png?key=${encodeURIComponent(
          cartoApiKey
        )}`
      : `https://basemaps.cartocdn.com/${cartoStyle}/{z}/{x}/{y}.png`,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  };
}

export function GeographicDistributionCard({
  markers,
  target,
  onExportGeo,
  focusRequest,
}: GeographicDistributionCardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    markers[0]?.id || null
  );
  const [tilesLoaded, setTilesLoaded] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    setSelectedId(markers[0]?.id || null);
  }, [target, markers]);

  const activeMarker =
    markers.find((m) => m.id === selectedId) || markers[0] || null;

  // Initialize interactive Leaflet + MapTiler basemap (with CARTO fallback)
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mapRef.current) return;

    const initialCenter: [number, number] =
      markers.length > 0 ? [markers[0].lat, markers[0].lng] : [22, 20];
    const initialZoom = markers.length > 0 ? 3 : 2;

    const map = L.map(container, {
      center: initialCenter,
      zoom: initialZoom,
      minZoom: 2,
      maxZoom: 16,
      zoomControl: false,
      worldCopyJump: true,
      attributionControl: true,
    });

    let useFallback = false;
    const attachTileLayer = (dark: boolean, fallback: boolean) => {
      if (tileLayerRef.current) {
        map.removeLayer(tileLayerRef.current);
      }
      const cfg = resolveTileConfig(dark, fallback);
      const nextLayer = L.tileLayer(cfg.url, {
        maxZoom: 19,
        attribution: cfg.attribution,
      });
      nextLayer.on('tileload', () => {
        setTilesLoaded(true);
      });
      nextLayer.on('tileerror', () => {
        if (!useFallback && (import.meta.env.VITE_MAPTILER_API_KEY || '').trim()) {
          useFallback = true;
          attachTileLayer(
            document.documentElement.classList.contains('dark'),
            true
          );
        }
      });
      nextLayer.addTo(map);
      tileLayerRef.current = nextLayer;
    };

    attachTileLayer(
      typeof document !== 'undefined' &&
        document.documentElement.classList.contains('dark'),
      false
    );

    const themeObserver =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => {
            attachTileLayer(
              document.documentElement.classList.contains('dark'),
              useFallback
            );
          })
        : null;
    themeObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    const layerGroup = L.layerGroup().addTo(map);
    mapRef.current = map;
    markersLayerRef.current = layerGroup;

    const resizeTimer = window.setTimeout(() => {
      map.invalidateSize();
    }, 180);

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            map.invalidateSize();
          })
        : null;
    observer?.observe(container);

    return () => {
      window.clearTimeout(resizeTimer);
      themeObserver?.disconnect();
      observer?.disconnect();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      markersLayerRef.current = null;
    };
    // Initialize map instance once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit bounds when investigation markers change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (markers.length === 1 && !markers[0].radiusMeters) {
      map.setView([markers[0].lat, markers[0].lng], 4, { animate: false });
    } else if (markers.length >= 1) {
      const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng]));
      for (const m of markers) {
        if (typeof m.radiusMeters === 'number' && m.radiusMeters > 0) {
          const degLat = m.radiusMeters / 111_320;
          const degLng =
            m.radiusMeters /
            Math.max(15_000, 111_320 * Math.cos((m.lat * Math.PI) / 180));
          bounds.extend([m.lat + degLat, m.lng + degLng]);
          bounds.extend([m.lat - degLat, m.lng - degLng]);
        }
      }
      map.fitBounds(bounds, {
        padding: [44, 44],
        maxZoom: markers.some((m) => m.kind === 'review' || m.kind === 'ring_center') ? 12 : 5,
        animate: false,
      });
    } else {
      map.setView([22, 20], 2, { animate: false });
    }
  }, [markers, target]);

  // Pan & focus when triggered externally (e.g. GhuntProfileCard Focus Ring / Review button)
  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.markerId) {
      setSelectedId(focusRequest.markerId);
    }
    const map = mapRef.current;
    if (map) {
      map.invalidateSize();
      map.flyTo([focusRequest.lat, focusRequest.lng], focusRequest.zoom ?? 12, {
        duration: 0.65,
      });
    }
  }, [focusRequest]);

  // Render triangulation radius rings + color-coded interactive markers
  useEffect(() => {
    const layer = markersLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    for (const m of markers) {
      const isSelected = activeMarker?.id === m.id;
      const isRing = m.kind === 'ring_center';
      const isReview = m.kind === 'review';

      const baseHex = isRing ? '#EA580C' : isReview ? '#10B981' : '#4F46E5';
      const activeHex = isSelected ? '#EA580C' : baseHex;
      const haloRgba = isSelected || isRing
        ? 'rgba(249,115,22,0.34)'
        : isReview
        ? 'rgba(16,185,129,0.3)'
        : 'rgba(99,102,241,0.28)';

      // Triangulation / uncertainty ring circle in real meters
      if (typeof m.radiusMeters === 'number' && m.radiusMeters > 0) {
        const ringCircle = L.circle([m.lat, m.lng], {
          radius: m.radiusMeters,
          color: '#EA580C',
          weight: isSelected ? 2.25 : 1.75,
          dashArray: '6 5',
          fillColor: '#F97316',
          fillOpacity: isSelected ? 0.16 : 0.11,
        });
        ringCircle.bindTooltip(
          `<div style="font-family:Public Sans,sans-serif;font-size:11px;line-height:1.35;"><strong>${m.label}</strong><br/><span style="color:#64748b;">${m.region} · ${m.source}</span></div>`,
          { sticky: true }
        );
        ringCircle.on('click', () => {
          setSelectedId(m.id);
        });
        ringCircle.addTo(layer);
      }

      const pulseIcon = L.divIcon({
        className: 'brahmand-map-pulse',
        html: `<div style="position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center;pointer-events:none;">
          <span style="position:absolute;inset:0;border-radius:9999px;background:${haloRgba};animation:ping ${isSelected ? '1.8s' : '2.6s'} cubic-bezier(0,0,0.2,1) infinite;"></span>
        </div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
      L.marker([m.lat, m.lng], { icon: pulseIcon, interactive: false }).addTo(layer);

      L.circleMarker([m.lat, m.lng], {
        radius: isSelected ? 18 : isRing ? 16 : 12,
        stroke: false,
        fillColor: activeHex,
        fillOpacity: isSelected ? 0.22 : 0.14,
        interactive: false,
      }).addTo(layer);

      const pin = L.circleMarker([m.lat, m.lng], {
        radius: isSelected ? 8 : isRing ? 7 : 5.5,
        color: '#FFFFFF',
        weight: 2,
        fillColor: activeHex,
        fillOpacity: 1,
      });

      pin.bindTooltip(
        `<div style="font-family:Public Sans,sans-serif;font-size:11px;line-height:1.35;"><strong>${m.label}</strong><br/><span style="color:#64748b;">${m.region}, ${m.country} · ${m.source}</span></div>`,
        { direction: 'top', offset: [0, -8] }
      );

      pin.on('click', () => {
        setSelectedId(m.id);
      });

      pin.addTo(layer);
    }
  }, [markers, activeMarker?.id]);

  const handleFocusMarker = (m: GeoMarker) => {
    setSelectedId(m.id);
    const map = mapRef.current;
    if (map) {
      const targetZoom = m.kind === 'review' ? 14 : m.kind === 'ring_center' ? 10 : Math.max(map.getZoom(), 4);
      map.flyTo([m.lat, m.lng], targetZoom, {
        duration: 0.55,
      });
    }
  };

  const handleZoomIn = () => {
    mapRef.current?.zoomIn();
  };

  const handleZoomOut = () => {
    mapRef.current?.zoomOut();
  };

  const handleResetView = () => {
    const map = mapRef.current;
    if (!map) return;
    if (markers.length === 1 && !markers[0].radiusMeters) {
      map.flyTo([markers[0].lat, markers[0].lng], 4, { duration: 0.5 });
    } else if (markers.length >= 1) {
      const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng]));
      for (const m of markers) {
        if (typeof m.radiusMeters === 'number' && m.radiusMeters > 0) {
          const degLat = m.radiusMeters / 111_320;
          const degLng =
            m.radiusMeters /
            Math.max(15_000, 111_320 * Math.cos((m.lat * Math.PI) / 180));
          bounds.extend([m.lat + degLat, m.lng + degLng]);
          bounds.extend([m.lat - degLat, m.lng - degLng]);
        }
      }
      map.fitBounds(bounds, {
        padding: [44, 44],
        maxZoom: markers.some((m) => m.kind === 'review' || m.kind === 'ring_center') ? 12 : 5,
      });
    } else {
      map.flyTo([22, 20], 2, { duration: 0.5 });
    }
  };

  return (
    <Card className="p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-[#0F172A] dark:text-slate-100">
            Geographic Distribution
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Locations of detected public profiles, infrastructure nodes, and
            regional signals for{' '}
            <span className="font-mono text-slate-700 dark:text-slate-200">{target}</span>.
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={onExportGeo}>
          <Download className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          <span>Export</span>
        </Button>
      </div>

      <div className="relative rounded-xl border border-slate-200/70 dark:border-slate-800 bg-[#F3F5F8] dark:bg-slate-900 overflow-hidden">
        {/* Subtle fallback grid until tiles stream in */}
        {!tilesLoaded && (
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(#CBD5E1_1px,transparent_1px)] dark:bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:20px_20px] opacity-40 pointer-events-none"
          />
        )}

        {/* Custom Frosted Zoom & Reset Controls */}
        <div className="absolute right-3 top-3 z-[400] flex flex-col bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border border-slate-200/80 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={handleZoomIn}
            aria-label="Zoom in map"
            className="w-8 h-8 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-[#0F172A] dark:hover:text-white transition-colors border-b border-slate-100 dark:border-slate-800 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleZoomOut}
            aria-label="Zoom out map"
            className="w-8 h-8 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-[#0F172A] dark:hover:text-white transition-colors border-b border-slate-100 dark:border-slate-800 cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleResetView}
            aria-label="Reset map zoom"
            className="w-8 h-8 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-[#0F172A] dark:hover:text-white transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Interactive Leaflet Map Canvas */}
        <div
          ref={mapContainerRef}
          aria-label="Interactive geographic distribution map"
          className="w-full h-[280px] sm:h-[340px] z-10 [&_.leaflet-control-attribution]:bg-white/80 dark:[&_.leaflet-control-attribution]:bg-slate-900/80 [&_.leaflet-control-attribution]:backdrop-blur-sm [&_.leaflet-control-attribution]:text-[10px] [&_.leaflet-control-attribution]:px-2 [&_.leaflet-control-attribution]:py-0.5 [&_.leaflet-control-attribution]:rounded-tl-lg [&_.leaflet-control-attribution]:text-slate-500 dark:[&_.leaflet-control-attribution]:text-slate-400"
        />

        {/* Active Marker Readout or Empty Notice */}
        <div className="relative z-20 px-4 py-3 bg-white/85 dark:bg-[#0D1424]/90 backdrop-blur-md border-t border-slate-200/60 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          {activeMarker ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[#0F172A] dark:text-slate-100">
                <MapPin
                  className={`w-3.5 h-3.5 shrink-0 ${
                    activeMarker.kind === 'ring_center'
                      ? 'text-orange-600 dark:text-orange-400'
                      : activeMarker.kind === 'review'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-indigo-600 dark:text-indigo-400'
                  }`}
                />
                <span className="font-semibold">
                  {activeMarker.kind === 'review' || activeMarker.kind === 'ring_center'
                    ? activeMarker.label
                    : `${activeMarker.region}, ${activeMarker.country}`}
                </span>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span className="text-slate-500 dark:text-slate-400">{activeMarker.source}</span>
                {typeof activeMarker.radiusMeters === 'number' && activeMarker.radiusMeters > 0 && (
                  <>
                    <span className="text-slate-300 dark:text-slate-600">·</span>
                    <span className="font-mono text-[11px] text-orange-700 dark:text-orange-300 tabular-nums">
                      ±{(activeMarker.radiusMeters / 1000).toFixed(1)} km ring
                    </span>
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {markers.slice(0, 8).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleFocusMarker(m)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer tabular-nums ${
                      activeMarker.id === m.id
                        ? 'bg-gradient-to-r from-blue-50 to-purple-50 dark:from-indigo-950/70 dark:to-purple-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {m.kind === 'ring_center'
                      ? 'Location Ring'
                      : m.kind === 'review'
                      ? m.label.slice(0, 22)
                      : `${m.country} (${m.count})`}
                  </button>
                ))}
                {markers.length > 8 && (
                  <span className="text-[11px] text-slate-400 tabular-nums">
                    +{markers.length - 8} more
                  </span>
                )}
              </div>
            </>
          ) : (
            <span className="text-slate-500 dark:text-slate-400">
              No public geographic coordinates were disclosed by resolved
              accounts for this query.
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
