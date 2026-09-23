import type { Guard } from '../capability/guard.js';
import type { HostBindings } from '../host-bindings/index.js';
import { EvalError } from '../shared/errors.js';
import { display, isCallable, typeName } from '../shared/values.js';
import type { CallableValue, NativeSig, Value } from '../shared/values.js';

// Phase 5 — builtin functions (Section 1). Pure natives live in the script's
// global environment; effectful ones are reachable ONLY through BangCall
// dispatch and are thin wrappers: resolve args -> CapabilityGuard.authorize ->
// host binding, which receives the AUTHORIZED value (Section 2.2 step 6).
//
// BANG_SIGNATURES here and BANG_REGISTRY in the extractor describe the same
// effectful surface; chokepoint.test.ts asserts they cannot drift apart.

export const AMBIENT_BANGS = ['print', 'eprint'] as const;
export const EFFECTFUL_STDLIB = ['fs.readFile', 'fs.writeFile', 'curl'] as const;

export const BANG_SIGNATURES: Readonly<Record<string, NativeSig>> = {
  'fs.readFile': { params: ['string'], ret: 'string' },
  'fs.writeFile': { params: ['string', 'string'], ret: 'null' },
  curl: { params: ['string'], ret: 'object' },
  print: { params: ['any'], ret: 'null' },
  eprint: { params: ['any'], ret: 'null' },
};

export const PURE_SIGNATURES: Readonly<Record<string, NativeSig>> = {
  'json.parse': { params: ['string'], ret: 'unknown' },
};

export interface Stdlib {
  globals: ReadonlyMap<string, Value>;
  bangs: Readonly<Record<string, BangFn>>;
}

// A bang implementation receives the guard of the *lexical scope containing
// the call site* — a fn with `needs only(...)` must run its body's effectful
// calls against its attenuated child manifest, not the top-level one. The
// evaluator threads the current guard through evaluation.
export type BangFn = (guard: Guard, args: Value[]) => Value;

function evalError(code: string, message: string, hint: string): EvalError {
  return new EvalError({ code, message, hint });
}

function expectString(v: Value, what: string): string {
  if (typeof v !== 'string') {
    throw evalError(
      'E501_EVAL_TYPE_MISMATCH',
      `${what} must be a string, got ${typeName(v)}.`,
      'Pass a string value.',
    );
  }
  return v;
}

function native(name: string, min: number, max: number, impl: (args: Value[]) => Value): CallableValue {
  const arity = min === max ? String(min) : `${min}-${max}`;
  return {
    kind: 'native',
    name,
    call: (args: Value[]): Value => {
      if (args.length < min || args.length > max) {
        throw evalError(
          'E503_EVAL_ARITY_MISMATCH',
          `${name} expects ${arity} argument(s), got ${args.length}.`,
          'Match the function signature.',
        );
      }
      return impl(args);
    },
  };
}

function bangNative(name: string, min: number, max: number, impl: (guard: Guard, args: Value[]) => Value): BangFn {
  const arity = min === max ? String(min) : `${min}-${max}`;
  return (guard: Guard, args: Value[]): Value => {
    if (args.length < min || args.length > max) {
      throw evalError(
        'E503_EVAL_ARITY_MISMATCH',
        `${name} expects ${arity} argument(s), got ${args.length}.`,
        'Match the function signature.',
      );
    }
    return impl(guard, args);
  };
}

function expectFetchOptions(v: Value): { method: string; body: string | null } {
  if (v === null || typeof v !== 'object' || Array.isArray(v) || isCallable(v)) {
    throw evalError(
      'E501_EVAL_TYPE_MISMATCH',
      `curl options must be an object, got ${typeName(v)}.`,
      'Pass e.g. { method: "GET" }.',
    );
  }
  const method = v['method'] === undefined ? 'GET' : expectString(v['method'], 'curl options method');
  const body =
    v['body'] === undefined || v['body'] === null ? null : expectString(v['body'] as Value, 'curl options body');
  return { method, body };
}

function ambient(name: string, stream: 'stdout' | 'stderr', hosts: HostBindings): BangFn {
  return bangNative(name, 1, 1, (guard, args): Value => {
    const authorized = guard.authorize({ category: 'ambient-write', text: display(args[0] as Value), stream });
    if (stream === 'stdout') hosts.writeStdout(`${authorized}\n`);
    else hosts.writeStderr(`${authorized}\n`);
    return null;
  });
}

export function buildStdlib(hosts: HostBindings): Stdlib {
  const readFile = bangNative('fs.readFile', 1, 1, (guard, args): Value => {
    const path = expectString(args[0] as Value, 'fs.readFile path');
    return hosts.readFile(guard.authorize({ category: 'fsRead', path }));
  });
  const writeFile = bangNative('fs.writeFile', 2, 2, (guard, args): Value => {
    const path = expectString(args[0] as Value, 'fs.writeFile path');
    const contents = expectString(args[1] as Value, 'fs.writeFile contents');
    hosts.writeFile(guard.authorize({ category: 'fsWrite', path }), contents);
    return null;
  });
  const curl = bangNative('curl', 1, 2, (guard, args): Value => {
    const url = expectString(args[0] as Value, 'curl url');
    const opts = args.length === 2 ? expectFetchOptions(args[1] as Value) : { method: 'GET', body: null };
    const response = hosts.fetch(guard.authorize({ category: 'net', url }), opts);
    return { status: response.status, body: response.body };
  });
  const jsonParse = native('json.parse', 1, 1, (args): Value => {
    const text = expectString(args[0] as Value, 'json.parse input');
    try {
      return JSON.parse(text) as Value;
    } catch {
      throw evalError('E501_EVAL_TYPE_MISMATCH', 'json.parse: input is not valid JSON.', 'Pass a JSON-encoded string.');
    }
  });

  return {
    globals: new Map<string, Value>([['json', { parse: jsonParse }]]),
    bangs: {
      'fs.readFile': readFile,
      'fs.writeFile': writeFile,
      curl,
      print: ambient('print', 'stdout', hosts),
      eprint: ambient('eprint', 'stderr', hosts),
    },
  };
}
