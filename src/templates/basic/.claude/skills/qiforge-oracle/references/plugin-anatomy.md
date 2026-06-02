# Plugin anatomy

A QiForge plugin is a class extending `OraclePlugin` with up to 9 optional hooks. Three fields are required: `name`, `version`, `manifest`. Everything else is opt-in.

## The class

```ts
import { OraclePlugin, type PluginContext, type RuntimeContext } from '@ixo/oracle-runtime';

abstract class OraclePlugin {
  abstract readonly name: string;            // kebab-case, unique
  abstract readonly version: string;         // semver
  abstract readonly manifest: PluginManifest;

  readonly dependsOn?: string[];             // hard deps — boot fails if missing
  readonly softDependsOn?: string[];         // soft deps — branches on availability
  readonly configSchema?: z.ZodObject<any>;  // merged into runtime env schema

  autoDetect?(env: NodeJS.ProcessEnv): boolean;   // skip plugin when false
  readonly autoDetectHint?: string;                // surfaced in boot errors

  // Boot-time hooks (called once with PluginContext)
  getTools?(ctx: PluginContext): PluginTool[] | Promise<PluginTool[]>;
  getSubAgents?(ctx: PluginContext): PluginSubAgent[];
  getMiddlewares?(ctx: PluginContext): AgentMiddleware[];
  getNestModules?(ctx?: PluginContext): Array<Type | DynamicModule>;
  getAuthExcludedRoutes?(): AuthExcludedRoute[];
  getSharedState?(): Record<string, (state: any, runCtx: RuntimeContext) => unknown>;

  // Per-request hooks (called with RuntimeContext built fresh each turn)
  getRequestTools?(rtCtx: RuntimeContext): PluginTool[] | Promise<PluginTool[]>;
  getRequestSubAgents?(rtCtx: RuntimeContext): PluginSubAgent[] | Promise<PluginSubAgent[]>;
}
```

**Boot-time vs per-request**: use `getTools` when the tool list is fixed (same for every user). Use `getRequestTools` when the tool needs `rtCtx.user`, `rtCtx.session`, or `rtCtx.config` resolved for the current turn.

## The manifest

The manifest is what the agent sees — `whenToUse` drives Tier-1 prompt inclusion and `list_capabilities` discovery.

```ts
interface PluginManifest {
  title: string;                            // human name
  summary: string;                          // one line — shown in Tier-1 prompt when visibility='always'
  whenToUse: string[];                      // triggers — when the agent should reach for this plugin
  whenNotToUse?: string[];                  // anti-patterns
  examples?: { user: string; thought?: string; tool: string; args?: Record<string, unknown> }[];
  tags?: string[];
  category?: 'data' | 'communication' | 'automation' | 'memory' | 'integration' | 'ui' | 'auth' | 'observability' | 'core';
  visibility?: 'always' | 'on-demand' | 'silent';  // default: 'on-demand'
  stability?: 'stable' | 'beta' | 'experimental';
}
```

## Visibility — when does the plugin's stuff load?

| Visibility | Bound at boot? | In Tier-1 prompt? | Discoverable via `list_capabilities`? |
| --- | --- | --- | --- |
| `always` | yes | yes (summary in prompt) | yes |
| `on-demand` (default) | no — until `load_capability(name)` | no | yes |
| `silent` | yes, but agent doesn't see them | no | no |

**Rule of thumb**: default to `on-demand`. Reserve `always` for capabilities the agent will use in nearly every turn (memory, user preferences). Use `silent` for middleware-only plugins or background side-effects.

## Tools and sub-agents

