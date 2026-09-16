import { hostBindings } from '../../../src/host-bindings/index.js';
import type { HostBindings } from '../../../src/host-bindings/index.js';
import type { Guard, GuardRequest } from '../../../src/capability/guard.js';

// Phase 5 test doubles. captureHosts() keeps the real host bindings (so
// integration tests exercise real fs/fetch) and only intercepts the two
// writer entry points; individual tests override readFile/fetch for
// deterministic offline runs.

export interface Capture {
  hosts: HostBindings;
  stdout: string[];
  stderr: string[];
}

function withoutNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

export function captureHosts(overrides: Partial<HostBindings> = {}): Capture {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const hosts: HostBindings = {
    ...hostBindings,
    writeStdout: (text: string): void => {
      stdout.push(withoutNewline(text));
    },
    writeStderr: (text: string): void => {
      stderr.push(withoutNewline(text));
    },
    ...overrides,
  };
  return { hosts, stdout, stderr };
}

// The value an authorize() call is about: ambient text, URL, or path. Shared
// by the permissive stub and the chokepoint spies.
export function requestValue(req: GuardRequest): string {
  if (req.category === 'ambient-write') return req.text;
  return req.category === 'net' ? req.url : req.path;
}

// Authorizes everything and returns the value unchanged — for golden runs that
// must stay platform-independent (the real guard's realpath resolves /etc ->
// /private/etc on macOS). Real-guard tests live in chokepoint.test.ts.
export function permissiveGuard(): Guard {
  const guard: Guard = {
    authorize: (req: GuardRequest): string => requestValue(req),
    forScope: (): Guard => guard,
    requireEnv: (): void => undefined,
  };
  return guard;
}
