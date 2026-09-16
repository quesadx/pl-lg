import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import vm from 'node:vm';

// Phases 3 & 6 purity harness (shared). Transpile a known-pure closure's .ts
// sources to CJS with ts.transpileModule (type-only imports are erased),
// evaluate each inside a bare vm context, and serve `require` only closure
// members plus an explicit bare-import allow-list (zod for the explain
// renderer — a pure validator, no I/O). Anything else throws immediately:
// an accidental fs/net import fails loudly instead of silently succeeding
// via module caching. Adding a new runtime import to a closure module must
// update that closure list — the test fails otherwise, which is the point.

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export interface VmClosure {
  readonly closure: readonly string[];
  readonly bareImports?: Readonly<Record<string, unknown>>;
}

export function loadVmModule<T>({ closure, bareImports = {} }: VmClosure, entry: string): T {
  const factories = new Map<string, string>(
    closure.map((rel) => [resolvePath(repoRoot, rel), transpile(rel)] as const),
  );
  const cache = new Map<string, unknown>();

  const runModule = (resolved: string): unknown => {
    const cached = cache.get(resolved);
    if (cached !== undefined) return cached;
    const module = { exports: {} as Record<string, unknown> };
    cache.set(resolved, module.exports);
    const innerRequire = (id: string): unknown => {
      if (!id.startsWith('.')) {
        if (Object.hasOwn(bareImports, id)) return bareImports[id];
        throw new Error(`purity violation: ${resolved} imports "${id}" — bare imports are outside the pure closure`);
      }
      const dep = resolvePath(dirname(resolved), id.replace(/\.js$/, '.ts'));
      if (!factories.has(dep)) {
        throw new Error(`purity violation: ${resolved} imports "${id}" — outside the module's pure closure`);
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

  return runModule(resolvePath(repoRoot, entry)) as T;
}

function transpile(rel: string): string {
  const source = readFileSync(resolvePath(repoRoot, rel), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
