import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { renderTemplate, toCamelCase, toPascalCase } from '../utils/template-renderer';

/**
 * Smokes the actual bundled templates by rendering them into a tmpdir and
 * sanity-checking the output. Catches missing placeholders / broken syntax
 * without booting a full project.
 */
describe('basic template', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'qiforge-cli-basic-'));

  afterAll(() => {
    rmSync(target, { recursive: true, force: true });
  });

  it('renders the full basic template without errors', () => {
    const sourceDir = path.resolve(__dirname, '..', 'templates', 'basic');
    renderTemplate({
      sourceDir,
      targetDir: target,
      vars: {
        name: 'demo-oracle',
        org: 'Acme',
        description: 'Demo oracle for tests.',
        network: 'devnet',
        runtimeVersion: '^0.0.1',
      },
      overwrite: true,
    });

    // Files expected at the project root.
    for (const file of [
      'package.json',
      'tsconfig.json',
      'tsconfig.build.json',
      'vitest.config.ts',
      '.env.example',
      '.gitignore',
      'README.md',
      'CLAUDE.md',
      'src/main.ts',
      'src/config.ts',
      '.claude/skills/qiforge-oracle/SKILL.md',
      '.claude/skills/qiforge-oracle/references/plugin-anatomy.md',
      '.claude/skills/qiforge-oracle/references/add-a-plugin.md',
      '.claude/skills/qiforge-oracle/references/add-a-tool.md',
      '.claude/skills/qiforge-oracle/references/env-vars.md',
      '.claude/skills/qiforge-oracle/references/bundled-plugins.md',
      '.claude/skills/qiforge-oracle/references/testing.md',
    ]) {
      expect(existsSync(path.join(target, file))).toBe(true);
    }

    // Substitution actually happened.
    const pkg = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8')) as {
      name: string;
      dependencies: Record<string, string>;
    };
    expect(pkg.name).toBe('demo-oracle');
    expect(pkg.dependencies['@ixo/oracle-runtime']).toBe('^0.0.1');

    const config = readFileSync(path.join(target, 'src/config.ts'), 'utf8');
    expect(config).toContain("name: 'demo-oracle'");
    expect(config).toContain("org: 'Acme'");
    expect(config).toContain('Demo oracle for tests.');

    // CLAUDE.md gets project-specific substitutions, references stay literal.
    const claudeMd = readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('# demo-oracle');
    expect(claudeMd).toContain('Acme');
    expect(claudeMd).toContain('Demo oracle for tests.');
    expect(claudeMd).toContain('.claude/skills/qiforge-oracle/SKILL.md');

    // SKILL.md has the required frontmatter for Claude Code discovery.
    const skillMd = readFileSync(
      path.join(target, '.claude/skills/qiforge-oracle/SKILL.md'),
      'utf8',
    );
    expect(skillMd).toMatch(/^---\s*\nname: qiforge-oracle/m);
    expect(skillMd).toContain('description:');

    // No unrendered {{placeholders}} left anywhere.
    const allFiles = walk(target);
    for (const file of allFiles) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(/\{\{\w+\}\}/);
    }
  });
});

describe('plugin template', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'qiforge-cli-plugin-'));

  afterAll(() => {
    rmSync(target, { recursive: true, force: true });
  });

  it('renders the plugin template with all placeholders substituted', () => {
    const sourceDir = path.resolve(__dirname, '..', 'templates', 'plugin');
    const name = 'climate';
    renderTemplate({
      sourceDir,
      targetDir: target,
      vars: {
        nameKebab: name,
        nameClass: toPascalCase(name),
        nameCamel: toCamelCase(name),
      },
      overwrite: true,
    });

    expect(existsSync(path.join(target, 'climate.plugin.ts'))).toBe(true);
    expect(existsSync(path.join(target, 'climate.plugin.test.ts'))).toBe(true);
    expect(existsSync(path.join(target, 'README-climate.md'))).toBe(true);
    expect(existsSync(path.join(target, 'fixtures'))).toBe(true);

    const plugin = readFileSync(path.join(target, 'climate.plugin.ts'), 'utf8');
    expect(plugin).toContain('export class ClimatePlugin');
    expect(plugin).toContain("name: 'climate_echo'");

    const test = readFileSync(path.join(target, 'climate.plugin.test.ts'), 'utf8');
    expect(test).toContain('new ClimatePlugin()');
    expect(test).toContain("invokeTool('climate_echo'");

    // Nothing left unrendered.
    for (const file of walk(target)) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(/\{\{\w+\}\}/);
    }
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
