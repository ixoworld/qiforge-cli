import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  buildProjectTemplateVars,
  type OracleIdentityVars,
  placeholderIdentity,
  WRANGLER_CONFIG_TEMPLATES,
} from '../utils/oracle-project';
import { FALLBACK_SCAFFOLD_VERSIONS } from '../utils/runtime-versions';
import { renderTemplate, renderTemplateFile, toCamelCase, toPascalCase } from '../utils/template-renderer';

/** wrangler's JSONC: strip comments and trailing commas, then JSON.parse. */
function parseJsonc(text: string): Record<string, unknown> {
  const withoutComments = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str: string | undefined) => str ?? '');
  return JSON.parse(withoutComments.replace(/,(\s*[}\]])/g, '$1')) as Record<string, unknown>;
}

const TEMPLATE_DIR = path.resolve(__dirname, '..', 'templates', 'basic');

function projectVars(identity: OracleIdentityVars) {
  return buildProjectTemplateVars({
    projectName: 'demo-oracle',
    oracleName: 'demo-oracle',
    org: 'Acme',
    description: 'Demo oracle\'s "quoted" description.',
    network: 'devnet',
    versions: FALLBACK_SCAFFOLD_VERSIONS,
    identity,
    rateLimitNamespaceId: '424242',
  });
}

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
    renderTemplate({
      sourceDir: TEMPLATE_DIR,
      targetDir: target,
      vars: projectVars(placeholderIdentity('devnet')),
      overwrite: true,
    });

    // Files expected at the project root.
    for (const file of [
      'package.json',
      'pnpm-workspace.yaml',
      'tsconfig.json',
      'vitest.config.ts',
      'wrangler.jsonc',
      'wrangler.gateway.jsonc',
      '.dev.vars.example',
      '.gitignore',
      'README.md',
      'CLAUDE.md',
      'src/index.ts',
      'src/gateway.ts',
      'src/config.ts',
      'src/config.test.ts',
      'test/wrangler.test.jsonc',
      'test/worker.ts',
      '.claude/skills/qiforge-oracle/SKILL.md',
      '.claude/skills/qiforge-oracle/references/plugin-anatomy.md',
      '.claude/skills/qiforge-oracle/references/add-a-plugin.md',
      '.claude/skills/qiforge-oracle/references/add-a-tool.md',
      '.claude/skills/qiforge-oracle/references/env-vars.md',
      '.claude/skills/qiforge-oracle/references/bundled-plugins.md',
      '.claude/skills/qiforge-oracle/references/testing.md',
      '.claude/skills/qiforge-oracle/references/deploy.md',
    ]) {
      expect(existsSync(path.join(target, file))).toBe(true);
    }
    // No Node-runtime leftovers, and the renamed ignore file is in place.
    for (const file of ['src/main.ts', '.env.example', 'tsconfig.build.json', '_gitignore']) {
      expect(existsSync(path.join(target, file))).toBe(false);
    }
    expect(readFileSync(path.join(target, '.gitignore'), 'utf8')).toMatch(/^\.dev\.vars$/m);
    expect(readFileSync(path.join(target, '.gitignore'), 'utf8')).toMatch(/^oracle-credentials\.env$/m);

    // package.json: the Workers runtime, pinned with its matching bot SDK.
    const pkg = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8')) as {
      name: string;
      description: string;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.name).toBe('demo-oracle');
    expect(pkg.description).toBe('Demo oracle\'s "quoted" description.');
    expect(pkg.dependencies['@ixo/oracle-runtime-workers']).toBe(FALLBACK_SCAFFOLD_VERSIONS.runtimeVersion);
    expect(pkg.dependencies['@ixo/matrix-bot-workers-sdk']).toBe(FALLBACK_SCAFFOLD_VERSIONS.botSdkVersion);
    expect(pkg.dependencies['@ixo/oracle-runtime']).toBeUndefined();
    expect(pkg.devDependencies.wrangler).toBe(FALLBACK_SCAFFOLD_VERSIONS.wranglerVersion);
    expect(pkg.scripts.dev).toMatch(/^wrangler dev /);
    expect(pkg.scripts.deploy).toBe('wrangler deploy -c wrangler.gateway.jsonc && wrangler deploy -c wrangler.jsonc');

    // src/index.ts uses createOracleWorker and exports both Durable Objects.
    const index = readFileSync(path.join(target, 'src/index.ts'), 'utf8');
    expect(index).toContain('createOracleWorker');
    expect(index).toContain('export const { UserOracleDO, MatrixGatewayDO } = oracle;');

    // config.ts carries the identity as valid string literals.
    const config = readFileSync(path.join(target, 'src/config.ts'), 'utf8');
    expect(config).toContain('const name = "demo-oracle";');
    expect(config).toContain('const org = "Acme";');
    expect(config).toContain('const description = "Demo oracle\'s \\"quoted\\" description.";');

    // CLAUDE.md gets project-specific substitutions, references stay literal.
    const claudeMd = readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('# demo-oracle');
    expect(claudeMd).toContain('Acme');
    expect(claudeMd).toContain('.claude/skills/qiforge-oracle/SKILL.md');

    // SKILL.md has the required frontmatter for Claude Code discovery.
    const skillMd = readFileSync(path.join(target, '.claude/skills/qiforge-oracle/SKILL.md'), 'utf8');
    expect(skillMd).toMatch(/^---\s*\nname: qiforge-oracle/m);
    expect(skillMd).toContain('description:');
    expect(skillMd).not.toContain('createOracleApp');

    // No unrendered {{placeholders}} left anywhere.
    for (const file of walk(target)) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/\{\{\w+\}\}/);
    }
  });

  it('writes wrangler configs with minify, nodejs_compat, aliases and the split Durable Objects', () => {
    const oracle = parseJsonc(readFileSync(path.join(target, 'wrangler.jsonc'), 'utf8'));
    const gateway = parseJsonc(readFileSync(path.join(target, 'wrangler.gateway.jsonc'), 'utf8'));

    for (const config of [oracle, gateway]) {
      expect(config.minify).toBe(true);
      expect(config.keep_names).toBeUndefined();
      expect(config.compatibility_flags).toEqual(['nodejs_compat']);
      expect(config.limits).toEqual({ cpu_ms: 300000 });
      expect((config.alias as Record<string, string>)['@matrix-org/matrix-sdk-crypto-wasm']).toBe(
        '@ixo/matrix-bot-workers-sdk/crypto-wasm-shim',
      );
    }
    expect((oracle.alias as Record<string, string>).jsdom).toBe(
      './node_modules/@ixo/oracle-runtime-workers/src/plugins/editor/jsdom-shim.ts',
    );

    expect(oracle.name).toBe('demo-oracle');
    expect(oracle.main).toBe('src/index.ts');
    expect(oracle.durable_objects).toEqual({
      bindings: [
        { name: 'USER_ORACLE', class_name: 'UserOracleDO' },
        { name: 'MATRIX_GATEWAY', class_name: 'MatrixGatewayDO', script_name: 'demo-oracle-gateway' },
      ],
    });
    expect(oracle.migrations).toEqual([{ tag: 'v1', new_sqlite_classes: ['UserOracleDO'] }]);
    expect(oracle.ratelimits).toEqual([
      { name: 'RATE_LIMIT', namespace_id: '424242', simple: { limit: 100, period: 60 } },
    ]);

    expect(gateway.name).toBe('demo-oracle-gateway');
    expect(gateway.main).toBe('src/gateway.ts');
    expect(gateway.workers_dev).toBe(false);
    expect(gateway.triggers).toEqual({ crons: ['*/5 * * * *'] });
    expect(gateway.durable_objects).toEqual({
      bindings: [
        { name: 'MATRIX_GATEWAY', class_name: 'MatrixGatewayDO' },
        { name: 'USER_ORACLE', class_name: 'UserOracleDO', script_name: 'demo-oracle' },
      ],
    });
    expect(gateway.migrations).toEqual([{ tag: 'v1', new_sqlite_classes: ['MatrixGatewayDO'] }]);

    const vars = oracle.vars as Record<string, string>;
    expect(vars.NETWORK).toBe('devnet');
    expect(vars.FIRECRAWL_MCP_URL).toBe('https://mcp-firecrawl.ixo.earth/v2/mcp');
    expect(vars.DOMAIN_INDEXER_URL).toBe('https://domain-indexer.devnet.ixo.earth');
    expect(vars.ORACLE_DEBUG_ROUTES).toBe('false');
  });

  it('re-renders the wrangler configs with a provisioned identity', () => {
    const identity: OracleIdentityVars = {
      oracleDid: 'did:ixo:ixo1abcdefghijklmnopqrstuvwxyz0123456789ab',
      entityDid: 'did:ixo:entity:0123456789abcdef0123456789abcdef',
      matrixBaseUrl: 'https://devmx.ixo.earth',
      matrixUserId: '@did-ixo-ixo1abc:devmx.ixo.earth',
      matrixRoomId: '!room:devmx.ixo.earth',
    };
    for (const file of WRANGLER_CONFIG_TEMPLATES) {
      renderTemplateFile({ sourceFile: path.join(TEMPLATE_DIR, file), targetDir: target, vars: projectVars(identity) });
    }
    for (const file of ['wrangler.jsonc', 'wrangler.gateway.jsonc']) {
      const vars = parseJsonc(readFileSync(path.join(target, file), 'utf8')).vars as Record<string, string>;
      expect(vars.ORACLE_DID).toBe(identity.oracleDid);
      expect(vars.ORACLE_ENTITY_DID).toBe(identity.entityDid);
      expect(vars.MATRIX_ORACLE_ADMIN_USER_ID).toBe(identity.matrixUserId);
      expect(vars.MATRIX_ACCOUNT_ROOM_ID).toBe(identity.matrixRoomId);
      expect(vars.MATRIX_HOMESERVER_NAME).toBe('devmx.ixo.earth');
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
        nameSnake: name.replace(/-/g, '_'),
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
    expect(plugin).toContain("from '@ixo/oracle-runtime-workers'");
    expect(plugin).not.toContain("'@ixo/oracle-runtime'");

    const test = readFileSync(path.join(target, 'climate.plugin.test.ts'), 'utf8');
    expect(test).toContain('new ClimatePlugin()');
    expect(test).toContain("['climate_echo']");

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
