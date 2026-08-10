import { cancel, intro, isCancel, log, outro, select, spinner } from '@clack/prompts';
import process from 'node:process';
import { CommandRegistry } from './commands';
import { AgentCardCommand } from './commands/agent-card.command';
import { CreateComposioKeyCommand } from './commands/create-composio-key.command';
import { CreateEntityCommand } from './commands/create-entity-command';
import { CreateUserCommand } from './commands/create-user-command';
import { DashboardAccessCommand } from './commands/dashboard-access.command';
import { HelpCommand } from './commands/help.command';
import { LogoutCommand } from './commands/logout.commands';
import { NewCommand } from './commands/new.command';
import { OfflineLoginCommand } from './commands/offline-login.command';
import { PluginNewCommand } from './commands/plugin-new.command';
import { SetupEncryptionKeyCommand } from './commands/setup-encryption-key-command';
import { SignXLoginCommand } from './commands/signX.commands';
import { UpdateDomainCommand } from './commands/update-domain-command';
import { UpdateEntityCommand } from './commands/update-entity-command';
import { handleError } from './utils/errors';
import { RuntimeConfig } from './utils/runtime-config';
import { Wallet } from './utils/wallet';

class CLIManager {
  private registry: CommandRegistry;
  private config: RuntimeConfig;
  private wallet: Wallet;

  constructor() {
    this.registry = new CommandRegistry();
    this.config = RuntimeConfig.getInstance();
    this.wallet = new Wallet(this.config);
  }

  private registerCommands(): void {
    this.registry.register(new NewCommand(this.config, this.wallet));
    this.registry.register(new PluginNewCommand());
    this.registry.register(new CreateEntityCommand(this.wallet, this.config));
    this.registry.register(new UpdateEntityCommand(this.wallet, this.config));
    this.registry.register(new UpdateDomainCommand(this.wallet, this.config));
    this.registry.register(new SetupEncryptionKeyCommand(this.wallet, this.config));
    this.registry.register(new AgentCardCommand(this.wallet, this.config));
    this.registry.register(new DashboardAccessCommand(this.config));
    this.registry.register(new CreateUserCommand(this.wallet, this.config));
    this.registry.register(new CreateComposioKeyCommand(this.wallet));
    this.registry.register(new LogoutCommand(this.wallet));
    this.registry.register(new HelpCommand(this.registry));
  }

  private addFakeWallet() {
    // add fake wallet to the config
    this.wallet.setWallet({
      address: '0x0000000000000000000000000000000000000000',
      algo: 'secp',
      did: 'did:ixo:entity:1a76366f16570483cea72b111b27fd78',
      network: 'devnet',
      name: 'My oracle',
      pubKey:
        '0x0400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
      ledgered: false,
      matrix: {
        accessToken: '',
        userId: '0x0000000000000000000000000000000000000000',
        address: '',
        roomId: '',
      },
    });
  }
  private async showHelp(): Promise<void> {
    this.addFakeWallet();
    this.registerCommands();
    const helpCommand = new HelpCommand(this.registry);
    const result = await helpCommand.execute();
    if (result.success && result.data) {
      console.log(result.data);
    }
  }

  private async handleAuthentication(_login?: 'SignX' | 'offline'): Promise<void> {
    if (!this.wallet.checkWalletExists()) {
      const login =
        _login ??
        (await select({
          message: 'How would you like to authenticate?',
          options: [
            { value: 'signx', label: 'SignX Wallet (QR code with mobile app)' },
            { value: 'offline', label: 'Offline Wallet (local mnemonic)' },
            { value: 'exit', label: 'Exit' },
          ],
        }));

      if (isCancel(login)) {
        cancel('Operation cancelled.');
        process.exit(0);
      }

      switch (String(login)) {
        case 'signx': {
          const loginCommand = new SignXLoginCommand(this.wallet, this.config);
          const result = await loginCommand.execute();
          if (result.success) {
            log.success('Login successful');
          } else {
            log.error(`Login failed: ${result.error ?? 'unknown error'}`);
            process.exit(1);
          }
          return;
        }
        case 'offline': {
          const offlineCommand = new OfflineLoginCommand(this.config, this.wallet);
          const result = await offlineCommand.execute();
          if (result.success) {
            log.success('Login successful');
          } else {
            log.error(`Login failed: ${result.error ?? 'unknown error'}`);
            process.exit(1);
          }
          return;
        }
        case 'exit': {
          cancel('Operation cancelled.');
          process.exit(0);
          return;
        }
        default: {
          throw new Error(`Unknown command: ${login}`);
        }
      }
    }
  }

