import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import vm from 'node:vm';
import { lex } from '../../src/lexer/lexer.js';
import { parse } from '../../src/parser/parser.js';
import { extract } from '../../src/capability/extractor.js';

// Phase 3 DoD: run the extractor inside a Node vm context where an accidental
// import of fs / net / child_process / zod / anything outside the extractor's
// known-pure closure throws immediately (instead of silently succeeding via
// module caching).
//
// Mechanism: transpile the closure's .ts sources to CJS with ts.transpileModule
// (type-only imports are erased), evaluate each inside a bare vm context, and
// give them a `require` that serves only closure members and denies everything
// else. Adding a new runtime import to a closure module must update CLOSURE —
// the test fails otherwise, which is the point.
const CLOSURE = [
  'src/capability/extractor.ts',
  'src/shared/glob-to-regex.ts',
  'src/shared/errors.ts',
] as const;

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function transpile(rel: string): string {
  const source = readFileSync(resolvePath(repoRoot, rel), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function loadVmExtract(): (program: unknown) => unknown {
  const factories = new Map<string, string>(
    CLOSURE.map((rel) => [resolvePath(repoRoot, rel), transpile(rel)] as const),
  );
  const cache = new Map<string, unknown>();

  const runModule = (resolved: string): unknown => {
    const cached = cache.get(resolved);
    if (cached !== undefined) return cached;
    const module = { exports: {} as Record<string, unknown> };
    cache.set(resolved, module.exports);
    const innerRequire = (id: string): unknown => {
      if (!id.startsWith('.')) {
        throw new Error(`purity violation: ${resolved} imports "${id}" — bare imports are outside the pure closure`);
      }
      const dep = resolvePath(dirname(resolved), id.replace(/\.js$/, '.ts'));
      if (!factories.has(dep)) {
        throw new Error(`purity violation: ${resolved} imports "${id}" — outside the extractor's pure closure`);
      }
      return runModule(dep);
    };
    // URL is a WHATWG parsing global with no I/O — the extractor needs it for
    // literal curl!() host checks. Everything host-ish (fs, net, process, …)
    // simply does not exist in this context.
    const ctx = vm.createContext({ URL });
    const wrapper = vm.runInContext(
      '(function (exports, require, module) {\n' + (factories.get(resolved) as string) + '\n})',
      ctx,
      { filename: resolved },
    ) as (e: Record<string, unknown>, r: (id: string) => unknown, m: { exports: Record<string, unknown> }) => void;
    wrapper(module.exports, innerRequire, module);
    cache.set(resolved, module.exports);
    return module.exports;
  };

  const extractor = runModule(resolvePath(repoRoot, 'src/capability/extractor.ts')) as {
    extract: (program: unknown) => unknown;
  };
  return extractor.extract;
}

describe('Phase 3: purity smoke test (Section 2.1 — the extractor never does I/O)', () => {
  it('the sandbox denies non-closure imports (harness self-check)', () => {
    // Simulate a module inside the sandbox requiring fs: must throw, not return.
    const ctx = vm.createContext({
      require: (id: string): unknown => {
        throw new Error(`purity violation: bare import "${id}" is not in the pure closure`);
      },
    });
    expect(() => {
      vm.runInContext(`require('fs')`, ctx);
    }).toThrowError(/purity violation/);
  });

  it('extracts rosetta and kitchen-sink inside the vm, byte-identical to the normal run', () => {
    const vmExtract = loadVmExtract();
    for (const file of ['../parser/rosetta.placitum', './kitchen-sink.placitum']) {
      const program = parse(lex(readFileSync(new URL(file, import.meta.url), 'utf8')));
      expect(JSON.stringify(vmExtract(program))).toBe(JSON.stringify(extract(program)));
    }
  });
});
