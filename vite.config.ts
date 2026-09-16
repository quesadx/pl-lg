import { configDefaults, defineConfig } from 'vitest/config';

// Default excludes plus direnv's flake cache, which contains full source
// snapshots of this repo's inputs — vitest must not execute their tests.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/.direnv/**'],
  },
});
