import * as p from '@clack/prompts';
import { NETWORK } from '@ixo/signx-sdk/types/types/transact';
import { Ajv2020 } from 'ajv/dist/2020';
import agentCardSchemaSnapshot from '../schemas/agent-card-schema.json';
import { checkRequiredString, EVAL_ENGINE_URL } from './common';
import { PLUGIN_CATALOG } from './plugin-catalog';

const SCHEMA_FETCH_TIMEOUT_MS = 10000;
export const MAX_SERVICES = 20;
export const MAX_DONE_MEANS = 10;
export const SERVICE_ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** 1 USDC = 1,000 credits — the portal's `creditsPerUsd`. */
export const CREDITS_PER_USDC = 1000;

export interface AgentCardService {
  id: string;
  name: string;
  description: string;
  price: { amount: number; currency: 'USDC' };
  deliverables: string;
  doneMeans: string[];
}

/** The developer-authored half of the card — everything except the VC envelope. */
export interface AgentCardContent {
  name: string;
  description: string;
  version: string;
  services: AgentCardService[];
}

export interface AgentCard {
  '@context': string[];
  id: string;
  type: string[];
  issuer: { id: string };
  validFrom: string;
  credentialSubject: {
    id: string;
    name: string;
    description: string;
    version: string;
    services: AgentCardService[];
  };
}

/**
 * A suggested service prefill. Seeds only prefill the prompts — the developer
 * confirms/edits every field before anything is published (the CLI never
 * publishes generated sentences unseen).
 */
export interface AgentCardServiceSeed {
  /** Where this suggestion came from — shown in the confirm prompt. */
  source: string;
  id?: string;
  name?: string;
  description?: string;
}

/** Assembles the VC envelope around the developer-authored content (spec §A.2). */
export function buildAgentCard({
  entityDid,
  issuerDid,
  name,
  description,
  version,
  services,
}: AgentCardContent & { entityDid: string; issuerDid: string }): AgentCard {
  return {
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      'https://w3id.org/ixo/ns/agent-card/v1',
    ],
    id: `${entityDid}#acard`,
    type: ['VerifiableCredential', 'ixo:AgentCard'],
    issuer: { id: issuerDid },
    validFrom: new Date().toISOString(),
    credentialSubject: { id: entityDid, name, description, version, services },
  };
}

/**
 * Fetches the canonical Agent Card JSON Schema served by the eval-engine.
 * When the endpoint is unreachable we fall back to the bundled snapshot in
 * `src/schemas/agent-card-schema.json` — the engine's Zod schema is canonical,
 * so the snapshot is kept in lock-step with the engine manually (update it by
 * hand whenever the engine's schema changes).
 */
