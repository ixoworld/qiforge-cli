import * as p from '@clack/prompts';
import { NETWORK } from '@ixo/signx-sdk/types/types/transact';
import { BLOCKSYNC_GRAPHQL_URL, checkIsEntityDid, RELAYER_NODE_DID } from './common';

export interface RelayerNodeInfo {
  did: string;
  /** Human-friendly name read from the relayer node's domain card, if available. */
  name?: string;
  /** Resolved domain card serviceEndpoint URL, if found. */
  domainCardUrl?: string;
}

interface LinkedResourceItem {
  id?: string;
  type?: string;
  serviceEndpoint?: string;
}

const RELAYER_LOOKUP_TIMEOUT_MS = 10000;

function isDomainCard(resource: unknown): boolean {
  if (!resource || typeof resource !== 'object') return false;
  const item = resource as LinkedResourceItem;
  const type = typeof item.type === 'string' ? item.type.toLowerCase() : '';
  const id = typeof item.id === 'string' ? item.id : '';
  return type.includes('domaincard') || id.endsWith('#dmn');
}

/**
 * Finds the domain card serviceEndpoint inside an entity's `linkedResource`
 * (array) or `settings` (keyed map) — both shapes are returned by blocksync.
 */
function findDomainCardEndpoint(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const card = value.find((r) => isDomainCard(r)) as LinkedResourceItem | undefined;
    return card?.serviceEndpoint;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, LinkedResourceItem>)) {
      if (/domain ?card|dmn/i.test(key) || isDomainCard(item)) {
        if (item?.serviceEndpoint) return item.serviceEndpoint;
      }
    }
  }
  return undefined;
}

async function fetchDomainName(domainCardUrl: string): Promise<string | undefined> {
  try {
    const res = await fetch(domainCardUrl);
    if (!res.ok) return undefined;
    const card = (await res.json()) as {
      credentialSubject?: { name?: string; legalName?: string; alternateName?: string[] };
    };
    const subject = card?.credentialSubject;
    if (!subject) return undefined;
    return (
      subject.name ??
      subject.legalName ??
      (Array.isArray(subject.alternateName) ? subject.alternateName[0] : undefined)
    );
  } catch {
    return undefined;
  }
}

/**
 * Looks up a relayer node entity on blocksync, reads its domain card and
 * extracts a human-friendly name so devs can confirm they are targeting the
 * right relayer node before creating an oracle on it.
 */
export async function fetchRelayerNodeInfo(relayerDid: string, network: NETWORK): Promise<RelayerNodeInfo> {
  const endpoint = BLOCKSYNC_GRAPHQL_URL[network];
  const query = `query Entity($id: String!) {
    entity(id: $id) {
      id
      type
      linkedResource
      settings
    }
  }`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RELAYER_LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, variables: { id: relayerDid } }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`blocksync query failed (${res.status})`);

    const body = (await res.json()) as {
      data?: { entity?: { linkedResource?: unknown; settings?: unknown } };
      errors?: Array<{ message?: string }>;
    };
    if (body.errors?.length) {
      throw new Error(body.errors[0]?.message ?? 'blocksync returned errors');
    }
    const entity = body.data?.entity;
    if (!entity) throw new Error('relayer node entity not found');

    const domainCardUrl =
      findDomainCardEndpoint(entity.linkedResource) ?? findDomainCardEndpoint(entity.settings);
    if (!domainCardUrl) return { did: relayerDid };

    const name = await fetchDomainName(domainCardUrl);
    const info: RelayerNodeInfo = { did: relayerDid, domainCardUrl };
    if (name) info.name = name;
    return info;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Interactive relayer node picker. Defaults to the IXO relayer node and offers
 * a "custom" option where devs enter their own relayer node DID. Custom DIDs
 * are verified against blocksync and the dev is shown the relayer node's name
 * (from its domain card) for confirmation before continuing.
 */
export async function selectRelayerNode(network: NETWORK): Promise<string> {
  const defaultRelayer = RELAYER_NODE_DID[network ?? 'devnet'];

  const choice = await p.select({
    message: 'Which relayer node should host this oracle?',
    options: [
      { value: '__default__', label: 'IXO', hint: 'Default IXO relayer node' },
      { value: '__custom__', label: 'Custom relayer node', hint: 'Enter your own relayer node DID' },
    ],
    initialValue: '__default__',
  });
  if (p.isCancel(choice)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  if (choice === '__default__') {
    p.log.info(`Using the IXO relayer node (${defaultRelayer}).`);
    return defaultRelayer;
  }

  // Custom relayer: loop until the dev confirms or re-enters a different DID.
  for (;;) {
    const relayerDidInput = await p.text({
      message: 'Enter the relayer node entity DID:',
      placeholder: 'did:ixo:entity:...',
      validate(value) {
        return checkIsEntityDid(value);
      },
    });
    if (p.isCancel(relayerDidInput)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }
    const relayerDid = String(relayerDidInput);

    const s = p.spinner();
    s.start('Verifying relayer node…');
    let info: RelayerNodeInfo | undefined;
    try {
      info = await fetchRelayerNodeInfo(relayerDid, network);
      s.stop(info.name ? `Relayer node found: ${info.name}` : 'Relayer node found');
    } catch (err) {
      s.stop('Could not verify relayer node');
      p.log.warn(`Could not look up relayer node ${relayerDid}: ${(err as Error).message}`);
    }

    const relayerLabel = info?.name ? `"${info.name}" (${relayerDid})` : relayerDid;
    p.log.warn(`⚠️  This oracle will be created on the relayer node ${relayerLabel}.`);

    const confirmed = await p.confirm({
      message: info?.name
        ? `Create this oracle on the "${info.name}" relayer node?`
        : `Create this oracle on relayer node ${relayerDid}?`,
      initialValue: true,
    });
    if (p.isCancel(confirmed)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }
    if (confirmed) return relayerDid;
    // Not confirmed — loop and let the dev enter a different relayer node DID.
  }
}
