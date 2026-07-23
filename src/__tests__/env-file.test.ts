import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { upsertEnvVar } from '../utils/env-file';

const TMP_ROOT = path.join(tmpdir(), `qiforge-cli-env-file-${process.pid}`);

afterAll(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

function tmpEnvPath(): string {
  const dir = path.join(TMP_ROOT, `case-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return path.join(dir, '.env');
}

describe('upsertEnvVar', () => {
  it('creates the file when it does not exist', () => {
    const filePath = tmpEnvPath();
    upsertEnvVar(filePath, 'AGENT_CARD_PATH', './agent-card.json');
    expect(readFileSync(filePath, 'utf8')).toBe('AGENT_CARD_PATH=./agent-card.json\n');
  });

  it('appends the var when the file exists but lacks the key', () => {
    const filePath = tmpEnvPath();
    writeFileSync(filePath, 'NODE_ENV=development\nPORT=3000\n');
    upsertEnvVar(filePath, 'AGENT_CARD_PATH', './agent-card.json');
    const content = readFileSync(filePath, 'utf8');
    expect(content).toBe('NODE_ENV=development\nPORT=3000\nAGENT_CARD_PATH=./agent-card.json\n');
  });

  it('replaces an existing assignment in place, preserving other lines', () => {
    const filePath = tmpEnvPath();
    writeFileSync(
      filePath,
      'NODE_ENV=development\nAGENT_CARD_PATH=./old-card.json\nPORT=3000\n',
    );
    upsertEnvVar(filePath, 'AGENT_CARD_PATH', './agent-card.json');
    const content = readFileSync(filePath, 'utf8');
    expect(content).toBe(
      'NODE_ENV=development\nAGENT_CARD_PATH=./agent-card.json\nPORT=3000\n',
    );
  });

  it('quotes values containing whitespace', () => {
    const filePath = tmpEnvPath();
    upsertEnvVar(filePath, 'LANGSMITH_PROJECT', 'my oracle_devnet');
    expect(readFileSync(filePath, 'utf8')).toBe('LANGSMITH_PROJECT="my oracle_devnet"\n');
  });
});
