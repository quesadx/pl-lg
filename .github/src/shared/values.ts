// Phase 5 — the runtime value model. Pure data + pure helpers, shared by the
// evaluator (which produces values) and the stdlib (whose natives consume and
// return them). No I/O, no dependencies.

export type TypeName = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object' | 'unknown';

// First parameter is the piped slot; 'any' accepts every type, 'unknown' means
// no static information (and is never a rejection reason in the strict pre-pass).
export interface NativeSig {
  readonly params: readonly (TypeName | 'any')[];
  readonly ret: TypeName | 'any';
}

export interface CallableValue {
  readonly kind: 'native' | 'closure';
  readonly name: string;
  call(args: Value[]): Value;
}

export type Value =
  | null
  | boolean
  | number
  | string
  | Value[]
  | { [key: string]: Value }
  | CallableValue;

export function isCallable(v: Value): v is CallableValue {
  return (
    v !== null &&
    typeof v === 'object' &&
    typeof (v as { call?: unknown }).call === 'function' &&
    ((v as { kind?: unknown }).kind === 'native' || (v as { kind?: unknown }).kind === 'closure')
  );
}

export function typeName(v: Value): TypeName | 'function' {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (isCallable(v)) return 'function';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'object';
}

// ponytail: one JS-like convention — false/null/0/"" are falsy, everything else
// (including empty arrays/objects) is truthy. Revisit only if scripts ask for it.
export function truthy(v: Value): boolean {
  if (v === null || v === false) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '';
  return true;
}

export function deepEquals(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEquals(x, b[i] as Value));
  }
  if (isCallable(a) || isCallable(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((k) => Object.hasOwn(b, k) && deepEquals(a[k] as Value, b[k] as Value))
  );
}

// print!/f-string rendering: strings raw, callables named tags, everything
// else JSON-encoded (deterministic for our value model).
export function display(v: Value): string {
  if (typeof v === 'string') return v;
  if (isCallable(v)) return `[${v.kind} ${v.name}]`;
  return JSON.stringify(v) ?? String(v);
}
