import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import bgOsintMap from '@/src/assets/images/osint_signal_map_bg_1795349222553.jpg';
import bgOsintRadar from '@/src/assets/images/osint_radar_telemetry_bg_1795349223314.jpg';
import bgOsintNodes from '@/src/assets/images/osint_node_constellation_bg_1795349223184.jpg';
import bgSecurityLens from '@/src/assets/images/hero_security_lens_1794650561688.jpg';
import bgRedLens from '@/src/assets/images/hero_red_osint_lens_1794651963127.jpg';

interface HeroSlide {
  src: string;
  alt: string;
  accentA: [number, number, number];
  accentB: [number, number, number];
  accentC: [number, number, number];
}

const HERO_SLIDES: HeroSlide[] = [
  {
    src: bgOsintMap,
    alt: 'Bright alabaster OSINT global signal intelligence cartography with triangulation arcs',
    accentA: [59, 130, 246],
    accentB: [245, 158, 11],
    accentC: [99, 102, 241],
  },
  {
    src: bgOsintRadar,
    alt: 'Bright optical radar telemetry rings and concentric coordinate arcs',
    accentA: [14, 165, 233],
    accentB: [79, 70, 229],
    accentC: [16, 185, 129],
  },
  {
    src: bgOsintNodes,
    alt: 'Pearl-white OSINT identity correlation node network over frosted glass',
    accentA: [99, 102, 241],
    accentB: [56, 189, 248],
    accentC: [245, 158, 11],
  },
  {
    src: bgSecurityLens,
    alt: 'Concentric frosted glass telemetry lens with indigo geometry',
    accentA: [59, 130, 246],
    accentB: [99, 102, 241],
    accentC: [16, 185, 129],
  },
  {
    src: bgRedLens,
    alt: 'Precision frosted concentric architectural ring core',
    accentA: [244, 63, 94],
    accentB: [99, 102, 241],
    accentC: [245, 158, 11],
  },
];

function lerp(x: number, y: number, t: number): number {
  return x + (y - x) * t;
}

function lerpRgb(
  c1: [number, number, number],
  c2: [number, number, number],
  t: number
): string {
  const r = Math.round(lerp(c1[0], c2[0], t));
  const g = Math.round(lerp(c1[1], c2[1], t));
  const b = Math.round(lerp(c1[2], c2[2], t));
  return `${r}, ${g}, ${b}`;
}

