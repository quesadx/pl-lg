import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION, runCli } from '../../src/cli/main.js';
import type { CliIo } from '../../src/cli/main.js';
import { captureHosts, permissiveGuard } from '../eval/helpers/fakes.js';

// Phase 9 final release gate (Section 11): the Rosetta Stone example must run
// end-to-end through `run` and `explain`. runCli is the CLI minus process
// wiring: argv in, exit code out, every byte through the injected io.

const rosettaPath = fileURLToPath(new URL('../parser/rosetta.placitum', import.meta.url));
const traversalPath = fileURLToPath(new URL('../capability/negative/traversal.negative.placitum', import.meta.url));
const explainGolden = readFileSync(new URL('../explain/rosetta.explain.golden.txt', import.meta.url), 'utf8');
const evalGolden = JSON.parse(readFileSync(new URL('../eval/rosetta.eval.golden.json', import.meta.url), 'utf8')) as {
  stdout: string[];
  stderr: string[];
};

const configJson = JSON.stringify({
  enabled: true,
  name: 'app',
  endpoints: ['https://api.example.com/one', 'https://api.example.com/two'],
});

interface FakeCli {
  io: CliIo;
  stdout: string[];
  stderr: string[];
}

function fakeIo(overrides: Partial<CliIo> = {}): FakeCli {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CliIo = {
    stdout: { write: (text: string): void => { stdout.push(text); } },
    stderr: { write: (text: string): void => { stderr.push(text); } },
    ...overrides,
  };
  return { io, stdout, stderr };
}

describe('Phase 9: CLI end-to-end (final release gate)', () => {
  it('run executes the Rosetta Stone example to its golden output', () => {
    const capture = captureHosts({
      readFile: (): string => configJson,
      fetch: (): { status: number; body: string } => ({ status: 200, body: '{"status":"ok"}' }),
    });
    const { io, stderr } = fakeIo({
      env: { API_KEY: 'test-key' },
      guard: permissiveGuard(),
      hosts: capture.hosts,
    });
    const code = runCli(['run', rosettaPath], io);
    expect(code).toBe(0);
    expect(capture.stdout).toEqual(evalGolden.stdout);
    expect(capture.stderr).toEqual(evalGolden.stderr);
    expect(stderr.join('')).toBe('');
  });

  it('explain renders the Rosetta Stone manifest byte-for-byte to its golden', () => {
    const { io, stdout, stderr } = fakeIo();
    const code = runCli(['explain', rosettaPath], io);
    expect(code).toBe(0);
    expect(stdout.join('')).toBe(explainGolden);
    expect(stderr.join('')).toBe('');
  });

  it('renders a guard denial through the formatter with the call-site location', () => {
    const { io, stdout, stderr } = fakeIo();
    const code = runCli(['run', traversalPath], io);
    expect(code).toBe(1);
    expect(stdout.join('')).toBe('');
    const rendered = stderr.join('');
    expect(rendered).toContain(
      'error[E403_GUARD_PATH_TRAVERSAL]: Canonicalization of "/safe/../etc/passwd" (fsRead) resolves outside every granted capability.',
    );
    expect(rendered).toContain(`--> ${traversalPath}:3:15`);
    expect(rendered).toContain('let secrets = fs.readFile!("/safe/../etc/passwd")');
    expect(rendered).toContain('  = hint: ');
  });

  it('maps a missing script file to E601', () => {
    const missing = fileURLToPath(new URL('./__does-not-exist__.placitum', import.meta.url));
    const { io, stdout, stderr } = fakeIo();
    const code = runCli(['run', missing], io);
    expect(code).toBe(1);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toContain('error[E601_CLI_FILE_NOT_FOUND]');
    expect(stderr.join('')).toContain(missing);
  });

  it('maps an unknown command to E602', () => {
    const { io, stdout, stderr } = fakeIo();
    expect(runCli(['frobnicate'], io)).toBe(1);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toContain('error[E602_CLI_INVALID_FLAG]');
    expect(stderr.join('')).toContain('unknown command');
  });

  it('maps an unknown option to E602', () => {
    const { io, stderr } = fakeIo();
    expect(runCli(['run', '--bogus', rosettaPath], io)).toBe(1);
    expect(stderr.join('')).toContain('error[E602_CLI_INVALID_FLAG]');
    expect(stderr.join('')).toContain('unknown option');
  });

  it('maps a missing argument to E602', () => {
    const { io, stderr } = fakeIo();
    expect(runCli(['run'], io)).toBe(1);
    expect(stderr.join('')).toContain('error[E602_CLI_INVALID_FLAG]');
    expect(stderr.join('')).toContain('missing required argument');
  });

  it('maps excess arguments to E602', () => {
    const { io, stderr } = fakeIo();
    expect(runCli(['run', rosettaPath, 'extra'], io)).toBe(1);
    expect(stderr.join('')).toContain('error[E602_CLI_INVALID_FLAG]');
  });

  it('--version prints the version deterministically', () => {
    const { io, stdout, stderr } = fakeIo();
    expect(runCli(['--version'], io)).toBe(0);
    expect(stdout.join('')).toBe(`${VERSION}\n`);
    expect(stderr.join('')).toBe('');
  });

  it('--help is deterministic and lists both subcommands', () => {
    const first = fakeIo();
    const second = fakeIo();
    expect(runCli(['--help'], first.io)).toBe(0);
    expect(runCli(['--help'], second.io)).toBe(0);
    expect(first.stdout.join('')).toBe(second.stdout.join(''));
    expect(first.stdout.join('')).toContain('Usage: placitum');
    expect(first.stdout.join('')).toContain('run');
    expect(first.stdout.join('')).toContain('explain');
  });

  it('bare placitum prints the same help as --help', () => {
    const bare = fakeIo();
    const help = fakeIo();
    expect(runCli([], bare.io)).toBe(0);
    expect(runCli(['--help'], help.io)).toBe(0);
    expect(bare.stdout.join('')).toBe(help.stdout.join(''));
  });

  it('run --help and explain --help are deterministic', () => {
    for (const command of ['run', 'explain']) {
      const first = fakeIo();
      const second = fakeIo();
      expect(runCli([command, '--help'], first.io)).toBe(0);
      expect(runCli([command, '--help'], second.io)).toBe(0);
      expect(first.stdout.join('')).toBe(second.stdout.join(''));
      expect(first.stdout.join('')).toContain(`Usage: placitum ${command}`);
    }
  });

  it('package.json version matches the CLI VERSION constant', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(pkg.version).toBe(VERSION);
  });
});
