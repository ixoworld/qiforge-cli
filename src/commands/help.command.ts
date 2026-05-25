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
${commands.map((cmd) => `  ${cmd.name.padEnd(15)} ${cmd.description}`).join('\n')}

EXAMPLES:
  qiforge-cli new my-oracle           Scaffold a new oracle from the bundled starter
  qiforge-cli plugin new climate      Scaffold a plugin into the current oracle project
  qiforge-cli --chat                  Chat with your oracle
  qiforge-cli                         Launch interactive menu
  qiforge-cli help                    Show this help message

OPTIONS:
  --chat                      Start a chat session with your oracle
  --help, -h                  Show help information

NEW COMMAND FLAGS (qiforge-cli new):
  --no-interactive            Skip prompts; requires --name
  --name <name>               Project / oracle name
  --path <dir>                Target directory (default: ./\<name\>)
  --template <name>           Starter template (default: basic). See src/templates/index.json
  --description <text>        One-line oracle description
  --org <name>                Organization name (default: IXO)
  --install                   Run pnpm install after scaffolding
  --force                     Overwrite an existing non-empty target dir

PLUGIN NEW COMMAND FLAGS (qiforge-cli plugin new \<name\>):
  --cwd <dir>                 Project directory (default: current working dir)

For more information, visit: https://www.npmjs.com/package/qiforge-cli
`;

    return {
      success: true,
      data: helpText,
    };
  }
}
