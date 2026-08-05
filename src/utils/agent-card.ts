import * as p from '@clack/prompts';
import { NETWORK } from '@ixo/signx-sdk/types/types/transact';
import { Ajv2020 } from 'ajv/dist/2020';
import { writeFileSync } from 'fs';
import path from 'path';
import agentCardSchemaSnapshot from '../schemas/agent-card-schema.json';
import { checkRequiredString, EVAL_ENGINE_URL } from './common';
import { upsertEnvVar } from './env-file';
import { deriveServiceId } from './service-id';

/** The developer's local, versioned copy of the published card. */
export const AGENT_CARD_FILENAME = 'agent-card.json';

const SCHEMA_FETCH_TIMEOUT_MS = 10000;
export const MAX_SERVICES = 20;
export const MAX_DONE_MEANS = 10;
export const SERVICE_ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface AgentCardService {
  id: string;
  name: string;
  description: string;
  price: { amount: number; currency: 'PAY' };
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
 * Writes the published card to `<projectPath>/agent-card.json` and points
 * `AGENT_CARD_PATH` at it in the project's `.env` — a local, versioned copy
 * of what's live on Matrix/chain, so the oracle runtime (and its developer)
 * can read the card without re-fetching it from Matrix.
 */
export function saveAgentCardLocally(projectPath: string, card: AgentCard): string {
  const cardPath = path.join(projectPath, AGENT_CARD_FILENAME);
  writeFileSync(cardPath, `${JSON.stringify(card, null, 2)}\n`);
  upsertEnvVar(path.join(projectPath, '.env'), 'AGENT_CARD_PATH', `./${AGENT_CARD_FILENAME}`);
  return cardPath;
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
 * Interactive service builder. Prompts for services until the developer leaves
 * the "next service name" blank. Always returns at least one service (the schema
 * requires it) and never more than MAX_SERVICES.
 */
export async function promptAgentCardServices(): Promise<AgentCardService[]> {
  const services: AgentCardService[] = [];

  for (;;) {
    const first = services.length === 0;
    const name = await p.text({
      message: first
        ? 'Service name (e.g. "Expense Report"):'
        : `Next service name (blank to finish, ${services.length}/${MAX_SERVICES}):`,
      validate(value) {
        if (first) return checkRequiredString(value, 'At least one service is required');
        return undefined; // blank allowed → terminates the loop
      },
    });
    if (p.isCancel(name)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }
    if (!first && !String(name).trim()) break;

    services.push(await promptService(services, String(name).trim()));

    if (services.length >= MAX_SERVICES) {
      p.log.warn(`Reached the ${MAX_SERVICES}-service limit.`);
      break;
    }
  }

  return services;
}

async function promptService(
  existing: AgentCardService[],
  name: string,
): Promise<AgentCardService> {
  p.log.step(`Service ${existing.length + 1}: ${name}`);

  const id = deriveServiceId(
    name,
    existing.map((s) => s.id),
  );
  p.log.info(`Service id: ${id}`);

  const svc = await p.group(
    {
      description: () =>
        p.text({
          message: 'Service description:',
          validate(value) {
            return checkRequiredString(value, 'Service description is required');
          },
        }),
      amount: () =>
        p.text({
          message: 'Price in PAY (1 PAY = 1 USD; 0 = free):',
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
  p.log.info(`${amount} PAY = $${amount}`);

  // doneMeans — first sentence required, blank Enter finishes the list.
  const doneMeans: string[] = [];
  for (;;) {
    const first = doneMeans.length === 0;
    const line = await p.text({
      message: first
        ? '"Done" means — one sentence describing done-right (required):'
        : `"Done" also means (${doneMeans.length + 1}, blank to finish):`,
      validate(value) {
        if (first) return checkRequiredString(value, 'At least one sentence is required');
        return undefined;
      },
    });
    if (p.isCancel(line)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }
    if (!first && !String(line).trim()) break;
    doneMeans.push(String(line).trim());
    if (doneMeans.length >= MAX_DONE_MEANS) {
      p.log.warn(`Reached the ${MAX_DONE_MEANS}-sentence limit.`);
      break;
    }
  }

  return {
    id,
    name,
    description: svc.description,
    price: { amount, currency: 'PAY' },
    deliverables: svc.deliverables,
    doneMeans,
  };
}

// Re-exported so callers can import from the agent-card module; the
// implementation lives in a clack-free module for test isolation.
export { deriveServiceId, servicesToOffers } from './service-id';
