import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { EvalError } from '../shared/errors.js';

// Section 3 — the only directory allowed to import OS/network primitives.
// Every function here is called post-authorization, with the guard's canonical
// value (Section 2.2 step 6); nothing in this module decides policy, and it
// never sees the script's raw argument.

export interface FetchOptions {
  method: string;
  body: string | null;
}

export interface FetchResponse {
  status: number;
  body: string;
}

export interface HostBindings {
  readFile(path: string): string;
  writeFile(path: string, contents: string): void;
  fetch(url: string, opts: FetchOptions): FetchResponse;
  writeStdout(text: string): void;
  writeStderr(text: string): void;
}

// Host failures are evaluation-time errors: E501 is the catalog's runtime-error
// umbrella (no dedicated E-code exists for I/O failures).
function hostError(what: string, err: unknown): EvalError {
  const detail = err instanceof Error ? err.message : String(err);
  return new EvalError({
    code: 'E501_EVAL_TYPE_MISMATCH',
    message: `${what} failed: ${detail}`,
    hint: 'The operation was authorized; this is a host failure, not a capability denial.',
  });
}

// The evaluator is a synchronous tree-walker, so curl! must block, and Node has
// no synchronous fetch. A one-shot `node -e` subprocess running the global
// fetch is the dependency-free way to get one.
// The request (including URL, which may carry credentials) travels on stdin,
// never argv: argv is visible in the process list and capped by ARG_MAX.
// Redirects are refused: a granted host could otherwise bounce the request to
// any other host.
// ponytail: one process per request (~30ms); swap for an in-process
// Atomics.wait bridge if request volume ever makes spawn cost matter.
const FETCH_SUBPROCESS = `
import { readFileSync } from 'node:fs';
const { url, method, body } = JSON.parse(readFileSync(0, 'utf8'));
const res = await fetch(url, { method, body, redirect: 'manual' });
if (res.status >= 300 && res.status < 400) {
  const location = res.headers.get('location') ?? '(no Location)';
  throw new Error(\`redirect refused: \${res.status} -> \${location}\`);
}
const text = await res.text();
process.stdout.write(JSON.stringify({ status: res.status, body: text }));
`;

function fetchSync(url: string, opts: FetchOptions): FetchResponse {
  const payload = JSON.stringify({ url, method: opts.method, body: opts.body });
  let out: string;
  try {
    out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', FETCH_SUBPROCESS],
      { encoding: 'utf8', input: payload, stdio: 'pipe', timeout: 30_000, maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (err) {
    throw hostError(`curl!("${url}")`, err);
  }
  return JSON.parse(out) as FetchResponse; // our own subprocess's output
}

export const hostBindings: HostBindings = {
  readFile(path: string): string {
    try {
      return readFileSync(path, 'utf8');
    } catch (err) {
      throw hostError(`fs.readFile("${path}")`, err);
    }
  },
  writeFile(path: string, contents: string): void {
    try {
      writeFileSync(path, contents);
    } catch (err) {
      throw hostError(`fs.writeFile("${path}")`, err);
    }
  },
  fetch: fetchSync,
  writeStdout(text: string): void {
    process.stdout.write(text);
  },
  writeStderr(text: string): void {
    process.stderr.write(text);
  },
};

// CLI harness I/O: reads the script file the user pointed placitum at. This is
// not a script capability (no bang, absent from every manifest, no guard call)
// — it is the CLI reading its own input, like node reading a .js file. Errors
// stay raw (unwrapped) so the CLI can map them to E601_CLI_FILE_NOT_FOUND.
export function readSourceFile(path: string): string {
  return readFileSync(path, 'utf8');
}
