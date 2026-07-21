import * as p from '@clack/prompts';
import { ixo } from '@ixo/impactxclient-sdk';
import { NETWORK } from '@ixo/signx-sdk/types/types/transact';
import { readFileSync } from 'fs';
import { Command } from '.';
import { CLIResult } from '../types';
import {
  AgentCard,
  buildAgentCard,
  fetchAgentCardSchema,
  promptAgentCardServices,
  validateAgentCard,
} from '../utils/agent-card';
import { parseCliFlags } from '../utils/cli-flags';
import {
  BLOCKSYNC_GRAPHQL_URL,
  checkIsEntityDid,
  checkRequiredString,
  selectNetwork,
} from '../utils/common';
import { deriveHomeServerUrl } from '../utils/encryption-key';
import { publicUpload } from '../utils/matrix/upload-to-matrix';
import { RuntimeConfig } from '../utils/runtime-config';
import { Wallet } from '../utils/wallet';

const BLOCKSYNC_LOOKUP_TIMEOUT_MS = 10000;

interface LinkedResourceItem {
  id?: string;
  type?: string;
}

/**
 * Looks up the oracle entity on blocksync and returns the stored id of an
 * existing `agentCard` LinkedResource, if any. Blocksync returns the
 * `linkedResource` field as an array or a keyed map depending on the entity —
 * both shapes are handled (same as the domain-card lookup in relayer-node.ts).
 */
async function findExistingAgentCardResourceId(
  entityDid: string,
  network: NETWORK,
): Promise<string | undefined> {
  const query = `query Entity($id: String!) {
    entity(id: $id) {
      id
      linkedResource
    }
  }`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BLOCKSYNC_LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(BLOCKSYNC_GRAPHQL_URL[network], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, variables: { id: entityDid } }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`blocksync query failed (${res.status})`);

    const body = (await res.json()) as {
      data?: { entity?: { linkedResource?: unknown } };
      errors?: Array<{ message?: string }>;
    };
    if (body.errors?.length) {
      throw new Error(body.errors[0]?.message ?? 'blocksync returned errors');
    }
    const entity = body.data?.entity;
    if (!entity) throw new Error(`Entity not found on blocksync: ${entityDid}`);

    const value = entity.linkedResource;
    const resources: LinkedResourceItem[] = Array.isArray(value)
      ? (value as LinkedResourceItem[])
      : value && typeof value === 'object'
        ? Object.values(value as Record<string, LinkedResourceItem>)
        : [];

    const existing = resources.find(
      (r) => r?.type === 'agentCard' || (typeof r?.id === 'string' && r.id.endsWith('#acard')),
    );
    return existing?.id;
  } finally {
    clearTimeout(timer);
  }
}

export class AgentCardCommand implements Command {
  name = 'agent-card';
  description = 'Author and publish an Agent Card for an existing oracle';

  constructor(
    private wallet: Wallet,
    private config: RuntimeConfig,
  ) {}

