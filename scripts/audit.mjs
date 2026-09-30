// Runs `npm audit` on package-lock.json with an explicit allowlist:
//
// - runtime dependencies (what applications install with the package) must have no advisory at all;
// - development dependencies may only have the advisories listed in ALLOWED, each with the reason
//   why it does not reach the published package. Any other advisory fails, so that it gets looked at.
//
//   node scripts/audit.mjs
import { spawnSync } from 'node:child_process';

const ALLOWED = {
  // The package is compiled with the oldest supported Angular major (17), so that applications on
  // every supported major can use it. These packages only compile and test it: no code of theirs is
  // published, and applications bring their own Angular through the peer dependency range. Fixed
  // versions exist only in newer majors (the CI matrix tests those as well).
  '@angular/common': [
    'GHSA-39pv-4j6c-2g6v',
    'GHSA-48r7-hpm6-gfxm',
    'GHSA-58c5-g7wp-6w37',
    'GHSA-jhpw-976m-542j',
    'GHSA-p297-fm68-3q8c',
    'GHSA-p3vc-36g9-x9gr',
    'GHSA-q6f4-qqrg-jv6x',
  ],
  '@angular/compiler': [
    'GHSA-58w9-8g37-x9v5',
    'GHSA-f3m7-gqxr-g87x',
    'GHSA-g93w-mfhg-p222',
    'GHSA-hh8m-fm6v-7cvg',
    'GHSA-jj27-h5hq-8x99',
    'GHSA-jrmj-c5cx-3cw6',
    'GHSA-v4hv-rgfq-gp49',
  ],
  '@angular/core': [
    'GHSA-692r-grfm-v8x7',
    'GHSA-f3m7-gqxr-g87x',
    'GHSA-g93w-mfhg-p222',
    'GHSA-hh8m-fm6v-7cvg',
    'GHSA-jj27-h5hq-8x99',
    'GHSA-jrmj-c5cx-3cw6',
    'GHSA-prjf-86w9-mfqv',
    'GHSA-rgjc-h3x7-9mwg',
  ],
  '@angular/platform-server': [
    'GHSA-45q2-gjvg-7973',
    'GHSA-68x2-mx4q-78m7',
    'GHSA-f67j-2jqw-jpq7',
    'GHSA-f6mr-pjwc-34m4',
    'GHSA-gxx4-3xcv-f8qx',
    'GHSA-hqr9-c56f-3x7f',
    'GHSA-j3r3-mxqp-r2p4',
    'GHSA-rfh7-fxqc-q52v',
    'GHSA-v3p8-whq6-r5jg',
    'GHSA-vpx6-8pjr-4g3v',
    'GHSA-xrxm-cp7j-8xf6',
  ],
  // ng-packagr 17 loads esbuild only to bundle component stylesheets, and this package has none.
  // The advisory concerns the esbuild development server, which is never started.
  esbuild: ['GHSA-67mh-4wv8-2f99'],
};

/** The advisories npm reports for the lockfile: one entry per advisory and affected package. */
function advisories(extraArgs) {
  const result = spawnSync('npm', ['audit', '--json', ...extraArgs], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    console.error(result.stderr || result.stdout);
    throw new Error('npm audit did not return a JSON report.');
  }
  if (report.error) throw new Error('npm audit failed: ' + JSON.stringify(report.error));
  const found = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via) {
      // Entries that are only package names point to another entry, which lists the advisory.
      if (typeof via !== 'object') continue;
      const id = String(via.url).split('/').pop();
      found.set(via.name + ' ' + id, { name: via.name, id, severity: via.severity, title: via.title, url: via.url });
    }
  }
  return [...found.values()];
}

function print(list) {
  for (const { name, id, severity, title, url } of list) console.error('  ' + name + ' ' + id + ' (' + severity + '): ' + title + ' ' + url);
}

const runtime = advisories(['--omit=dev']);
const all = advisories([]);
const unexpected = all.filter(({ name, id }) => !(ALLOWED[name] ?? []).includes(id));
const listed = new Set(all.map(({ name, id }) => name + ' ' + id));
const stale = Object.entries(ALLOWED).flatMap(([name, ids]) => ids.filter((id) => !listed.has(name + ' ' + id)).map((id) => name + ' ' + id));

let failed = false;
if (runtime.length > 0) {
  failed = true;
  console.error('Advisories in runtime dependencies:');
  print(runtime);
}
if (unexpected.length > 0) {
  failed = true;
  console.error('Advisories in development dependencies that are not in the allowlist of scripts/audit.mjs:');
  print(unexpected);
}
if (stale.length > 0) {
  // Not an error: the advisory no longer applies (for example after an update). Remove it from ALLOWED.
  console.log('Allowlisted advisories that npm no longer reports: ' + stale.join(', '));
}
if (failed) process.exit(1);
console.log('npm audit: no runtime advisories, ' + String(all.length) + ' allowlisted development advisories.');
