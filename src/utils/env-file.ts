import { existsSync, readFileSync, writeFileSync } from 'fs';

/**
 * Sets `KEY=value` in a .env file: replaces an existing assignment for the
 * same key in place, or appends a new line. Creates the file if missing.
 * Every other line is left untouched — this patches one var, it does not
 * regenerate the file (see `createProjectEnvFile` for that).
 */
export function upsertEnvVar(filePath: string, key: string, value: string): void {
  const line = `${key}=${/\s/.test(value) ? `"${value}"` : value}`;

  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${line}\n`);
    return;
  }

  const content = readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const pattern = new RegExp(`^${key}=`);
  const index = lines.findIndex((l) => pattern.test(l.trim()));

  if (index === -1) {
    const trimmed = content.replace(/\n+$/, '');
    writeFileSync(filePath, trimmed ? `${trimmed}\n${line}\n` : `${line}\n`);
  } else {
    lines[index] = line;
    writeFileSync(filePath, lines.join('\n'));
  }
}
