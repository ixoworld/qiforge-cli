import * as p from '@clack/prompts';
import { NETWORK } from '@ixo/signx-sdk/types/types/transact';
import { Command } from '.';
import { CLIResult } from '../types';
import { parseCliFlags } from '../utils/cli-flags';
import {
  checkRequiredMatrixUrl,
  checkRequiredNumber,
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
    let oraclePrice: string;
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

    // A5: Extended config flags
    let model: string | undefined;
    let skills: string[] | undefined;
    let promptOpening: string | undefined;
    let promptStyle: string | undefined;
    let promptCapabilities: string | undefined;
    let mcpServers: Array<{ url: string; name?: string; description?: string }> | undefined;

    if (noInteractive) {
      // Non-interactive: use flags with sensible defaults
      oracleName = flags['oracle-name'] ?? 'My oracle';
      oraclePrice = flags.price ?? '100';
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
      relayerNodeDid = RELAYER_NODE_DID[currentNetwork ?? 'devnet'];

      // A5 flags
      model = flags.model;
      if (flags.skills) {
        skills = flags.skills.split(',').map((s: string) => s.trim());
      }
      promptOpening = flags['prompt-opening'];
      promptStyle = flags['prompt-style'];
      promptCapabilities = flags['prompt-capabilities'];
      if (flags['mcp-servers']) {
        try {
          mcpServers = JSON.parse(flags['mcp-servers']);
        } catch {
          return { success: false, error: '--mcp-servers must be a valid JSON array' };
        }
      }
    } else {
      const prefilledOracleName = this.config.getValue('oracleName') as string | undefined;
      const prefilledDescription = this.config.getValue('prefillDescription') as string | undefined;
      const prefilledOrgName = this.config.getValue('prefillOrgName') as string | undefined;
      const isNewContext = this.config.getValue('newCommandContext') === 'true';

      if (isNewContext) {
        // Fast path called from `qiforge new`: oracle name, description, and org
        // were already collected — only ask for price; default everything else.
        // All defaults are editable in oracle.config.json after scaffolding.
        const priceResult = await p.text({
          message: 'What is the price of the oracle in IXO CREDITS?',
          initialValue: '100',
          validate(value) {
            return checkRequiredNumber(parseInt(value ?? ''), 'Oracle price is required and must be a number');
          },
        });
        if (p.isCancel(priceResult)) {
          p.cancel('Operation cancelled.');
          process.exit(0);
        }
        oraclePrice = priceResult as string;

        oracleName = prefilledOracleName ?? 'My Oracle';
        orgName = prefilledOrgName ?? 'IXO';
        profileName = oracleName;
        logo = `https://api.dicebear.com/8.x/bottts/svg?seed=${oracleName}`;
        coverImage = logo;
        location = 'Not specified';
        description = prefilledDescription ?? '';
        website = undefined;
        parentProtocol = PARENT_PROTOCOL_DID[currentNetwork ?? 'devnet'];
        apiUrl = 'http://localhost:4000';
        matrixHomeServerUrl = defaultMatrixUrl;
        relayerNodeDid = RELAYER_NODE_DID[currentNetwork ?? 'devnet'];
        model = 'moonshotai/kimi-k2.5';

        const selectedPluginsStr = this.config.getValue('selectedPlugins') as string | undefined;
        if (selectedPluginsStr) {
          skills = selectedPluginsStr.split(',').filter(Boolean);
        }
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
            oraclePrice: () =>
              p.text({
                message: 'What is the price of the oracle in IXO CREDITS?',
                initialValue: '100',
                validate(value) {
                  return checkRequiredNumber(parseInt(value ?? ''), 'Oracle price is required and must be a number');
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
            relayerNodeDid: () => {
              const defaultRelayer = RELAYER_NODE_DID[currentNetwork ?? 'devnet'];
              return p.text({
                message: 'Relayer node DID (optional, press Enter for default):',
                initialValue: defaultRelayer,
                defaultValue: defaultRelayer,
              });
            },
          },
          {
            onCancel: () => {
              p.cancel('Operation cancelled.');
              process.exit(0);
            },
          }
        );

        oracleName = results.oracleName;
        oraclePrice = results.oraclePrice;
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
        relayerNodeDid = results.relayerNodeDid;

        const modelChoice = await p.select({
          message: 'Select the default LLM model (press Enter for default):',
          options: [
            { value: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5', hint: 'default' },
            { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
            { value: 'openai/gpt-4o', label: 'GPT-4o' },
            { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
            { value: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick' },
            { value: '__custom__', label: 'Custom model...' },
          ],
          initialValue: 'moonshotai/kimi-k2.5',
        });

        if (p.isCancel(modelChoice)) {
          p.cancel('Operation cancelled.');
          process.exit(0);
        }

        if (modelChoice === '__custom__') {
          const customModel = await p.text({
            message: 'Enter the custom model identifier:',
            placeholder: 'provider/model-name',
            validate(value) {
              return checkRequiredString(value, 'Model identifier is required');
            },
          });
          if (p.isCancel(customModel)) {
            p.cancel('Operation cancelled.');
            process.exit(0);
          }
          model = customModel;
        } else {
          model = modelChoice;
        }

        const promptOpeningResult = await p.text({
          message: 'Opening prompt for the oracle (optional, press Enter to skip):',
          placeholder: 'e.g. Welcome! I can help you with...',
        });
        if (p.isCancel(promptOpeningResult)) {
          p.cancel('Operation cancelled.');
          process.exit(0);
        }
        promptOpening = promptOpeningResult || undefined;

        const promptStyleResult = await p.text({
          message: 'Communication style (optional, press Enter to skip):',
          placeholder: 'e.g. Friendly and concise',
        });
        if (p.isCancel(promptStyleResult)) {
          p.cancel('Operation cancelled.');
          process.exit(0);
        }
        promptStyle = promptStyleResult || undefined;

        const promptCapabilitiesResult = await p.text({
          message: 'Capabilities description (optional, press Enter to skip):',
          placeholder: 'e.g. I can search the web, manage tasks, and answer questions',
        });
        if (p.isCancel(promptCapabilitiesResult)) {
          p.cancel('Operation cancelled.');
          process.exit(0);
        }
        promptCapabilities = promptCapabilitiesResult || undefined;
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
        price: parseInt(oraclePrice),
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
