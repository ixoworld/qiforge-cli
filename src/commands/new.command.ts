import * as p from '@clack/prompts';
import { NETWORK } from '@ixo/signx-sdk/types/types/transact';
import { spawn } from 'child_process';
import { existsSync, readdirSync, rmSync } from 'fs';
import path from 'path';
import { Command } from '.';
import { CLIResult } from '../types';
import { AgentCard, saveAgentCardLocally } from '../utils/agent-card';
import { parseCliFlags } from '../utils/cli-flags';
import { checkRequiredURL } from '../utils/common';
import {
  imageContentType,
  SUPPORTED_IMAGE_EXTENSIONS,
  uploadImageToMatrix,
} from '../utils/matrix/upload-image';
import {
  buildProjectTemplateVars,
  CREDENTIALS_FILENAME,
  DEV_VARS_FILENAME,
  generateRateLimitNamespaceId,
  type OracleIdentityVars,
  placeholderIdentity,
  WRANGLER_CONFIG_TEMPLATES,
} from '../utils/oracle-project';
import { writeProvisionedProjectFiles } from '../utils/provisioned-project-files';
import { RuntimeConfig } from '../utils/runtime-config';
import { RUNTIME_PACKAGE, SCAFFOLD_VERSIONS } from '../utils/runtime-versions';
import { findTemplate, loadTemplateCatalog, type TemplateEntry } from '../utils/template-catalog';
import { renderTemplate, renderTemplateFile } from '../utils/template-renderer';
import { getTemplatesDir } from '../utils/templates-dir';
import { Wallet } from '../utils/wallet';
import { CreateEntityCommand } from './create-entity-command';

/**
 * `qiforge new <name>` — scaffolds a Cloudflare Workers oracle
 * (`@ixo/oracle-runtime-workers`) from the bundled code template (no git
 * clone), provisions its on-chain entity, DID (with the Ed25519 UCAN signing
 * key) and Matrix account, and writes the provisioned identity into the
 * project's wrangler configs and `.dev.vars`. Optionally runs `pnpm install`.
 *
 * `--skip-entity` scaffolds without provisioning (no login, nothing on chain
 * or Matrix): the wrangler configs then carry placeholder identity values.
 */
export class NewCommand implements Command {
  name = 'new';
  description = 'Scaffold a new oracle from a code template';

  constructor(private readonly config: RuntimeConfig, private readonly wallet: Wallet) {}

  private async getProjectInput(): Promise<{ projectPath: string; projectName: string }> {
    const input = await p.text({
      message: 'What is your oracle named?',
      placeholder: 'my-oracle',
      validate(value) {
        if (!value) return 'Oracle name is required';
        return undefined;
      },
    });

    if (p.isCancel(input)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }

    const inputStr = String(input);
    let projectPath: string;
    let projectName: string;

    if (inputStr.includes('/') || inputStr.includes('\\')) {
      projectPath = path.resolve(inputStr);
      projectName = path.basename(inputStr);
    } else {
      projectName = inputStr;
      projectPath = path.resolve(process.cwd(), projectName);
    }

    if (!isValidProjectName(projectName)) {
      const sanitized = sanitizeProjectName(projectName);
      p.note(`"${projectName}" is invalid. Using "${sanitized}" instead.`, 'Warning');
      projectName = sanitized;
      projectPath = path.join(path.dirname(projectPath), projectName);
    }

    return { projectPath, projectName };
  }

  private async getDescription(): Promise<string> {
    const description = await p.text({
      message: 'One-line description for your oracle:',
      placeholder: 'An oracle that does X for Y',
      defaultValue: 'An oracle built with QiForge.',
    });
    if (p.isCancel(description)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }
    return String(description) || 'An oracle built with QiForge.';
  }

  private async getOrg(): Promise<string> {
    const org = await p.text({
      message: 'Organization name:',
      placeholder: 'Your Org',
      defaultValue: 'IXO',
    });
    if (p.isCancel(org)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }
    return String(org) || 'IXO';
  }

