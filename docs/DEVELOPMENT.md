# QiForge CLI - Development Guide

This guide explains how to develop and extend the QiForge CLI, including how to create new commands and understand the existing architecture.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Command System](#command-system)
- [Creating New Commands](#creating-new-commands)
- [Available Utilities](#available-utilities)
- [Testing Commands](#testing-commands)
- [Best Practices](#best-practices)

## Architecture Overview

The CLI is built with a modular command system using TypeScript. Here's the high-level structure:

```
src/
├── cli.ts                    # Main CLI entry point (CLIManager)
├── commands/                 # Command implementations
│   ├── index.ts             # Command interface and registry
│   ├── new.command.ts       # Provision an oracle + scaffold its Workers project
│   ├── plugin-new.command.ts  # Scaffold a plugin into an oracle project
│   ├── create-entity-command.ts  # Blockchain entity creation
│   ├── setup-signing-key.command.ts  # Ed25519 UCAN signing key for older oracles
│   ├── offline-login.command.ts  # Offline wallet authentication
│   ├── signX.commands.ts    # SignX authentication
│   └── logout.commands.ts   # Logout functionality
├── templates/               # basic (Workers oracle) and plugin templates
├── types/                   # TypeScript interfaces
│   └── index.ts
├── utils/                   # Shared utilities
│   ├── wallet.ts           # Wallet management
│   ├── runtime-config.ts   # Configuration management
│   ├── oracle-project.ts   # Scaffold template vars, .dev.vars, oracle-credentials.env
│   ├── runtime-versions.ts # The pinned runtime release and its companion versions
│   ├── cli-flags.ts        # CLI flag parser (--key value)
│   ├── errors.ts           # Error handling
│   └── ...                 # Other utilities
└── __tests__/              # Tests
```

## Command System

### Command Interface

All commands must implement the `Command` interface:

```typescript
export interface Command {
  name: string; // Command identifier
  description: string; // Command description for help
  execute: (...args: any[]) => Promise<CLIResult>;
}
```

### Command Registry

The `CommandRegistry` manages all available commands:

```typescript
export class CommandRegistry {
  private commands: Map<string, Command>;

  register(command: Command): void; // Register a new command
  get(name: string): Command | undefined; // Get command by name
  getAll(): Command[]; // Get all commands
  getCommandOptions(): Array<{ value: string; label: string; hint: string }>;
}
```

### CLI Result

All commands return a `CLIResult`:

```typescript
export interface CLIResult {
  success: boolean; // Whether the command succeeded
  data?: any; // Optional result data
  error?: string; // Error message if failed
}
```

## Creating New Commands

### Step 1: Create Command File

Create a new file in `src/commands/` following the naming convention:

- `your-command.command.ts` for main commands
- `your-command.commands.ts` for utility commands

### Step 2: Implement Command Interface

```typescript
import { CLIResult } from '../types';
import { Command } from './index';
import { Wallet } from '../utils/wallet';
import { RuntimeConfig } from '../utils/runtime-config';

export class YourCommand implements Command {
  name = 'your-command';
  description = 'Description of what your command does';

  constructor(private wallet: Wallet, private config: RuntimeConfig) {}

  async execute(): Promise<CLIResult> {
    try {
      // Your command logic here

      return {
        success: true,
        data: { message: 'Command executed successfully' },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
```

### Step 3: Register Command

Add your command to the registry in `src/cli.ts`:

```typescript
import { YourCommand } from './commands/your-command.command';

// In the main function:
const registry = new CommandRegistry();
registry.register(new YourCommand(wallet, config));
```

### Step 4: Add User Prompts (Optional)

Use `@clack/prompts` for interactive prompts:

```typescript
import { text, select, confirm, spinner } from '@clack/prompts';

async execute(): Promise<CLIResult> {
  // Text input
  const name = await text({
    message: 'Enter your name:',
    placeholder: 'John Doe'
  });

  // Selection
  const option = await select({
    message: 'Choose an option:',
    options: [
      { value: 'option1', label: 'Option 1' },
      { value: 'option2', label: 'Option 2' }
    ]
  });

  // Confirmation
  const confirmed = await confirm({
    message: 'Are you sure?',
    initialValue: false
  });

  // Loading spinner
  const s = spinner();
  s.start('Processing...');
  // ... your logic
  s.stop('Completed!');
}
```

## Available Utilities

### Wallet Management

```typescript
import { Wallet } from '../utils/wallet';

// Access wallet properties
const address = wallet.address;
const did = wallet.did;
const name = wallet.name;

// Check if wallet exists
if (wallet.checkWalletExists()) {
  // Wallet is available
}

// Clear wallet (logout)
await wallet.clearWallet();
```

### Runtime Configuration

```typescript
import { RuntimeConfig } from '../utils/runtime-config';

const config = RuntimeConfig.getInstance();

// Set configuration values
config.addValue('projectPath', '/path/to/project');
config.addValue('projectName', 'my-oracle');

// Get configuration values
const projectPath = config.getValue('projectPath');
const projectName = config.getOrThrow('projectName'); // Throws if not set
```

### Error Handling

```typescript
import { handleError } from '../utils/errors';

try {
  // Your code
} catch (error) {
  handleError(error);
}
```

### Common Utilities

```typescript
import { selectNetwork, checkRequiredString, checkRequiredNumber, PORTAL_URL } from '../utils/common';

// Network selection
const network = await selectNetwork(config);

// Validation
const error = checkRequiredString(value, 'Field is required');
const error = checkRequiredNumber(parseInt(value), 'Must be a number');
```

## Existing Commands Reference

### 1. NewCommand (`new.command.ts`)

- **Purpose**: Provisions an oracle and scaffolds its Cloudflare Workers project
- **Dependencies**: `RuntimeConfig`, `Wallet`, `CreateEntityCommand`, `parseCliFlags`
- **Key Features**:
  - Renders `src/templates/basic` with `SCAFFOLD_VERSIONS`: one exact `@ixo/oracle-runtime-workers` release and the companion versions from its npm manifest
  - Entity, DID (with the Ed25519 UCAN signing key) and Matrix account (delegates to `CreateEntityCommand`)
  - Re-renders `wrangler.jsonc` / `wrangler.gateway.jsonc` with the provisioned identity; writes `.dev.vars` and `oracle-credentials.env`
  - `--skip-entity`: scaffold only, no login
  - Full non-interactive mode via `--no-interactive` with `--name`, `--path`, `--network`, `--pin`, `--install`, `--force`

### 2. CreateEntityCommand (`create-entity-command.ts`)

- **Purpose**: Creates blockchain entities with linked resources
- **Dependencies**: `Wallet`, `RuntimeConfig`, `CreateEntity` utility, `parseCliFlags`
- **Key Features**:
  - Oracle profile, domain card, Agent Card, AuthZ config, P-256 encryption key
  - The oracle's own DID with its Ed25519 UCAN signing key, and its Matrix account and account room
  - Relayer node selection
  - Full non-interactive mode via `--no-interactive` with CLI flags

### 3. OfflineLoginCommand (`offline-login.command.ts`)

- **Purpose**: Login with a local mnemonic (offline wallet mode)
- **Dependencies**: `RuntimeConfig`, `Wallet`, `parseCliFlags`
- **Key Features**:
  - Derives wallet from mnemonic via `getSecpClient()`
  - Authenticates Matrix via `mxLoginRaw()`
  - Auto-detects display name from Matrix profile
  - Supports CLI flags for non-interactive use: `--network`, `--mnemonic`, `--matrixPassword`, `--name`

### 4. SignXLoginCommand (`signX.commands.ts`)

- **Purpose**: Handles SignX authentication
- **Dependencies**: `Wallet`, `RuntimeConfig`, `SignXClient`
- **Key Features**:
  - QR code display
  - Mobile app integration
  - Wallet storage

### 5. LogoutCommand (`logout.commands.ts`)

- **Purpose**: Handles user logout
- **Dependencies**: `Wallet`
- **Key Features**:
  - Confirmation prompt
  - Wallet clearing

## CLI Flag Parser

The `parseCliFlags()` utility (`src/utils/cli-flags.ts`) extracts flags from `process.argv`. Supports:

- `--flag value` (space-separated)
- `--flag=value` (equals-separated)
- `--boolean-flag` (sets to `"true"`)

Commands use this to support non-interactive mode. Pattern:

```typescript
import { parseCliFlags } from '../utils/cli-flags';

const flags = parseCliFlags();
const noInteractive = flags['no-interactive'] === 'true';

// Use flag value or fall back to interactive prompt
const name = flags.name ?? await p.text({ message: 'Enter name:' });
```

## Scaffold templates

`src/templates/basic` is the Workers oracle template, `src/templates/plugin` the plugin template; `build.mjs` copies both to `dist/templates`.

- Files ending in `.tmpl` get `{{placeholder}}` substitution (an unknown placeholder throws); other files are copied as they are. Template `.ts` files always end in `.tmpl` so the CLI's own `tsc`, jest and eslint skip them.
- `_gitignore` is written as `.gitignore`: npm never publishes a file named `.gitignore`.
- `src/__tests__/templates.test.ts` renders both templates and checks the output. To prove a template change end to end, scaffold into a temp dir and run the project's own checks:

```bash
pnpm build
node dist/cli.js new --no-interactive --name demo --path /tmp/demo --skip-entity
cd /tmp/demo && pnpm install && pnpm typecheck && pnpm test && pnpm run build && pnpm dev
```

### Moving the scaffold to a new runtime release

The template pins one exact `@ixo/oracle-runtime-workers` release (`SCAFFOLD_VERSIONS` in `src/utils/runtime-versions.ts`), never npm `latest`: a bad release can sit on `latest` (0.36.0 shipped a change 0.36.1 reverted).

1. Read the runtime's CHANGELOG from the pinned version up for new bindings, migrations, aliases or required vars, and update the wrangler templates and the bundled skill.
2. `npm view @ixo/oracle-runtime-workers@<version> --json`: copy `version`, the bot SDK and `zod` from `dependencies` and `wrangler`, `@cloudflare/workers-types` and `vitest` from `devDependencies` into `SCAFFOLD_VERSIONS` and into the manifest fixture of `src/__tests__/runtime-versions.test.ts`.
3. Run the end-to-end check above under a throwaway `HOME` (the CLI keeps its login in `~/.wallet.json`), including `pnpm run build` and `pnpm dev` with `/health`, and check the minified oracle bundle holds one copy of yjs and no character above U+00FF:

```bash
grep -c "Yjs was already imported" dist/oracle/index.js    # 1
node -e "const s=require('fs').readFileSync('dist/oracle/index.js','utf8');console.log((s.match(/[^\u0000-\u00ff]/g)||[]).length)"   # 0
```

## Testing Commands

### Unit Testing

Create tests in `src/__tests__/`:

```typescript
import { YourCommand } from '../commands/your-command.command';
import { Wallet } from '../utils/wallet';
import { RuntimeConfig } from '../utils/runtime-config';

describe('YourCommand', () => {
  let command: YourCommand;
  let wallet: Wallet;
  let config: RuntimeConfig;

  beforeEach(() => {
    wallet = new Wallet();
    config = RuntimeConfig.getInstance();
    command = new YourCommand(wallet, config);
  });

  it('should execute successfully', async () => {
    const result = await command.execute();
    expect(result.success).toBe(true);
  });
});
```

### Integration Testing

Test command registration and execution:

```typescript
import { CommandRegistry } from '../commands';
import { YourCommand } from '../commands/your-command.command';

describe('Command Registry', () => {
  it('should register and execute commands', async () => {
    const registry = new CommandRegistry();
    const command = new YourCommand(wallet, config);

    registry.register(command);
    const retrieved = registry.get('your-command');

    expect(retrieved).toBe(command);
  });
});
```

## Best Practices

### 1. Error Handling

- Always wrap command logic in try-catch
- Return meaningful error messages
- Use the `handleError` utility for uncaught errors

### 2. User Experience

- Provide clear prompts and messages
- Use spinners for long-running operations
- Give helpful feedback on success/failure

### 3. Configuration

- Use `RuntimeConfig` for shared state
- Validate required configuration before execution
- Provide sensible defaults

### 4. Dependencies

- Inject dependencies through constructor
- Keep commands focused on single responsibility
- Use utility classes for shared functionality

### 5. Testing

- Write unit tests for all commands
- Mock external dependencies
- Test both success and failure scenarios

### 6. Documentation

- Add clear descriptions for commands
- Document complex logic with comments
- Update this guide when adding new patterns

## Example: Creating a Balance Command

Here's a complete example of creating a balance checking command:

```typescript
// src/commands/balance.command.ts
import { CLIResult } from '../types';
import { Command } from './index';
import { Wallet } from '../utils/wallet';
import { RuntimeConfig } from '../utils/runtime-config';
import { spinner } from '@clack/prompts';

export class BalanceCommand implements Command {
  name = 'balance';
  description = 'Check wallet balance on IXO blockchain';

  constructor(private wallet: Wallet, private config: RuntimeConfig) {}

  async execute(): Promise<CLIResult> {
    try {
      if (!this.wallet.checkWalletExists()) {
        return {
          success: false,
          error: 'Wallet not found. Please login first.',
        };
      }

      const s = spinner();
      s.start('Fetching balance...');

      // Simulate balance check
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const balance = {
        address: this.wallet.address,
        balance: '1000 IXO',
        network: this.config.getValue('network') || 'devnet',
      };

      s.stop('Balance fetched successfully');

      return {
        success: true,
        data: balance,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch balance',
      };
    }
  }
}
```

Then register it in `src/cli.ts`:

```typescript
import { BalanceCommand } from './commands/balance.command';

// In the main function:
registry.register(new BalanceCommand(wallet, config));
```

This command will now appear in the interactive menu and can be executed by users.
