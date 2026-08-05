# QiForge CLI

A command-line interface for creating and managing IXO Oracle projects. This CLI helps you set up AI Agent oracles built with LangGraph, using Matrix as a datastore with linked resources stored on the IXO blockchain.

## What is QiForge CLI?

The QiForge CLI automates the complete setup of AI Agent oracle projects. It handles:

- **Blockchain Integration**: Creates entities on the IXO blockchain with linked resources stored in Matrix
- **Matrix Account Creation**: Sets up Matrix accounts for data storage and communication
- **Project Initialization**: Clones the [QiForge boilerplate](https://github.com/ixoworld/qiforge) and configures the environment
- **Authentication**: Supports two modes — SignX (QR code via IXO Mobile App) or offline wallet (local mnemonic)
- **Non-interactive Mode**: Full CI/CD support with `--no-interactive` flag and CLI flags for all parameters

## Prerequisites

- Node.js 22+
- IXO Mobile App (for SignX authentication) **or** a mnemonic phrase (for offline mode)

## Installation

Install the CLI globally using npm:

```bash
npm install -g qiforge-cli
```

Or with pnpm:

```bash
pnpm add -g qiforge-cli
```

**Important for pnpm users:** After installation, you need to approve build scripts:

```bash
pnpm approve-builds -g
```

When prompted, select `protobufjs` and approve it:

```
✔ Choose which packages to build · protobufjs
✔ The next packages will now be built: protobufjs.
Do you approve? (y/N) · true
```

Or with yarn:

```bash
yarn global add qiforge-cli
```

## Quick Start

1. **Initialize a new oracle project:**

   ```bash
   qiforge-cli --init
   ```

2. **Or run the interactive CLI:**

   ```bash
   qiforge-cli
   ```

3. **Follow the prompts:**
   - Choose authentication: SignX (QR code) or Offline (local mnemonic)
   - Enter your project name
   - Select the template (QiForge boilerplate or custom)
   - Configure your oracle details (name, profile, LLM model, prompts, etc.)

## Authentication

The CLI supports two authentication modes:

### SignX (Default)

Uses the IXO Mobile App for QR code-based authentication. Keep your app open during the session.

```bash
qiforge-cli
# Select "SignX Wallet (QR code with mobile app)" when prompted
```

### Offline Wallet

Uses a local mnemonic phrase for authentication. No mobile app needed.

```bash
# Interactive
qiforge-cli offline-login

# Non-interactive (CI/CD)
qiforge-cli offline-login --network devnet --mnemonic "your twelve word mnemonic phrase here" --matrixPassword "your-matrix-password"
```

**Offline login flags:**

| Flag               | Description                                      |
| ------------------ | ------------------------------------------------ |
| `--network`        | Network to use (`devnet`, `testnet`, `mainnet`)  |
| `--mnemonic`       | Mnemonic phrase for wallet derivation             |
| `--matrixPassword`  | Matrix account password                           |
| `--name`           | Display name (falls back to Matrix profile name)  |

## Commands

### `qiforge-cli --init` - Initialize Project

Creates a new IXO Oracle project with all necessary components:

- **Project Setup**: Creates directory and clones the QiForge boilerplate
- **Entity Creation**: Creates a blockchain entity with linked resources stored in Matrix
- **Matrix Account**: Sets up Matrix account for data storage
- **Oracle Config**: Saves `oracle.config.json` with oracle metadata, LLM model, and prompt settings
- **Environment Configuration**: Creates `.env` file with all necessary variables

### `qiforge-cli` - Interactive Menu

Launches an interactive menu with the following options:

- **init** - Initialize a new project
- **create-entity** - Create a blockchain entity
- **chat** - Chat with the oracle
- **logout** - Sign out

### Other Commands

| Command              | Description                                              |
| -------------------- | -------------------------------------------------------- |
| `create-entity`      | Create an entity with oracle profile, linked resources   |
| `chat`               | Chat with the oracle                                     |
| `offline-login`      | Login with a local mnemonic (offline wallet)             |
| `logout`             | Clear your authentication session                        |
| `--help`, `-h`       | Show help information and available commands             |

## Non-interactive Mode (CI/CD)

Both `init` and `create-entity` support a `--no-interactive` flag for fully automated pipelines. All parameters can be passed as CLI flags.

### Init (non-interactive)

```bash
qiforge-cli --init --no-interactive \
  --name my-oracle-project \
  --network devnet \
  --oracle-name "My Oracle" \
  --api-url http://localhost:4000 \
  --pin 123456
```

**Init flags:**

| Flag           | Description                                     | Default                                |
| -------------- | ----------------------------------------------- | -------------------------------------- |
| `--name`       | Project name (required in non-interactive mode)  | —                                      |
| `--path`       | Project directory path                           | `./<name>`                             |
| `--repo`       | Template repository URL                          | `git@github.com:ixoworld/qiforge.git` |
| `--force`      | Overwrite existing directory                     | `false`                                |

### Create Entity (non-interactive)

```bash
qiforge-cli create-entity --no-interactive \
  --network devnet \
  --oracle-name "My Oracle" \
  --org-name "My Org" \
  --description "Oracle description" \
  --api-url http://localhost:4000 \
  --model "anthropic/claude-sonnet-4" \
  --pin 123456
```

**Create entity flags:**

| Flag                    | Description                                       | Default                           |
| ----------------------- | ------------------------------------------------- | --------------------------------- |
| `--network`             | Network (`devnet`, `testnet`, `mainnet`)           | `devnet`                          |
| `--oracle-name`         | Oracle name                                        | `My oracle`                       |
| `--org-name`            | Organization name                                  | `IXO`                             |
| `--logo`                | Logo URL                                           | Auto-generated from oracle name   |
| `--cover-image`         | Cover image URL                                    | Same as logo                      |
| `--location`            | Location string                                    | `New York, NY`                    |
| `--description`         | Entity description                                 | Default placeholder               |
| `--website`             | Website URL (optional)                             | —                                 |
| `--api-url`             | Oracle API URL                                     | `http://localhost:4000`           |
| `--project-path`        | Project directory for saving config                | Current directory                 |
| `--pin`                 | 6-digit PIN for Matrix vault                       | Prompted if not provided          |
| `--model`               | LLM model identifier                               | `moonshotai/kimi-k2.5`           |
| `--skills`              | Comma-separated skill list                          | —                                 |
| `--prompt-opening`      | Opening prompt for the oracle                       | —                                 |
| `--prompt-style`        | Communication style                                 | —                                 |
| `--prompt-capabilities` | Capabilities description                            | —                                 |
| `--mcp-servers`         | JSON array of MCP servers (`[{"url":"..."}]`)       | —                                 |

## Oracle Configuration

After entity creation, the CLI saves an `oracle.config.json` file in your project root (and `apps/app/`) with oracle metadata:

```json
{
  "oracleName": "My Oracle",
  "orgName": "IXO",
  "description": "Oracle description",
  "location": "New York, NY",
  "website": "",
  "apiUrl": "http://localhost:4000",
  "network": "devnet",
  "entityDid": "did:ixo:entity:...",
  "logo": "https://...",
  "prompt": {
    "opening": "Welcome! I can help you with...",
    "communicationStyle": "Friendly and concise",
    "capabilities": "I can search the web, manage tasks..."
  },
  "model": "moonshotai/kimi-k2.5",
  "skills": [],
  "customSkills": [],
  "mcpServers": []
}
```

### Supported LLM Models

During interactive entity creation, you can choose from:

- `moonshotai/kimi-k2.5` (default)
- `anthropic/claude-sonnet-4`
- `openai/gpt-4o`
- `google/gemini-2.5-pro`
- `meta-llama/llama-4-maverick`
- Or enter a custom model identifier

## Project Structure

After initialization, your project will have:

```
your-oracle-project/
├── oracle.config.json        # Oracle configuration
├── apps/
│   └── app/
│       ├── .env              # Environment configuration
│       ├── oracle.config.json # Copy for Docker builds
│       └── ...               # Application files
├── packages/                 # Shared packages
└── ...                      # Other project files
```

## Environment Configuration

The CLI automatically creates a `.env` file with:

```env
PORT=4000
ORACLE_NAME=your-oracle-name

# Matrix Configuration
MATRIX_BASE_URL=https://matrix.ixo.world
MATRIX_ORACLE_ADMIN_ACCESS_TOKEN=your-access-token
MATRIX_ORACLE_ADMIN_PASSWORD=your-password
MATRIX_ORACLE_ADMIN_USER_ID=your-user-id

# AI/ML Services (configure as needed)
OPENAI_API_KEY=
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_HOST=https://cloud.langfuse.com
OPEN_ROUTER_API_KEY=

# Blockchain Details (store securely)
ORACLE_ADDRESS=your-address
ORACLE_DID=your-did
ORACLE_MNEMONIC=your-mnemonic
MATRIX_VAULT_PIN=your-pin
ENTITY_DID=your-entity-did
```

## Authentication Details

The CLI supports two authentication modes:

- **SignX**: Keep your IXO Mobile App open during the login process. All transactions require QR code scanning.
- **Offline**: Uses a local mnemonic phrase. Transactions are signed locally — no mobile app needed. Credentials are stored in `~/.wallet.json`.

Your session is persisted locally for future use. Run `qiforge-cli logout` to clear it.

## Next Steps

After project initialization:

1. **Navigate to your project:**

   ```bash
   cd your-project-name
   ```

2. **Install dependencies:**

   ```bash
   pnpm install
   ```

3. **Build the project:**

   ```bash
   pnpm build
   ```

4. **Start development:**
   ```bash
   cd apps/app
   pnpm start:dev
   ```

## Development (Contributing to CLI)

If you want to contribute to the CLI itself:

1. **Clone the repository:**

   ```bash
   git clone https://github.com/ixoworld/ixo-oracles-cli
   cd ixo-oracles-cli
   ```

2. **Install dependencies:**

   ```bash
   pnpm install
   ```

3. **Build the CLI:**

   ```bash
   pnpm build
   ```

4. **Run locally:**
   ```bash
   pnpm start
   ```

**Development Scripts:**

- `pnpm build` - Build the CLI
- `pnpm dev` - Watch mode for development
- `pnpm test` - Run tests
- `pnpm lint` - Lint code
- `pnpm type-check` - Type check

## Support

For issues and questions:

- Create an issue in the repository
- Join the IXO Discord community
- Check the IXO documentation

## License

This project is licensed under the Apache License 2.0. See [License.txt](License.txt) for details.
