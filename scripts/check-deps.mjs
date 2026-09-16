#!/usr/bin/env node
// Fails the build if package-lock.json declares any direct dependency outside
// the Section 8.3 allow-list.
// ponytail: audits direct deps only — transitive deps are pinned by the
// lockfile itself; add a transitive audit if supply-chain policy ever demands it.
import { readFileSync } from 'node:fs';

const ALLOW_LIST = new Set([
  'zod',
  'typescript',
  'eslint',
  '@typescript-eslint/parser',
  '@typescript-eslint/eslint-plugin',
  'vitest',
  'tsx',
  'commander',
  'prettier',
  '@types/node',
]);

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const root = lock.packages?.[''];
if (!root) {
  console.error('check-deps: package-lock.json has no root package entry');
  process.exit(1);
}

const declared = [
  ...Object.keys(root.dependencies ?? {}),
  ...Object.keys(root.devDependencies ?? {}),
  ...Object.keys(root.optionalDependencies ?? {}),
];

const offenders = declared.filter((name) => !ALLOW_LIST.has(name));
if (offenders.length > 0) {
  console.error(
    `check-deps: dependencies outside the Section 8.3 allow-list:\n  ${offenders.join('\n  ')}`,
  );
  process.exit(1);
}

console.log(`check-deps: ${declared.length} direct dependencies, all within the allow-list.`);
