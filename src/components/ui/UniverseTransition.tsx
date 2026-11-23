import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';

interface UniverseTransitionProps {
  open: boolean;
  onComplete: () => void;
}

const ACCELERATOR_DURATION_MS = 3500;
const _targetParallax = new THREE.Vector2(0, 0);
const _currentParallax = new THREE.Vector2(0, 0);

function isSoftwareWebGLContext(
  gl: WebGLRenderingContext | WebGL2RenderingContext
): boolean {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const rendererStr = String(gl.getParameter(param) || '');
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(rendererStr);
  } catch {
    return true;
  }
}

function tryAcquireWebGLCanvas(): {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext | WebGLRenderingContext;
  isSoftwareGl: boolean;
} | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    const onCreationError = (e: Event) => {
      e.preventDefault();
    };
    canvas.addEventListener('webglcontextcreationerror', onCreationError, false);

    const attrs: WebGLContextAttributes = {
      alpha: false,
      antialias: true,
      depth: true,
      stencil: true,
      powerPreference: 'default',
      failIfMajorPerformanceCaveat: false,
    };

    const gl =
      (canvas.getContext('webgl2', attrs) as WebGL2RenderingContext | null) ||
      (canvas.getContext('webgl', attrs) as WebGLRenderingContext | null);

    canvas.removeEventListener('webglcontextcreationerror', onCreationError, false);

    if (!gl || gl.isContextLost()) {
      return null;
    }

    return {
      canvas,
      gl,
      isSoftwareGl: isSoftwareWebGLContext(gl),
    };
  } catch {
    return null;
  }
}

