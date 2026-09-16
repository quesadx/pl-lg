import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runSource } from '../../src/evaluator/run.js';
import type { Guard, GuardRequest } from '../../src/capability/guard.js';
import { BANG_REGISTRY } from '../../src/capability/extractor.js';
import {
  AMBIENT_BANGS,
  BANG_SIGNATURES,
  EFFECTFUL_STDLIB,
  buildStdlib,
} from '../../src/stdlib/stdlib.js';
import { CapabilityViolationError, EvalError } from '../../src/shared/errors.js';
import type { HostBindings } from '../../src/host-bindings/index.js';
import { captureHosts, permissiveGuard, requestValue } from './helpers/fakes.js';

// Phase 5 chokepoint guarantees (Section 1/2.2): every effectful stdlib call
// authorizes first, the host receives the *authorized* value (TOCTOU), and the
// registry/stdlib surface cannot drift apart.

function spyHosts(log: string[]): { hosts: HostBindings; stdout: string[] } {
  const stdout: string[] = [];
  const line = (text: string): string => (text.endsWith('\n') ? text.slice(0, -1) : text);
  const hosts: HostBindings = {
    readFile: (path: string): string => {
      log.push(`host readFile ${path}`);
      return 'file-body';
    },
    writeFile: (path: string): void => {
      log.push(`host writeFile ${path}`);
    },
    fetch: (url: string): { status: number; body: string } => {
      log.push(`host fetch ${url}`);
      return { status: 200, body: 'ok' };
    },
    writeStdout: (text: string): void => {
      log.push(`host writeStdout ${line(text)}`);
      stdout.push(line(text));
    },
    writeStderr: (text: string): void => {
      log.push(`host writeStderr ${line(text)}`);
    },
  };
  return { hosts, stdout };
}

