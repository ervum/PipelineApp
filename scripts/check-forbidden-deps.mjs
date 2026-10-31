import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const EXACT_FORBIDDEN = new Set([
  'tailwindcss',
  'bootstrap',
  '@angular/material',
  '@angular/cdk',
  'primeng',
  'bullmq',
  'redis',
  '@google/generative-ai',
]);

const PREFIX_FORBIDDEN = ['@ng-bootstrap/', 'ngx-'];

function isForbidden(pkgName) {
  if (EXACT_FORBIDDEN.has(pkgName)) return true;
  return PREFIX_FORBIDDEN.some((prefix) => pkgName.startsWith(prefix));
}

const packageJsonPaths = [
  path.join(rootDir, 'package.json'),
  path.join(rootDir, 'shared', 'package.json'),
  path.join(rootDir, 'backend', 'package.json'),
  path.join(rootDir, 'frontend', 'package.json'),
];

const violations = [];

for (const pkgPath of packageJsonPaths) {
  if (!fs.existsSync(pkgPath)) continue;
  const raw = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw);
  const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  for (const section of sections) {
    const deps = pkg[section];
    if (!deps || typeof deps !== 'object') continue;
    for (const depName of Object.keys(deps)) {
      if (isForbidden(depName)) {
        violations.push(`${path.relative(rootDir, pkgPath)} -> ${section}.${depName}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Forbidden dependencies detected:');
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

console.log('check-forbidden-deps: OK (0 violations)');
