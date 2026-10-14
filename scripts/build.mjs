// Bundles the app into one HTML page (script and styles inline) for publishing as an artifact.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
const out = 'dist';
mkdirSync(out, { recursive: true });
const r = await build({ entryPoints: ['src/app/main.tsx'], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, define: { 'process.env.NODE_ENV': '"production"' }, jsx: 'automatic', legalComments: 'none' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync('src/app/styles.css', 'utf8');
const html = `<title>Query Studio</title>
<meta name="description" content="Custom queries, weights and dashboards over any processed data layer.">
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}</style>
<div id="root"></div>
<script>${js}</script>
`;
writeFileSync(`${out}/index.html`, html);
cpSync('public/data', `${out}/data`, { recursive: true });
console.log(`index.html ${(html.length / 1024).toFixed(0)} KB`);
