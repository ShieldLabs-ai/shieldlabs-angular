// Swaps the Angular toolchain in node_modules for another supported major, without touching
// package.json or package-lock.json, so that the tests and the build can run against it.
//
//   node scripts/use-angular.mjs <major> [more packages or tarballs to install at the same time]
//
// npm removes packages installed with --no-save on the next install, so pass the @shieldlabs/js
// tarball here as well. `npm ci` restores the default toolchain (Angular 17).
import { spawnSync } from 'node:child_process';

const TOOLCHAINS = {
  17: { angular: '~17.3.0', ngPackagr: '~17.3.0', typescript: '~5.4.5', zone: '~0.14.10' },
  18: { angular: '~18.2.0', ngPackagr: '~18.2.0', typescript: '~5.5.4', zone: '~0.14.10' },
  19: { angular: '~19.2.0', ngPackagr: '~19.2.0', typescript: '~5.8.3', zone: '~0.15.1' },
  20: { angular: '~20.3.0', ngPackagr: '~20.3.0', typescript: '~5.9.3', zone: '~0.15.1' },
  21: { angular: '~21.2.0', ngPackagr: '~21.2.0', typescript: '~5.9.3', zone: '~0.16.0' },
  22: { angular: '~22.2.0', ngPackagr: '~22.2.0', typescript: '~6.0.3', zone: '~0.16.0' },
};

const ANGULAR_PACKAGES = [
  'animations',
  'common',
  'compiler',
  'compiler-cli',
  'core',
  'platform-browser',
  'platform-browser-dynamic',
  'platform-server',
];

const [major, ...extra] = process.argv.slice(2);
const toolchain = TOOLCHAINS[major];
if (!toolchain) {
  console.error('Usage: node scripts/use-angular.mjs <' + Object.keys(TOOLCHAINS).join('|') + '> [packages...]');
  process.exit(2);
}

const packages = [
  ...ANGULAR_PACKAGES.map((name) => '@angular/' + name + '@' + toolchain.angular),
  'ng-packagr@' + toolchain.ngPackagr,
  'typescript@' + toolchain.typescript,
  'zone.js@' + toolchain.zone,
  ...extra,
];

// --legacy-peer-deps=false: resolve peer dependencies strictly for this install, so that npm checks
// that the swapped Angular packages, ng-packagr and TypeScript fit each other's peer ranges.
const args = ['install', '--no-save', '--legacy-peer-deps=false', ...packages];
console.log('npm ' + args.join(' '));
const result = spawnSync('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