describe('Phase 5: host-binding chokepoint', () => {
  it('authorizes before every host call and hands over the authorized value (TOCTOU)', () => {
    const log: string[] = [];
    // The stub guard tags every authorized value: a host receiving the raw
    // argument instead of the authorize() return would be visible here.
    const guard: Guard = {
      authorize: (req: GuardRequest): string => {
        const value = requestValue(req);
        log.push(`authorize ${req.category} ${value}`);
        return `canonical:${value}`;
      },
      forScope: (): Guard => guard,
      requireEnv: (): void => undefined,
    };
    const { hosts, stdout } = spyHosts(log);
    runSource(
      [
        'needs fs.read("/safe/*.txt"), net("api.example.com")',
        '',
        'let body = fs.readFile!("/safe/a.txt")',
        'let page = curl!("https://api.example.com/x")',
        'print!(f"{body}:{page.status}")',
      ].join('\n'),
      { env: {}, guard, hosts },
    );
    expect(log).toEqual([
      'authorize fsRead /safe/a.txt',
      'host readFile canonical:/safe/a.txt',
      'authorize net https://api.example.com/x',
      'host fetch canonical:https://api.example.com/x',
      'authorize ambient-write file-body:200',
      'host writeStdout canonical:file-body:200',
    ]);
    expect(stdout).toEqual(['canonical:file-body:200']);
  });

  it('unconditionally authorizes print!/eprint! with no needs declaration (real guard)', () => {
    const { hosts, stdout, stderr } = captureHosts();
    runSource('print!("hi")\neprint!("oops")', { env: {}, hosts });
    expect(stdout).toEqual(['hi']);
    expect(stderr).toEqual(['oops']);
  });

  it('enforces a fn needs only(...) attenuation through the child guard at runtime', () => {
    let fetched = false;
    const { hosts } = captureHosts({
      fetch: (): { status: number; body: string } => {
        fetched = true;
        return { status: 200, body: 'ok' };
      },
    });
    const source = [
      'needs net("api.example.com"), net("evil.com")',
      '',
      'fn safe(u) needs only(net("api.example.com")) {',
      '    return u | curl!()',
      '}',
      '',
      'let url = "https://evil.com/x"',
      'safe(url)',
    ].join('\n');
    let thrown: unknown;
    try {
      runSource(source, { env: {}, hosts }); // real guard, built from the script's manifest
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CapabilityViolationError);
    expect((thrown as CapabilityViolationError).code).toBe('E401_GUARD_NET_DENIED');
    expect(fetched).toBe(false);
  });

  it('keeps the effectful stdlib surface and BANG_REGISTRY in sync (both directions)', () => {
    expect(Object.keys(BANG_REGISTRY).sort()).toEqual([...EFFECTFUL_STDLIB].sort());
    for (const ambient of AMBIENT_BANGS) expect(BANG_REGISTRY[ambient]).toBeUndefined();
    expect(Object.keys(BANG_SIGNATURES).sort()).toEqual(
      [...EFFECTFUL_STDLIB, ...AMBIENT_BANGS].sort(),
    );
    const { hosts } = captureHosts();
    const stdlib = buildStdlib(hosts);
    for (const name of Object.keys(BANG_SIGNATURES)) {
      expect(stdlib.bangs[name]).toBeDefined();
    }
  });

  it('catches a strict pipe-chain type error before the chain runs any side effect', () => {
    const { hosts, stdout } = captureHosts();
    let thrown: unknown;
    try {
      runSource('#!strict\n\nprint!("boom") | json.parse', {
        env: {},
        guard: permissiveGuard(),
        hosts,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(EvalError);
    expect((thrown as EvalError).code).toBe('E505_EVAL_PIPE_TYPE_ERROR');
    expect(stdout).toEqual([]);
  });

  it('completes the TOCTOU chain: the real guard canonicalizes and real readFile receives it', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'placitum-eval-')));
    try {
      writeFileSync(join(dir, 'a.txt'), 'canonical body');
      const { hosts, stdout } = captureHosts();
      const source = [
        `needs fs.read("${dir}/*.txt")`,
        '',
        `let c = fs.readFile!("${dir}/a.txt")`,
        'print!(c)',
      ].join('\n');
      runSource(source, { env: {}, hosts }); // real guard + real host bindings
      expect(stdout).toEqual(['canonical body']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes through the real host binding at the canonicalized target', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'placitum-eval-')));
    try {
      const { hosts } = captureHosts();
      const source = [
        `needs fs.write("${dir}/*.txt")`,
        '',
        `fs.writeFile!("${dir}/out.txt", "written by placitum")`,
      ].join('\n');
      runSource(source, { env: {}, hosts }); // real guard + real host bindings
      expect(readFileSync(join(dir, 'out.txt'), 'utf8')).toBe('written by placitum');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails E406 when a non-optional env(...) is unset at runtime (real guard)', () => {
    let thrown: unknown;
    try {
      runSource('needs env(PLACITUM_TEST_MISSING)\n\nprint!("x")', {
        env: {},
        hosts: captureHosts().hosts,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CapabilityViolationError);
    expect((thrown as CapabilityViolationError).code).toBe('E406_GUARD_ENV_MISSING');
  });

  it('resolves Object.prototype-named fn ids as own keys (no prototype-chain leakage)', () => {
    const { hosts, stdout } = captureHosts({
      fetch: (): { status: number; body: string } => ({ status: 200, body: 'ok' }),
    });
    const source = [
      'needs net("api.example.com")',
      '',
      'fn constructor(u) needs only(net("api.example.com")) {',
      '    return u | curl!()',
      '}',
      '',
      'fn __proto__(u) needs only(net("api.example.com")) {',
      '    return u | curl!()',
      '}',
      '',
      'print!(constructor!("https://api.example.com/x").status)',
      'print!(__proto__!("https://api.example.com/x").status)',
    ].join('\n');
    runSource(source, { env: {}, hosts }); // real guard: scoped/forScope must find own keys
    expect(stdout).toEqual(['200', '200']);
  });

  it('fetches through the real host binding against a local HTTP server', async () => {
    // The server must live in its own process: execFileSync blocks this
    // process's event loop, so an in-process server could never accept.
    const serverScript = `
import { createServer } from 'node:http';
const server = createServer((_req, res) => res.end('hello-from-server'));
server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port)));
`;
    const server = spawn(process.execPath, ['--input-type=module', '-e', serverScript]);
    const port = await new Promise<number>((resolve) => {
      server.stdout.once('data', (chunk: Buffer) => resolve(Number(chunk.toString())));
    });
    try {
      const { hosts, stdout } = captureHosts();
      const source = [
        'needs net("127.0.0.1")',
        '',
        `let r = curl!("http://127.0.0.1:${port}/x")`,
        'print!(r.body)',
      ].join('\n');
      runSource(source, { env: {}, hosts }); // real guard + real fetch
      expect(stdout).toEqual(['hello-from-server']);
    } finally {
      server.kill();
    }
  });
});
