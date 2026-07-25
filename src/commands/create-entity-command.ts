import * as p from '@clack/prompts';
import { NETWORK } from '@ixo/signx-sdk/types/types/transact';
import { Command } from '.';
import { CLIResult } from '../types';
import {
  AgentCardContent,
  promptAgentCardServices,
} from '../utils/agent-card';
import { parseCliFlags } from '../utils/cli-flags';
import {
  checkRequiredMatrixUrl,
  checkRequiredPin,
  checkRequiredString,
  checkRequiredURL,
  MatrixHomeServerUrl,
  PARENT_PROTOCOL_DID,
  PORTAL_URL,
  RELAYER_NODE_DID,
  selectNetwork,
} from '../utils/common';
import { CreateEntity } from '../utils/entity';
import { selectRelayerNode } from '../utils/relayer-node';
import { RuntimeConfig } from '../utils/runtime-config';
import { Wallet } from '../utils/wallet';

export class CreateEntityCommand implements Command {
  name = 'create-entity';
  description = 'Create an entity';

  constructor(private wallet: Wallet, private config: RuntimeConfig) {}

  async execute(): Promise<CLIResult> {
    const flags = parseCliFlags();
    const noInteractive = flags['no-interactive'] === 'true';

    // Network
    let currentNetwork = this.config.getValue('network') as NETWORK;
    if (flags.network) {
      currentNetwork = flags.network as NETWORK;
      this.config.addValue('network', currentNetwork);
    } else if (!currentNetwork) {
      if (noInteractive) {
        currentNetwork = 'devnet';
        this.config.addValue('network', currentNetwork);
      } else {
        await selectNetwork(this.config);
        currentNetwork = this.config.getValue('network') as NETWORK;
      }
    }

    // Project path from flag
    if (flags['project-path']) {
      this.config.addValue('projectPath', flags['project-path']);
    }

    // Determine default Matrix homeserver URL from wallet or static map
    const defaultMatrixUrl = this.wallet.matrixHomeServer ?? MatrixHomeServerUrl[currentNetwork ?? 'devnet'];

    // Collect all entity params — from flags or prompts
    let oracleName: string;
    let orgName: string;
    let profileName: string;
    let logo: string;
    let coverImage: string;
    let location: string;
    let description: string;
    let website: string | undefined;
    let parentProtocol: string;
    let apiUrl: string;
    let matrixHomeServerUrl: string;
    let relayerNodeDid: string;

    if (noInteractive) {
      // Non-interactive: use flags with sensible defaults
      oracleName = flags['oracle-name'] ?? 'My oracle';
      orgName = flags['org-name'] ?? 'IXO';
      profileName = flags['oracle-name'] ?? oracleName;
      logo = flags.logo ?? `https://api.dicebear.com/8.x/bottts/svg?seed=${oracleName}`;
      coverImage = flags['cover-image'] ?? logo;
      location = flags.location ?? 'New York, NY';
      description = flags.description ?? 'We are a company that helps you with daily tasks';
      website = flags.website;
      parentProtocol = PARENT_PROTOCOL_DID[currentNetwork ?? 'devnet'];
      apiUrl = flags['api-url'] ?? 'http://localhost:4000';
      matrixHomeServerUrl = defaultMatrixUrl;
      relayerNodeDid = flags['relayer-node'] ?? RELAYER_NODE_DID[currentNetwork ?? 'devnet'];
    } else {
      const prefilledOracleName = this.config.getValue('oracleName') as string | undefined;
      const prefilledDescription = this.config.getValue('prefillDescription') as string | undefined;
      const prefilledOrgName = this.config.getValue('prefillOrgName') as string | undefined;
      const isNewContext = this.config.getValue('newCommandContext') === 'true';

      if (isNewContext) {
        // Fast path called from `qiforge new`: oracle name, description, org,
        // and avatar were already collected — default everything else. All
        // defaults are editable in oracle.config.json after scaffolding.

        // Let devs choose the relayer node (IXO default or a custom one).
        relayerNodeDid = await selectRelayerNode(currentNetwork ?? 'devnet');

        const prefilledLogo = this.config.getValue('prefillLogo') as string | undefined;
        const logoUrl =
          prefilledLogo ?? `https://api.dicebear.com/8.x/bottts/svg?seed=${encodeURIComponent(prefilledOracleName ?? 'IXO')}`;

        oracleName = prefilledOracleName ?? 'My Oracle';
        orgName = prefilledOrgName ?? 'IXO';
        profileName = oracleName;
        logo = logoUrl;
        coverImage = logoUrl;
        location = 'Not specified';
        description = prefilledDescription ?? '';
        website = undefined;
        parentProtocol = PARENT_PROTOCOL_DID[currentNetwork ?? 'devnet'];
        apiUrl = 'http://localhost:4000';
        matrixHomeServerUrl = defaultMatrixUrl;
      } else {
        // Standalone `qiforge create-entity` — full interactive prompt set.
        const results = await p.group(
          {
            matrixHomeServerUrl: () =>
              p.text({
                message: 'Matrix homeserver URL for the oracle:',
                initialValue: defaultMatrixUrl,
                defaultValue: defaultMatrixUrl,
                validate(value) {
                  return checkRequiredMatrixUrl(value);
                },
              }),
            oracleName: () =>
              p.text({
                message: 'What is the name of the oracle?',
                initialValue: prefilledOracleName ?? 'My oracle',
                validate(value) {
                  return checkRequiredString(value, 'Oracle name is required');
                },
              }),
            profile: () =>
              p.group({
                orgName: () =>
                  p.text({
                    message: 'What is the name of the organization?',
                    initialValue: prefilledOrgName ?? 'IXO',
                    validate(value) {
                      return checkRequiredString(value, 'Organization name is required');
                    },
                  }),
                name: () =>
                  p.text({
                    message: 'What is the name of the profile?',
                    initialValue: 'My oracle',
                    validate(value) {
                      return checkRequiredString(value, 'Profile name is required');
                    },
                  }),
                logo: ({ results }) =>
                  p.text({
                    message: 'What is the logo of the profile?',
                    initialValue: `https://api.dicebear.com/8.x/bottts/svg?seed=${results?.name ?? 'IXO'}`,
                    defaultValue: `https://api.dicebear.com/8.x/bottts/svg?seed=${results?.name ?? 'IXO'}`,
                    validate(value) {
                      if (!value) return `https://api.dicebear.com/8.x/bottts/svg?seed=${results?.name ?? 'IXO'}`;
                      return checkRequiredURL(value, 'Logo is required or a valid URL');
                    },
                  }),
                coverImage: ({ results }) =>
                  p.text({
                    message: 'What is the cover image of the profile?',
                    initialValue: results.logo as string,
                    defaultValue: results.logo as string,
                    validate(value) {
                      if (!value) return results.logo as string;
                      return checkRequiredURL(value, 'Cover image is required or a valid URL');
                    },
                  }),
                location: () =>
                  p.text({
                    message: 'What is the location of your domain?',
                    initialValue: 'New York, NY',
                    validate(value) {
                      return checkRequiredString(value, 'Location is required');
                    },
                  }),
                description: () =>
                  p.text({
                    message: 'What is the description of the entity (profile)?',
                    initialValue: prefilledDescription ?? 'We are a company that helps you with daily tasks',
                    validate(value) {
                      return checkRequiredString(value, 'Description is required');
                    },
                  }),
                url: () =>
                  p.text({
                    message: 'What is the website URL of the oracle? (optional, press Enter to skip)',
                    placeholder: 'https://your-oracle-website.com',
                  }),
              }),
            parentProtocol: () =>
              p.select({
                message: 'What is the parent protocol of the entity?',
                options: [
                  {
                    value: PARENT_PROTOCOL_DID[currentNetwork ?? 'devnet'],
                    label: `IXO Oracle Protocol (${currentNetwork ?? 'devnet'})`,
                    hint: 'default protocol for the selected network',
                  },
                ],
                initialValue: PARENT_PROTOCOL_DID[currentNetwork ?? 'devnet'],
              }),
            apiUrl: () =>
              p.text({
                message: 'What is the API URL of the oracle?',
                initialValue: 'http://localhost:4000',
                validate(value) {
                  return checkRequiredURL(value, 'API URL is required or a valid URL');
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

        oracleName = results.oracleName;
        orgName = results.profile.orgName;
        profileName = results.profile.name;
        logo = results.profile.logo as string;
        coverImage = results.profile.coverImage as string;
        location = results.profile.location;
        description = results.profile.description;
        website = results.profile.url as string | undefined;
        parentProtocol = results.parentProtocol;
        apiUrl = results.apiUrl;
        matrixHomeServerUrl = results.matrixHomeServerUrl;

        // Relayer node: IXO default or a custom node (verified + confirmed).
        relayerNodeDid = await selectRelayerNode(currentNetwork ?? 'devnet');
      }
    }

    // Agent Card — mandatory for `qiforge new` (an oracle without a card cannot
    // be contracted). Skipped only in non-interactive mode, where seeds/services
    // must never be published unseen — use `agent-card --no-interactive --card`.
    let agentCard: AgentCardContent | undefined;
    if (noInteractive) {
      p.log.info('Skipping Agent Card in non-interactive mode — publish one later with: qiforge-cli agent-card');
    } else if (this.config.getValue('newCommandContext') === 'true') {
      p.log.step('Agent Card — describe the services this oracle offers');
      const services = await promptAgentCardServices();
      agentCard = { name: oracleName, description, version: '1.0.0', services };
    } else {
      const wantsCard = await p.confirm({
        message: 'Add an Agent Card now? (You can run `qiforge-cli agent-card` later)',
        initialValue: true,
      });
      if (p.isCancel(wantsCard)) {
        p.cancel('Operation cancelled.');
        process.exit(0);
      }
      if (wantsCard) {
        const services = await promptAgentCardServices();
        agentCard = { name: oracleName, description, version: '1.0.0', services };
      }
    }

    // Resolve PIN: flag or let CreateEntity prompt interactively
    let pin: string | undefined;
    if (flags.pin) {
      const pinError = checkRequiredPin(flags.pin);
      if (pinError) {
        return { success: false, error: `Invalid --pin: ${pinError}` };
      }
      pin = flags.pin;
    }

    // Defer CreateEntity construction to execute() so matrixHomeServerUrl can be used
    const createEntity = new CreateEntity(this.wallet, this.config);

    const did = await createEntity.execute({
      oracleConfig: {
        oracleName,
      },
      profile: {
        orgName,
        name: profileName,
        logo,
        coverImage,
        location,
        description,
        ...(website ? { url: website } : {}),
      },
      services: [
        {
          id: '{id}#api',
          serviceEndpoint: apiUrl,
          type: 'oracleService',
        },
        {
          id: '{id}#ws',
          serviceEndpoint: apiUrl,
          type: 'wsService',
        },
      ],
      parentProtocol,
      matrixHomeServerUrl,
      ...(relayerNodeDid ? { relayerNodeDid } : {}),
      ...(pin ? { pin } : {}),
      ...(agentCard ? { agentCard } : {}),
    });

    p.log.info(`API for the oracle is: ${apiUrl} | You can change this after you deploy the oracle`);

    // add to portal
    const portalBaseUrl = PORTAL_URL[currentNetwork ?? 'devnet'];

    const portalUrl = `${portalBaseUrl}/oracle/${did}/overview`;

    p.log.info(`Oracle created successfully: ${did}`);
    p.log.info(`Oracle URL: ${portalUrl}`);

    return {
      success: true,
      data: `Entity created successfully: ${did}`,
    };
  }
}