  async execute(): Promise<CLIResult> {
    try {
      const flags = parseCliFlags();
      if (flags['no-interactive'] === 'true') {
        return await this.executeNonInteractive(flags);
      }
      return await this.executeInteractive();
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // -------------------------------------------------------------------------
  // Interactive mode
  // -------------------------------------------------------------------------

  private async executeInteractive(): Promise<CLIResult> {
    let network = this.config.getValue('network') as NETWORK;
    if (!network) {
      network = await selectNetwork(this.config);
    }

    if (!this.wallet.wallet?.address || !this.wallet.did) {
      throw new Error('Wallet not available. Please login first.');
    }
    const issuerDid = this.wallet.did;

    const base = await p.group(
      {
        entityDid: () =>
          p.text({
            message: 'Oracle entity DID (ORACLE_ENTITY_DID from .env):',
            initialValue: this.config.getValue('entityDid')?.toString() ?? '',
            validate(value) {
              return checkIsEntityDid(value);
            },
          }),
        name: () =>
          p.text({
            message: 'Agent name:',
            validate(value) {
              return checkRequiredString(value, 'Agent name is required');
            },
          }),
        description: () =>
          p.text({
            message: 'Agent description (what this agent does, one or two sentences):',
            validate(value) {
              return checkRequiredString(value, 'Agent description is required');
            },
          }),
        version: () =>
          p.text({
            message: 'Card version:',
            initialValue: '1.0.0',
            validate(value) {
              return checkRequiredString(value, 'Card version is required');
            },
          }),
      },
      {
        onCancel: () => {
          p.cancel('Operation cancelled.');
          process.exit(0);
        },
      },
    );

    // Services — at least one; each is a priced, contractable unit.
    const services = await promptAgentCardServices();

    const card = buildAgentCard({
      entityDid: base.entityDid,
      issuerDid,
      name: base.name,
      description: base.description,
      version: base.version,
      services,
    });

    // Validate against the engine's schema before anything touches Matrix/chain
    const { schema } = await fetchAgentCardSchema(network);
    const errors = validateAgentCard(card, schema);
    if (errors.length > 0) {
      return {
        success: false,
        error: `Agent Card failed schema validation:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
      };
    }
    p.log.success('Agent Card is valid against the engine schema');

    p.note(JSON.stringify(card, null, 2), 'Agent Card preview');
    const publish = await p.confirm({
      message: 'Publish this Agent Card?',
      initialValue: true,
    });
    if (p.isCancel(publish) || !publish) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }

    // The card is uploaded with the ORACLE's Matrix account, not the developer's
    const matrix = await p.group(
      {
        matrixRoomId: () =>
          p.text({
            message: 'Oracle Matrix room ID (MATRIX_ACCOUNT_ROOM_ID from .env):',
            placeholder: '!abc123:devmx.ixo.earth',
            validate(value) {
              if (!value || !value.startsWith('!') || !value.includes(':')) {
                return 'Matrix room ID must be in format !roomId:server (e.g. !abc123:devmx.ixo.earth)';
              }
              return checkRequiredString(value, 'Matrix room ID is required');
            },
          }),
        matrixAccessToken: () =>
          p.password({
            message: 'Oracle Matrix access token (MATRIX_ORACLE_ADMIN_ACCESS_TOKEN from .env):',
            validate(value) {
              return checkRequiredString(value, 'Matrix access token is required');
            },
          }),
      },
      {
        onCancel: () => {
          p.cancel('Operation cancelled.');
          process.exit(0);
        },
      },
    );

    return this.publishCard({
      card,
      entityDid: base.entityDid,
      network,
      homeServerUrl: deriveHomeServerUrl(matrix.matrixRoomId),
      accessToken: matrix.matrixAccessToken,
    });
  }

  // -------------------------------------------------------------------------
  // Non-interactive mode (--no-interactive --card <path>)
  // -------------------------------------------------------------------------

  private async executeNonInteractive(flags: Record<string, string>): Promise<CLIResult> {
    let network = (flags.network as NETWORK) ?? (this.config.getValue('network') as NETWORK);
    if (!network) network = 'devnet';
    this.config.addValue('network', network);

    if (!this.wallet.wallet?.address || !this.wallet.did) {
      throw new Error('Wallet not available. Please login first.');
    }

    const cardPath = flags.card;
    if (!cardPath) {
      throw new Error('--no-interactive requires --card <path-to-json>');
    }
    const matrixRoomId = flags['matrix-room-id'];
    const matrixAccessToken = flags['matrix-access-token'];
    if (!matrixRoomId || !matrixAccessToken) {
      throw new Error(
        '--no-interactive requires --matrix-room-id and --matrix-access-token (the oracle Matrix credentials)',
      );
    }

    let card: AgentCard;
    try {
      card = JSON.parse(readFileSync(cardPath, 'utf8')) as AgentCard;
    } catch (error) {
      throw new Error(
        `Failed to read card file ${cardPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const { schema } = await fetchAgentCardSchema(network);
    const errors = validateAgentCard(card, schema);
    if (errors.length > 0) {
      throw new Error(
        `Agent Card failed schema validation:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
      );
    }

    const entityDid = card.credentialSubject.id;
    const didError = checkIsEntityDid(entityDid);
    if (didError) throw new Error(`credentialSubject.id: ${didError}`);
    // Same cross-check the engine's resolver runs: the card must be about the
    // entity it is anchored on.
    if (card.id !== `${entityDid}#acard`) {
      throw new Error(`Card id must be "${entityDid}#acard" (got "${card.id}")`);
    }

    return this.publishCard({
      card,
      entityDid,
      network,
      homeServerUrl: deriveHomeServerUrl(matrixRoomId),
      accessToken: matrixAccessToken,
    });
  }

  // -------------------------------------------------------------------------
  // Publish: Matrix upload + chain anchoring
  // -------------------------------------------------------------------------

  private async publishCard({
    card,
    entityDid,
    network,
    homeServerUrl,
    accessToken,
  }: {
    card: AgentCard;
    entityDid: string;
    network: NETWORK;
    homeServerUrl: string;
    accessToken: string;
  }): Promise<CLIResult> {
    const walletAddress = this.wallet.wallet?.address;
    if (!walletAddress) {
      throw new Error('Wallet not available. Please login first.');
    }

    const s = p.spinner();

    s.start('Checking the entity for an existing Agent Card...');
    const existingResourceId = await findExistingAgentCardResourceId(entityDid, network);
    s.stop(
      existingResourceId
        ? 'Existing Agent Card found — it will be replaced'
        : 'No existing Agent Card on the entity',
    );

    s.start('Uploading Agent Card to Matrix...');
    const upload = await publicUpload({
      data: card,
      fileName: 'agentCard',
      homeServerUrl,
      accessToken,
    });
    s.stop(`Agent Card uploaded (CID: ${upload.proof})`);

    const linkedResource = ixo.iid.v1beta1.LinkedResource.fromPartial({
      id: '{id}#acard',
      type: 'agentCard',
      mediaType: 'application/json',
      description: 'Agent Card',
      proof: upload.proof,
      serviceEndpoint: upload.serviceEndpoint,
      encrypted: 'false',
      right: '',
    });

    // IID has no update — a re-publish is delete + add in one tx.
    const msgs = [
      ...(existingResourceId
        ? [
            {
              typeUrl: '/ixo.iid.v1beta1.MsgDeleteLinkedResource',
              value: ixo.iid.v1beta1.MsgDeleteLinkedResource.fromPartial({
                id: entityDid,
                resourceId: existingResourceId,
                signer: walletAddress,
              }),
            },
          ]
        : []),
      {
        typeUrl: '/ixo.iid.v1beta1.MsgAddLinkedResource',
        value: ixo.iid.v1beta1.MsgAddLinkedResource.fromPartial({
          id: entityDid,
          linkedResource,
          signer: walletAddress,
        }),
      },
    ];

    p.log.info(
      existingResourceId
        ? 'Sign to replace the Agent Card on the entity (delete + add in one tx)'
        : 'Sign to anchor the Agent Card on the entity',
    );
    await this.wallet.signAndBroadcast(msgs);

    p.log.success(`Agent Card published to entity DID: ${entityDid}`);
    p.log.info(`Resource: ${entityDid}#acard · proof (CID): ${upload.proof}`);

    return {
      success: true,
      data: `Agent Card published for ${entityDid} (CID: ${upload.proof})`,
    };
  }
}