function startCanvas2DFallback(
  mount: HTMLDivElement,
  pulseBoostRef: React.MutableRefObject<number>
): () => void {
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  mount.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return () => {
      if (canvas.parentNode === mount) mount.removeChild(canvas);
    };
  }

  let width = window.innerWidth;
  let height = window.innerHeight;
  const setSize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  setSize();

  const onResize = () => setSize();
  const onPointerMove = (e: PointerEvent) => {
    const nx = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    const ny = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
    _targetParallax.set(nx * 28, ny * 18);
  };
  const onPointerDown = () => {
    pulseBoostRef.current = 1;
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown, { passive: true });

  const particles = Array.from({ length: 160 }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.25 + Math.random() * 0.95;
    const palette = ['#FF9933', '#38BDF8', '#6366F1', '#10B981', '#F8FAFC'];
    return {
      angle,
      speed,
      radius: 2 + Math.random() * 2.5,
      color: palette[Math.floor(Math.random() * palette.length)],
      tilt: 0.48 + Math.random() * 0.45,
    };
  });

  let rafId = 0;
  let stopped = false;
  const startMs = performance.now();
  const COLLISION_TIME = 1.42;

  const drawFrame = () => {
    if (stopped) return;
    const elapsedSec = (performance.now() - startMs) / 1000;
    const preT = THREE.MathUtils.clamp(elapsedSec / COLLISION_TIME, 0, 1);
    const blastRaw = THREE.MathUtils.clamp((elapsedSec - COLLISION_TIME) / 1.15, 0, 1);
    const blast = 1 - Math.pow(1 - blastRaw, 3);
    const warpRaw = THREE.MathUtils.clamp((elapsedSec - 2.35) / 1.05, 0, 1);
    const warp = warpRaw * warpRaw;

    pulseBoostRef.current *= 0.92;
    _currentParallax.x += (_targetParallax.x - _currentParallax.x) * 0.12;
    _currentParallax.y += (_targetParallax.y - _currentParallax.y) * 0.12;

    ctx.fillStyle = '#03050D';
    ctx.fillRect(0, 0, width, height);

    const cx = width * 0.5 + _currentParallax.x;
    const cy = height * 0.5 + _currentParallax.y;
    const baseR = Math.min(width, height) * 0.26 * (1 + blast * 0.35 + warp * 0.8);
    const tiltY = 0.44 + warp * 0.15;

    // Ambient synchrotron core glow
    const bgGlow = ctx.createRadialGradient(
      cx,
      cy,
      2,
      cx,
      cy,
      baseR * (1.4 + blast * 1.4)
    );
    bgGlow.addColorStop(0, `rgba(255, 153, 51, ${0.22 + blast * 0.35 + pulseBoostRef.current * 0.2})`);
    bgGlow.addColorStop(0.42, `rgba(56, 189, 248, ${0.14 + blast * 0.22})`);
    bgGlow.addColorStop(1, 'rgba(3, 5, 13, 0)');
    ctx.fillStyle = bgGlow;
    ctx.fillRect(0, 0, width, height);

    // Outer synchrotron torus + inner guide ring
    ctx.save();
    ctx.globalAlpha = Math.max(0.12, 1 - warp * 0.85);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy, baseR, baseR * tiltY, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(245, 158, 11, 0.38)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(cx, cy, baseR * 0.56, baseR * 0.56 * tiltY, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 18 quadrupole coils along the ellipse
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + elapsedSec * (0.25 + preT * 0.9);
      const qx = cx + Math.cos(a) * baseR;
      const qy = cy + Math.sin(a) * baseR * tiltY;
      ctx.fillStyle = i % 2 === 0 ? '#6366F1' : '#38BDF8';
      ctx.beginPath();
      ctx.arc(qx, qy, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Counter-rotating protons prior to collision
    if (elapsedSec < COLLISION_TIME) {
      const spiralPhase = THREE.MathUtils.clamp((preT - 0.72) / 0.28, 0, 1);
      const r = baseR * (1 - spiralPhase * spiralPhase * 0.96);
      const ang = preT * preT * 18.5;

      const drawProton = (theta: number, color: string, glow: string) => {
        ctx.strokeStyle = glow;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let s = 0; s < 16; s++) {
          const lag = s * 0.08 * (0.6 + preT);
          const aLag = theta - lag * (color === '#FF9933' ? 1 : -1);
          const rLag = Math.min(baseR, r + lag * spiralPhase * baseR * 0.12);
          const px = cx + Math.cos(aLag) * rLag;
          const py = cy + Math.sin(aLag) * rLag * tiltY;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();

        const px = cx + Math.cos(theta) * r;
        const py = cy + Math.sin(theta) * r * tiltY;
        const pGrad = ctx.createRadialGradient(px, py, 1, px, py, 18);
        pGrad.addColorStop(0, '#FFFFFF');
        pGrad.addColorStop(0.35, color);
        pGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = pGrad;
        ctx.beginPath();
        ctx.arc(px, py, 18, 0, Math.PI * 2);
        ctx.fill();
      };

      drawProton(ang, '#FF9933', 'rgba(255, 179, 71, 0.75)');
      drawProton(-ang + Math.PI, '#38BDF8', 'rgba(56, 189, 248, 0.75)');
    } else {
      // Shockwave rings + particle explosion cloud
      const shockFade = blastRaw > 0 && blastRaw < 1 ? Math.sin(blastRaw * Math.PI) : 0;
      if (shockFade > 0.01) {
        ctx.strokeStyle = `rgba(255, 153, 51, ${shockFade * 0.85})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(
          cx,
          cy,
          16 + blast * baseR * 2.1,
          (16 + blast * baseR * 2.1) * tiltY,
          0,
          0,
          Math.PI * 2
        );
        ctx.stroke();

        ctx.strokeStyle = `rgba(56, 189, 248, ${shockFade * 0.7})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(
          cx,
          cy,
          12 + blast * baseR * 1.65,
          (12 + blast * baseR * 1.65) * 0.72,
          0.35,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      }

      const maxReach = Math.max(width, height) * 0.75;
      for (const p of particles) {
        const dist = blast * maxReach * p.speed * (1 + warp * 0.9);
        const px = cx + Math.cos(p.angle + elapsedSec * 0.25) * dist;
        const py = cy + Math.sin(p.angle + elapsedSec * 0.25) * dist * p.tilt;
        ctx.globalAlpha = Math.max(0.15, (1 - warp * 0.7) * (0.4 + blast * 0.6));
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(px, py, p.radius * (1 + warp * 0.8), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    rafId = requestAnimationFrame(drawFrame);
  };

  rafId = requestAnimationFrame(drawFrame);

  return () => {
    stopped = true;
    window.cancelAnimationFrame(rafId);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerDown);
    if (canvas.parentNode === mount) {
      mount.removeChild(canvas);
    }
  };
}

export function UniverseTransition({
  open,
  onComplete,
}: UniverseTransitionProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  const completedRef = useRef(false);
  const pulseBoostRef = useRef(0);
  const [stageIndex, setStageIndex] = useState<0 | 1 | 2>(0);
  const [flashFade, setFlashFade] = useState(false);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!open) return;
    completedRef.current = false;
    pulseBoostRef.current = 0;
    setStageIndex(0);
    setFlashFade(false);

    const triggerComplete = () => {
      if (completedRef.current) return;
      completedRef.current = true;
      onCompleteRef.current();
    };

    const stage1Timer = window.setTimeout(() => setStageIndex(1), 1350);
    const stage2Timer = window.setTimeout(() => setStageIndex(2), 2300);
    const fadeTimer = window.setTimeout(() => setFlashFade(true), 3150);
    const finishTimer = window.setTimeout(
      triggerComplete,
      ACCELERATOR_DURATION_MS
    );

    const mount = mountRef.current;
    if (!mount) {
      return () => {
        window.clearTimeout(stage1Timer);
        window.clearTimeout(stage2Timer);
        window.clearTimeout(fadeTimer);
        window.clearTimeout(finishTimer);
      };
    }

    const acquired = tryAcquireWebGLCanvas();
    if (!acquired) {
      const cleanup2d = startCanvas2DFallback(mount, pulseBoostRef);
      return () => {
        window.clearTimeout(stage1Timer);
        window.clearTimeout(stage2Timer);
        window.clearTimeout(fadeTimer);
        window.clearTimeout(finishTimer);
        cleanup2d();
      };
    }

    const { canvas, gl, isSoftwareGl } = acquired;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        context: gl as unknown as WebGLRenderingContext,
        antialias: !isSoftwareGl,
        powerPreference: 'default',
        alpha: false,
        failIfMajorPerformanceCaveat: false,
      });
    } catch {
      const cleanup2d = startCanvas2DFallback(mount, pulseBoostRef);
      return () => {
        window.clearTimeout(stage1Timer);
        window.clearTimeout(stage2Timer);
        window.clearTimeout(fadeTimer);
        window.clearTimeout(finishTimer);
        cleanup2d();
      };
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x03050d, 1);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03050d);

    const camera = new THREE.PerspectiveCamera(
      56,
      window.innerWidth / window.innerHeight,
      0.1,
      260
    );
    camera.position.set(0, 5.2, 24);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTexture = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04
    ).texture;
    scene.environment = envTexture;
    pmremGenerator.dispose();

    const hemiLight = new THREE.HemisphereLight(0x818cf8, 0x0f172a, 1.3);
    scene.add(hemiLight);

    const coreFlashLight = new THREE.PointLight(0xff9933, 18, 90, 1.2);
    coreFlashLight.position.set(0, 0, 0);
    scene.add(coreFlashLight);

    const rimLight = new THREE.PointLight(0x38bdf8, 24, 80, 1.4);
    rimLight.position.set(-8, 6, 8);
    scene.add(rimLight);

    // 1. Subatomic Chamber Dome Shader (Dark Synchrotron Field + Collision Glow)
    const domeGeo = new THREE.SphereGeometry(105, 32, 24);
    const domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uBlast: { value: 0 },
        uWarp: { value: 0 },
        uPulse: { value: 0 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vDir;
        uniform float uTime;
        uniform float uBlast;
        uniform float uWarp;
        uniform float uPulse;

        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }

        float noise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
            f.z
          );
        }

        void main() {
          vec3 d = normalize(vDir);
          float n = noise(d * 4.5 + vec3(uTime * 0.15, 0.0, -uTime * 0.12));
          float ringHorizon = exp(-abs(d.y) * 5.2);
          vec3 base = vec3(0.012, 0.018, 0.048);
          vec3 cherenkov = vec3(0.14, 0.56, 0.96) * n * (0.35 + uBlast * 0.85 + uWarp * 0.6);
          vec3 plasma = vec3(0.98, 0.48, 0.14) * ringHorizon * (0.35 + uBlast * 1.1 + uPulse * 0.7);
          vec3 indigo = vec3(0.32, 0.30, 0.88) * (1.0 - n) * 0.32;
          gl_FragColor = vec4(base + cherenkov + plasma + indigo, 1.0);
        }
      `,
    });
    const domeMesh = new THREE.Mesh(domeGeo, domeMat);
    scene.add(domeMesh);

    const chamberGroup = new THREE.Group();
    scene.add(chamberGroup);

    // 2. Toroidal Particle Accelerator Chamber (Cryo Ring + Magnetic Field Coils)
    const acceleratorGroup = new THREE.Group();
    chamberGroup.add(acceleratorGroup);

    const trackRadius = 8.4;
    const outerRingGeo = new THREE.TorusGeometry(trackRadius, 0.24, 24, 144);
    const outerRingMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.94,
      roughness: 0.16,
      emissive: 0x1e293b,
      emissiveIntensity: 0.5,
    });
    const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
    outerRing.rotation.x = Math.PI * 0.5;
    acceleratorGroup.add(outerRing);

    const beamTubeGeo = new THREE.TorusGeometry(trackRadius, 0.06, 12, 144);
    const beamTubeMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
    });
    const beamTube = new THREE.Mesh(beamTubeGeo, beamTubeMat);
    beamTube.rotation.x = Math.PI * 0.5;
    acceleratorGroup.add(beamTube);

    const innerGuideGeo = new THREE.TorusGeometry(4.6, 0.045, 16, 128);
    const innerGuideMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.9,
      roughness: 0.2,
      emissive: 0x9a3412,
      emissiveIntensity: 0.45,
    });
    const innerGuide = new THREE.Mesh(innerGuideGeo, innerGuideMat);
    innerGuide.rotation.x = Math.PI * 0.5;
    acceleratorGroup.add(innerGuide);

    // 18 Electromagnetic Quadrupole Coils evenly spaced around the synchrotron torus
    const coilGeo = new THREE.TorusGeometry(0.62, 0.08, 12, 32);
    const coilMat = new THREE.MeshStandardMaterial({
      color: 0x6366f1,
      metalness: 0.92,
      roughness: 0.18,
      emissive: 0x312e81,
      emissiveIntensity: 0.55,
    });
    const coils: THREE.Mesh[] = [];
    const coilCount = 18;
    for (let i = 0; i < coilCount; i++) {
      const a = (i / coilCount) * Math.PI * 2;
      const coil = new THREE.Mesh(coilGeo, coilMat);
      coil.position.set(
        Math.cos(a) * trackRadius,
        0,
        Math.sin(a) * trackRadius
      );
      coil.rotation.y = -a;
      acceleratorGroup.add(coil);
      coils.push(coil);
    }

    // 3. Two Counter-Rotating High-Energy Protons + Glowing Beam Trails
    const protonMatA = new THREE.MeshBasicMaterial({
      color: 0xff9933,
      transparent: true,
      opacity: 1,
    });
    const protonMatB = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 1,
    });
    const protonGeo = new THREE.SphereGeometry(0.36, 24, 24);
    const protonA = new THREE.Mesh(protonGeo, protonMatA);
    const protonB = new THREE.Mesh(protonGeo, protonMatB);

    const haloGeo = new THREE.SphereGeometry(0.75, 20, 20);
    const haloMatA = new THREE.MeshBasicMaterial({
      color: 0xff6b00,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
    });
    const haloMatB = new THREE.MeshBasicMaterial({
      color: 0x0ea5e9,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
    });
    protonA.add(new THREE.Mesh(haloGeo, haloMatA));
    protonB.add(new THREE.Mesh(haloGeo, haloMatB));
    chamberGroup.add(protonA, protonB);

    // Ionized beam ribbon trails behind each proton
    const trailLength = 34;
    const trailPositionsA = new Float32Array(trailLength * 3);
    const trailPositionsB = new Float32Array(trailLength * 3);
    const trailGeoA = new THREE.BufferGeometry();
    const trailGeoB = new THREE.BufferGeometry();
    trailGeoA.setAttribute(
      'position',
      new THREE.BufferAttribute(trailPositionsA, 3)
    );
    trailGeoB.setAttribute(
      'position',
      new THREE.BufferAttribute(trailPositionsB, 3)
    );
    const trailLineMatA = new THREE.LineBasicMaterial({
      color: 0xffb347,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
    });
    const trailLineMatB = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
    });
    const trailA = new THREE.Line(trailGeoA, trailLineMatA);
    const trailB = new THREE.Line(trailGeoB, trailLineMatB);
    chamberGroup.add(trailA, trailB);

    // 4. Central Proton Collision Flash Core & Dual Expanding Blast Shockwaves
    const coreGeo = new THREE.IcosahedronGeometry(0.9, 4);
    const coreMat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uBlast: { value: 0 },
        uPulse: { value: 0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        uniform float uTime;
        uniform float uBlast;
        void main() {
          float ripple = sin(position.x * 6.0 + uTime * 8.0) * sin(position.y * 6.0 - uTime * 7.0) * 0.08 * (1.0 + uBlast * 1.4);
          vec3 p = position + normal * ripple;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        uniform float uBlast;
        uniform float uPulse;
        void main() {
          float fresnel = pow(1.0 - max(0.0, dot(vNormal, vViewDir)), 2.0);
          vec3 whiteHot = vec3(1.0, 0.98, 0.92);
          vec3 saffron = vec3(1.0, 0.54, 0.14);
          vec3 cyan = vec3(0.24, 0.80, 1.0);
          vec3 col = mix(whiteHot, mix(saffron, cyan, fresnel * 0.5), fresnel);
          float alpha = clamp(0.22 + uBlast * 0.9 + uPulse * 0.4, 0.0, 1.0);
          gl_FragColor = vec4(col * (1.2 + uBlast * 1.5), alpha);
        }
      `,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    chamberGroup.add(coreMesh);

    const shockGeo = new THREE.TorusGeometry(1.1, 0.12, 16, 128);
    const shockMat1 = new THREE.MeshBasicMaterial({
      color: 0xff9933,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
    });
    const shockMat2 = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
    });
    const shockRing1 = new THREE.Mesh(shockGeo, shockMat1);
    const shockRing2 = new THREE.Mesh(shockGeo, shockMat2);
    shockRing1.rotation.x = Math.PI * 0.5;
    shockRing2.rotation.set(Math.PI * 0.25, Math.PI * 0.25, 0);
    chamberGroup.add(shockRing1, shockRing2);

    // 5. High-Energy Particle Detector Collision Tracks (64 radial/helical ionized jets)
    const rayCount = 64;
    const rayPositions = new Float32Array(rayCount * 2 * 3);
    const rayDirs: THREE.Vector3[] = [];
    for (let i = 0; i < rayCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const dir = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi) * 0.78,
        Math.sin(phi) * Math.sin(theta)
      ).normalize();
      rayDirs.push(dir);
    }
    const rayGeo = new THREE.BufferGeometry();
    rayGeo.setAttribute('position', new THREE.BufferAttribute(rayPositions, 3));
    const rayMat = new THREE.LineBasicMaterial({
      color: 0xfde68a,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
    });
    const collisionRays = new THREE.LineSegments(rayGeo, rayMat);
    chamberGroup.add(collisionRays);

    // 6. Subatomic Explosion Cloud (3,000 Glowing Quarks / Electrons / Signal Nodes)
    const particleCount = 3000;
    const pStart = new Float32Array(particleCount * 3);
    const pTarget = new Float32Array(particleCount * 3);
    const pColor = new Float32Array(particleCount * 3);
    const pSeed = new Float32Array(particleCount);

    const cSaffron = new THREE.Color('#FF9933');
    const cCyan = new THREE.Color('#38BDF8');
    const cIndigo = new THREE.Color('#6366F1');
    const cEmerald = new THREE.Color('#10B981');
    const cWhite = new THREE.Color('#F8FAFC');
    const tmpCol = new THREE.Color();

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      // Compressed inside synchrotron core prior to collision
      const r0 = 0.05 + Math.random() * 0.5;
      const a0 = Math.random() * Math.PI * 2;
      const b0 = Math.acos(2 * Math.random() - 1);
      pStart[i3] = r0 * Math.sin(b0) * Math.cos(a0);
      pStart[i3 + 1] = r0 * Math.cos(b0);
      pStart[i3 + 2] = r0 * Math.sin(b0) * Math.sin(a0);

      // Explodes radially outward into spherical atomic shell + spiral detector arcs
      const r1 = 4.5 + Math.pow(Math.random(), 0.6) * 38;
      const a1 = Math.random() * Math.PI * 2;
      const b1 = Math.acos(2 * Math.random() - 1);
      pTarget[i3] = r1 * Math.sin(b1) * Math.cos(a1);
      pTarget[i3 + 1] = r1 * Math.cos(b1) * 0.85;
      pTarget[i3 + 2] = r1 * Math.sin(b1) * Math.sin(a1);

      const pick = Math.random();
      if (pick < 0.28) tmpCol.copy(cSaffron);
      else if (pick < 0.56) tmpCol.copy(cCyan);
      else if (pick < 0.8) tmpCol.copy(cIndigo);
      else if (pick < 0.92) tmpCol.copy(cEmerald);
      else tmpCol.copy(cWhite);

      pColor[i3] = tmpCol.r;
      pColor[i3 + 1] = tmpCol.g;
      pColor[i3 + 2] = tmpCol.b;
      pSeed[i] = Math.random();
    }

    const burstGeo = new THREE.BufferGeometry();
    burstGeo.setAttribute('position', new THREE.BufferAttribute(pStart, 3));
    burstGeo.setAttribute('aTarget', new THREE.BufferAttribute(pTarget, 3));
    burstGeo.setAttribute('aColor', new THREE.BufferAttribute(pColor, 3));
    burstGeo.setAttribute('aSeed', new THREE.BufferAttribute(pSeed, 1));

    const burstMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uBlast: { value: 0 },
        uWarp: { value: 0 },
        uPulse: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      },
      vertexShader: `
        attribute vec3 aTarget;
        attribute vec3 aColor;
        attribute float aSeed;
        uniform float uTime;
        uniform float uBlast;
        uniform float uWarp;
        uniform float uPulse;
        uniform float uPixelRatio;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vColor = aColor;
          vec3 pos = mix(position, aTarget, uBlast);
          float swirl = uTime * (0.25 + aSeed * 0.35);
          float s = sin(swirl * 0.35);
          float c = cos(swirl * 0.35);
          pos *= 1.0 + uPulse * 0.16;
          vec3 rotated = vec3(
            pos.x * c - pos.z * s,
            pos.y,
            pos.x * s + pos.z * c
          );
          rotated.z += uWarp * (9.0 + aSeed * 24.0);

          vec4 mv = modelViewMatrix * vec4(rotated, 1.0);
          gl_Position = projectionMatrix * mv;
          float size = (24.0 + aSeed * 36.0 + uBlast * 14.0 + uWarp * 22.0) * uPixelRatio;
          gl_PointSize = clamp(size / max(1.0, -mv.z), 1.4, 24.0);
          vAlpha = (0.18 + uBlast * 0.82) * (0.65 + 0.35 * sin(uTime * 4.5 + aSeed * 15.0));
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float glow = pow(1.0 - dist * 2.0, 2.0);
          gl_FragColor = vec4(vColor, glow * vAlpha);
        }
      `,
    });

    const burstPoints = new THREE.Points(burstGeo, burstMat);
    chamberGroup.add(burstPoints);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const onPointerMove = (e: PointerEvent) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      _targetParallax.set(nx * 0.24, -ny * 0.16);
    };
    const onPointerDown = () => {
      pulseBoostRef.current = 1;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    let frameId = 0;
    let disposed = false;
    const startMs = performance.now();
    let lastMs = startMs;

    function afterDraw(cb: () => void) {
      const glCtx = renderer.getContext() as WebGL2RenderingContext;
      if (!glCtx || glCtx.isContextLost() || typeof glCtx.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = glCtx.fenceSync(glCtx.SYNC_GPU_COMMANDS_COMPLETE, 0);
      glCtx.flush();
      const poll = () => {
        if (disposed || glCtx.isContextLost()) return;
        const state = sync && glCtx.getSyncParameter(sync, glCtx.SYNC_STATUS);
        if (state === glCtx.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) glCtx.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const COLLISION_TIME = 1.42;

    const tick = () => {
      if (disposed || gl.isContextLost()) return;
      const now = performance.now();
      const elapsedSec = (now - startMs) / 1000;
      const delta = Math.min(0.05, (now - lastMs) / 1000);
      lastMs = now;

      // Phase 1 (0 -> 1.42s): Protons accelerate counter-clockwise & spiral inward
      // Phase 2 (1.42s -> 2.35s): Proton collision flash + atomic shockwave + radial debris
      // Phase 3 (2.35s -> 3.5s): Relativistic warp dive into Parmanu Search
      const preT = THREE.MathUtils.clamp(elapsedSec / COLLISION_TIME, 0, 1);
      const blastRaw = THREE.MathUtils.clamp(
        (elapsedSec - COLLISION_TIME) / 1.15,
        0,
        1
      );
      const blast = 1 - Math.pow(1 - blastRaw, 3.0);
      const warpRaw = THREE.MathUtils.clamp((elapsedSec - 2.35) / 1.05, 0, 1);
      const warp = warpRaw * warpRaw;

      pulseBoostRef.current = THREE.MathUtils.damp(
        pulseBoostRef.current,
        0,
        5.5,
        delta
      );

      domeMat.uniforms.uTime.value = elapsedSec;
      domeMat.uniforms.uBlast.value = blast;
      domeMat.uniforms.uWarp.value = warp;
      domeMat.uniforms.uPulse.value = pulseBoostRef.current;

      coreMat.uniforms.uTime.value = elapsedSec;
      coreMat.uniforms.uBlast.value = blast;
      coreMat.uniforms.uPulse.value = pulseBoostRef.current;

      burstMat.uniforms.uTime.value = elapsedSec;
      burstMat.uniforms.uBlast.value = blast;
      burstMat.uniforms.uWarp.value = warp;
      burstMat.uniforms.uPulse.value = pulseBoostRef.current;

      // Animate counter-rotating accelerating protons converging at center (t = 1.42s)
      const collided = elapsedSec >= COLLISION_TIME;
      if (!collided) {
        // Radius stays on synchrotron ring, then spirals inward sharply in the final 0.38s
        const spiralPhase = THREE.MathUtils.clamp((preT - 0.72) / 0.28, 0, 1);
        const r = trackRadius * (1 - spiralPhase * spiralPhase * 0.98);
        const angularPhase = preT * preT * 18.5;

        const xA = Math.cos(angularPhase) * r;
        const zA = Math.sin(angularPhase) * r;
        const xB = Math.cos(-angularPhase + Math.PI) * r;
        const zB = Math.sin(-angularPhase + Math.PI) * r;

        protonA.visible = true;
        protonB.visible = true;
        protonA.position.set(xA, 0, zA);
        protonB.position.set(xB, 0, zB);

        const pScale = 0.85 + preT * 0.65;
        protonA.scale.setScalar(pScale);
        protonB.scale.setScalar(pScale);

        // Update trailing ionized arc points behind each proton
        const posArrA = trailGeoA.attributes.position.array as Float32Array;
        const posArrB = trailGeoB.attributes.position.array as Float32Array;
        for (let i = 0; i < trailLength; i++) {
          const lag = i * 0.048 * (0.5 + preT * 1.3);
          const aLag = angularPhase - lag;
          const bLag = -angularPhase + Math.PI + lag;
          const rLag = Math.min(trackRadius, r + lag * spiralPhase * 2.2);
          posArrA[i * 3] = Math.cos(aLag) * rLag;
          posArrA[i * 3 + 1] = 0;
          posArrA[i * 3 + 2] = Math.sin(aLag) * rLag;
          posArrB[i * 3] = Math.cos(bLag) * rLag;
          posArrB[i * 3 + 1] = 0;
          posArrB[i * 3 + 2] = Math.sin(bLag) * rLag;
        }
        trailGeoA.attributes.position.needsUpdate = true;
        trailGeoB.attributes.position.needsUpdate = true;
        trailLineMatA.opacity = 0.92;
        trailLineMatB.opacity = 0.92;
      } else {
        protonA.visible = false;
        protonB.visible = false;
        trailLineMatA.opacity = Math.max(0, 0.92 * (1 - blastRaw * 3.0));
        trailLineMatB.opacity = Math.max(0, 0.92 * (1 - blastRaw * 3.0));
      }

      // Collision Core Flash & Intensity
      const coreScale = !collided
        ? 0.38 + preT * 0.35
        : 1.9 * Math.exp(-blastRaw * 2.2) + 0.55 + warp * 1.4 + pulseBoostRef.current * 0.35;
      coreMesh.scale.setScalar(coreScale);
      coreMesh.rotation.y += delta * 2.1;
      coreFlashLight.intensity = !collided
        ? 14 + preT * 18
        : 85 * Math.exp(-blastRaw * 2.1) + 22;

      // Dual Blast Shockwave Rings
      shockRing1.scale.setScalar(0.5 + blast * 17.0);
      shockRing2.scale.setScalar(0.4 + blast * 13.5);
      const shockFade =
        blastRaw > 0 && blastRaw < 1 ? Math.sin(blastRaw * Math.PI) : 0;
      shockMat1.opacity = shockFade * 0.95;
      shockMat2.opacity = shockFade * 0.78;

      // Particle Detector Collision Tracks Shooting Outward
      if (blastRaw > 0) {
        const rayArr = rayGeo.attributes.position.array as Float32Array;
        const innerR = Math.max(0, (blast - 0.15) * 14);
        const outerR = blast * 26;
        for (let i = 0; i < rayCount; i++) {
          const d = rayDirs[i];
          const idx = i * 6;
          rayArr[idx] = d.x * innerR;
          rayArr[idx + 1] = d.y * innerR;
          rayArr[idx + 2] = d.z * innerR;
          rayArr[idx + 3] = d.x * outerR;
          rayArr[idx + 4] = d.y * outerR;
          rayArr[idx + 5] = d.z * outerR;
        }
        rayGeo.attributes.position.needsUpdate = true;
        rayMat.opacity = Math.sin(Math.min(1, blastRaw * 1.1) * Math.PI) * 0.85;
      }

      // Accelerator chamber spins up, then expands & fades away into atomic space
      acceleratorGroup.rotation.y += delta * (0.25 + preT * 1.15);
      const ringScale = 1 + blast * 0.38 + warp * 0.9;
      acceleratorGroup.scale.setScalar(ringScale);
      outerRingMat.opacity = Math.max(0.15, 1 - warp * 0.85);
      beamTubeMat.opacity = Math.max(0.1, 0.55 * (1 - warp * 0.85));

      _currentParallax.x = THREE.MathUtils.damp(
        _currentParallax.x,
        _targetParallax.x,
        6,
        delta
      );
      _currentParallax.y = THREE.MathUtils.damp(
        _currentParallax.y,
        _targetParallax.y,
        6,
        delta
      );
      chamberGroup.rotation.y = _currentParallax.x * 0.9;
      chamberGroup.rotation.x = _currentParallax.y * 0.7 + 0.18;

      const targetCamZ = 24 - blast * 6.5 - warp * 22;
      const targetCamY = 5.2 - blast * 3.8 - warp * 1.2;
      camera.position.z = THREE.MathUtils.damp(
        camera.position.z,
        targetCamZ,
        5.0,
        delta
      );
      camera.position.y = THREE.MathUtils.damp(
        camera.position.y,
        targetCamY,
        5.0,
        delta
      );
      camera.fov = THREE.MathUtils.damp(camera.fov, 56 + warp * 36, 4.8, delta);
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    let cleanupFallback: (() => void) | null = null;
    const onContextLost = (e: Event) => {
      e.preventDefault();
      if (disposed) return;
      disposed = true;
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(frameId);
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
      cleanupFallback = startCanvas2DFallback(mount, pulseBoostRef);
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost, false);

    tick();

    return () => {
      disposed = true;
      window.clearTimeout(stage1Timer);
      window.clearTimeout(stage2Timer);
      window.clearTimeout(fadeTimer);
      window.clearTimeout(finishTimer);
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(frameId);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost, false);

      domeGeo.dispose();
      domeMat.dispose();
      outerRingGeo.dispose();
      outerRingMat.dispose();
      beamTubeGeo.dispose();
      beamTubeMat.dispose();
      innerGuideGeo.dispose();
      innerGuideMat.dispose();
      coilGeo.dispose();
      coilMat.dispose();
      protonGeo.dispose();
      protonMatA.dispose();
      protonMatB.dispose();
      haloGeo.dispose();
      haloMatA.dispose();
      haloMatB.dispose();
      trailGeoA.dispose();
      trailGeoB.dispose();
      trailLineMatA.dispose();
      trailLineMatB.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      shockGeo.dispose();
      shockMat1.dispose();
      shockMat2.dispose();
      rayGeo.dispose();
      rayMat.dispose();
      burstGeo.dispose();
      burstMat.dispose();
      envTexture.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
      cleanupFallback?.();
    };
  }, [open]);

  if (!open) return null;

  const stages = [
    { num: '01', label: 'Accelerating Counter-Rotating Proton Beams' },
    { num: '02', label: 'Proton Collision & Subatomic Explosion' },
    { num: '03', label: 'Expanding Parmanu Signal Field' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28 }}
      className="fixed inset-0 z-50 bg-[#03050D] overflow-hidden select-none"
      role="dialog"
      aria-label="Parmanu Particle Accelerator Initialization"
    >
      {/* Isolated WebGL Container */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />

      {/* Top-Left Mark (solid rgba without backdrop-filter over WebGL) */}
      <div className="pointer-events-none absolute top-6 left-6 z-20 flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-[#080D1E]/90 border border-white/12 text-white">
        <span className="font-display text-base font-bold text-orange-400">
          ॐ
        </span>
        <span className="font-display text-xs font-semibold tracking-tight">
          Parmanu Accelerator
        </span>
      </div>

      {/* Unified Bottom Control Dock — solid rgba without backdrop-filter over WebGL */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 w-[min(700px,92vw)] rounded-2xl bg-[#080D1E]/90 border border-white/12 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-300 shadow-[0_18px_50px_rgba(0,0,0,0.48)]">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono font-semibold text-orange-400 tabular-nums shrink-0">
            {stages[stageIndex].num}.
          </span>
          <span className="font-medium text-white truncate">
            {stages[stageIndex].label}
          </span>
          <span className="hidden sm:inline text-slate-500">·</span>
          <span className="hidden sm:inline text-[11px] text-slate-400 whitespace-nowrap">
            Move cursor to orbit · Click to pulse
          </span>
        </div>

        <button
          type="button"
          onClick={() => {
            if (!completedRef.current) {
              completedRef.current = true;
              onCompleteRef.current();
            }
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white text-[#0F172A] hover:bg-slate-100 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap shrink-0"
        >
          <span>Enter Search</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Clean Luminous Warp Bloom Veil right before revealing Search Workspace */}
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-0 z-30 bg-[#F4F6FA] transition-opacity duration-300 ${
          flashFade ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </motion.div>
  );
}