export function DynamicHeroBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.4 });
  const prefersReducedMotion = useReducedMotion();
  const [activeIndex, setActiveIndex] = useState(0);

  // Cycle real background pictures smoothly every 5.2 seconds
  useEffect(() => {
    if (prefersReducedMotion) return;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % HERO_SLIDES.length);
    }, 5200);
    return () => window.clearInterval(timer);
  }, [prefersReducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      const w = parent ? parent.clientWidth : window.innerWidth;
      const h = parent ? parent.clientHeight : 760;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      width = w;
      height = h;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const onPointerMove = (e: PointerEvent) => {
      if (!width || !height) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      pointerRef.current = { x: nx, y: ny };
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    const nodes = Array.from({ length: 24 }, (_, i) => ({
      angle: (i / 24) * Math.PI * 2,
      radiusFrac: 0.18 + ((i * 37) % 100) / 140,
      speed: (i % 2 === 0 ? 1 : -1) * (0.06 + ((i * 13) % 10) * 0.01),
      size: 1.6 + (i % 3) * 0.85,
    }));

    const startTime = performance.now();

    const drawFrame = (now: number) => {
      if (document.hidden && !prefersReducedMotion) {
        rafId = window.requestAnimationFrame(drawFrame);
        return;
      }

      const elapsedSec = prefersReducedMotion ? 0 : (now - startTime) / 1000;
      const cyclePos = (elapsedSec / 5.2) % HERO_SLIDES.length;
      const idxA = Math.floor(cyclePos);
      const idxB = (idxA + 1) % HERO_SLIDES.length;
      const mix = cyclePos - idxA;
      const smoothMix = mix * mix * (3 - 2 * mix);

      const sA = HERO_SLIDES[idxA];
      const sB = HERO_SLIDES[idxB];
      const rgb1 = lerpRgb(sA.accentA, sB.accentA, smoothMix);
      const rgb2 = lerpRgb(sA.accentB, sB.accentB, smoothMix);
      const rgb3 = lerpRgb(sA.accentC, sB.accentC, smoothMix);

      ctx.clearRect(0, 0, width, height);

      const px = (pointerRef.current.x - 0.5) * 44;
      const py = (pointerRef.current.y - 0.5) * 30;

      // Soft translucent chromatic wash synced with current photo slide
      const orb1X = width * (0.24 + Math.sin(elapsedSec * 0.32) * 0.16) + px * 0.6;
      const orb1Y = height * (0.26 + Math.cos(elapsedSec * 0.25) * 0.12) + py * 0.5;
      const g1 = ctx.createRadialGradient(orb1X, orb1Y, 0, orb1X, orb1Y, width * 0.48);
      g1.addColorStop(0, `rgba(${rgb1}, 0.26)`);
      g1.addColorStop(0.55, `rgba(${rgb1}, 0.08)`);
      g1.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, width, height);

      const orb2X = width * (0.76 + Math.cos(elapsedSec * 0.29) * 0.16) - px * 0.7;
      const orb2Y = height * (0.34 + Math.sin(elapsedSec * 0.34) * 0.13) + py * 0.5;
      const g2 = ctx.createRadialGradient(orb2X, orb2Y, 0, orb2X, orb2Y, width * 0.5);
      g2.addColorStop(0, `rgba(${rgb2}, 0.24)`);
      g2.addColorStop(0.55, `rgba(${rgb2}, 0.08)`);
      g2.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, width, height);

      // Atomic telemetry rings & constellation overlay
      const cx = width * 0.5 + px * 0.35;
      const cy = height * 0.44 + py * 0.35;
      const maxR = Math.min(width, height) * 0.52;

      for (let ring = 1; ring <= 3; ring++) {
        const r = maxR * (ring * 0.34);
        ctx.beginPath();
        ctx.strokeStyle = `rgba(${rgb2}, ${0.22 - ring * 0.035})`;
        ctx.lineWidth = 1.1;
        ctx.setLineDash([5, 8]);
        ctx.lineDashOffset = -elapsedSec * (12 + ring * 5);
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();

        // Subtle 24-spoke Chakra-inspired atomic telemetry ticks on middle orbital ring
        if (ring === 2) {
          ctx.setLineDash([]);
          const spokeOffset = elapsedSec * 0.06;
          for (let s = 0; s < 24; s++) {
            const ang = (s * Math.PI * 2) / 24 + spokeOffset;
            const innerR = r - 7;
            const outerR = r + 7;
            ctx.beginPath();
            ctx.strokeStyle =
              s % 6 === 0
                ? 'rgba(255, 153, 51, 0.20)'
                : 'rgba(29, 78, 216, 0.13)';
            ctx.lineWidth = s % 6 === 0 ? 1.15 : 0.75;
            ctx.moveTo(cx + Math.cos(ang) * innerR, cy + Math.sin(ang) * innerR);
            ctx.lineTo(cx + Math.cos(ang) * outerR, cy + Math.sin(ang) * outerR);
            ctx.stroke();
          }
        }
      }
      ctx.setLineDash([]);

      const pts: Array<{ x: number; y: number; size: number }> = [];
      for (const n of nodes) {
        const a = n.angle + elapsedSec * n.speed;
        const rx = width * 0.42 * n.radiusFrac;
        const ry = height * 0.36 * n.radiusFrac;
        const x = cx + Math.cos(a) * rx;
        const y = cy + Math.sin(a) * ry;
        pts.push({ x, y, size: n.size });
      }

      ctx.lineWidth = 0.9;
      for (let i = 0; i < pts.length; i++) {
        const p1 = pts[i];
        const p2 = pts[(i + 3) % pts.length];
        ctx.beginPath();
        ctx.strokeStyle = `rgba(${rgb3}, 0.16)`;
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        ctx.beginPath();
        ctx.fillStyle = `rgba(${rgb1}, 0.5)`;
        ctx.arc(p1.x, p1.y, p1.size, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!prefersReducedMotion) {
        rafId = window.requestAnimationFrame(drawFrame);
      }
    };

    rafId = window.requestAnimationFrame(drawFrame);

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, [prefersReducedMotion]);

  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden bg-[#F4F7FF]">
      {/* Rotating High-Resolution Architectural Glass Background Photography */}
      {HERO_SLIDES.map((slide, idx) => {
        const isActive = idx === activeIndex;
        return (
          <motion.img
            key={slide.src}
            src={slide.src}
            alt={slide.alt}
            referrerPolicy="no-referrer"
            initial={false}
            animate={
              prefersReducedMotion
                ? { opacity: idx === 0 ? 0.68 : 0, scale: 1.02 }
                : isActive
                ? { opacity: 0.72, scale: 1.07 }
                : { opacity: 0, scale: 1.02 }
            }
            transition={{
              opacity: { duration: 1.35, ease: 'easeInOut' },
              scale: { duration: 5.8, ease: 'easeOut' },
            }}
            className="absolute inset-0 w-full h-full object-cover object-center select-none pointer-events-none"
            style={{ zIndex: isActive ? 1 : 0 }}
          />
        );
      })}

      {/* Ambient Telemetry Rings & Signal Nodes Overlay */}
      <canvas
        ref={canvasRef}
        className="relative z-10 w-full h-full block pointer-events-none"
      />

      {/* Editorial Contrast Scrim for Crisp Text Readability (#0F172A) */}
      <div
        className="absolute inset-0 z-20 pointer-events-none"
        style={{
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.62) 0%, rgba(248,250,255,0.34) 42%, rgba(244,247,255,0.88) 100%)',
        }}
      />
      <div className="absolute inset-x-0 top-0 z-20 h-28 bg-gradient-to-b from-white/75 to-transparent pointer-events-none" />
    </div>
  );
}
