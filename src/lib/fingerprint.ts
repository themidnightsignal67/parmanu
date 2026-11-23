// Client-side multi-signal browser fingerprint & durable cross-storage token
// Correlated server-side with HMAC-signed HttpOnly cookies and normalized IP addresses.

const LS_KEY = 'parmanu_device_token_v1';
const SS_KEY = 'parmanu_device_session_v1';
const IDB_NAME = 'parmanu_osint_guard';
const IDB_STORE = 'device_state';
const IDB_KEY = 'client_token';

export interface DeviceSignals {
  fpHash: string;
  clientId: string;
}

let cachedSignals: DeviceSignals | null = null;
let inflightSignals: Promise<DeviceSignals> | null = null;

function randomToken(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const enc = new TextEncoder().encode(input);
      const buf = await crypto.subtle.digest('SHA-256', enc);
      return Array.from(new Uint8Array(buf), (b) =>
        b.toString(16).padStart(2, '0')
      ).join('');
    } catch {
      // Fallback below
    }
  }
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, '0') +
    (h1 >>> 0).toString(16).padStart(8, '0')
  );
}

function readIdbToken(): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        try {
          if (!req.result.objectStoreNames.contains(IDB_STORE)) {
            req.result.createObjectStore(IDB_STORE);
          }
        } catch {
          // ignore
        }
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.close();
            resolve(null);
            return;
          }
          const tx = db.transaction(IDB_STORE, 'readonly');
          const store = tx.objectStore(IDB_STORE);
          const getReq = store.get(IDB_KEY);
          getReq.onsuccess = () => {
            const val =
              typeof getReq.result === 'string' && getReq.result.length >= 16
                ? getReq.result
                : null;
            db.close();
            resolve(val);
          };
          getReq.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function writeIdbToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve();
      return;
    }
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        try {
          if (!req.result.objectStoreNames.contains(IDB_STORE)) {
            req.result.createObjectStore(IDB_STORE);
          }
        } catch {
          // ignore
        }
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(token, IDB_KEY);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            resolve();
          };
        } catch {
          resolve();
        }
      };
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function resolveDurableClientId(): Promise<string> {
  let lsVal: string | null = null;
  let ssVal: string | null = null;
  try {
    lsVal = window.localStorage.getItem(LS_KEY);
  } catch {
    lsVal = null;
  }
  try {
    ssVal = window.sessionStorage.getItem(SS_KEY);
  } catch {
    ssVal = null;
  }
  const idbVal = await readIdbToken();

  // Heal across stores so wiping any single store cannot reset identity
  const valid =
    [idbVal, lsVal, ssVal].find(
      (v) => typeof v === 'string' && /^[a-f0-9]{24,64}$/i.test(v)
    ) || randomToken();

  try {
    if (lsVal !== valid) window.localStorage.setItem(LS_KEY, valid);
  } catch {
    // ignore
  }
  try {
    if (ssVal !== valid) window.sessionStorage.setItem(SS_KEY, valid);
  } catch {
    // ignore
  }
  if (idbVal !== valid) {
    void writeIdbToken(valid);
  }
  return valid;
}

function getCanvasSignature(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no-2d';
    ctx.textBaseline = 'top';
    ctx.font = '14px "Inter", Arial, sans-serif';
    ctx.fillStyle = '#f60';
    ctx.fillRect(10, 10, 82, 22);
    ctx.fillStyle = '#069';
    ctx.fillText('Parmanu-OSINT-9876!@#', 12, 14);
    ctx.strokeStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.beginPath();
    ctx.arc(140, 30, 18, 0, Math.PI * 2);
    ctx.stroke();
    return canvas.toDataURL();
  } catch {
    return 'canvas-err';
  }
}

function getCanvasFontAndShapeSignature(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 280;
    canvas.height = 72;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no-2d-ext';
    ctx.font = '15px "Inter", "Segoe UI", sans-serif';
    const w1 = ctx.measureText('Parmanu-OSINT-9876!@#\u0950').width;
    ctx.font = '15px monospace';
    const w2 = ctx.measureText('MMMMMMMMWWWWW000111').width;
    const grad = ctx.createLinearGradient(0, 0, 200, 0);
    grad.addColorStop(0, '#ff9933');
    grad.addColorStop(1, '#138808');
    ctx.fillStyle = grad;
    ctx.fillRect(4, 34, 180, 14);
    return `${w1.toFixed(2)}:${w2.toFixed(2)}:${canvas.toDataURL().slice(-48)}`;
  } catch {
    return 'canvas-ext-err';
  }
}

export async function getDeviceSignals(): Promise<DeviceSignals> {
  if (typeof window === 'undefined') {
    return { fpHash: 'ssr', clientId: 'ssr' };
  }
  if (cachedSignals) return cachedSignals;
  if (inflightSignals) return inflightSignals;

  inflightSignals = (async () => {
    const clientId = await resolveDurableClientId();
    const nav = window.navigator as Navigator & { deviceMemory?: number };
    const scr = window.screen;
    const tz =
      typeof Intl !== 'undefined'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || ''
        : '';

    const rawComponents = [
      `ua:${nav.userAgent || ''}`,
      `plat:${nav.platform || ''}`,
      `lang:${nav.language || ''}:${(nav.languages || []).join(',')}`,
      `cores:${nav.hardwareConcurrency ?? ''}`,
      `mem:${nav.deviceMemory ?? ''}`,
      `touch:${nav.maxTouchPoints ?? ''}`,
      `scr:${scr?.width ?? ''}x${scr?.height ?? ''}x${scr?.colorDepth ?? ''}x${window.devicePixelRatio ?? ''}`,
      `tz:${tz}:${new Date().getTimezoneOffset()}`,
      `canvas:${getCanvasSignature()}`,
      `canvas2:${getCanvasFontAndShapeSignature()}`,
    ].join('||');

    const fpHash = await sha256Hex(rawComponents);
    cachedSignals = { fpHash, clientId };
    return cachedSignals;
  })();

  try {
    return await inflightSignals;
  } finally {
    inflightSignals = null;
  }
}

export function syncServerClientId(serverClientId?: string): void {
  if (typeof window === 'undefined' || !serverClientId) return;
  if (!/^[a-f0-9]{24,64}$/i.test(serverClientId)) return;
  try {
    window.localStorage.setItem(LS_KEY, serverClientId);
    window.sessionStorage.setItem(SS_KEY, serverClientId);
  } catch {
    // ignore
  }
  void writeIdbToken(serverClientId);
  if (cachedSignals) {
    cachedSignals = { ...cachedSignals, clientId: serverClientId };
  }
}
