# Plugin anatomy

A plugin is a class extending `OraclePlugin` from `@ixo/oracle-runtime-workers`. Three fields are required — `name`, `version`, `manifest` — everything else is opt-in. (Source: `node_modules/@ixo/oracle-runtime-workers/src/plugin-api/oracle-plugin.ts` and `types.ts`.)

## The class

```ts
import {
  OraclePlugin,
  type PluginContext,
  type PluginEnv,
  type PluginManifest,
  type PluginTool,
  type RuntimeContext,
} from '@ixo/oracle-runtime-workers';
import { z } from 'zod';

abstract class OraclePlugin {
  abstract readonly name: string;            // kebab-case, unique
  abstract readonly version: string;
  abstract readonly manifest: PluginManifest;

  readonly operatingGuide?: string;          // working rules, sent only on turns that use the plugin
  readonly dependsOn?: string[];             // hard deps — boot fails if missing
  readonly softDependsOn?: string[];         // soft deps — branch on ctx.availablePlugins
  readonly configSchema?: z.ZodObject<any>;  // merged into the env schema validated at boot

  autoDetect?(env: PluginEnv): boolean;      // the Worker env bindings, not process.env
  readonly autoDetectHint?: string;          // shown when the plugin is skipped

  // Boot-time hooks (once per isolate, with PluginContext)
  getTools?(ctx: PluginContext): PluginTool[] | Promise<PluginTool[]>;
  getSubAgents?(ctx: PluginContext): PluginSubAgent[];
  getDecisions?(ctx: PluginContext): DecisionRegistration[];
  getMiddlewares?(ctx: PluginContext): AgentMiddleware[];
  getRoutes?(ctx: PluginContext): PluginRoute[];       // HTTP routes on the shell (replaces Node's getNestModules)
  getAuthExcludedRoutes?(): AuthExcludedRoute[];      // routes that skip UCAN auth
  getSharedState?(): Record<string, (state: any, runCtx: RuntimeContext) => unknown>;

  // Per-request hooks (with the RuntimeContext of the turn)
  getRequestTools?(rtCtx: RuntimeContext): PluginTool[] | Promise<PluginTool[]>;
  getRequestSubAgents?(rtCtx: RuntimeContext): PluginSubAgent[] | Promise<PluginSubAgent[]>;
  getRequestMiddlewares?(rtCtx: RuntimeContext): AgentMiddleware[] | Promise<AgentMiddleware[]>;
  getRequestAdmission?(ctx: RequestAdmissionContext): RequestAdmissionResult | Promise<RequestAdmissionResult>;
}
```

**Boot-time vs per-request**: `getTools` when the tool list is the same for every user; `getRequestTools` when it depends on the user, the session or live state. Boot-time results are cached per isolate.

**Plugin instances live as long as the isolate** and are shared by every user the isolate serves. Never keep per-user state on `this`; use `ctx.kv`.

## The manifest

What the agent sees. `whenToUse` drives discovery.

```ts
interface PluginManifest {
  title: string;
  summary: string;                 // shown in the Tier-1 prompt for `always` plugins
  whenToUse: string[];
  whenNotToUse?: string[];
  examples?: { user: string; thought?: string; tool: string; args?: Record<string, unknown> }[];
  tags?: string[];
  category?: 'data' | 'communication' | 'automation' | 'memory' | 'integration' | 'ui' | 'auth' | 'observability' | 'core';
  visibility?: 'always' | 'on-demand' | 'silent';   // default 'on-demand'
  stability?: 'stable' | 'beta' | 'experimental';
  requires?: ReadonlyArray<{ resource: string; action: string }>;  // UCAN capabilities the user's delegation must grant
}
```

| Visibility | Tools bound? | In the Tier-1 prompt? | Discoverable via `list_capabilities`? |
| --- | --- | --- | --- |
| `always` | every turn | yes (summary) | yes |
| `on-demand` (default) | after `load_capability(name)` (or the capability router preloads it) | no | yes |
| `silent` | middleware-only | no | no |

Default to `on-demand`. A host can retune a loaded plugin's manifest without forking it: `createOracleWorker({ manifestOverrides: { portal: { visibility: 'always' } } })`.

## Tools

```ts
interface PluginTool {
  name: string;                    // snake_case, verb first
  description: string;
  schema: z.ZodType;               // every field .describe()d
  handler: (args: unknown, ctx: RuntimeContext) => Promise<unknown>;
  visibility?: 'always' | 'on-demand' | 'silent';
  plane?: 'orchestration' | 'admin';   // admin: needs an admin-tool/invoke grant in the user's delegation
  effect?: 'read' | 'write';           // read = safe to run again when a turn resumes after a reset
  repeatable?: boolean;                // same args again is a new action (a UI step)
  surface?: 'frontend';                // acts in the user's browser
}
```

Build them with the `tool(handler, options)` helper (see `add-a-tool.md`). Zod comes from your own `zod` dependency (`import { z } from 'zod'`); the runtime does not re-export it.

## Sub-agents

```ts
interface PluginSubAgent {
  name: string;                    // e.g. 'call_weather_planner_agent'
  description: string;
  systemPrompt: string | ((ctx: PluginContext) => string);
  tools: PluginTool[] | ((ctx: PluginContext) => PluginTool[]);
  model?: ModelRole;               // 'main' | 'subagent' | 'utility' | custom
  middlewares?: AgentMiddleware[];
  forwardTools?: boolean | string[];
  onComplete?: (result: string, ctx: RuntimeContext) => Promise<void>;
}
```

## The two contexts

- **`PluginContext`** — boot time: `config` (validated env), `identity` (`name`, `org`, `description`, `entityDid`, `prompt`), `availablePlugins`, `logger`. No user, no session.
- **`RuntimeContext`** — built per turn. The parts plugins use most:
  - `user` — `did`, `matrixUserId`, `ucanDelegation`, `timezone`, `currentTime`
  - `session` — `id`, `client` (`portal` | `matrix` | `slack` | `channel`), `requestId`, `runId`, `roomId`, `surface`
  - `history` — `messages`, `recent(n)`, `userContext` (memory prefetch), `state`
  - `config`, `availablePlugins`, `loadedPlugins`
  - `kv` — durable per-user key/value state (`get`, `set`, `update`, `delete`, by namespace)
  - `ucan` — `hasCapability`, `requireCapability`, `mintInvocation`, `createInvocationFromDelegation`, `hasSigningKey()`
  - `secrets` — the user's per-room secrets (`getIndex`, `getValues`, `getAll`)
  - `matrix` — `postToRoom`, `postEvent`, `getRoomState`, `getEventById`
  - `llm.get(role)`, `decisions.evaluate(...)`, `emit.*`, `logger`, `abortSignal`, `shared`, `background(promise)`, `onTurnEnd(dispose)`

`ctx.ucan.hasSigningKey()` is false when the oracle has no Ed25519 UCAN signing key; tools that call IXO services (VFS, memory engine, sandbox) gate on it. `qiforge-cli new` provisions the key; `qiforge-cli setup-signing-key` adds it to older oracles.
