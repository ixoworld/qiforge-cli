# Add a capability to an existing plugin

Recipes for adding each kind of capability — tool, sub-agent, middleware, HTTP route, shared state, dependency.

## Add a tool

Tools are functions the agent calls. Use `getTools` when the tool list is fixed; use `getRequestTools` when the tool needs per-request context.

```ts
import { OraclePlugin, type PluginContext, type PluginTool, tool, z } from '@ixo/oracle-runtime';

override getTools(ctx: PluginContext): PluginTool[] {
  return [
    tool(
      async (args, rtCtx) => {
        const { city } = args as { city: string };
        return fetchCurrentWeather(city);
      },
      {
        name: 'get_current_weather',
        description: 'Current weather for a city.',
        schema: z.object({ city: z.string().describe('City name, e.g. "Berlin".') }),
      },
    ),
  ];
}
```

**Schema rules**: every field needs a `.describe()`. The agent reads descriptions; they're not optional documentation.

**Naming**: use `snake_case` and a verb prefix (`get_`, `list_`, `create_`, `update_`, `search_`). The runtime is opinionated about this — it's what the agent reads.

## Add a per-request tool

When the tool needs `rtCtx.user`, `rtCtx.session`, or fresh `rtCtx.config`:

```ts
override getRequestTools(rtCtx: RuntimeContext): PluginTool[] {
  return [
    tool(
      async (args) => {
        const { days } = args as { days: number };
        return fetchForecast({ days, timezone: rtCtx.user.timezone });
      },
      {
        name: 'get_weather_forecast',
        description: 'Forecast for the user\'s timezone.',
        schema: z.object({ days: z.number().int().min(1).max(14) }),
      },
    ),
  ];
}
```

## Add a sub-agent

Sub-agents are mini-agents the main agent can call as a tool. They have their own system prompt and tool set.

```ts
import type { PluginSubAgent } from '@ixo/oracle-runtime';

override getSubAgents(ctx: PluginContext): PluginSubAgent[] {
  return [
    {
      name: 'call_weather_planner_agent',
      description: 'Decide outfit / equipment based on the forecast.',
      systemPrompt: 'You are a weather-planner. Always fetch the forecast first, then recommend.',
      tools: ctx => [getCurrentWeatherTool, getForecastTool],
      model: 'subagent',
      forwardTools: ['get_weather_forecast'],   // stream sub-agent tool calls back to the main turn
    },
  ];
}
```

## Add a middleware

Middlewares wrap every model call in the agent loop — useful for logging, retry, transformation, safety checks.

```ts
import type { AgentMiddleware } from '@ixo/oracle-runtime';

override getMiddlewares(ctx: PluginContext): AgentMiddleware[] {
  return [
    {
      name: 'weather-logger',
      beforeCall: async (state) => {
        ctx.logger.log(`[weather] turn ${state.messages.length}`);
      },
      afterCall: async (_state, response) => {
        ctx.logger.log(`[weather] model returned ${response.content.length} chars`);
      },
    },
  ];
}
```

## Add HTTP routes (via NestJS)

Plugins can mount their own Nest controllers / modules. Use this for public webhooks, health checks, or any HTTP surface that doesn't fit the agent loop.

```ts
import { Module, Controller, Get } from '@nestjs/common';

@Controller('weather')
class WeatherController {
  @Get('now')
  async now() {
    return { ok: true, source: 'open-meteo' };
  }
}

@Module({ controllers: [WeatherController] })
class WeatherHttpModule {}

override getNestModules(_ctx: PluginContext) {
  return [WeatherHttpModule];
}
```

**Auth**: by default every route requires a UCAN header. To make a route public:

```ts
import { RequestMethod } from '@nestjs/common';

override getAuthExcludedRoutes(): AuthExcludedRoute[] {
  return [{ path: 'weather/now', method: RequestMethod.GET }];
}
```

## Share state with other plugins

`getSharedState` returns selectors that other plugins read via `rtCtx.shared.<key>`. Useful when plugin B needs the last query of plugin A.

```ts
override getSharedState() {
  return {
    lastWeatherQuery: (_state, runCtx) => this.lastBySession.get(runCtx.session.id),
  };
}
```

## Declare dependencies

```ts
class CreditsAwarePlugin extends OraclePlugin {
  readonly dependsOn = ['credits'];        // hard — boot fails if missing
  readonly softDependsOn = ['memory'];     // soft — branches on availability
}
```

In code, check soft deps via `ctx.has('memory')` before using their shared state.

## Source of truth

Each recipe is documented separately:

- https://docs.ixo.world/build-an-oracle/build/plugin-recipes/add-a-tool
- https://docs.ixo.world/build-an-oracle/build/plugin-recipes/add-a-sub-agent
- https://docs.ixo.world/build-an-oracle/build/plugin-recipes/add-a-middleware
- https://docs.ixo.world/build-an-oracle/build/plugin-recipes/add-http-endpoints
- https://docs.ixo.world/build-an-oracle/build/plugin-recipes/share-state
- https://docs.ixo.world/build-an-oracle/build/plugin-recipes/declare-dependencies
- https://docs.ixo.world/build-an-oracle/build/plugin-recipes/set-visibility
- https://docs.ixo.world/build-an-oracle/build/plugin-recipes/add-config-and-env
