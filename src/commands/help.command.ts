import { CLIResult } from '../types';
import { Command, CommandRegistry } from './index';

export class HelpCommand implements Command {
  name = 'help';
  description = 'Show help information and available commands';

  constructor(private registry: CommandRegistry) {}

  async execute(): Promise<CLIResult> {
    const commands = this.registry.getAll();

    const helpText = `
QiForge CLI - Help

USAGE:
  qiforge-cli [command] [options]

COMMANDS:
${commands.map((cmd) => `  ${cmd.name.padEnd(22)} ${cmd.description}`).join('\n')}

EXAMPLES:
  qiforge-cli new                     Provision an oracle and scaffold its Cloudflare Workers project
  qiforge-cli new --no-interactive --name my-oracle --skip-entity
                                      Scaffold only (no login, nothing on chain or Matrix)
  qiforge-cli plugin new climate      Scaffold a plugin into the current oracle project
  qiforge-cli setup-signing-key --env oracle-credentials.env
                                      Add the Ed25519 UCAN signing key to an older oracle
  qiforge-cli                         Launch interactive menu
  qiforge-cli help                    Show this help message

OPTIONS:
  --help, -h                  Show help information
  --version, -v               Show the CLI version

NEW COMMAND FLAGS (qiforge-cli new):
  --no-interactive            Skip prompts; requires --name
  --name <name>               Project / oracle name
  --path <dir>                Target directory (default: ./<name>)
  --template <name>           Starter template (default: basic). See src/templates/index.json
  --description <text>        One-line oracle description
  --org <name>                Organization name (default: IXO)
  --network <net>             devnet | testnet | mainnet (default: devnet)
  --install                   Run pnpm install after scaffolding
  --force                     Overwrite an existing non-empty target dir
  --skip-entity               Scaffold only: no login, no entity, no Matrix account;
                              the wrangler configs get placeholder identity values
  --pin <6 digits>            PIN that encrypts the oracle's secrets (prompted if omitted)

PLUGIN NEW COMMAND FLAGS (qiforge-cli plugin new <name>):
  --cwd <dir>                 Project directory (default: current working dir)

AGENT CARD COMMAND FLAGS (qiforge-cli agent-card):
  --no-interactive            Skip prompts; requires --card and the oracle's Matrix credentials
  --card <path>               Agent Card JSON file to validate and publish
  --env <path>                oracle-credentials.env (account room + bot password)
  --matrix-room-id <id>       Oracle Matrix room ID, with --matrix-access-token (legacy)
  --matrix-access-token <t>   Oracle Matrix access token (legacy Node-era oracles)
  --network <net>             devnet | testnet | mainnet (default: devnet)
  --project-path <dir>        Oracle project dir to save agent-card.json into

SETUP ENCRYPTION KEY / SETUP SIGNING KEY FLAGS:
  --env <path>                oracle-credentials.env for the oracle's Matrix account (and,
                              for setup-signing-key, SECP_MNEMONIC + MATRIX_VALUE_PIN)
  --network <net>             setup-signing-key: devnet | testnet | mainnet
  --no-interactive            setup-signing-key: requires --env

DASHBOARD ACCESS COMMAND FLAGS (qiforge-cli dashboard-access):
  --env <path>                oracle-credentials.env (SECP_MNEMONIC, PIN, Matrix credentials)
  --no-interactive            Skip prompts; requires --grant, --entity-did, --env
  --grant <did>               Console account DID to grant dashboard access to
  --entity-did <did>          Oracle entity DID to link
  --grant-deposit             Also authorize the account to fund performance deposits
  --network <net>             devnet | testnet | mainnet (default: devnet)

For more information, visit: https://www.npmjs.com/package/qiforge-cli
`;

    return {
      success: true,
      data: helpText,
    };
  }
}
