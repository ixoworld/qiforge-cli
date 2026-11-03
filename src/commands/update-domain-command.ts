import * as p from '@clack/prompts';
import { NETWORK } from '@ixo/signx-sdk/types/types/transact';
import { Command } from '.';
import { CLIResult } from '../types';
import { checkIsEntityDid, checkRequiredURL, selectNetwork } from '../utils/common';
import { CreateEntity } from '../utils/entity';
import { RuntimeConfig } from '../utils/runtime-config';
import { Wallet } from '../utils/wallet';

export class UpdateDomainCommand implements Command {
  name = 'update-oracle-api-url';
  description = 'Update the oracle API domain (default is localhost)';

  constructor(private wallet: Wallet, private config: RuntimeConfig) {}

  async execute(): Promise<CLIResult> {
    const network = this.config.getValue('network') as NETWORK;
    if (!network) {
      await selectNetwork(this.config);
    }

    const results = await p.group(
      {
        entityDid: () =>
          p.text({
            message: 'What is the DID of the entity you want to update?',
            initialValue: this.config.getValue('entityDid')?.toString() ?? '',
            validate(value) {
              return checkIsEntityDid(value);
            },
          }),
        apiUrl: () =>
          p.text({
            message: 'New API URL of the oracle (the deployed Worker, e.g. https://my-oracle.<subdomain>.workers.dev):',
            initialValue: 'http://localhost:8787',
            validate(value) {
              return checkRequiredURL(value, 'API URL is required and must be a valid URL');
            },
          }),
      },
      {
        onCancel: () => {
          p.cancel('Operation cancelled.');
          process.exit(0);
        },
      }
    );

    try {
      const createEntity = new CreateEntity(this.wallet, this.config);
      p.log.info(`Updating oracle domain for entity ${results.entityDid} to ${results.apiUrl}`);
      await createEntity.updateOracleDomain(results.entityDid, results.apiUrl);
      return {
        success: true,
        data: `Oracle domain updated to ${results.apiUrl} for entity ${results.entityDid}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
