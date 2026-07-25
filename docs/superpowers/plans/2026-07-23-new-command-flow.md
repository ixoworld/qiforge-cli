# `qiforge new` Flow Cleanup + Composio Key Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slim the `qiforge new` prompt flow, make the Agent Card mandatory and saved locally, mirror its services onto the domain card, delete the dead plugin-catalog and pricing-list code, and fix Composio API-key creation failing on every project after the first.

**Architecture:** Interactive-flow changes live in `new.command.ts` and `create-entity-command.ts`; card/domain data shaping lives in `agent-card.ts` and `entity.ts`; the Composio PIN fix touches `wallet.ts` types and `create-project-env-file.ts`. Pure data transforms (slug derivation, service→offer mapping, PIN-resolution decision) are extracted as exported functions so they carry real unit tests; interactive wiring is verified by `type-check` plus a scripted manual run.

**Tech Stack:** TypeScript (ESM, node22), `@clack/prompts`, Jest + ts-jest, `@ixo/impactxclient-sdk`, `@ixo/ucan`.

## Global Constraints

- Node.js 22+; single ESM bundle built by `node build.mjs` (tsup under the hood).
- Tests: `pnpm test` (Jest, `ts-jest` preset, roots `<rootDir>/src`, `testMatch **/__tests__/**/*.ts`).
- Type-check: `pnpm type-check` (`tsc --noEmit`) must pass after every task.
- Lint: `pnpm lint` (`eslint src/**/*.ts`).
- Commands return `CLIResult { success, data?, error? }`; interactive prompts use `@clack/prompts` and must handle `p.isCancel` → `p.cancel(...)` → `process.exit(0)`.
- Service id must satisfy `SERVICE_ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/`; max 20 services (`MAX_SERVICES`); max 10 `doneMeans` (`MAX_DONE_MEANS`); `CREDITS_PER_USDC = 1000`.
- Agent Card service price currency is always `'USDC'`.
- `~/.wallet.json` already stores the wallet mnemonic and (offline) Matrix password in plaintext — persisting `edKeyPin` there is consistent with that trust model.

---

## File Structure

- `src/utils/service-id.ts` — **new, clack-free** module holding the pure helpers `deriveServiceId()` and `servicesToOffers()`. Lives apart from `agent-card.ts` because that module statically imports `@clack/prompts`, which is ESM-only (all 1.x); importing it into the ts-jest/CommonJS runtime throws `Cannot use import statement outside a module`. Keeping the pure logic dependency-free lets unit tests import it directly. (Confirmed: `transformIgnorePatterns` cannot rescue this — pnpm nests clack at `node_modules/.pnpm/@clack+prompts@*/node_modules/@clack/prompts`, which the pattern never matches; and updating clack does not help since every 1.x release is ESM-only.)
- `src/utils/agent-card.ts` — re-export `deriveServiceId`/`servicesToOffers` from `./service-id`; rewrite `promptAgentCardServices()`/`promptService()` (auto-slug, blank-to-finish); delete `buildAgentCardSeeds()` and `AgentCardServiceSeed`.
- `src/utils/plugin-catalog.ts` — **deleted**.
- `src/utils/runtime-config.ts` — drop `selectedPlugins`, `authZFile`, `feesFile`; add `prefillLogo`, `agentCard`.
- `src/utils/entity.ts` — enrich `createDomainCard()` with `makesOffer`; delete `createFeesConfig()` + `pricingList`; drop `oracleConfig.price`; stash built card in config.
- `src/utils/wallet.ts` + `src/utils/signx/types.ts` — add `edKeyPin` to `WalletProps`; add `persistEdKeyPin()`.
- `src/utils/composio.ts` — add `resolveEdPinDecision()` (pure); classify errors.
- `src/utils/create-project-env-file.ts` — use resolved user PIN, persist it, surface Composio failure cause + recovery.
- `src/commands/new.command.ts` — new question set (avatar, network up front); remove plugin/model/prompt steps and IXO-price hint; save card locally after env file.
- `src/commands/create-entity-command.ts` — remove price/model/prompt-* prompts; mandatory card in new-context path; consume `prefillLogo`.
- `src/__tests__/agent-card.test.ts` — **new**, covers `deriveServiceId` + `servicesToOffers` (imports from `../utils/service-id`, not `../utils/agent-card`).
- `src/__tests__/composio-pin.test.ts` — **new**, covers `resolveEdPinDecision`.
- `src/__tests__/env-file.test.ts` — extend with post-rewrite `AGENT_CARD_PATH` survival test.

---

### Task 1: `deriveServiceId()` — slug a service name into a unique id

**Files:**
- Modify: `src/utils/agent-card.ts` (add exported function near `SERVICE_ID_REGEX`, line ~17)
- Test: `src/__tests__/agent-card.test.ts` (create)

**Interfaces:**
- Produces: `deriveServiceId(name: string, existingIds: string[]): string` — lowercase slug conforming to `SERVICE_ID_REGEX`, unique against `existingIds`, falling back to `service-<n>` when the name slugs to empty.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/agent-card.test.ts`:

```ts
import { deriveServiceId } from '../utils/agent-card';

