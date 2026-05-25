import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  detectOracleProject,
  RESERVED_PLUGIN_NAMES,
  validatePluginName,
} from '../utils/project-detector';

const TMP_ROOT = path.join(tmpdir(), `qiforge-cli-detector-${process.pid}`);

afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

function makeProject(layout: { hasRuntime: boolean; subdir?: string }): {
  root: string;
  startDir: string;
} {
  const root = path.join(TMP_ROOT, `proj-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'fake',
      dependencies: layout.hasRuntime
        ? { '@ixo/oracle-runtime': '^0.0.1' }
        : { lodash: '^4.0.0' },
    }),
  );

  const startDir = layout.subdir ? path.join(root, layout.subdir) : root;
  if (layout.subdir) mkdirSync(startDir, { recursive: true });
  return { root, startDir };
}

describe('detectOracleProject', () => {
  it('finds the project root when started at root', () => {
    const { root, startDir } = makeProject({ hasRuntime: true });
    const result = detectOracleProject(startDir);
    expect(result.root).toBe(root);
  });

  it('walks up from a nested directory', () => {
    const { root, startDir } = makeProject({
      hasRuntime: true,
      subdir: path.join('src', 'plugins', 'deep'),
    });
    const result = detectOracleProject(startDir);
    expect(result.root).toBe(root);
  });

  it('throws when no oracle project is found', () => {
    const { startDir } = makeProject({ hasRuntime: false });
    expect(() => detectOracleProject(startDir)).toThrow(/oracle project/);
  });
});

describe('validatePluginName', () => {
  it('accepts valid kebab-case names', () => {
    expect(validatePluginName('climate')).toBeUndefined();
    expect(validatePluginName('my-plugin')).toBeUndefined();
    expect(validatePluginName('x9')).toBeUndefined();
  });

  it('rejects names that collide with bundled plugins', () => {
    for (const reserved of RESERVED_PLUGIN_NAMES) {
      expect(validatePluginName(reserved)).toMatch(/collides/);
    }
  });

  it('rejects invalid casing or characters', () => {
    expect(validatePluginName('MyPlugin')).toMatch(/kebab-case/);
    expect(validatePluginName('my_plugin')).toMatch(/kebab-case/);
    expect(validatePluginName('1leading-digit')).toMatch(/kebab-case/);
    expect(validatePluginName('trailing-')).toMatch(/kebab-case/);
  });

  it('rejects empty / too short / too long', () => {
    expect(validatePluginName('')).toMatch(/required/);
    expect(validatePluginName('a')).toMatch(/2–40/);
    expect(validatePluginName('x'.repeat(41))).toMatch(/2–40/);
  });
});
