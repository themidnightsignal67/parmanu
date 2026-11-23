const SOUND_STORAGE_KEY = 'parmanu_sound_enabled';
const MUSIC_STORAGE_KEY = 'parmanu_music_enabled';
const AUDIO_EVENT_NAME = 'parmanu-audio-state-change';

let sharedCtx: AudioContext | null = null;
let musicMasterGain: GainNode | null = null;
let musicSchedulerId: number | null = null;
let musicChordStep = 0;
let musicStepIndex = 0;
let musicActiveNodes: Array<{ stop: () => void; disconnect: () => void }> = [];

function getRawAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedCtx || sharedCtx.state === 'closed') {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    try {
      sharedCtx = new Ctor();
    } catch {
      return null;
    }
  }
  if (sharedCtx.state === 'suspended') {
    void sharedCtx.resume().catch(() => {});
  }
  return sharedCtx;
}

function getSfxContext(): AudioContext | null {
  if (!isSoundEnabled()) return null;
  return getRawAudioContext();
}

function emitAudioStateChange() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(AUDIO_EVENT_NAME, {
      detail: {
        soundEnabled: isSoundEnabled(),
        musicEnabled: isMusicEnabled(),
      },
    })
  );
}

export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const saved = window.localStorage.getItem(SOUND_STORAGE_KEY);
  return saved === null ? true : saved === 'true';
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SOUND_STORAGE_KEY, String(enabled));
  emitAudioStateChange();
}

export function toggleSoundEnabled(): boolean {
  const next = !isSoundEnabled();
  setSoundEnabled(next);
  if (next) playClickTick();
  return next;
}

export function isMusicEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const saved = window.localStorage.getItem(MUSIC_STORAGE_KEY);
  return saved === 'true';
}

export function setMusicEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MUSIC_STORAGE_KEY, String(enabled));
  if (enabled) {
    startAmbientMusic();
  } else {
    stopAmbientMusic();
  }
  emitAudioStateChange();
}

export function toggleMusicEnabled(): boolean {
  const next = !isMusicEnabled();
  setMusicEnabled(next);
  return next;
}

export function subscribeAudioState(
  cb: (state: { soundEnabled: boolean; musicEnabled: boolean }) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () =>
    cb({ soundEnabled: isSoundEnabled(), musicEnabled: isMusicEnabled() });
  window.addEventListener(AUDIO_EVENT_NAME, handler);
  return () => window.removeEventListener(AUDIO_EVENT_NAME, handler);
}

// Unlock ambient music automatically on first user gesture if user left music enabled
export function attachAudioAutoResume(): () => void {
  if (typeof window === 'undefined') return () => {};
  const resume = () => {
    if (isMusicEnabled() && musicSchedulerId === null) {
      startAmbientMusic();
    }
    if (sharedCtx && sharedCtx.state === 'suspended') {
      void sharedCtx.resume().catch(() => {});
    }
  };
  window.addEventListener('pointerdown', resume, { passive: true });
  window.addEventListener('keydown', resume, { passive: true });
  return () => {
    window.removeEventListener('pointerdown', resume);
    window.removeEventListener('keydown', resume);
  };
}

function playTone(
  freq: number,
  duration: number,
  type: OscillatorType = 'sine',
  gainPeak = 0.045,
  delay = 0,
  endFreq?: number
) {
  const ctx = getSfxContext();
  if (!ctx || ctx.state === 'closed') return;

  try {
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq && endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    }

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3600, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.03);
  } catch {
    // ignore transient Web Audio scheduling errors
  }
}

export function playSonarPing() {
  playTone(440, 0.16, 'sine', 0.042, 0, 660);
  playTone(880, 0.28, 'triangle', 0.032, 0.07, 1174);
  playTone(1320, 0.34, 'sine', 0.018, 0.14);
}

export function playHitChime() {
  playTone(587.33, 0.14, 'triangle', 0.038, 0);
  playTone(880, 0.18, 'sine', 0.042, 0.06);
  playTone(1174.66, 0.26, 'sine', 0.03, 0.12);
}

export function playAlertTone() {
  playTone(330, 0.14, 'triangle', 0.045, 0);
  playTone(440, 0.16, 'triangle', 0.045, 0.11);
  playTone(330, 0.22, 'sine', 0.035, 0.24);
}

export function playClickTick() {
  playTone(620, 0.045, 'sine', 0.02, 0, 480);
}

export function playCopyPing() {
  playTone(980, 0.07, 'sine', 0.025, 0, 1318);
}

export function playErrorTone() {
  playTone(280, 0.14, 'sawtooth', 0.022, 0, 220);
  playTone(210, 0.2, 'sawtooth', 0.018, 0.1, 165);
}

// Procedural D-Dorian cosmic cyber-intelligence ambient soundtrack (100% Web Audio API)
const AMBIENT_CHORDS = [
  [146.83, 220.0, 261.63, 329.63], // Dm9
  [116.54, 174.61, 220.0, 293.66], // Bbmaj7
  [174.61, 220.0, 261.63, 329.63], // Fmaj7
  [130.81, 196.0, 246.94, 293.66], // Cmaj9 / Am feel
];

