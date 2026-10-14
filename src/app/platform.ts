// The runtime around the app: claude.ai capabilities when the page runs as an artifact, browser
// fallbacks otherwise. Everything here is optional; the app works with none of it.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { claude?: { use(name: string): Promise<any> } } }

const caps: Record<string, Promise<any | null>> = {};
export function cap(name: string): Promise<any | null> {
  if (!caps[name]) caps[name] = typeof window !== 'undefined' && window.claude?.use ? window.claude.use(name).catch(() => null) : Promise.resolve(null);
  return caps[name];
}

// ---------- text storage: per-user docs in the artifact database, else this browser ----------
export interface TextStore { kind: 'account' | 'browser' | 'none'; get(key: string): Promise<string | null>; put(key: string, text: string): Promise<void>; del(key: string): Promise<void> }

const CHUNK = 100_000; // characters per document; documents are capped at 256 KiB
const LS = 'qs.web.';

function browserStore(): TextStore {
  let ok = false;
  try { localStorage.setItem(LS + 'probe', '1'); localStorage.removeItem(LS + 'probe'); ok = true; } catch { /* storage blocked */ }
  return {
    kind: ok ? 'browser' : 'none',
    async get(k) { try { return localStorage.getItem(LS + k); } catch { return null; } },
    async put(k, t) { try { localStorage.setItem(LS + k, t); } catch { throw new Error('This browser is out of room for saved data.'); } },
    async del(k) { try { localStorage.removeItem(LS + k); } catch { /* ignore */ } },
  };
}

let storeP: Promise<TextStore> | null = null;
export function textStore(): Promise<TextStore> {
  if (!storeP) storeP = (async () => {
    const [db, user] = await Promise.all([cap('db'), cap('user')]);
    const uid = user ? await user.id().catch(() => null) : null;
    if (!db || !uid) return browserStore();
    const col = db.collection('data/users/' + uid);
    // One write at a time per document.
    const queue = new Map<string, Promise<void>>();
    const serial = (k: string, f: () => Promise<void>) => { const p = (queue.get(k) || Promise.resolve()).then(f, f); queue.set(k, p.catch(() => undefined)); return p; };
    const read = async (k: string) => { const s = await col.doc(k).get(); return s.data() as Record<string, unknown> | undefined; };
    const store: TextStore = {
      kind: 'account',
      async get(k) {
        const head = await read(k); if (!head) return null;
        const n = Number(head.n || 1); let t = String(head.t ?? '');
        for (let i = 1; i < n; i++) { const p = await read(`${k}__${i}`); t += String(p?.t ?? ''); }
        return t;
      },
      put(k, text) {
        return serial(k, async () => {
          const parts: string[] = []; for (let i = 0; i < text.length; i += CHUNK) parts.push(text.slice(i, i + CHUNK)); if (!parts.length) parts.push('');
          const old = await read(k);
          for (let i = 1; i < parts.length; i++) await col.doc(`${k}__${i}`).set({ t: parts[i] });
          await col.doc(k).set({ t: parts[0], n: parts.length, at: new Date().toISOString() });
          for (let i = parts.length; i < Number(old?.n || 1); i++) await col.doc(`${k}__${i}`).delete().catch(() => undefined);
        });
      },
      del(k) {
        return serial(k, async () => { const old = await read(k); for (let i = 1; i < Number(old?.n || 1); i++) await col.doc(`${k}__${i}`).delete().catch(() => undefined); await col.doc(k).delete().catch(() => undefined); });
      },
    };
    return store;
  })().catch(() => browserStore());
  return storeP;
}

// Small per-viewer conveniences (last tab, live-data opt-in) stay in this browser.
export const prefs = {
  get(k: string, d = ''): string { try { return localStorage.getItem(LS + 'pref.' + k) ?? d; } catch { return d; } },
  set(k: string, v: string) { try { localStorage.setItem(LS + 'pref.' + k, v); } catch { /* ignore */ } },
};

// ---------- reading bytes ----------
export async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw Object.assign(new Error(`${url}: HTTP ${r.status}`), { code: r.status === 404 ? 'missing' : 'http' });
  return r.arrayBuffer();
}

/** A file in the Claude project, read as the viewer (several reads for files over 25 MiB). */
export async function projectBytes(path: string): Promise<ArrayBuffer> {
  const files = await cap('files');
  if (!files) throw Object.assign(new Error('Project files are not available in this view.'), { code: 'not_found' });
  const first = await files.read(path);
  if (first.bytes.byteLength >= first.size) return first.bytes.slice().buffer;
  const out = new Uint8Array(first.size); out.set(first.bytes, 0);
  let off = first.bytes.byteLength;
  while (off < first.size) { const r = await files.read(path, { offset: off }); out.set(r.bytes, off); off += r.bytes.byteLength; if (!r.bytes.byteLength) break; }
  return out.buffer;
}

export async function saveFile(filename: string, data: string): Promise<'saved' | 'unavailable' | 'declined'> {
  const d = await cap('downloads');
  if (!d) return 'unavailable';
  try { await d.save({ filename, data }); return 'saved'; } catch { return 'declined'; }
}

export async function askJSON<T>(prompt: string, signal?: AbortSignal): Promise<T> {
  const s = await cap('sample');
  if (!s) throw Object.assign(new Error('Ask is not available in this view.'), { code: 'unavailable' });
  return s.json(prompt, { modelTier: 'default', signal }) as Promise<T>;
}
