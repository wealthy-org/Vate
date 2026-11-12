#!/usr/bin/env node
// Visual QA: screenshots of every route at the viewports the brief names, plus checks that do
// not need eyes — console errors, CSP violations, failed requests, horizontal overflow, and the
// link to the official X account in every header and footer.
//
//   pnpm build && pnpm start &            (or any running instance)
//   BASE_URL=http://127.0.0.1:3000 pnpm qa:screens [--only=/app --widths=1440,390]
//
// For an instance built with its own NEXT_PUBLIC_X_URL, run this script with the same value.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = (process.env.BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
// Screenshots go to the system temp directory unless QA_OUT says otherwise: never into the repository.
const outDir = process.env.QA_OUT ?? join(tmpdir(), 'vate-qa', 'screens');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const widths = (arg('widths') ?? '1440,1280,768,390').split(',').map(Number);
const routes = (arg('only') ?? '/,/app,/app#portfolio,/docs,/terms,/privacy').split(',');
const heights = { 1440: 900, 1280: 800, 768: 1024, 390: 844 };
const xUrl = (process.env.NEXT_PUBLIC_X_URL || 'https://x.com/VateVault').trim().replace(/\/$/, '');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const report = [];
let failed = false;

for (const width of widths) {
  const context = await browser.newContext({
    viewport: { width, height: heights[width] ?? 900 },
    deviceScaleFactor: 1,
    reducedMotion: process.env.QA_MOTION === '1' ? 'no-preference' : 'reduce',
    hasTouch: width <= 768,
    isMobile: width <= 480,
  });
  for (const route of routes) {
    const page = await context.newPage();
    const problems = [];
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 240)}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 240)}`));
    page.on('response', (r) => {
      if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url().slice(0, 140)}`);
    });
    page.on('requestfailed', (r) => {
      const failure = r.failure()?.errorText ?? '';
      if (!/ERR_ABORTED/.test(failure)) problems.push(`request failed: ${r.url().slice(0, 120)} ${failure}`);
    });
    await page.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    const response = await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // Let live data arrive: stats lose their skeleton once the first snapshot is in.
    await page.waitForLoadState('networkidle', { timeout: 25_000 }).catch(() => {});
    await page.waitForTimeout(Number(process.env.QA_SETTLE ?? 2500));
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      csp: window.__csp,
      title: document.title,
    }));
    if (metrics.scrollWidth > metrics.clientWidth + 1) problems.push(`horizontal overflow: ${metrics.scrollWidth} > ${metrics.clientWidth}`);
    for (const v of metrics.csp) problems.push(`csp: ${v}`);
    if (!response || response.status() >= 400) problems.push(`http ${response?.status()}`);
    // The official X account: one button in the header and one in the footer, the right address,
    // a new tab, a name for screen readers, a size a finger can hit, and inside the window.
    const xLinks = await page.evaluate(() => [...document.querySelectorAll('a.xlink')].map((a) => {
      const r = a.getBoundingClientRect();
      return {
        where: a.closest('header') ? 'header' : a.closest('footer') ? 'footer' : 'elsewhere',
        href: a.getAttribute('href'),
        newTab: a.target === '_blank' && a.relList.contains('noopener'),
        name: a.getAttribute('aria-label') ?? '',
        size: `${Math.round(r.width)}x${Math.round(r.height)}`,
        fits: r.width >= 24 && r.height >= 24 && r.left >= 0 && r.right <= document.documentElement.clientWidth,
      };
    }));
    for (const where of ['header', 'footer']) {
      const found = xLinks.filter((l) => l.where === where);
      if (found.length !== 1) problems.push(`x link: ${found.length} in the ${where}, expected 1`);
      for (const l of found) {
        if (l.href !== xUrl) problems.push(`x link in the ${where} points to ${l.href}, expected ${xUrl}`);
        if (!l.newTab) problems.push(`x link in the ${where} does not open a new tab with rel=noopener`);
        if (!/\bX\b/.test(l.name)) problems.push(`x link in the ${where} has no name for screen readers`);
        if (!l.fits) problems.push(`x link in the ${where} is ${l.size}px or outside the window`);
      }
    }
    if (xLinks.some((l) => l.where === 'elsewhere')) problems.push('x link outside a header or footer');
    const name = `${width}-${route === '/' ? 'home' : route.replace(/[/#]+/g, '-').replace(/^-/, '')}.png`;
    await page.screenshot({ path: join(outDir, name), fullPage: true });
    report.push({ width, route, title: metrics.title, status: response?.status() ?? 0, problems });
    if (problems.length) failed = true;
    console.log(`${problems.length ? '✕' : '✓'} ${String(width).padStart(4)}  ${route.padEnd(16)} ${metrics.title}${problems.length ? `\n    ${problems.join('\n    ')}` : ''}`);
    await page.close();
  }
  await context.close();
}
await browser.close();
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ base, at: new Date().toISOString(), report }, null, 2));
console.log(`\n${report.length} pages, ${report.filter((r) => r.problems.length).length} with problems. Screenshots in ${outDir}/`);
process.exit(failed ? 1 : 0);