describe('deriveServiceId', () => {
  it('slugs a plain name', () => {
    expect(deriveServiceId('Expense Report', [])).toBe('expense-report');
  });

  it('collapses punctuation and repeats, trims edges', () => {
    expect(deriveServiceId('  Tax   & Filing!! ', [])).toBe('tax-filing');
  });

  it('lowercases and strips leading/trailing dashes', () => {
    expect(deriveServiceId('--Hello--', [])).toBe('hello');
  });

  it('suffixes on collision', () => {
    expect(deriveServiceId('Expense Report', ['expense-report'])).toBe('expense-report-2');
    expect(deriveServiceId('Expense Report', ['expense-report', 'expense-report-2'])).toBe(
      'expense-report-3',
    );
  });

  it('falls back to service-<n> when the name slugs to empty', () => {
    expect(deriveServiceId('!!!', [])).toBe('service-1');
    expect(deriveServiceId('###', ['service-1'])).toBe('service-2');
  });

  it('always returns a value matching SERVICE_ID_REGEX', () => {
    const id = deriveServiceId('Über Ölçü 42', []);
    expect(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- agent-card`
Expected: FAIL — `deriveServiceId is not a function` / import error.

- [ ] **Step 3: Write minimal implementation**

In `src/utils/agent-card.ts`, after the `SERVICE_ID_REGEX` declaration (line ~17):

```ts
/**
 * Turns a service name into a unique, schema-valid service id (slug). Non
 * `[a-z0-9]` runs become single dashes; edges are trimmed. A name that slugs to
 * empty (e.g. all punctuation) falls back to `service-<n>`; collisions with
 * `existingIds` get a `-2`, `-3`, … suffix.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- agent-card`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/agent-card.ts src/__tests__/agent-card.test.ts
git commit -m "feat(agent-card): add deriveServiceId slug helper"
```

---

### Task 2: `servicesToOffers()` — map Agent Card services to schema:Offer

**Files:**
- Modify: `src/utils/service-id.ts` (add exported function after `deriveServiceId`)
- Modify: `src/utils/agent-card.ts` (extend the re-export to include `servicesToOffers`)
- Test: `src/__tests__/agent-card.test.ts` (extend)

**Interfaces:**
- Consumes: `AgentCardService` — imported **type-only** from `./agent-card` so the runtime import is elided (no `@clack/prompts` pulled into `service-id.ts`).
- Produces: `servicesToOffers(services: AgentCardService[]): Record<string, unknown>[]` — one `schema:Offer` object per service; `serviceOutput`/`acceptanceCriteria` omitted when their source field is empty. Re-exported from `agent-card.ts` for consumers.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/agent-card.test.ts` (import from the clack-free `service-id` module, not `agent-card`):

```ts
import { servicesToOffers } from '../utils/service-id';
import { type AgentCardService } from '../utils/agent-card';

const svc = (over: Partial<AgentCardService> = {}): AgentCardService => ({
  id: 'expense-report',
  name: 'Expense Report',
  description: 'Builds an expense report',
  price: { amount: 5, currency: 'USDC' },
  deliverables: 'A PDF report',
  doneMeans: ['Reconciles to the ledger'],
  ...over,
});

describe('servicesToOffers', () => {
  it('maps a full service to a schema:Offer', () => {
    expect(servicesToOffers([svc()])).toEqual([
      {
        type: 'schema:Offer',
        identifier: 'expense-report',
        itemOffered: {
          type: 'schema:Service',
          name: 'Expense Report',
          description: 'Builds an expense report',
          serviceOutput: 'A PDF report',
        },
        priceSpecification: {
          type: 'schema:PriceSpecification',
          price: 5,
          priceCurrency: 'USDC',
        },
        'ixo:acceptanceCriteria': ['Reconciles to the ledger'],
      },
    ]);
  });

  it('omits serviceOutput and acceptanceCriteria when empty', () => {
    const [offer] = servicesToOffers([svc({ deliverables: '', doneMeans: [] })]);
    expect(offer.itemOffered).not.toHaveProperty('serviceOutput');
    expect(offer).not.toHaveProperty('ixo:acceptanceCriteria');
  });

  it('returns one offer per service', () => {
    expect(servicesToOffers([svc(), svc({ id: 'x' })])).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- agent-card`
Expected: FAIL — `servicesToOffers is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/utils/agent-card.ts`, after `deriveServiceId`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- agent-card`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/utils/agent-card.ts src/__tests__/agent-card.test.ts
git commit -m "feat(agent-card): add servicesToOffers domain-card mapping"
```

---

### Task 3: Rewrite the Agent Card service prompts (auto-slug + blank-to-finish)

**Files:**
- Modify: `src/utils/agent-card.ts` — rewrite `promptAgentCardServices()` (line ~185) and `promptService()` (line ~226); delete `buildAgentCardSeeds()` (line ~152) and `AgentCardServiceSeed` (line ~58) and the now-unused `PLUGIN_CATALOG` import (line 9).

**Interfaces:**
- Consumes: `deriveServiceId` (Task 1), `checkRequiredString`, `CREDITS_PER_USDC`, `MAX_SERVICES`, `MAX_DONE_MEANS`.
- Produces: `promptAgentCardServices(): Promise<AgentCardService[]>` — now takes **no** arguments; always returns ≥1 service.

- [ ] **Step 1: Delete the seed machinery and its import**

Remove from `src/utils/agent-card.ts`:
- Line 9: `import { PLUGIN_CATALOG } from './plugin-catalog';`
- The `AgentCardServiceSeed` interface (lines ~53–64).
- The entire `buildAgentCardSeeds(...)` function (lines ~147–178).

- [ ] **Step 2: Replace `promptAgentCardServices` with the blank-to-finish loop**

Replace the whole `promptAgentCardServices` function with:

```ts
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
```

- [ ] **Step 3: Replace `promptService` — take the name, auto-slug the id, blank-to-finish doneMeans**

Replace the whole `promptService` function with:

```ts
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
  p.log.info(`${amount} USDC = ${(amount * CREDITS_PER_USDC).toLocaleString('en-US')} credits`);

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
    price: { amount, currency: 'USDC' },
    deliverables: svc.deliverables,
    doneMeans,
  };
}
```

- [ ] **Step 4: Type-check (callers still compile against the new no-arg signature)**

Run: `pnpm type-check`
Expected: errors ONLY in `create-entity-command.ts` (`buildAgentCardSeeds` import + `promptAgentCardServices(seeds)` call) and `agent-card.command.ts` (unchanged `promptAgentCardServices()` call is fine). Fix the `create-entity-command.ts` call in Step 5.

- [ ] **Step 5: Fix the `create-entity-command.ts` call site**

In `src/commands/create-entity-command.ts`:
- Remove `buildAgentCardSeeds` from the import block (lines ~5–9), keeping `AgentCardContent` and `promptAgentCardServices`.
- Change the card block (line ~375) from:

```ts
      if (wantsCard) {
        const seeds = buildAgentCardSeeds({ skills, promptCapabilities });
        const services = await promptAgentCardServices(seeds);
        agentCard = { name: oracleName, description, version: '1.0.0', services };
      }
```

to:

```ts
      if (wantsCard) {
        const services = await promptAgentCardServices();
        agentCard = { name: oracleName, description, version: '1.0.0', services };
      }
```

- [ ] **Step 6: Verify type-check and existing tests pass**

Run: `pnpm type-check && pnpm test -- agent-card`
Expected: type-check clean; agent-card tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/utils/agent-card.ts src/commands/create-entity-command.ts
git commit -m "feat(agent-card): auto-slug ids and blank-to-finish service prompts"
```

---

### Task 4: Enrich the domain card with `makesOffer` from the Agent Card

**Files:**
- Modify: `src/utils/entity.ts` — `createDomainCard()` signature + body (lines ~414–501); its call site (line ~748).

**Interfaces:**
- Consumes: `servicesToOffers` (Task 2), `AgentCardService`.
- Produces: `createDomainCard({ profile, entityDid, homeServerUrl, accessToken, services? })` — when `services` is a non-empty array, `credentialSubject.makesOffer` is set.

- [ ] **Step 1: Import the mapper**

In `src/utils/entity.ts`, add `servicesToOffers` and `AgentCardService` to the existing import from `./agent-card` (line ~14):

```ts
import {
  AgentCardContent,
  AgentCardService,
  buildAgentCard,
  fetchAgentCardSchema,
  servicesToOffers,
  validateAgentCard,
} from "./agent-card";
```

- [ ] **Step 2: Add `services` to the `createDomainCard` params**

Change the destructure + type (lines ~414–424):

```ts
  private async createDomainCard({
    profile,
    entityDid,
    homeServerUrl,
    accessToken,
    services,
  }: {
    profile: CreateEntityParams["profile"];
    entityDid: string;
    homeServerUrl: string;
    accessToken: string;
    services?: AgentCardService[];
  }): Promise<LinkedResource> {
```

- [ ] **Step 3: Set `makesOffer` in `credentialSubject`**

In the `credentialSubject` object literal, immediately after the `...(profile.url ? { url: profile.url } : {})` line (line ~480):

```ts
        ...(profile.url ? { url: profile.url } : {}),
        ...(services && services.length > 0
          ? { makesOffer: servicesToOffers(services) }
          : {}),
```

- [ ] **Step 4: Pass the services at the call site**

At the `createDomainCard` call (line ~748):

```ts
    const domainCardResource = await this.createDomainCard({
      profile: params.profile,
      entityDid: did,
      homeServerUrl: oracleHomeServerUrl,
      accessToken: oracleAccessToken,
      services: params.agentCard?.services,
    });
```

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/utils/entity.ts
git commit -m "feat(entity): mirror Agent Card services onto domain card makesOffer"
```

---

### Task 5: Delete the plugin catalog and every reference

**Files:**
- Delete: `src/utils/plugin-catalog.ts`
- Modify: `src/commands/new.command.ts` (import line 9; `pickPlugins()` ~115–131; `selectedPlugins` handling ~186, 195–200, 228, 238; `pluginEnvHints`/`pluginHintBlock` ~293–302, 305).
- Modify: `src/commands/create-entity-command.ts` (`selectedPlugins`/`skills` read ~154–157).
- Modify: `src/utils/runtime-config.ts` (remove `selectedPlugins` key, line 19).

- [ ] **Step 1: Delete the file**

```bash
git rm src/utils/plugin-catalog.ts
```

- [ ] **Step 2: Strip `new.command.ts`**

- Remove line 9: `import { BASE_BUNDLE, PLUGIN_CATALOG } from '../utils/plugin-catalog';`
- Delete the `pickPlugins()` method (lines ~115–131).
- Delete the `let selectedPlugins: string[];` declaration (line ~186).
- In the non-interactive block, delete the `selectedPlugins = flags.plugins ? … : BASE_BUNDLE;` assignment (lines ~195–200).
- In the interactive block, delete `selectedPlugins = await this.pickPlugins();` (line ~228).
- Delete `this.config.addValue('selectedPlugins', selectedPlugins.join(','));` (line ~238).
- Delete the `pluginEnvHints` + `pluginHintBlock` computation (lines ~293–302) and remove `pluginHintBlock +` from the final `p.log.success(...)` template (line ~305). The success message becomes:

```ts
      p.log.success(
        `\n✅ Oracle "${projectName}" scaffolded at ${projectPath}\n` +
          `\n🚀 Next steps:\n` +
          `   cd ${relPath}\n` +
          (install ? '' : '   pnpm install\n') +
          `   pnpm dev`
      );
```

- [ ] **Step 3: Strip `create-entity-command.ts`**

After Task 3 removed `buildAgentCardSeeds`, `skills` has no consumer left — remove it entirely here.

- Delete the block that reads plugins into `skills` (lines ~154–157):

```ts
        const selectedPluginsStr = this.config.getValue('selectedPlugins') as string | undefined;
        if (selectedPluginsStr) {
          skills = selectedPluginsStr.split(',').filter(Boolean);
        }
```

- Delete the declaration `let skills: string[] | undefined;` (line ~78).
- Delete the non-interactive producer (lines ~102–104):

```ts
      if (flags.skills) {
        skills = flags.skills.split(',').map((s: string) => s.trim());
      }
```

Verify nothing dangles: `grep -n "skills" src/commands/create-entity-command.ts` should return nothing.

- [ ] **Step 4: Strip `runtime-config.ts`**

Remove line 19: `  selectedPlugins: string;`

- [ ] **Step 5: Type-check + full test run**

Run: `pnpm type-check && pnpm test`
Expected: type-check clean (no reference to `PLUGIN_CATALOG`/`BASE_BUNDLE`/`selectedPlugins` remains); all existing tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: delete plugin catalog and all references"
```

---

### Task 6: Remove the pricing list, price prompt, and fees config

**Files:**
- Modify: `src/utils/entity.ts` — delete `createFeesConfig()` (lines ~197–260); remove it from the `Promise.all` in `createOracleConfigFiles()` (lines ~373–391); drop `price` from `oracleConfig` type (line ~47) and the `createOracleConfigFiles` param (line ~361) and its call (line ~825).
- Modify: `src/commands/create-entity-command.ts` — remove `oraclePrice` var + `--price` flag + the price prompt (new-context path line ~125–136, standalone path line ~179–186 & ~277) and `price: parseInt(oraclePrice)` (line ~398).
- Modify: `src/utils/runtime-config.ts` — remove dead `authZFile` and `feesFile` keys (lines 5–6).

- [ ] **Step 1: Remove `createFeesConfig` and its usage in `entity.ts`**

- Delete the entire `createFeesConfig(...)` method (lines ~197–260).
- In `createOracleConfigFiles`, change the `Promise.all([...])` (lines ~373–391) so only `createAuthZConfig` remains:

```ts
    const resources = await Promise.all([
      this.createAuthZConfig({
        oracleName,
        entityDid,
        oracleAccountAddress,
        homeServerUrl,
        accessToken,
      }),
    ]);
```

- In the `createOracleConfigFiles` param type (line ~361), remove `price` from the intersection — change `}: CreateEntityParams["oracleConfig"] & {` so it no longer pulls `price`. Replace the destructure header (lines ~354–366) with:

```ts
  private async createOracleConfigFiles({
    oracleName,
    entityDid,
    oracleAccountAddress,
    homeServerUrl,
    accessToken,
  }: {
    oracleName: string;
    entityDid: string;
    oracleAccountAddress: string;
    homeServerUrl: string;
    accessToken: string;
  }) {
```

(Remove the now-unused `price` destructure and the `Denom` computation that fed the fee config.)

- In `CreateEntityParams`, change `oracleConfig` (lines ~45–48) to:

```ts
  oracleConfig: {
    oracleName: string;
  };
```

- At the `createOracleConfigFiles` call (lines ~823–830), remove the `price:` line:

```ts
    await this.createOracleConfigFiles({
      oracleName: params.oracleConfig.oracleName,
      oracleAccountAddress: registerResult.address,
      entityDid: did,
      homeServerUrl: oracleHomeServerUrl,
      accessToken: oracleAccessToken,
    });
```

- If `Denom` type (lines ~54–56) is now unused, delete it. Verify with `grep -n "Denom" src/utils/entity.ts`.

- [ ] **Step 2: Remove price from `create-entity-command.ts`**

- Delete `let oraclePrice: string;` (line ~63).
- Non-interactive block: delete `oraclePrice = flags.price ?? '100';` (line ~87).
- New-context path: delete the entire price `p.text({...})` prompt and its `oraclePrice = priceResult as string;` (lines ~125–136).
- Standalone path: delete the `oraclePrice:` field from the `p.group` (lines ~179–186) and `oraclePrice = results.oraclePrice;` (line ~277).
- In the `createEntity.execute({ oracleConfig: {...} })` call (lines ~396–399), change to:

```ts
      oracleConfig: {
        oracleName,
      },
```

- [ ] **Step 3: Remove dead keys from `runtime-config.ts`**

Delete lines 5–6:

```ts
  authZFile: string;
  feesFile: string;
```

- [ ] **Step 4: Type-check + full test run**

Run: `pnpm type-check && pnpm test`
Expected: clean; all tests PASS. If `grep -rn "pricingList\|createFeesConfig\|oraclePrice\|feesFile\|authZFile" src/` returns anything outside tests, remove it.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove IXO-credits pricing list and fees config"
```

---

### Task 7: Rewrite the `qiforge new` project question set

**Files:**
- Modify: `src/commands/new.command.ts` — add avatar + network prompts; reorder; store `prefillLogo`; render template with chosen network.
- Modify: `src/utils/runtime-config.ts` — add `prefillLogo: string;`.

**Interfaces:**
- Consumes: `checkRequiredURL`, `selectNetwork` from `../utils/common`; `NETWORK` type.
- Produces (via RuntimeConfig): `network`, `prefillLogo`, plus existing `oracleName`/`prefillDescription`/`prefillOrgName`/`newCommandContext`.

- [ ] **Step 1: Add the `prefillLogo` config key**

In `src/utils/runtime-config.ts`, in the `Config` interface after `prefillOrgName`:

```ts
  prefillLogo: string;
```

- [ ] **Step 2: Add imports to `new.command.ts`**

Add to the top imports:

```ts
import { NETWORK } from '@ixo/signx-sdk/types/types/transact';
import { checkRequiredURL, selectNetwork } from '../utils/common';
```

- [ ] **Step 3: Add avatar + network prompt helpers**

Add two methods to `NewCommand` (near `getOrg`):

```ts
  private async getAvatarUrl(name: string): Promise<string> {
    const fallback = `https://api.dicebear.com/8.x/bottts/svg?seed=${encodeURIComponent(name)}`;
    const url = await p.text({
      message: 'Avatar image URL for your oracle:',
      initialValue: fallback,
      defaultValue: fallback,
      validate(value) {
        if (!value) return undefined; // empty → defaultValue (fallback) is used
        return checkRequiredURL(value, 'Avatar must be a valid URL');
      },
    });
    if (p.isCancel(url)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }
    return String(url) || fallback;
  }

  private async getNetwork(): Promise<NETWORK> {
    const choice = await p.select({
      message: 'Which network is this oracle for?',
      options: [
        { value: 'devnet', label: 'Devnet', hint: 'default' },
        { value: 'testnet', label: 'Testnet' },
        { value: 'mainnet', label: 'Mainnet' },
      ],
      initialValue: 'devnet',
    });
    if (p.isCancel(choice)) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }
    return choice as NETWORK;
  }
```

- [ ] **Step 4: Rewire the interactive branch of `execute()`**

In the interactive `else` branch (currently lines ~211–229), replace the body so the order is name → description → org → avatar → network → install, template picked as before, and network is stored:

```ts
      } else {
        const input = await this.getProjectInput();
        projectPath = input.projectPath;
        projectName = input.projectName;

        if (existsSync(projectPath) && isDirNonEmpty(projectPath)) {
          const ok = await this.confirmOverwrite(projectPath);
          if (!ok) return { success: false, data: 'Project creation cancelled' };
        }

        template = flags.template ? findTemplate(catalog, flags.template) : await this.pickTemplate(catalog);

        description = await this.getDescription();
        org = await this.getOrg();
        const avatarUrl = await this.getAvatarUrl(projectName);
        const chosenNetwork = await this.getNetwork();
        install = await this.confirmInstall();

        this.config.addValue('prefillLogo', avatarUrl);
        this.config.addValue('network', chosenNetwork);
      }
```

Note: `selectedPlugins` is already gone (Task 5). Remove the now-unused `selectNetwork` import if it isn't referenced — but it IS used by the non-interactive network defaulting below, so keep it only if referenced; otherwise drop. Verify with `grep -n selectNetwork src/commands/new.command.ts` after Step 6.

- [ ] **Step 5: Store the network in the non-interactive branch too**

In the `if (noInteractive && flags.name)` branch, after `template = findTemplate(...)`, add:

```ts
        this.config.addValue('network', (flags.network as NETWORK) ?? 'devnet');
        this.config.addValue('prefillLogo', flags.logo ?? `https://api.dicebear.com/8.x/bottts/svg?seed=${encodeURIComponent(projectName)}`);
```

- [ ] **Step 6: Render the template with the chosen network**

Find the `renderTemplate({ ... vars: { name, org, description, network: 'devnet', runtimeVersion } ... })` call (line ~250) and replace the hardcoded `network: 'devnet'` with the stored value:

```ts
          vars: {
            name: projectName,
            org,
            description,
            network: (this.config.getValue('network') as NETWORK) ?? 'devnet',
            runtimeVersion,
          },
```

- [ ] **Step 7: Type-check + lint**

Run: `pnpm type-check && pnpm lint`
Expected: clean. Remove any unused import flagged by lint.

- [ ] **Step 8: Commit**

```bash
git add src/commands/new.command.ts src/utils/runtime-config.ts
git commit -m "feat(new): avatar + network prompts, network-correct scaffolding"
```

---

### Task 8: Make the Agent Card mandatory and drop dead prompts in `create-entity-command.ts`

**Files:**
- Modify: `src/commands/create-entity-command.ts` — new-context path: consume `prefillLogo`, set network from config, make card mandatory, remove model/prompt-* prompts; delete unused A5 flag vars.

**Interfaces:**
- Consumes: `prefillLogo`, `network` from RuntimeConfig (Task 7); `promptAgentCardServices` (Task 3).

- [ ] **Step 1: Remove the discarded A5 flag vars and prompts**

In `src/commands/create-entity-command.ts` (`skills` was already removed in Task 5):
- Delete the declarations `model`, `promptOpening`, `promptStyle`, `promptCapabilities`, `mcpServers` (lines ~77–82).
- In the non-interactive block, delete their flag reads (lines ~101–114): `model = flags.model;`, `promptOpening/Style/Capabilities`, and the `flags['mcp-servers']` JSON parse block.
- In the standalone interactive path, delete the model `p.select` + custom-model handling (lines ~292–325) and the three `promptOpening/Style/Capabilities` `p.text` prompts (lines ~327–356).

- [ ] **Step 2: Use `prefillLogo` and stored network in the new-context path**

In the `if (isNewContext)` block (lines ~121–157), replace the logo/coverImage/network defaults:

```ts
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
```

Delete the removed-plugin `skills` block that Task 5 left (already gone) and the `model = 'moonshotai/kimi-k2.5';` line — model is no longer collected or passed.

The price prompt in this block is already removed (Task 6). Keep the `relayerNodeDid = await selectRelayerNode(...)` line.

- [ ] **Step 3: Make the card mandatory in the new-context flow**

Replace the Agent Card block (lines ~363–380) with:

```ts
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
```

- [ ] **Step 4: Type-check + lint**

Run: `pnpm type-check && pnpm lint`
Expected: clean. `grep -n "model\|promptOpening\|promptStyle\|promptCapabilities\|mcpServers\|skills" src/commands/create-entity-command.ts` should return nothing.

- [ ] **Step 5: Commit**

```bash
git add src/commands/create-entity-command.ts
git commit -m "feat(create-entity): mandatory Agent Card in new flow, drop dead prompts"
```

---

### Task 9: Save the Agent Card locally after the env file is written

**Files:**
- Modify: `src/utils/runtime-config.ts` — add `agentCard: AgentCard;` key.
- Modify: `src/utils/entity.ts` — stash the built card in config inside `createAgentCard()`.
- Modify: `src/commands/new.command.ts` — call `saveAgentCardLocally()` after `createProjectEnvFile()`.

**Interfaces:**
- Consumes: `saveAgentCardLocally`, `AgentCard` from `../utils/agent-card`.
- Produces (via RuntimeConfig): `agentCard` (full VC envelope), stored during entity creation.

- [ ] **Step 1: Add the `agentCard` config key**

In `src/utils/runtime-config.ts`: add the import and key.

```ts
import { AgentCard } from './agent-card';
```

In `Config`:

```ts
  agentCard: AgentCard;
```

- [ ] **Step 2: Stash the built card in `entity.ts`**

In `createAgentCard()` (line ~514), right after `const card = buildAgentCard({...});`, add:

```ts
    this.config.addValue("agentCard", card);
```

- [ ] **Step 3: Save the card after the env file in `new.command.ts`**

Add the import:

```ts
import { AgentCard, saveAgentCardLocally } from '../utils/agent-card';
```

After the `await createProjectEnvFile(this.config, this.wallet);` line (line ~277), add:

```ts
      const publishedCard = this.config.getValue('agentCard') as AgentCard | undefined;
      if (publishedCard) {
        try {
          const cardPath = saveAgentCardLocally(projectPath, publishedCard);
          p.log.success(`Agent Card saved locally at ${cardPath}`);
        } catch (err) {
          // The card is already on-chain; a local-save miss is not fatal.
          p.log.warn(`Could not save a local Agent Card copy: ${(err as Error).message}`);
        }
      }
```

- [ ] **Step 4: Extend the env-file test — `AGENT_CARD_PATH` survives a full rewrite when written afterwards**

Append to `src/__tests__/env-file.test.ts` a test that mirrors the ordering guarantee (env file written first, then `upsertEnvVar`):

```ts
describe('AGENT_CARD_PATH ordering', () => {
  it('survives when upserted after a full .env rewrite', () => {
    const filePath = tmpEnvPath();
    // Simulate createProjectEnvFile writing the whole file first…
    writeFileSync(filePath, 'ORACLE_NAME=demo\nNETWORK=devnet\n');
    // …then saveAgentCardLocally upserting AGENT_CARD_PATH afterwards.
    upsertEnvVar(filePath, 'AGENT_CARD_PATH', './agent-card.json');
    const content = readFileSync(filePath, 'utf8');
    expect(content).toContain('ORACLE_NAME=demo');
    expect(content).toContain('NETWORK=devnet');
    expect(content).toContain('AGENT_CARD_PATH=./agent-card.json');
  });
});
```

- [ ] **Step 5: Run tests + type-check**

Run: `pnpm type-check && pnpm test -- env-file`
Expected: type-check clean; env-file tests PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/utils/runtime-config.ts src/utils/entity.ts src/commands/new.command.ts src/__tests__/env-file.test.ts
git commit -m "feat(new): save Agent Card locally and set AGENT_CARD_PATH after env write"
```

---

### Task 10: `WalletProps.edKeyPin` + `resolveEdPinDecision()` pure logic

**Files:**
- Modify: `src/utils/signx/types.ts` — add `edKeyPin?: string;` to `WalletProps`.
- Modify: `src/utils/wallet.ts` — add getter `edKeyPin` and `persistEdKeyPin()`.
- Modify: `src/utils/composio.ts` — add exported pure `resolveEdPinDecision()`.
- Test: `src/__tests__/composio-pin.test.ts` (create).

**Interfaces:**
- Produces: `resolveEdPinDecision({ storedPin, blobExists }): { pin: string; persist: boolean } | { needsPrompt: true }` — decides which PIN unlocks the user-room ED key.
- Produces: `Wallet.edKeyPin: string | undefined`, `Wallet.persistEdKeyPin(pin: string): void`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/composio-pin.test.ts`:

```ts
import { resolveEdPinDecision } from '../utils/composio';

describe('resolveEdPinDecision', () => {
  it('uses the stored edKeyPin when present, regardless of blob state', () => {
    expect(resolveEdPinDecision({ storedPin: '771290', blobExists: true })).toEqual({
      pin: '771290',
      persist: false,
    });
    expect(resolveEdPinDecision({ storedPin: '771290', blobExists: false })).toEqual({
      pin: '771290',
      persist: false,
    });
  });

  it('when no stored pin and no blob yet, defers to the oracle pin (caller supplies) via needsOraclePin', () => {
    expect(resolveEdPinDecision({ storedPin: undefined, blobExists: false })).toEqual({
      useOraclePin: true,
      persist: true,
    });
  });

  it('when no stored pin but a blob exists, must prompt', () => {
    expect(resolveEdPinDecision({ storedPin: undefined, blobExists: true })).toEqual({
      needsPrompt: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- composio-pin`
Expected: FAIL — `resolveEdPinDecision is not a function`.

- [ ] **Step 3: Implement the pure decision in `composio.ts`**

Add near the top of `src/utils/composio.ts` (after imports):

```ts
export type EdPinDecision =
  | { pin: string; persist: false }
  | { useOraclePin: true; persist: true }
  | { needsPrompt: true };

/**
 * Decides which PIN unlocks the user-room ED signing key, disentangling it from
 * the per-oracle vault PIN:
 *  - a PIN persisted in the wallet (`edKeyPin`) always wins;
 *  - first run (no key stored yet) uses the oracle PIN and persists it;
 *  - a legacy key with no persisted PIN must be prompted for.
 */
export function resolveEdPinDecision(args: {
  storedPin: string | undefined;
  blobExists: boolean;
}): EdPinDecision {
  if (args.storedPin) return { pin: args.storedPin, persist: false };
  if (!args.blobExists) return { useOraclePin: true, persist: true };
  return { needsPrompt: true };
}
```

- [ ] **Step 4: Add `edKeyPin` to `WalletProps`**

In `src/utils/signx/types.ts`, in `WalletProps` (after `offlineConfig?`):

```ts
  /**
   * PIN that encrypts the user's ED signing mnemonic in their Matrix room (used
   * to mint Composio delegations). Distinct from any per-oracle vault PIN.
   * Persisted on first successful key provisioning so later projects don't
   * re-prompt or reuse the wrong PIN.
   */
  edKeyPin?: string;
```

- [ ] **Step 5: Add `edKeyPin` getter + `persistEdKeyPin` to `Wallet`**

In `src/utils/wallet.ts`, near the other getters (after `get did()`):

```ts
  get edKeyPin(): string | undefined {
    return this.wallet?.edKeyPin;
  }

  /** Persists the user's ED signing-key PIN into ~/.wallet.json. */
  public persistEdKeyPin(pin: string): void {
    if (!this.wallet) return;
    this.wallet.edKeyPin = pin;
    this.setWallet(this.wallet);
  }
```

- [ ] **Step 6: Run tests + type-check**

Run: `pnpm type-check && pnpm test -- composio-pin`
Expected: type-check clean; composio-pin tests PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/utils/signx/types.ts src/utils/wallet.ts src/utils/composio.ts src/__tests__/composio-pin.test.ts
git commit -m "feat(composio): edKeyPin persistence + resolveEdPinDecision"
```

---

### Task 11: Wire the PIN fix + failure-cause surfacing into `create-project-env-file.ts`

**Files:**
- Modify: `src/utils/composio.ts` — export a typed error so the CLI can classify decrypt-vs-network failures.
- Modify: `src/utils/create-project-env-file.ts` — resolve the ED PIN via `resolveEdPinDecision`, persist on first run, prompt legacy users, and print cause + recovery on failure.

**Interfaces:**
- Consumes: `resolveEdPinDecision`, `fetchOrCreateEdMnemonic`, `Wallet.edKeyPin`, `Wallet.persistEdKeyPin`.

- [ ] **Step 1: Detect whether the ED blob already exists**

`fetchOrCreateEdMnemonic` already reads the room state. Add a lightweight existence check exported from `composio.ts` so the caller can branch before deciding the PIN:

```ts
/** True if the user's room already holds an encrypted ED signing mnemonic. */
export async function edMnemonicExists(args: {
  matrixHomeServerUrl: string;
  matrixAccessToken: string;
  matrixRoomId: string;
}): Promise<boolean> {
  const stateUrl = `${args.matrixHomeServerUrl}/_matrix/client/v3/rooms/${encodeURIComponent(
    args.matrixRoomId,
  )}/state/ixo.room.state.secure/${ED_SIGNING_STATE_KEY}`;
  const res = await fetch(stateUrl, {
    headers: { Authorization: `Bearer ${args.matrixAccessToken}` },
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Failed to read ED signing state from Matrix (${res.status})`);
  const data = (await res.json()) as { encrypted_mnemonic?: string };
  return Boolean(data.encrypted_mnemonic);
}
```

(`ED_SIGNING_STATE_KEY` is already a module const in `composio.ts`.)

- [ ] **Step 2: Resolve the PIN in `create-project-env-file.ts`**

In `createProjectEnvFile`, inside the Composio `try` block, before `fetchOrCreateEdMnemonic` (line ~214), replace the `pin: regResult.pin` usage. Add imports at the top:

```ts
import * as p from '@clack/prompts';
import {
  COMPOSIO_BASE_URL,
  createComposioApiKey,
  edMnemonicExists,
  fetchOrCreateEdMnemonic,
  resolveEdPinDecision,
} from './composio';
```

Replace the `edMnemonic = await fetchOrCreateEdMnemonic({...})` call region with:

```ts
    const blobExists = await edMnemonicExists({
      matrixHomeServerUrl: userMatrixHomeServer,
      matrixAccessToken: userMatrixAccessToken,
      matrixRoomId: userMatrix.roomId,
    });

    const decision = resolveEdPinDecision({
      storedPin: wallet.edKeyPin,
      blobExists,
    });

    let edPin: string;
    let persistPin = false;
    if ('pin' in decision) {
      edPin = decision.pin;
    } else if ('useOraclePin' in decision) {
      edPin = regResult.pin;
      persistPin = true;
    } else {
      const entered = await p.password({
        message: 'PIN that unlocks your Composio signing key (from your first project):',
      });
      if (p.isCancel(entered)) {
        throw new Error('Composio signing-key PIN entry cancelled');
      }
      edPin = String(entered);
      persistPin = true;
    }

    const edMnemonic = await fetchOrCreateEdMnemonic({
      matrixHomeServerUrl: userMatrixHomeServer,
      matrixAccessToken: userMatrixAccessToken,
      matrixRoomId: userMatrix.roomId,
      pin: edPin,
    });

    if (persistPin) wallet.persistEdKeyPin(edPin);
```

Remove the old `fetchOrCreateEdMnemonic` call that used `pin: regResult.pin` so it isn't invoked twice.

- [ ] **Step 3: Surface cause + recovery on failure**

Replace the existing catch (line ~232):

```ts
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    const reason = /decrypt/i.test(message)
      ? 'wrong PIN for your Composio signing key'
      : /subscription|402/i.test(message)
        ? 'no active subscription for this network'
        : message;
    console.warn('⚠  Composio API key not created');
    console.warn(`   reason: ${reason}`);
    console.warn('   fix:    qiforge-cli create-composio-key');
    console.warn('   (everything else in your project is set up)');
  }
```

- [ ] **Step 4: Type-check + lint + full test run**

Run: `pnpm type-check && pnpm lint && pnpm test`
Expected: clean; all tests PASS.

- [ ] **Step 5: Manual verification (documented, run once)**

Run `qiforge new` twice with **different** vault PINs. Confirm:
1. Both runs print `Agent Card saved locally at …/agent-card.json`.
2. Both `.env` files contain `AGENT_CARD_PATH=./agent-card.json` and a non-empty `COMPOSIO_API_KEY`.
3. Choosing `testnet` scaffolds `NETWORK=testnet` in the rendered template.
4. `~/.wallet.json` contains `edKeyPin` after the first run.

If step 2's Composio key is empty, re-run the scratch diagnostic to confirm which stage failed:
`node /private/tmp/claude-501/-Users-yousef-ixo-oracles-cli/bf623d55-a11c-415e-93b8-0f0e67ece016/scratchpad/diagnose-composio.mjs`

- [ ] **Step 6: Commit**

```bash
git add src/utils/composio.ts src/utils/create-project-env-file.ts
git commit -m "fix(composio): resolve ED signing PIN from wallet, persist it, surface cause"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| §1 project question set (avatar, network up, removals) | 5, 6, 7 |
| §1 Agent Card mandatory + auto-slug + blank-to-finish | 3, 8 |
| §1 remove plugin catalog | 5 |
| §1 remove pricing list / price / fees | 6 |
| §2 Agent Card local copy (after env write) | 9 |
| §3 Composio PIN fix (edKeyPin, 3 branches) | 10, 11 |
| §4 domain-card `makesOffer` enrichment | 2, 4 |
| §5 Composio error surfacing (cause + recovery) | 11 |
| Testing: slug, offers, pin-decision, env ordering | 1, 2, 9, 10 |

**Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"; every code step shows full code.

**Type consistency:** `deriveServiceId(name, existingIds)`, `servicesToOffers(services)`, `promptAgentCardServices()` (no-arg), `resolveEdPinDecision({storedPin, blobExists})`, `edMnemonicExists({...})`, `Wallet.edKeyPin`/`persistEdKeyPin`, config keys `prefillLogo`/`agentCard` — all used consistently across the tasks that reference them.

**Ordering note:** `skills` is fully removed in Task 5 (its only consumer, `buildAgentCardSeeds`, was deleted in Task 3), so no intermediate commit carries a dangling local. `noUnusedLocals` is not set in `tsconfig.json`, but eslint would flag it — hence the clean removal.