export async function fetchAgentCardSchema(
  network: NETWORK,
): Promise<{ schema: Record<string, unknown>; source: 'engine' | 'snapshot' }> {
  const url = `${EVAL_ENGINE_URL[network]}/v1/agent-card-schema`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCHEMA_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`schema fetch failed (${res.status})`);
    const schema = (await res.json()) as Record<string, unknown>;
    return { schema, source: 'engine' };
  } catch {
    p.log.warn(
      `Could not reach the eval-engine schema at ${url} — validating against the bundled snapshot instead.`,
    );
    return {
      schema: agentCardSchemaSnapshot as Record<string, unknown>,
      source: 'snapshot',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validates a card against the (engine-served or snapshot) JSON Schema.
 * Returns human-readable error strings; empty array = valid. `strict: false`
 * because the engine generates its schema from Zod and may emit keywords Ajv's
 * strict mode complains about — instance validation is all we need here.
 */
export function validateAgentCard(card: unknown, schema: Record<string, unknown>): string[] {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  const validate = ajv.compile(schema);
  if (validate(card)) return [];
  return (validate.errors ?? []).map(
    (err) => `${err.instancePath || '(root)'}: ${err.message ?? 'invalid'}`,
  );
}

/**
 * Turns the create-entity "A5" inputs into service seeds: one per selected
 * plugin (name/description from the plugin catalog) plus one from the
 * free-text capabilities description when given.
 */
export function buildAgentCardSeeds({
  skills,
  promptCapabilities,
}: {
  skills: string[] | undefined;
  promptCapabilities: string | undefined;
}): AgentCardServiceSeed[] {
  const seeds: AgentCardServiceSeed[] = [];
  for (const skill of skills ?? []) {
    const entry = PLUGIN_CATALOG.find((e) => e.value === skill);
    seeds.push({
      source: `plugin "${entry?.label ?? skill}"`,
      id: skill,
      name: entry?.label ?? skill,
      ...(entry?.hint ? { description: entry.hint } : {}),
    });
  }
  if (promptCapabilities) {
    seeds.push({
      source: 'your capabilities description',
      id: 'general-assistance',
      name: 'General assistance',
      description: promptCapabilities,
    });
  }
  return seeds;
}

/**
 * The interactive service builder: offers each seed for confirm/edit first,
 * then loops "Add another service?" for blank ones. Always returns at least
 * one service (the schema requires it) and never more than MAX_SERVICES.
 */
export async function promptAgentCardServices(
  seeds: AgentCardServiceSeed[] = [],
): Promise<AgentCardService[]> {
  const services: AgentCardService[] = [];

  for (const seed of seeds) {
    if (services.length >= MAX_SERVICES) break;
    const include = await p.confirm({
      message: `Add a service seeded from ${seed.source}?`,
      initialValue: true,
    });
    if (p.isCancel(include)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }
    if (!include) continue;
    services.push(await promptService(services, seed));
  }

  for (;;) {
    if (services.length >= MAX_SERVICES) {
      p.log.warn(`Reached the ${MAX_SERVICES}-service limit.`);
      break;
    }
    if (services.length > 0) {
      const more = await p.confirm({
        message: 'Add another service?',
        initialValue: false,
      });
      if (p.isCancel(more)) {
        p.cancel('Operation cancelled.');
        process.exit(0);
      }
      if (!more) break;
    }
    services.push(await promptService(services));
  }

  return services;
}

async function promptService(
  existing: AgentCardService[],
  seed?: AgentCardServiceSeed,
): Promise<AgentCardService> {
  p.log.step(`Service ${existing.length + 1}`);

  const seedId = seed?.id && SERVICE_ID_REGEX.test(seed.id) ? seed.id : '';

  const svc = await p.group(
    {
      id: () =>
        p.text({
          message: 'Service id (slug, e.g. "expense-report"):',
          initialValue: seedId,
          validate(value) {
            const required = checkRequiredString(value, 'Service id is required');
            if (required) return required;
            if (!SERVICE_ID_REGEX.test(value ?? '')) {
              return 'Use a lowercase slug: letters/digits separated by dashes';
            }
            if (existing.some((s) => s.id === value)) {
              return 'A service with this id is already on the card';
            }
            return undefined;
          },
        }),
      name: () =>
        p.text({
          message: 'Service name:',
          initialValue: seed?.name ?? '',
          validate(value) {
            return checkRequiredString(value, 'Service name is required');
          },
        }),
      description: () =>
        p.text({
          message: 'Service description:',
          initialValue: seed?.description ?? '',
          validate(value) {
            return checkRequiredString(value, 'Service description is required');
          },
        }),
      amount: () =>
        p.text({
          message: 'Price in USDC (1 USDC = 1,000 credits; 0 = free):',
          validate(value) {
            const required = checkRequiredString(value, 'Price is required (0 = free)');
            if (required) return required;
            const amount = Number(value);
            if (!Number.isFinite(amount) || amount < 0) {
              return 'Price must be a number >= 0';
            }
            return undefined;
          },
        }),
      deliverables: () =>
        p.text({
          message: 'Deliverables — what the agent hands over, one sentence:',
          validate(value) {
            return checkRequiredString(value, 'Deliverables sentence is required');
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

  const amount = Number(svc.amount);
  p.log.info(
    `${amount} USDC = ${(amount * CREDITS_PER_USDC).toLocaleString('en-US')} credits`,
  );

  // doneMeans — the anti-vagueness lever: each sentence becomes a candidate
  // AI-check instruction, at least one is required.
  const doneMeans: string[] = [];
  for (;;) {
    const line = await p.text({
      message:
        doneMeans.length === 0
          ? '"Done" means — one sentence describing what done-right looks like:'
          : `"Done" also means (sentence ${doneMeans.length + 1}):`,
      validate(value) {
        return checkRequiredString(value, 'Sentence is required');
      },
    });
    if (p.isCancel(line)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }
    doneMeans.push(line);
    if (doneMeans.length >= MAX_DONE_MEANS) {
      p.log.warn(`Reached the ${MAX_DONE_MEANS}-sentence limit.`);
      break;
    }
    const more = await p.confirm({
      message: 'Add another sentence?',
      initialValue: false,
    });
    if (p.isCancel(more)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }
    if (!more) break;
  }

  return {
    id: svc.id,
    name: svc.name,
    description: svc.description,
    price: { amount, currency: 'USDC' },
    deliverables: svc.deliverables,
    doneMeans,
  };
}
