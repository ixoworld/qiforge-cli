import { select } from "@clack/prompts";
import { NETWORK } from "@ixo/signx-sdk/types/types/transact";
import { z } from "zod";
import { RuntimeConfig } from "./runtime-config";

export const selectNetwork = async (config: RuntimeConfig) => {
  const network = await select({
    message: "Select network: (default: devnet)",
    options: [
      { value: "mainnet", label: "Mainnet" },
      { value: "testnet", label: "Testnet" },
      { value: "devnet", label: "Devnet" },
    ],
    initialValue: "devnet",
    maxItems: 1,
  });

  config.addValue("network", network as NETWORK);

  return network as NETWORK;
};

export const RELAYER_NODE_DID = {
  mainnet: "did:ixo:entity:2f22535f8b179a51d77a0e302e68d35d",
  testnet: "did:ixo:entity:3d079ebc0b332aad3305bb4a51c72edb",
  devnet: "did:ixo:entity:2f22535f8b179a51d77a0e302e68d35d",
};

/**
 * The IXO Oracle Protocol entity DID, per network. New oracle entities are
 * created as children of this protocol — picking the wrong network's DID at
 * creation will cause indexing failures since the protocol entity is
 * network-scoped.
 */
export const PARENT_PROTOCOL_DID: Record<NETWORK, string> = {
  devnet: "did:ixo:entity:1a76366f16570483cea72b111b27fd78",
  testnet: "did:ixo:entity:4fea95339b4cf738cbf0879b02d0da77",
  mainnet: "did:ixo:entity:a4dee98213e19f15e02e59873a0d9548",
};

export const MatrixHomeServerUrl: Record<NETWORK, string> = {
  devnet: "https://devmx.ixo.earth",
  testnet: "https://testmx.ixo.earth",
  mainnet: "https://mx.ixo.earth",
};

export const MatrixRoomBotServerUrl: Record<NETWORK, string> = {
  devnet: "https://rooms.bot.devmx.ixo.earth",
  testnet: "https://rooms.bot.testmx.ixo.earth",
  mainnet: "https://rooms.bot.mx.ixo.earth",
};

export const MatrixBotHomeServerUrl: Record<NETWORK, string> = {
  devnet: "https://state.bot.devmx.ixo.earth",
  testnet: "https://state.bot.testmx.ixo.earth",
  mainnet: "https://state.bot.mx.ixo.earth",
};
export const PORTAL_URL = {
  devnet: "https://ixo-portal.vercel.app",
  testnet: "https://ixo-portal.vercel.app",
  mainnet: "https://ixo-portal.vercel.app",
};

export const CHAIN_RPC = {
  mainnet: "https://impacthub.ixo.world/rpc/",
  testnet: "https://testnet.ixo.earth/rpc/",
  devnet: "https://devnet.ixo.earth/rpc/",
};

export const DOMAIN_INDEXER_URL: Record<NETWORK, string> = {
  devnet: "https://domain-indexer.devnet.ixo.earth/index",
  testnet: "https://domain-indexer.testnet.ixo.earth/index",
  mainnet: "https://domain-indexer.ixo.earth/index",
};
export const BLOCKSYNC_GRAPHQL_URL: Record<NETWORK, string> = {
  devnet: 'https://devnet-blocksync-graphql.ixo.earth/graphql',
  testnet: 'https://testnet-blocksync-graphql.ixo.earth/graphql',
  mainnet: 'https://blocksync-graphql.ixo.earth/graphql',
};

export const MEMORY_ENGINE_API = {
  devnet: "https://memory-engine.devnet.ixo.earth/",
  testnet: "https://memory-engine.testnet.ixo.earth/",
  mainnet: "https://memory-engine.ixo.earth/",
};
export const MEMORY_ENGINE_MCP = {
  devnet: "https://mcp-memory-engine.devnet.ixo.earth/",
  testnet: "https://mcp-memory-engine.testnet.ixo.earth/",
  mainnet: "https://mcp-memory-engine.ixo.earth/",
};

