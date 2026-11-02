# Add a capability to an existing plugin

Recipes for each kind of capability: tool, per-request tool, sub-agent, middleware, HTTP route, shared state, per-user state, dependency. Imports come from `@ixo/oracle-runtime-workers`; Zod from `zod`.

## Add a tool

```ts
import { type PluginContext, type PluginTool, tool } from '@ixo/oracle-runtime-workers';
import { z } from 'zod';

const currentWeatherSchema = z.object({
  city: z.string().describe('City name, e.g. "Berlin".'),
});

override getTools(_ctx: PluginContext): PluginTool[] {
  return [
    tool(
      async (args) => fetchCurrentWeather(currentWeatherSchema.parse(args).city),
      {
        name: 'get_current_weather',
        description: 'Current weather for a city.',
        schema: currentWeatherSchema,
        effect: 'read', // no external effect: safe to re-run after a reset
      },
    ),
  ];
}
```

- Every schema field needs a `.describe()` — the agent reads it.
- `snake_case` names with a verb (`get_`, `list_`, `create_`, `update_`, `search_`).
- Mark read-only tools `effect: 'read'`. A tool with an external effect stays `write` (the default): the runtime will not re-run it blindly when a durable run resumes after a reset.
- Use `fetch` for HTTP. Bound every outbound call (`AbortSignal.timeout(ms)`, and honour `ctx.abortSignal`).

## Add a per-request tool

When the tool needs the user, the session or live state:

```ts
override getRequestTools(rtCtx: RuntimeContext): PluginTool[] {
  return [
    tool(
      async (args) => fetchForecast({ ...forecastSchema.parse(args), timezone: rtCtx.user.timezone }),
      { name: 'get_weather_forecast', description: "Forecast in the user's timezone.", schema: forecastSchema },
    ),
  ];
}
```

## Add a sub-agent

```ts
override getSubAgents(ctx: PluginContext): PluginSubAgent[] {
  return [
    {
      name: 'call_weather_planner_agent',
      description: 'Decide outfit / equipment from the forecast.',
      systemPrompt: 'You are a weather planner. Always fetch the forecast first, then recommend.',
      tools: [forecastTool],
      model: 'subagent',
      forwardTools: ['get_weather_forecast'],
    },
  ];
}
```

## Add a middleware

Middlewares are LangChain `createMiddleware` objects; they run after the runtime's always-on middlewares.

```ts
import { createMiddleware } from 'langchain';

override getMiddlewares(ctx: PluginContext): AgentMiddleware[] {
  return [
    createMiddleware({
      name: 'WeatherLoggingMiddleware',
      beforeModel: async () => ctx.logger.log('model call started'),
      afterModel: async () => ctx.logger.log('model call complete'),
    }),
  ];
}
```

`langchain` is a dependency of the runtime; add it to your own `package.json` (at the version the runtime pins) before importing it directly.

## Add an HTTP route

`getRoutes` replaces the Node runtime's NestJS modules: plain `{ method, path, handler }` records the Hono shell mounts.

```ts
override getRoutes(ctx: PluginContext): PluginRoute[] {
  return [
    {
      method: 'GET',
      path: '/weather/now',
      handler: async (request, _env, { auth }) => {
        const city = new URL(request.url).searchParams.get('city');
        return Response.json(await weatherNow(city));
      },
    },
  ];
}

// Routes are UCAN-authenticated unless the plugin opts them out:
override getAuthExcludedRoutes(): AuthExcludedRoute[] {
  return [{ path: 'weather/now', method: 'GET' }];
}
```

`auth` is the validated caller on authenticated routes and `null` on excluded ones.

## Keep per-user state

`ctx.kv` is durable, per user, stored in the user's Durable Object. Use it instead of instance fields.

```ts
await rtCtx.kv?.set('climate', 'last-city', city, { idleTtlMs: 7 * 24 * 3600_000 });
const last = await rtCtx.kv?.get('climate', 'last-city');
```

## Share state with other plugins

```ts
override getSharedState() {
  return {
    lastWeatherQuery: (_state, runCtx) => /* derive from state or ctx.kv */ undefined,
  };
}
```

Other plugins read it through `rtCtx.shared`.

## Declare dependencies

```ts
readonly dependsOn = ['memory'];       // hard — boot fails without it
readonly softDependsOn = ['portal'];   // soft — check ctx.availablePlugins.has('portal')
```

## Call an IXO service with UCAN

The oracle signs invocations with its Ed25519 key; gate on it:

```ts
if (!rtCtx.ucan.hasSigningKey()) return { error: 'This oracle has no UCAN signing key.' };
const invocation = await rtCtx.ucan.mintInvocation({ did: serviceDid, capability: 'ixo:my-service' });
```

## Source of truth

`node_modules/@ixo/oracle-runtime-workers/src/plugin-api/` and the bundled plugins under `src/plugins/` (the `WeatherPlugin` in `src/core/plugins/weather/` exercises every hook).
