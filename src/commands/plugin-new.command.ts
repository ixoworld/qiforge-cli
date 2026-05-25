import * as p from '@clack/prompts';
import { existsSync } from 'fs';
import path from 'path';
import { Command } from '.';
import { CLIResult } from '../types';
import { parseCliFlags } from '../utils/cli-flags';
import { detectOracleProject, validatePluginName } from '../utils/project-detector';
import {
  renderTemplate,
  toCamelCase,
  toPascalCase,
} from '../utils/template-renderer';
import { getTemplatesDir } from '../utils/templates-dir';

/**
 * `qiforge plugin new <name>` — scaffolds a class-based plugin into
 * `<project>/src/plugins/<name>/` with a sample tool, three tests, and a
 * README stub. Run from inside an oracle project (auto-detected by walking
 * up for a package.json that depends on `@ixo/oracle-runtime`).
 */
export class PluginNewCommand implements Command {
  name = 'plugin-new';
  description = 'Scaffold a new plugin into the current oracle project';

  private async getName(initial?: string): Promise<string> {
    if (initial) {
      const err = validatePluginName(initial);
      if (err) throw new Error(err);
      return initial;
    }
    const input = await p.text({
      message: 'Plugin name (kebab-case):',
      placeholder: 'climate',
      validate(value) {
        return validatePluginName(String(value ?? ''));
      },
    });
    if (p.isCancel(input)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }
    return String(input);
  }

  async execute(): Promise<CLIResult> {
    try {
      const flags = parseCliFlags();

      // Positional argument: `qiforge plugin new climate`. Skip the command
      // tokens and any `--flag value` pairs.
      const argv = process.argv.slice(2);
      const positional = argv.find((a, i) => {
        if (a.startsWith('--')) return false;
        if (a === 'plugin' || a === 'new' || a === 'plugin-new') return false;
        // If preceded by a bare `--flag`, this is the flag's value, not a positional.
        const prev = argv[i - 1];
        if (prev && prev.startsWith('--') && !prev.includes('=')) return false;
        return true;
      });
      const candidateName = flags.name ?? positional;

      const cwd = flags.cwd ? path.resolve(flags.cwd) : process.cwd();
      const project = detectOracleProject(cwd);

      const name = await this.getName(candidateName);
      const validationError = validatePluginName(name);
      if (validationError) {
        return { success: false, error: validationError };
      }

      const targetDir = path.join(project.root, 'src', 'plugins', name);
      if (existsSync(targetDir)) {
        return {
          success: false,
          error: `Plugin directory already exists: ${targetDir}`,
        };
      }

      const templatesDir = getTemplatesDir(__dirname);
      const pluginTemplateDir = path.join(templatesDir, 'plugin');

      renderTemplate({
        sourceDir: pluginTemplateDir,
        targetDir,
        vars: {
          nameKebab: name,
          nameClass: toPascalCase(name),
          nameCamel: toCamelCase(name),
        },
      });

      const className = `${toPascalCase(name)}Plugin`;
      p.log.success(
        `\n✅ Plugin scaffolded at ${path.relative(process.cwd(), targetDir)}/\n\n` +
          `📝 Register it in src/main.ts:\n` +
          `   import { ${className} } from './plugins/${name}/${name}.plugin.js';\n\n` +
          `   await createOracleApp({\n` +
          `     config,\n` +
          `     plugins: [..., new ${className}()],\n` +
          `   });\n\n` +
          `🧪 Run tests: pnpm test src/plugins/${name}`,
      );

      return {
        success: true,
        data: `Plugin "${name}" scaffolded at "${targetDir}"`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}
