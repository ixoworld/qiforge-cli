export interface PluginEntry {
  value: string;
  label: string;
  hint: string;
  envVars: string[];
}

export const PLUGIN_CATALOG: PluginEntry[] = [
  {
    value: 'memory',
    label: 'Memory',
    hint: 'Long-term memory — remembers context across sessions',
    envVars: ['MEMORY_ENGINE_URL', 'MEMORY_MCP_URL'],
  },
  { value: 'sandbox', label: 'Sandbox', hint: 'Sandboxed code execution and file tools', envVars: ['SANDBOX_MCP_URL'] },
  {
    value: 'skills',
    label: 'Skills',
    hint: 'Discover and invoke AI agent skills from the skills registry',
    envVars: ['SKILLS_CAPSULES_BASE_URL'],
  },
  {
    value: 'composio',
    label: 'Composio',
    hint: '250+ integrations — Slack, GitHub, Gmail, Notion, and more',
    envVars: ['COMPOSIO_API_KEY'],
  },
  {
    value: 'firecrawl',
    label: 'Firecrawl',
    hint: 'Web scraping, crawling, and real-time search',
    envVars: ['FIRECRAWL_API_KEY'],
  },
  {
    value: 'domain-indexer',
    label: 'Domain Indexer',
    hint: 'Index and search IXO entities on-chain',
    envVars: ['DOMAIN_INDEXER_URL'],
  },
  {
    value: 'user-preferences',
    label: 'User Preferences',
    hint: 'Persist per-user settings across sessions',
    envVars: [],
  },
  { value: 'portal', label: 'Portal', hint: 'IXO portal integration for claims and projects', envVars: [] },
  { value: 'credits', label: 'Credits', hint: 'Token-based usage credits and rate limiting', envVars: ['REDIS_URL'] },
];

export const BASE_BUNDLE = ['memory', 'sandbox'];