const PENTATONIC_PLUCKS = [587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66];

function triggerPadChord(ctx: AudioContext, dest: AudioNode, notes: number[]) {
  if (ctx.state === 'closed') return;
  const now = ctx.currentTime;
  const chordDur = 6.2;

  notes.forEach((freq, idx) => {
    try {
      const osc = ctx.createOscillator();
      const subFilter = ctx.createBiquadFilter();
      const vGain = ctx.createGain();

      osc.type = idx === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, now);
      osc.detune.setValueAtTime((idx % 2 === 0 ? 1 : -1) * 4, now);

      subFilter.type = 'lowpass';
      subFilter.frequency.setValueAtTime(320, now);
      subFilter.frequency.linearRampToValueAtTime(680, now + 2.6);
      subFilter.frequency.linearRampToValueAtTime(280, now + chordDur);

      const peak = idx === 0 ? 0.095 : 0.055;
      vGain.gain.setValueAtTime(0.0001, now);
      vGain.gain.linearRampToValueAtTime(peak, now + 1.6);
      vGain.gain.linearRampToValueAtTime(peak * 0.72, now + 4.4);
      vGain.gain.exponentialRampToValueAtTime(0.0001, now + chordDur);

      osc.connect(subFilter);
      subFilter.connect(vGain);
      vGain.connect(dest);

      osc.start(now);
      osc.stop(now + chordDur + 0.05);

      const ref = {
        stop: () => {
          try {
            osc.stop();
          } catch {
            // already stopped
          }
        },
        disconnect: () => {
          try {
            vGain.disconnect();
          } catch {
            // already disconnected
          }
        },
      };
      musicActiveNodes.push(ref);
      if (musicActiveNodes.length > 32) {
        musicActiveNodes = musicActiveNodes.slice(-24);
      }
    } catch {
      // ignore closed/interrupted audio node
    }
  });
}

function triggerCosmicPulse(ctx: AudioContext, dest: AudioNode, step: number) {
  if (ctx.state === 'closed') return;
  try {
    const now = ctx.currentTime;
    const note = PENTATONIC_PLUCKS[(step * 3 + Math.floor(step / 2)) % PENTATONIC_PLUCKS.length];

    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(note, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(420, now + 1.4);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.032, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.45);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);

    osc.start(now);
    osc.stop(now + 1.5);
  } catch {
    // ignore closed/interrupted audio node
  }
}

export function startAmbientMusic(): void {
  if (typeof window === 'undefined') return;
  if (musicSchedulerId !== null) return;

  const ctx = getRawAudioContext();
  if (!ctx || ctx.state === 'closed') return;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  master.gain.linearRampToValueAtTime(0.45, ctx.currentTime + 1.2);
  master.connect(ctx.destination);
  musicMasterGain = master;

  musicChordStep = 0;
  musicStepIndex = 0;

  triggerPadChord(ctx, master, AMBIENT_CHORDS[0]);
  triggerCosmicPulse(ctx, master, 0);

  musicSchedulerId = window.setInterval(() => {
    if (!isMusicEnabled() || !musicMasterGain) {
      stopAmbientMusic();
      return;
    }
    const c = getRawAudioContext();
    if (!c || c.state === 'closed') return;
    if (c.state === 'suspended') {
      void c.resume().catch(() => {});
    }
    musicStepIndex += 1;
    if (musicStepIndex % 3 === 0) {
      musicChordStep = (musicChordStep + 1) % AMBIENT_CHORDS.length;
      triggerPadChord(c, musicMasterGain, AMBIENT_CHORDS[musicChordStep]);
    }
    if (musicStepIndex % 2 === 0 || musicStepIndex % 5 === 0) {
      triggerCosmicPulse(c, musicMasterGain, musicStepIndex);
    }
  }, 1900);
}

export function stopAmbientMusic(): void {
  if (musicSchedulerId !== null) {
    window.clearInterval(musicSchedulerId);
    musicSchedulerId = null;
  }
  const dyingMaster = musicMasterGain;
  if (dyingMaster && sharedCtx && sharedCtx.state !== 'closed') {
    try {
      const now = sharedCtx.currentTime;
      dyingMaster.gain.cancelScheduledValues(now);
      dyingMaster.gain.setValueAtTime(dyingMaster.gain.value || 0.3, now);
      dyingMaster.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    } catch {
      // ignore gain fade errors
    }
  }
  const toStop = [...musicActiveNodes];
  musicActiveNodes = [];
  window.setTimeout(() => {
    for (const n of toStop) {
      n.stop();
      n.disconnect();
    }
    if (dyingMaster) {
      try {
        dyingMaster.disconnect();
      } catch {
        // already disconnected
      }
      if (musicMasterGain === dyingMaster) {
        musicMasterGain = null;
      }
    }
  }, 480);
}