  private async getAvatarUrl(name: string): Promise<string> {
    const fallback = `https://api.dicebear.com/8.x/bottts/svg?seed=${encodeURIComponent(name)}`;
    const answer = await p.text({
      message: 'Avatar — paste an image URL, or a path to a local image to upload (blank for a generated one):',
      placeholder: fallback,
      validate(value) {
        if (!value) return undefined; // blank → generated fallback
        if (isRemoteUrl(value)) return checkRequiredURL(value, 'Avatar must be a valid URL');
        // Treat anything else as a local path — must exist and be a supported image.
        const resolved = path.resolve(value);
        if (!existsSync(resolved)) return `No file at "${resolved}" (and it is not a URL)`;
        if (!imageContentType(resolved)) {
          return `Unsupported image type. Use one of: ${SUPPORTED_IMAGE_EXTENSIONS.join(', ')}`;
        }
        return undefined;
      },
    });
    if (p.isCancel(answer)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }

    const value = String(answer).trim();
    if (!value) return fallback;
    if (isRemoteUrl(value)) return value;

    // Local path → upload to Matrix (public media) using the logged-in user's
    // account, and use the returned public HTTP URL as the avatar.
    const resolved = path.resolve(value);
    const homeServerUrl = this.wallet.matrixHomeServer;
    if (!homeServerUrl) {
      p.log.warn('No Matrix account available to upload the image — using a generated avatar instead.');
      return fallback;
    }
    const s = p.spinner();
    s.start('Uploading avatar to Matrix…');
    try {
      const accessToken = await this.wallet.getFreshMatrixAccessToken();
      const uploadedUrl = await uploadImageToMatrix({ filePath: resolved, homeServerUrl, accessToken });
      s.stop(`Avatar uploaded: ${uploadedUrl}`);
      return uploadedUrl;
    } catch (err) {
      s.stop('Avatar upload failed');
      p.log.warn(
        `Could not upload the image (${err instanceof Error ? err.message : String(err)}). Using a generated avatar instead.`,
      );
      return fallback;
    }
  }

  private async getNetwork(): Promise<NETWORK> {
    const choice = await p.select({
      message: 'Which network is this oracle for?',
      options: [
        { value: 'devnet', label: 'Devnet', hint: 'default' },
        { value: 'testnet', label: 'Testnet' },
        { value: 'mainnet', label: 'Mainnet' },
      ],
      initialValue: 'devnet',
    });
    if (p.isCancel(choice)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }
    return choice as NETWORK;
  }

  private async confirmOverwrite(projectPath: string): Promise<boolean> {
    const answer = await p.confirm({
      message: `"${projectPath}" already exists and is non-empty. Overwrite?`,
      initialValue: false,
    });
    if (p.isCancel(answer)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }
    return Boolean(answer);
  }

  private async confirmInstall(): Promise<boolean> {
    const answer = await p.confirm({
      message: 'Install dependencies with pnpm now?',
      initialValue: true,
    });
    if (p.isCancel(answer)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }
    return Boolean(answer);
  }

  /**
   * Prompt for a template when more than one is available. Single-template
   * catalogs short-circuit silently so the basic-only setup is one prompt
   * lighter.
   */
  private async pickTemplate(catalog: TemplateEntry[]): Promise<TemplateEntry> {
    if (catalog.length === 1) return catalog[0]!;

    const choice = await p.select({
      message: 'Pick a template:',
      options: catalog.map((t) => ({
        value: t.name,
        label: t.name,
        hint: t.description,
      })),
      initialValue: 'basic',
    });
    if (p.isCancel(choice)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }
    return findTemplate(catalog, String(choice));
  }

