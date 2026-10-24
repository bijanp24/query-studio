// Bundles the app into one HTML page (script and styles inline). By default the page is shaped for
// publishing as a claude.ai artifact, which adds the document skeleton itself; PAGES=1 builds a
// complete document for static hosting such as GitHub Pages.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
const out = 'dist';
const pages = process.env.PAGES === '1';
mkdirSync(out, { recursive: true });
const r = await build({ entryPoints: ['src/app/main.tsx'], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, define: { 'process.env.NODE_ENV': '"production"', __DEFAULT_WS__: JSON.stringify(pages ? 'fieldtrials' : 'lol'), __PAGES__: JSON.stringify(pages) }, jsx: 'automatic', legalComments: 'none' });
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

// The Social page: a separate, phone-first entry with its own look, served at /social/.
const sr = await build({ entryPoints: ['src/social/main.tsx'], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, define: { 'process.env.NODE_ENV': '"production"' }, jsx: 'automatic', legalComments: 'none' });
const sjs = sr.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const scss = readFileSync('src/social/social.css', 'utf8');
const sbody = `<title>Query Studio Social</title>
<meta name="description" content="Stats cards ready for Instagram Reels and X: me vs my lobby, rank distribution, the mode, farming and review bombing.">
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="theme-color" content="#0d1117">
<style>${scss}</style>
<div id="root"></div>
<script>${sjs}</script>
`;
const shtml = pages
  ? `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head><body>\n${sbody}</body></html>\n`
  : sbody;
mkdirSync(`${out}/social`, { recursive: true });
writeFileSync(`${out}/social/index.html`, shtml);
console.log(`social/index.html ${(shtml.length / 1024).toFixed(0)} KB`);
console.log(`index.html ${(html.length / 1024).toFixed(0)} KB`);
