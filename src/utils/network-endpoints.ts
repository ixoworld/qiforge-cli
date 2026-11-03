/**
 * Per-network IXO service endpoints. Dependency-free (types only) so unit
 * tests can import it; `common.ts` re-exports everything here.
 */
import type { NETWORK } from "@ixo/signx-sdk/types/types/transact";

export const MatrixHomeServerUrl: Record<NETWORK, string> = {
  devnet: "https://devmx.ixo.earth",
  testnet: "https://testmx.ixo.earth",
  mainnet: "https://mx.ixo.earth",
};

/**
 * The domain indexer's origin, per network. The oracle's `DOMAIN_INDEXER_URL`
 * var is this origin; the CLI submits new entities to `<origin>/index`.
 */
export const DOMAIN_INDEXER_URL: Record<NETWORK, string> = {
  devnet: "https://domain-indexer.devnet.ixo.earth",
  testnet: "https://domain-indexer.testnet.ixo.earth",
  mainnet: "https://domain-indexer.ixo.earth",
};

/** The IXO VFS (users' owner copies and file tools), per network. */
export const VFS_BASE_URL: Record<NETWORK, string> = {
  devnet: "https://devnet.vfs.ixo.earth",
  testnet: "https://testnet.vfs.ixo.earth",
  mainnet: "https://vfs.ixo.earth",
};

/** The UCAN store the vfs plugin reads its grants from, per network. */
export const UCAN_STORE_URL: Record<NETWORK, string> = {
  devnet: "https://devnet.store.ucan.ixo.earth",
  testnet: "https://testnet.store.ucan.ixo.earth",
  mainnet: "https://store.ucan.ixo.earth",
};

/** IXO's Firecrawl MCP server (one deployment serves every network). */
export const FIRECRAWL_MCP_URL = "https://mcp-firecrawl.ixo.earth/v2/mcp";

/** The skills capsule registry (one deployment serves every network). */
export const SKILLS_CAPSULES_BASE_URL = "https://capsules.skills.ixo.earth";

export const BLOCKSYNC_GRAPHQL_URL: Record<NETWORK, string> = {
  devnet: 'https://devnet-blocksync-graphql.ixo.earth/graphql',
  testnet: 'https://testnet-blocksync-graphql.ixo.earth/graphql',
  mainnet: 'https://blocksync-graphql.ixo.earth/graphql',
};

export const MEMORY_ENGINE_API = {
  devnet: "https://memory-engine.devnet.ixo.earth",
  testnet: "https://memory-engine.testnet.ixo.earth",
  mainnet: "https://memory-engine.ixo.earth",
};

export const MEMORY_ENGINE_MCP = {
  devnet: "https://mcp-memory-engine.devnet.ixo.earth/mcp",
  testnet: "https://mcp-memory-engine.testnet.ixo.earth/mcp",
  mainnet: "https://mcp-memory-engine.ixo.earth/mcp",
};

export const SANDBOX_API = {
  devnet: "https://ai-sandbox-devnet.ixo.earth/mcp",
  testnet: "https://ai-sandbox-testnet.ixo.earth/mcp",
  mainnet: "https://ai-sandbox.ixo.earth/mcp",
};
