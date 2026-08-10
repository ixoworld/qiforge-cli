import { type AgentCardService } from './agent-card';

/**
 * Turns a service name into a unique, schema-valid service id (slug). Non
 * `[a-z0-9]` runs become single dashes; edges are trimmed. A name that slugs to
 * empty (e.g. all punctuation) falls back to `service-<n>`; collisions with
 * `existingIds` get a `-2`, `-3`, … suffix.
 *
 * Lives in its own clack-free module so unit tests can import it without pulling
 * `@clack/prompts` (ESM-only) into the ts-jest/CommonJS runtime.
 */
export function deriveServiceId(name: string, existingIds: string[]): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!base) {
    let n = 1;
    while (existingIds.includes(`service-${n}`)) n += 1;
    return `service-${n}`;
  }

  if (!existingIds.includes(base)) return base;
  let n = 2;
  while (existingIds.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * Maps Agent Card services onto `schema:Offer` objects for the domain card's
 * `credentialSubject.makesOffer` — so the entity's public profile advertises the
 * same priced services the Agent Card defines. Optional fields are omitted when
 * their source is empty.
 */
export function servicesToOffers(services: AgentCardService[]): Record<string, unknown>[] {
  return services.map((s) => ({
    type: 'schema:Offer',
    identifier: s.id,
    itemOffered: {
      type: 'schema:Service',
      name: s.name,
      description: s.description,
      ...(s.deliverables ? { serviceOutput: s.deliverables } : {}),
    },
    priceSpecification: {
      type: 'schema:PriceSpecification',
      price: s.price.amount,
      priceCurrency: s.price.currency,
    },
    ...(s.doneMeans.length ? { 'ixo:acceptanceCriteria': s.doneMeans } : {}),
  }));
}
