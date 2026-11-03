import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import path from 'path';

const DIST_DIR = path.resolve(__dirname, '../../dist');
const CLI_JS = path.join(DIST_DIR, 'cli.js');

describe('build output', () => {
  beforeAll(() => {
    // Ensure a fresh build exists
    execSync('pnpm build', { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });
  });

  it('produces dist/cli.js', () => {
    expect(existsSync(CLI_JS)).toBe(true);
  });

  it('has a shebang line', () => {
    const content = readFileSync(CLI_JS, 'utf-8');
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('includes createRequire shim for CJS interop', () => {
    const head = readFileSync(CLI_JS, 'utf-8').slice(0, 500);
    expect(head).toContain('createRequire');
  });

  it('includes __dirname shim for ESM compatibility', () => {
    const head = readFileSync(CLI_JS, 'utf-8').slice(0, 500);
    expect(head).toContain('import.meta.dirname');
  });

  it('does not bundle @matrix-org/matrix-sdk-crypto-wasm (kept external)', () => {
    const content = readFileSync(CLI_JS, 'utf-8');
    expect(content).not.toContain('matrix_sdk_crypto_wasm_bg');
  });

  it('bundles @ixo/impactxclient-sdk (not left external)', () => {
    const content = readFileSync(CLI_JS, 'utf-8');
    // The SDK's codegen module should be inlined in the bundle
    expect(content).toContain('MsgCreateEntity');
  });

  it('runs --help without errors and without writing a wallet', () => {
    // A throwaway HOME: the CLI keeps its login in ~/.wallet.json, and --help
    // once overwrote it with a fake wallet. It must not touch it at all.
    const home = mkdtempSync(path.join(tmpdir(), 'qiforge-cli-home-'));
    try {
      const result = execSync(`node ${CLI_JS} --help`, {
        encoding: 'utf-8',
        timeout: 15000,
        env: { ...process.env, HOME: home, NODE_NO_WARNINGS: '1' },
      });
      expect(result).toContain('QiForge CLI');
      expect(result).toContain('USAGE');
      expect(existsSync(path.join(home, '.wallet.json'))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
