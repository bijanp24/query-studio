import React from 'react';
import type { Dashboard, Query, Suggestion, Visualization } from '../core/types';
import { useApp, runCached } from './ctx';
import { askJSON } from './platform';
import { askPrompt, validateAnswer, type AskAnswer } from './askModel';
import { Viz, autoType } from './viz/charts';
import { fmt } from '../core/engine';
import { uid } from './ui';

export function Ask({ dash, onAdded, onQuery }: { dash?: Dashboard; onAdded?: (vizId: string) => void; onQuery?: (q: Query) => void }) {
  const app = useApp();
  const { ws, cat, update } = app;
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [ans, setAns] = React.useState<AskAnswer | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<Suggestion | null>(null);
  const abort = React.useRef<AbortController | null>(null);
  // A question belongs to the workspace it was asked in.
  React.useEffect(() => { abort.current?.abort(); setText(''); setAns(null); setErr(null); setPicked(null); }, [ws.id]);
  const go = async (question = text) => {
    if (!question.trim() || busy) return;
    setBusy(true); setErr(null); setAns(null); setPicked(null);
    abort.current?.abort(); const ac = new AbortController(); abort.current = ac;
    try {
      const raw = await askJSON<unknown>(askPrompt(ws, cat.tables, question.trim(), app.showHidden), ac.signal);
      const a = validateAnswer(raw, ws, cat.tables);
      if (a.error) setErr(a.error); else setAns(a);
    } catch (e) {
      const c = (e as { code?: string; message?: string });
      setErr(c.code === 'unavailable' || c.code === 'not_granted' ? 'Ask needs Claude, which this view does not offer. Open the page on claude.ai to use it; the query builder works without it.' : c.code === 'rate_limited' ? 'Too many questions in a row. Wait a moment and ask again.' : c.code === 'invalid_json' ? 'The answer could not be read as a query. Try rephrasing.' : (c.message || 'Ask failed.'));
    } finally { setBusy(false); }
  };
  const q = ans?.query;
  const res = q ? runCached(cat, q, dash) : null;
  const v: Visualization | null = q && res ? { id: 'ask', name: ans!.visualization?.name || q.name, queryId: q.id, type: ans!.visualization?.type || autoType(res), color: 1, width: 3, window: ans!.visualization?.window || 10, labels: true, x: ans!.visualization?.x, dist: ans!.visualization?.dist } : null;
  // A suggestion with a saved answer shows it at once, without the model; one without goes to Ask.
  const pick = (s: Suggestion) => {
    setText(s.text); setErr(null); setAns(null);
    if (s.vizId && ws.visualizations.some(x => x.id === s.vizId)) setPicked(s); else { setPicked(null); go(s.text); }
  };
  const pv = picked?.vizId ? ws.visualizations.find(x => x.id === picked.vizId) : undefined;
  const pq = pv ? ws.queries.find(x => x.id === pv.queryId) : undefined;
  const pres = pq ? runCached(cat, pq, dash) : null;
  const save = (toDash: boolean) => {
    if (!q || !v) return;
    const vz = { ...v, id: uid('v') };
    update(w => ({ ...w, queries: [...w.queries, q], visualizations: [...w.visualizations, vz] }));
    if (toDash && onAdded) onAdded(vz.id);
    if (onQuery) onQuery(q);
    setAns(null); setText(''); app.toast(toDash ? 'Added to the dashboard' : 'Saved');
  };
  return <div className="ask">
    <form className="askrow" onSubmit={e => { e.preventDefault(); go(); }}>
      <span className="askicon" aria-hidden>✦</span>
      <input value={text} onChange={e => setText(e.target.value)} placeholder={ws.id === 'lol' ? 'Ask: “win rate by champion, Riven games after the 150th count double”' : 'Ask for a number, a breakdown or a trend'} aria-label="Ask for a query" />
      <button type="submit" disabled={busy || !text.trim()}>{busy ? 'Thinking…' : 'Ask'}</button>
    </form>
    {!!ws.suggestions?.length && !ans && !picked && <div className="suggest" aria-label="Suggested questions">
      <span className="small muted">Try</span>
      {ws.suggestions.map((s, i) => <button key={i} type="button" className="chip" onClick={() => pick(s)}>{s.text}</button>)}
    </div>}
    {picked && pv && pq && pres && <div className="askres">
      <div className="askhead"><b>{pv.name}</b><span className="muted small">{ws.datasets.find(d => d.id === pq.dataset)?.name} · {pres.n.toLocaleString()} {pres.grain}s · a saved answer to “{picked.text}”</span></div>
      {pv.note && <div className="small">{pv.note}</div>}
      <div className="askviz"><Viz v={pv} res={pres} cat={cat} /></div>
      <div className="inline">
        {onAdded && <button onClick={() => { onAdded(pv.id); setPicked(null); app.toast('Added to the dashboard'); }}>Add to dashboard</button>}
        {onAdded && <button className="ghost" onClick={() => app.go('queries', pq.id)}>Open in the builder</button>}
        <button className="ghost" onClick={() => go(picked.text)}>Ask Claude instead</button>
        <button className="ghost" onClick={() => { setPicked(null); setText(''); }}>Close</button>
      </div>
    </div>}
    {err && <div className="warn small">{err}</div>}
    {ans && q && res && v && <div className="askres">
      <div className="askhead"><b>{v.name}</b><span className="muted small">{ws.datasets.find(d => d.id === q.dataset)?.name} · {res.n.toLocaleString()} {res.grain}s{q.weight ? ` · weighted by ${q.weight}` : ''}</span></div>
      {ans.explanation && <div className="small">{ans.explanation}</div>}
      {ans.fixes.length > 0 && <div className="small muted">Adjusted: {ans.fixes.join('; ')}.</div>}
      <div className="askviz"><Viz v={v} res={res} cat={cat} />{res.unweighted && res.measures[0]?.weight && <div className="wnote">Unweighted: {fmt(res.unweighted[0], res.measures[0].format)}</div>}</div>
      <div className="inline">
        {onAdded && <button onClick={() => save(true)}>Add to dashboard</button>}
        <button className={onAdded ? 'ghost' : ''} onClick={() => save(false)}>Save query{v ? ' and visualization' : ''}</button>
        {onAdded && <button className="ghost" onClick={() => { update(w => ({ ...w, queries: [...w.queries, q] })); app.go('queries', q.id); }}>Open in the builder</button>}
        <button className="ghost" onClick={() => setAns(null)}>Discard</button>
      </div>
    </div>}
  </div>;
}