```ts
interface PluginTool {
  name: string;
  description: string;
  schema: z.ZodType;
  handler: (args: unknown, ctx: RuntimeContext) => Promise<unknown>;
  visibility?: 'always' | 'on-demand' | 'silent';   // overrides plugin default per tool
}

interface PluginSubAgent {
  name: string;                                      // e.g. 'call_memory_agent'
  description: string;
  systemPrompt: string | ((ctx: PluginContext) => string);
  tools: PluginTool[] | ((ctx: PluginContext) => PluginTool[]);
  model?: ModelRole;                                 // default 'subagent' — see note below
  middlewares?: AgentMiddleware[];
  forwardTools?: boolean | string[];                 // forward calls to main message stream
  onComplete?: (result: string, ctx: RuntimeContext) => Promise<void>;
}
```

**`ModelRole` values:** `'main'` (the primary conversational model), `'subagent'` (default for sub-agents — typically a faster/cheaper model), `'utility'` (for lightweight classification or extraction tasks), or any custom string key registered in the runtime's model registry. Use `'subagent'` unless you have a specific reason to select a different tier.

## Tool authoring helper

Use the `tool()` helper for less boilerplate:

```ts
import { tool, z } from '@ixo/oracle-runtime';

tool(
  async (args, ctx) => {
    const { query } = args as { query: string };
    return { echoed: query };
  },
  {
    name: 'my_tool',
    description: 'Does the thing.',
    schema: z.object({ query: z.string() }),
  },
);
```

## The two contexts

- **`PluginContext`** — built once at boot. Carries `config` (validated env), `logger`, ambient services, and identity. Pass it through `getTools` / `getSubAgents` / `getMiddlewares` / `getNestModules` / `getSharedState`.
- **`RuntimeContext`** — built per request. Full shape:

```ts
interface RuntimeContext {
  user: {
    did: string;
    matrixUserId: string;
    ucanDelegation: UcanDelegation;
    timezone?: string;
    currentTime?: string;
  };
  session: {
    id: string;
    client: 'portal' | 'matrix' | 'slack';
    wsId?: string;
    requestId: string;
    roomId?: string;
  };
  history: {
    messages: readonly BaseMessage[];
    recent(n: number): BaseMessage[];
    userContext: UserContextData;   // the 6 pre-fetched memory slots
    state: ReadonlyState;
  };
  config: TConfig;                  // validated plugin config (from configSchema)
  availablePlugins: ReadonlySet<string>;
  loadedPlugins: ReadonlySet<string>;
  secrets: {
    getIndex(): Promise<SecretIndex>;
    getValues(keys: string[]): Promise<Record<string, string>>;
  };
  matrix: {
    postToRoom(roomId: string, content: unknown): Promise<string>;
    getRoomState(roomId: string): Promise<RoomStateSnapshot>;
    getEventById(roomId: string, eventId: string): Promise<MatrixEvent>;
  };
  ucan: {
    requireCapability(resource: string, action: string): void;
    hasCapability(resource: string, action: string): boolean;
    mintInvocation(target: string, opts?: unknown): Promise<string>;
    resolveServiceDid(url: string): Promise<string | null>;
  };
  llm: {
    get(role: ModelRole, params?: unknown): BaseChatModel;
  };
  emit: {
    toolCall(...args: unknown[]): void;
    actionCall(...args: unknown[]): void;
    renderComponent(...args: unknown[]): void;
    reasoning(...args: unknown[]): void;
    browserToolCall(...args: unknown[]): void;
    router(...args: unknown[]): void;
    messageCacheInvalidation(...args: unknown[]): void;
  };
  logger: Logger;
  abortSignal: AbortSignal;
  shared: SharedAccessors;
  toolCallId?: string;
}
```

Pass `RuntimeContext` through `getRequestTools` / `getRequestSubAgents` and into every tool handler.

## Source of truth

- https://docs.ixo.world/build-an-oracle/reference/plugin-api
- https://docs.ixo.world/build-an-oracle/reference/manifest-schema
- https://docs.ixo.world/build-an-oracle/understand/plugin-anatomy
- https://docs.ixo.world/build-an-oracle/understand/contexts
- https://docs.ixo.world/build-an-oracle/understand/visibility-tiers
