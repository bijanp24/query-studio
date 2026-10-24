// Turns a card's SVG into a PNG at full export size. An SVG drawn as an image cannot see the page's web
// fonts, so the fonts are fetched once and embedded; where that is blocked the PNG falls back to the
// system fonts named in the stack.
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=DM+Sans:wght@400;500;600;700&display=swap';
let fontCss: Promise<string> | null = null;

async function embeddedFonts(): Promise<string> {
  try {
    const css = await fetch(FONT_CSS).then(r => (r.ok ? r.text() : Promise.reject()));
    // Keep only the latin subsets: they cover every character the cards draw.
    const blocks = css.split('@font-face').slice(1).filter(b => /U\+0000-00FF/.test(b));
    const out = await Promise.all(blocks.map(async b => {
      const url = /url\((https:[^)]+)\)/.exec(b)?.[1];
      if (!url) return '';
      const buf = await fetch(url).then(r => r.arrayBuffer());
      let bin = ''; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return '@font-face' + b.replace(url, 'data:font/woff2;base64,' + btoa(bin));
    }));
    return out.join('\n');
  } catch { return ''; }
}

export async function svgToPng(svg: SVGSVGElement, w: number, h: number): Promise<Blob> {
  fontCss ||= embeddedFonts();
  const css = await fontCss;
  let markup = new XMLSerializer().serializeToString(svg)
    .replace(/ width="100%"/, ` width="${w}" height="${h}"`);
  if (css) markup = markup.replace(/(<svg[^>]*>)/, `$1<style>${css.replace(/</g, '')}</style>`);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('Could not draw the card')); img.src = url; });
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((ok, bad) => canvas.toBlob(b => (b ? ok(b) : bad(new Error('Could not make the image'))), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

/** Opens the phone's share sheet with the image when the browser allows it. */
export async function shareFile(blob: Blob, name: string, text: string): Promise<'shared' | 'cancelled' | 'unavailable'> {
  const file = new File([blob], name, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!nav.share || !nav.canShare?.({ files: [file] })) return 'unavailable';
  try { await nav.share({ files: [file], text }); return 'shared'; } catch (e) { return (e as Error).name === 'AbortError' ? 'cancelled' : 'unavailable'; }
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
