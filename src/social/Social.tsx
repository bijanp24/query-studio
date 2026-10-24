// The Social page: a phone-first front end over three ready-made stories. Pick a story, pick a size
// (Reel or square post), pick a look, then save or share each card as an image. Each card can be
// redrawn in any of the three chart styles.
import React from 'react';
import { STORIES, GENERATED, type Style } from './cards';
import { CardSvg, SIZE, type Format, type LookId } from './CardSvg';
import { download, shareFile, svgToPng } from './exportPng';

type LookPref = 'auto' | LookId;
const STYLE_NAMES: Record<Style, string> = { rows: 'Rows', bars: 'Columns', big: 'Big number' };
const FORMATS: [Format, string, string][] = [['reel', 'Reel', '9:16 · Instagram, TikTok, Stories'], ['square', 'Square', '1:1 · X, Instagram feed']];
const LOOKS: [LookPref, string][] = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark'], ['pop', 'Pop']];

const store = {
  get(k: string, d: string) { try { return localStorage.getItem('qs-social-' + k) || d; } catch { return d; } },
  set(k: string, v: string) { try { localStorage.setItem('qs-social-' + k, v); } catch { /* private window */ } },
};

function useSystemDark() {
  const q = () => document.documentElement.getAttribute('data-theme') === 'dark' || (document.documentElement.getAttribute('data-theme') !== 'light' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const [dark, setDark] = React.useState(q);
  React.useEffect(() => {
    const m = window.matchMedia?.('(prefers-color-scheme: dark)');
    const on = () => setDark(q());
    m?.addEventListener?.('change', on);
    const mo = new MutationObserver(on); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { m?.removeEventListener?.('change', on); mo.disconnect(); };
  }, []);
  return dark;
}

interface Shot { url: string; blob: Blob; name: string; title: string }

export function Social() {
  const initialStory = (location.hash.slice(1) && STORIES.some(s => s.id === location.hash.slice(1))) ? location.hash.slice(1) : store.get('story', 'lobby');
  const [storyId, setStoryId] = React.useState(initialStory);
  const [format, setFormat] = React.useState<Format>(store.get('format', 'reel') as Format);
  const [lookPref, setLookPref] = React.useState<LookPref>(store.get('look', 'auto') as LookPref);
  const [styles, setStyles] = React.useState<Record<string, Style>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [shot, setShot] = React.useState<Shot | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const sysDark = useSystemDark();
  const look: LookId = lookPref === 'auto' ? (sysDark ? 'dark' : 'light') : lookPref;
  const story = STORIES.find(s => s.id === storyId) || STORIES[0];
  const refs = React.useRef<Record<string, HTMLDivElement | null>>({});

  React.useEffect(() => {
    if (lookPref === 'auto') document.documentElement.removeAttribute('data-look'); else document.documentElement.setAttribute('data-look', lookPref);
    store.set('look', lookPref);
  }, [lookPref]);
  React.useEffect(() => { store.set('format', format); }, [format]);
  React.useEffect(() => { store.set('story', storyId); try { history.replaceState(null, '', '#' + storyId); } catch { /* sandboxed */ } }, [storyId]);
  const say = (m: string) => { setToast(m); window.setTimeout(() => setToast(t => (t === m ? null : t)), 3000); };

  async function makeImage(cardId: string, title: string) {
    const svg = refs.current[cardId]?.querySelector('svg');
    if (!svg) return;
    setBusy(cardId);
    try {
      const { w, h } = SIZE[format];
      const blob = await svgToPng(svg, w, h);
      if (shot) URL.revokeObjectURL(shot.url);
      setShot({ blob, url: URL.createObjectURL(blob), name: `query-studio-${cardId}-${format}-${look}.png`, title });
    } catch (e) { say((e as Error).message); } finally { setBusy(null); }
  }
  async function share() {
    if (!shot) return;
    const r = await shareFile(shot.blob, shot.name, shot.title);
    if (r === 'unavailable') say('Sharing is not available here. Save the image instead.');
  }
  function close() { if (shot) URL.revokeObjectURL(shot.url); setShot(null); }

  return <div className="soc">
    <header className="bar">
      <a className="mark" href="../" aria-label="Query Studio home">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" fill="currentColor" /><rect x="5.5" y="12" width="3" height="6.5" rx="1" className="cut" /><rect x="10.5" y="8.5" width="3" height="10" rx="1" className="cut" /><rect x="15.5" y="5.5" width="3" height="13" rx="1" className="cut" /></svg>
        <span>Query Studio <b>Social</b></span>
      </a>
      <div className="seg looks" role="radiogroup" aria-label="Look">
        {LOOKS.map(([id, name]) => <button key={id} role="radio" aria-checked={lookPref === id} className={lookPref === id ? 'on' : ''} onClick={() => setLookPref(id)}>{name}</button>)}
      </div>
    </header>

    <section className="intro">
      <h1>Your stats, ready to post.</h1>
      <p>Pick a story and a size. Every card saves as an image you can drop straight into a Reel or a post.</p>
    </section>

    <section className="step" aria-labelledby="pick-story">
      <h2 id="pick-story"><span className="num">1</span>Pick a story</h2>
      <div className="stories" role="radiogroup" aria-labelledby="pick-story">
        {STORIES.map((s, i) => <button key={s.id} role="radio" aria-checked={s.id === story.id} className={'story' + (s.id === story.id ? ' on' : '')} onClick={() => setStoryId(s.id)}>
          <span className="glyph" aria-hidden="true">{['vs', '%', '★'][i]}</span>
          <span className="sname">{s.name}</span>
          <span className="sblurb">{s.blurb}</span>
        </button>)}
      </div>
    </section>

    <section className="step" aria-labelledby="pick-size">
      <h2 id="pick-size"><span className="num">2</span>Pick a size</h2>
      <div className="seg sizes" role="radiogroup" aria-labelledby="pick-size">
        {FORMATS.map(([id, name, hint]) => <button key={id} role="radio" aria-checked={format === id} className={format === id ? 'on' : ''} onClick={() => setFormat(id)}>
          <span className={'shape ' + id} aria-hidden="true" /><span><b>{name}</b><small>{hint}</small></span>
        </button>)}
      </div>
    </section>

    <section className="step" aria-labelledby="cards-h">
      <h2 id="cards-h"><span className="num">3</span>Save and share</h2>
      <div className={'cards ' + format}>
        {story.cards.map(c => {
          const st = styles[c.id] || c.style;
          return <article key={c.id} className="card">
            <div className="frame" ref={el => { refs.current[c.id] = el; }}><CardSvg card={c} style={st} format={format} look={look} /></div>
            <div className="controls">
              <div className="seg chips" role="radiogroup" aria-label="Chart style">
                {c.styles.map(s => <button key={s} role="radio" aria-checked={st === s} className={st === s ? 'on' : ''} onClick={() => setStyles(m => ({ ...m, [c.id]: s }))}>{STYLE_NAMES[s]}</button>)}
              </div>
              <button className="go" disabled={busy === c.id} onClick={() => makeImage(c.id, c.title)}>{busy === c.id ? 'Making…' : 'Get image'}</button>
            </div>
          </article>;
        })}
      </div>
    </section>

    <footer className="foot">
      <p>Sample data from {GENERATED}. Other players are anonymised; the review game is made up to show the method.</p>
      <p><a href="../">Open the full Query Studio</a> to build your own queries and dashboards.</p>
    </footer>

    {shot && <div className="sheet" role="dialog" aria-modal="true" aria-label="Your image" onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="sheet-in">
        <div className="sheet-head"><b>Your image</b><button className="x" onClick={close} aria-label="Close">×</button></div>
        <img src={shot.url} alt={shot.title} className={format} />
        <p className="hint">On a phone, press and hold the image to save it to Photos.</p>
        <div className="sheet-actions">
          <button className="go" onClick={share}>Share…</button>
          <button className="ghost" onClick={() => download(shot.blob, shot.name)}>Download PNG</button>
        </div>
      </div>
    </div>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