  private async executeCommand(commandName: string): Promise<void> {
    const command = this.registry.get(commandName);
    if (!command) {
      throw new Error(`Unknown command: ${commandName}`);
    }

    // Interactive commands manage their own UI lifecycle
    if (command.interactive) {
      const result = await command.execute();
      if (!result.success && result.error) {
        log.error(`${command.name} failed: ${result.error}`);
      }
      return;
    }

    const s = spinner();
    s.start(`Executing ${command.name}...`);

    const result = await command.execute();
    s.stop(`${command.name} completed`);

    if (result.success) {
      log.success(`${command.name} completed successfully!`);
      if (result.data) {
        log.info(JSON.stringify(result.data, null, 2));
      }
    } else {
      log.error(`${command.name} failed: ${result.error}`);
    }
  }

  private async interactiveMode(): Promise<void> {
    intro('qiforge-cli');

    await this.handleAuthentication();

    if (!this.wallet.checkWalletExists()) {
      log.error('No wallet loaded after authentication. Cannot continue.');
      process.exit(1);
    }

    if (this.wallet.wallet?.mode !== 'offline') {
      log.warn('Keep your IXO Mobile App open while running the CLI; So u do not interrupt the signX session');
    }
    this.registerCommands();

    const action = await select({
      message: `Welcome ${this.wallet.name}, what would you like to do?`,
      options: [...this.registry.getCommandOptions()],
      initialValue: 'new',
    });

    if (isCancel(action)) {
      cancel('Operation cancelled.');
      process.exit(0);
    }

    await this.executeCommand(String(action));
  }

  private async argumentMode(args: string[]): Promise<void> {
    const command = args[0];

    if (!command) {
      await this.interactiveMode();
      return;
    }

    // `qiforge new <name>` — scaffold a new oracle
    if (command === '--new' || command === 'new') {
      await this.handleAuthentication();
      this.registerCommands();
      await this.executeCommand('new');
      return;
    }

    // `qiforge plugin new <name>` — scaffold a plugin in the current project.
    // No authentication required: this is a pure filesystem operation.
    if (command === 'plugin' && args[1] === 'new') {
      this.registerCommands();
      await this.executeCommand('plugin-new');
      return;
    }

    if (command === '--chat' || command === 'chat') {
      await this.handleAuthentication();
      this.registerCommands();
      await this.executeCommand('chat');
      return;
    }

    // Handle version
    if (command === '--version' || command === '-v' || command === '--v') {
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      const { version } = require('../package.json') as { version: string };
      console.log(version);
      return;
    }

    // Handle help
    if (command === '--help' || command === '-h') {
      await this.showHelp();
      return;
    }

    // Login commands skip authentication (they ARE the authentication)
    if (command === 'offline-login') {
      await this.handleAuthentication('offline');
      this.registerCommands();
      return;
    }

    // All other commands require authentication first
    await this.handleAuthentication();
    this.registerCommands();
    await this.executeCommand(command);
  }

  async run(args: string[]): Promise<void> {
    try {
      // Remove the first two args (node path and script path)
      const userArgs = args.slice(2);

      if (userArgs.length === 0) {
        await this.interactiveMode();
      } else {
        await this.argumentMode(userArgs);
      }
    } catch (error) {
      handleError(error);
    }

    outro('Thanks for using qiforge-cli!');
    process.exit(0);
  }
}

// Handle uncaught errors
process.on('uncaughtException', handleError);
process.on('unhandledRejection', handleError);

// Start the CLI
const cli = new CLIManager();
void cli.run(process.argv);
