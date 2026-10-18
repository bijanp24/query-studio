// Bundles the app into one HTML page (script and styles inline). By default the page is shaped for
// publishing as a claude.ai artifact, which adds the document skeleton itself; PAGES=1 builds a
// complete document for static hosting such as GitHub Pages.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
const out = 'dist';
const pages = process.env.PAGES === '1';
mkdirSync(out, { recursive: true });
const r = await build({ entryPoints: ['src/app/main.tsx'], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, define: { 'process.env.NODE_ENV': '"production"', __DEFAULT_WS__: JSON.stringify(pages ? 'fieldtrials' : 'lol') }, jsx: 'automatic', legalComments: 'none' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync('src/app/styles.css', 'utf8');
const body = `<title>Query Studio</title>
<meta name="description" content="Custom queries, weights and dashboards over any processed data layer.">
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}</style>
<div id="root"></div>
<script>${js}</script>
`;
const html = pages
  ? `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head><body>\n${body}</body></html>\n`
  : body;
writeFileSync(`${out}/index.html`, html);
cpSync('public/data', `${out}/data`, { recursive: true });
cpSync('public/launch', `${out}/launch`, { recursive: true });
console.log(`index.html ${(html.length / 1024).toFixed(0)} KB`);