  private runPnpmInstall(projectPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('pnpm', ['install'], {
        cwd: projectPath,
        stdio: 'inherit',
        shell: false,
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`pnpm install exited with code ${code}`));
      });
    });
  }

  async execute(): Promise<CLIResult> {
    try {
      const flags = parseCliFlags();
      const noInteractive = flags['no-interactive'] === 'true';

      const templatesDir = getTemplatesDir(__dirname);
      const catalog = loadTemplateCatalog(templatesDir);

      let projectPath: string;
      let projectName: string;
      let description: string;
      let org: string;
      let install: boolean;
      let template: TemplateEntry;
      // Scaffold only: no wallet, no chain, no Matrix. The CLI entry point
      // skips authentication for it too.
      const skipEntity = flags['skip-entity'] === 'true';

      if (noInteractive && flags.name) {
        projectName = flags.name;
        projectPath = flags.path ? path.resolve(flags.path) : path.resolve(process.cwd(), projectName);
        description = flags.description ?? 'An oracle built with QiForge.';
        org = flags.org ?? 'IXO';
        install = flags.install === 'true';
        template = findTemplate(catalog, flags.template ?? 'basic');

        if (!isValidProjectName(projectName)) {
          return { success: false, error: `Invalid project name: ${projectName}` };
        }
        if (existsSync(projectPath) && isDirNonEmpty(projectPath) && flags.force !== 'true') {
          return {
            success: false,
            error: `Directory "${projectPath}" already exists. Use --force to overwrite.`,
          };
        }

        const network = flags.network ?? 'devnet';
        if (!isNetwork(network)) {
          return { success: false, error: `Invalid --network "${network}" (devnet, testnet or mainnet)` };
        }
        this.config.addValue('network', network);
        this.config.addValue(
          'prefillLogo',
          flags.logo ?? `https://api.dicebear.com/8.x/bottts/svg?seed=${encodeURIComponent(projectName)}`
        );
      } else {
        const input = await this.getProjectInput();
        projectPath = input.projectPath;
        projectName = input.projectName;

        if (existsSync(projectPath) && isDirNonEmpty(projectPath)) {
          const ok = await this.confirmOverwrite(projectPath);
          if (!ok) return { success: false, data: 'Project creation cancelled' };
        }

        // --template flag wins; otherwise prompt (and skip the prompt when
        // the catalog has only one entry).
        template = flags.template ? findTemplate(catalog, flags.template) : await this.pickTemplate(catalog);

        description = await this.getDescription();
        org = await this.getOrg();
        // The avatar belongs to the entity and its Matrix account; a
        // scaffold-only run provisions neither.
        const avatarUrl = skipEntity
          ? `https://api.dicebear.com/8.x/bottts/svg?seed=${encodeURIComponent(projectName)}`
          : await this.getAvatarUrl(projectName);
        const chosenNetwork = await this.getNetwork();
        install = await this.confirmInstall();

        this.config.addValue('prefillLogo', avatarUrl);
        this.config.addValue('network', chosenNetwork);
      }

      this.config.addValue('projectPath', projectPath);
      this.config.addValue('projectName', projectName);
      // Pre-fill entity values from already-collected answers so create-entity
      // doesn't re-prompt for the same information.
      this.config.addValue('oracleName', projectName);
      this.config.addValue('prefillDescription', description);
      this.config.addValue('prefillOrgName', org);
      this.config.addValue('newCommandContext', 'true');

      // The runtime release this CLI version was verified with (see runtime-versions.ts).
      const versions = SCAFFOLD_VERSIONS;
      const network = (this.config.getValue('network') as NETWORK) ?? 'devnet';
      const templateDir = path.join(templatesDir, template.name);
      const rateLimitNamespaceId = generateRateLimitNamespaceId();
      const varsFor = (identity: OracleIdentityVars) =>
        buildProjectTemplateVars({
          projectName,
          oracleName: projectName,
          org,
          description,
          network,
          versions,
          identity,
          rateLimitNamespaceId,
        });

      const renderSpinner = p.spinner();
      renderSpinner.start(`Scaffolding project files (template: ${template.name})…`);
      try {
        if (existsSync(projectPath) && isDirNonEmpty(projectPath)) {
          rmSync(projectPath, { recursive: true, force: true });
        }
        // Identity placeholders first; provisioning re-renders the wrangler
        // configs with the real values below.
        renderTemplate({
          sourceDir: templateDir,
          targetDir: projectPath,
          vars: varsFor(placeholderIdentity(network)),
          overwrite: true,
        });
        renderSpinner.stop(`Project files written (${RUNTIME_PACKAGE}@${versions.runtimeVersion})`);
      } catch (err) {
        renderSpinner.stop('Failed to scaffold project files');
        throw err;
      }

      if (skipEntity) {
        p.log.warn(
          'Skipped provisioning (--skip-entity): wrangler.jsonc and wrangler.gateway.jsonc carry placeholder ' +
            'identity values, and there is no .dev.vars. Provision an oracle with `qiforge-cli new` ' +
            '(without --skip-entity) or fill in the ORACLE_* / MATRIX_* vars and .dev.vars yourself.',
        );
      }

      if (!skipEntity) {
        p.log.info('Provisioning oracle entity + Matrix account…');
        const entityCommand = new CreateEntityCommand(this.wallet, this.config);
        const entityResult = await entityCommand.execute();
        if (!entityResult.success) {
          p.log.error(`Failed to create oracle entity: ${entityResult.error ?? 'unknown error'}`);
          throw new Error(entityResult.error ?? 'Entity creation failed');
        }
        p.log.success('Oracle entity + Matrix account created');

        await writeProvisionedProjectFiles(this.config, this.wallet, (identity) => {
          const vars = varsFor(identity);
          for (const file of WRANGLER_CONFIG_TEMPLATES) {
            renderTemplateFile({ sourceFile: path.join(templateDir, file), targetDir: projectPath, vars });
          }
        });

        const publishedCard = this.config.getValue('agentCard') as AgentCard | undefined;
        if (publishedCard) {
          try {
            const cardPath = saveAgentCardLocally(projectPath, publishedCard);
            p.log.success(`Agent Card saved locally at ${cardPath}`);
          } catch (err) {
            // The card is already on-chain; a local-save miss is not fatal.
            p.log.warn(`Could not save a local Agent Card copy: ${(err as Error).message}`);
          }
        }
      }

      if (install) {
        const installSpinner = p.spinner();
        installSpinner.start('Running pnpm install…');
        try {
          await this.runPnpmInstall(projectPath);
          installSpinner.stop('Dependencies installed');
        } catch (err) {
          installSpinner.stop('pnpm install failed (continuing)');
          p.log.warn(`Install failed: ${(err as Error).message}. Run pnpm install manually.`);
        }
      }

      const relPath = path.relative(process.cwd(), projectPath) || projectName;

      p.log.success(
        `\n✅ Oracle "${projectName}" scaffolded at ${projectPath}\n` +
          `\n🚀 Next steps:\n` +
          `   cd ${relPath}\n` +
          (install ? '' : '   pnpm install\n') +
          (skipEntity
            ? `   cp .dev.vars.example ${DEV_VARS_FILENAME}   # then fill in the secrets\n`
            : `   # add your OPEN_ROUTER_API_KEY to ${DEV_VARS_FILENAME}\n`) +
          `   pnpm dev                          # wrangler dev, http://localhost:8787/health\n` +
          `\n☁️  Deploy (Cloudflare Workers Paid plan):\n` +
          `   pnpm exec wrangler login\n` +
          `   pnpm run deploy                   # gateway script, then oracle script\n` +
          `   # upload the secrets: see .dev.vars.example\n` +
          `   qiforge-cli update-oracle-api-url # point the entity at the deployed URL\n` +
          (skipEntity ? '' : `\n🔐 Back up ${CREDENTIALS_FILENAME}: it holds the oracle's wallet mnemonic.\n`),
      );

      return {
        success: true,
        data: `Oracle "${projectName}" created at "${projectPath}"`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }
}

/** True for values that are already hosted URLs (http/https/mxc) — anything
 *  else the avatar prompt treats as a local file path to upload. */
function isRemoteUrl(value: string): boolean {
  return /^(https?:\/\/|mxc:\/\/)/i.test(value.trim());
}

function isNetwork(value: string): value is NETWORK {
  return value === 'devnet' || value === 'testnet' || value === 'mainnet';
}

function isValidProjectName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9-_]*$/.test(name) && name.length > 0 && name.length <= 50;
}

function sanitizeProjectName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .substring(0, 50);
}

function isDirNonEmpty(dir: string): boolean {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}