export const SANDBOX_API = {
  devnet: "https://ai-sandbox-devnet.ixo.earth/mcp",
  testnet: "https://ai-sandbox-testnet.ixo.earth/mcp",
  mainnet: "https://ai-sandbox.ixo.earth/mcp",
};
export const SUBSCRIPTION_API = {
  devnet: "https://subscriptions-api.ixo-api.workers.dev",
  testnet: "https://subscriptions-api-testnet.ixo-api.workers.dev/",
  mainnet: "https://subscriptions-api-mainnet.ixo-api.workers.dev/",
};
export const checkRequiredString = (
  value: string | undefined,
  message = "This  field is required",
) => {
  const schema = z.string().min(1, message);
  const result = schema.safeParse(value);
  if (!result.success) {
    return result.error.message;
  }
  return undefined;
};

export const checkIsEntityDid = (value: string | undefined) => {
  const schema = z
    .string()
    .regex(/^did:ixo:entity:[a-f0-9]{32}$/, "Invalid entity DID");
  const result = schema.safeParse(value);
  if (!result.success) {
    return result.error.message;
  }
  return undefined;
};

export const checkIsIidDid = (value: string | undefined) => {
  const schema = z
    .string()
    .regex(
      /^did:ixo:(entity:[a-f0-9]{32}|ixo1[a-z0-9]{38,58})$/,
      "Invalid DID. Expected an entity DID (did:ixo:entity:<hex>) or an account DID (did:ixo:ixo1...)",
    );
  const result = schema.safeParse(value);
  if (!result.success) {
    return result.error.message;
  }
  return undefined;
};

export const checkRequiredURL = (
  value: string | undefined,
  message = "This url is required or a valid URL",
) => {
  const schema = z.url(message);
  const result = schema.safeParse(value);
  if (!result.success) {
    return result.error.message;
  }
  return undefined;
};

export const checkRequiredNumber = (
  value: number,
  message = "This number is required",
) => {
  const schema = z.number().min(1, message);
  const result = schema.safeParse(value);
  if (!result.success) {
    return result.error.message;
  }
  return undefined;
};

export const checkRequiredPin = (value: string | undefined) => {
  const schema = z
    .string()
    .min(1, "PIN is required")
    .refine((v) => /^\d{6}$/.test(v), "PIN must be exactly 6 digits");
  const result = schema.safeParse(value);
  if (!result.success) {
    return result.error.issues[0]?.message ?? "Invalid PIN";
  }
  return undefined;
};

export const checkRequiredMatrixUrl = (value: string | undefined) => {
  const schema = z
    .string()
    .min(1, "Matrix homeserver URL is required")
    .refine(
      (v) => /^https?:\/\//.test(v),
      "Must start with http:// or https://",
    )
    .refine((v) => !v.endsWith("/"), "Must not end with a trailing slash");
  const result = schema.safeParse(value);
  if (!result.success) {
    return result.error.issues[0]?.message ?? "Invalid Matrix URL";
  }
  return undefined;
};

export interface MatrixUrls {
  homeServerUrl: string;
  roomBotUrl: string;
  stateBotUrl: string;
  bidsBotUrl: string;
  claimsBotUrl: string;
}

/**
 * Derives all Matrix bot URLs from a homeserver URL using subdomain convention.
 * e.g. https://devmx.ixo.earth → https://rooms.bot.devmx.ixo.earth
 */
export function deriveMatrixUrls(homeServerUrl: string): MatrixUrls {
  const url = new URL(homeServerUrl);
  const domain = url.hostname;
  const protocol = url.protocol;

  return {
    homeServerUrl,
    roomBotUrl: `${protocol}//rooms.bot.${domain}`,
    stateBotUrl: `${protocol}//state.bot.${domain}`,
    bidsBotUrl: `${protocol}//bids.bot.${domain}`,
    claimsBotUrl: `${protocol}//claims.bot.${domain}`,
  };
}
