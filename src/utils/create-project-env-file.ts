import { NETWORK } from '@ixo/signx-sdk/types/types/transact';
import fs from 'fs';
import path from 'path';
import { mxLogin } from './account/matrix';
import {
  BLOCKSYNC_GRAPHQL_URL,
  CHAIN_RPC,
  DOMAIN_INDEXER_URL,
  MatrixHomeServerUrl,
  MEMORY_ENGINE_API,
  MEMORY_ENGINE_MCP,
  SANDBOX_API,
  SUBSCRIPTION_API,
} from './common';
import { COMPOSIO_BASE_URL, createComposioApiKey, fetchOrCreateEdMnemonic } from './composio';
import { RuntimeConfig } from './runtime-config';
import { Wallet } from './wallet';

interface EnvValues {
  oracleName: string;
  network: NETWORK;
  matrixBaseUrl: string;
  matrixAccessToken: string;
  matrixPassword: string;
  matrixUserId: string;
  matrixRecoveryPhrase: string;
  matrixPin: string;
  matrixRoomId: string;
  mnemonic: string;
  entityDid: string;
  oracleAddress: string;
  oracleDid: string;
  composioApiKey: string;
}

function buildEnvContent(net: NETWORK, values: EnvValues): string {
  return `
NODE_ENV=development
PORT=3000
CORS_ORIGIN=*
ORACLE_NAME=${values.oracleName}

# Network
NETWORK=${net}
RPC_URL=${CHAIN_RPC[net]}
BLOCKSYNC_GRAPHQL_URL=${BLOCKSYNC_GRAPHQL_URL[net]}
BLOCKSYNC_URI=${BLOCKSYNC_GRAPHQL_URL[net].replace('/graphql', '')}

# Matrix
MATRIX_BASE_URL=${values.matrixBaseUrl}
MATRIX_ORACLE_ADMIN_ACCESS_TOKEN=${values.matrixAccessToken}
MATRIX_ORACLE_ADMIN_PASSWORD=${values.matrixPassword}
MATRIX_ORACLE_ADMIN_USER_ID=${values.matrixUserId}
MATRIX_RECOVERY_PHRASE="${values.matrixRecoveryPhrase}"
MATRIX_VALUE_PIN=${values.matrixPin}
MATRIX_ACCOUNT_ROOM_ID="${values.matrixRoomId}"
MATRIX_STORE_PATH=./.data/matrix-storage
ORACLE_DID=${values.oracleDid}

# Blockchain
SECP_MNEMONIC="${values.mnemonic}"
ORACLE_ENTITY_DID=${values.entityDid}

# Database
SQLITE_DATABASE_PATH=./.data/sqlite
REDIS_URL=redis://localhost:6379

# LLM (add your API keys)
OPENAI_API_KEY=
OPEN_ROUTER_API_KEY=

# External Services (configure these for your deployment)
MEMORY_MCP_URL=${MEMORY_ENGINE_MCP[net]}
MEMORY_ENGINE_URL=${MEMORY_ENGINE_API[net]}

# FIRECRWAL -> check the docs https://docs.firecrawl.dev/mcp-server
FIRECRAWL_MCP_URL=${SANDBOX_API[net]}
DOMAIN_INDEXER_URL=${DOMAIN_INDEXER_URL[net]}
SANDBOX_MCP_URL=${SANDBOX_API[net]}

# Observability (optional)
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=
LANGSMITH_API_KEY=
LANGSMITH_PROJECT="${values.oracleName}_${net}"


DISABLE_CREDITS=true
SUBSCRIPTION_URL=${SUBSCRIPTION_API[net]}

### BACKUP — save these securely (values above are already set)
# ORACLE_ADDRESS=${values.oracleAddress}

SKILLS_CAPSULES_BASE_URL="https://capsules.skills.ixo.earth"

# Composio
COMPOSIO_BASE_URL=${COMPOSIO_BASE_URL}
COMPOSIO_API_KEY=${values.composioApiKey}
`;
}

function buildEnvContentForNetwork(net: NETWORK, oracleName: string): string {
  return `# To fill in the blank values, run: qiforge-cli create-entity (select ${net})

NODE_ENV=development
PORT=3000
ORACLE_NAME=${oracleName}

# Network
NETWORK=${net}
RPC_URL=${CHAIN_RPC[net]}
BLOCKSYNC_GRAPHQL_URL=${BLOCKSYNC_GRAPHQL_URL[net]}
BLOCKSYNC_URI=${BLOCKSYNC_GRAPHQL_URL[net].replace('/graphql', '')}

# Matrix
MATRIX_BASE_URL=${MatrixHomeServerUrl[net]}
MATRIX_ORACLE_ADMIN_ACCESS_TOKEN=
MATRIX_ORACLE_ADMIN_PASSWORD=
MATRIX_ORACLE_ADMIN_USER_ID=
MATRIX_RECOVERY_PHRASE=
MATRIX_VALUE_PIN=
MATRIX_ACCOUNT_ROOM_ID=
MATRIX_STORE_PATH=./.data/matrix-storage

# Blockchain
SECP_MNEMONIC=
ORACLE_ENTITY_DID=

# Database
SQLITE_DATABASE_PATH=./.data/sqlite
REDIS_URL=redis://localhost:6379

# LLM (add your API keys)
OPENAI_API_KEY=
OPEN_ROUTER_API_KEY=

# External Services (configure these for your deployment)
MEMORY_MCP_URL=${MEMORY_ENGINE_MCP[net]}
MEMORY_ENGINE_URL=${MEMORY_ENGINE_API[net]}

# FIRECRWAL -> check the docs https://docs.firecrawl.dev/mcp-server
FIRECRAWL_MCP_URL=${SANDBOX_API[net]}
DOMAIN_INDEXER_URL=${DOMAIN_INDEXER_URL[net]}
SANDBOX_MCP_URL=${SANDBOX_API[net]}

# Observability (optional)
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=
LANGSMITH_API_KEY=
LANGSMITH_PROJECT="${oracleName}_${net}"


# Features (optional)
# DISABLE_CREDITS=false
# CORS_ORIGIN=*
# SUBSCRIPTION_URL=${SUBSCRIPTION_API[net]}
`;
}

function writeEnvFile(filePath: string, content: string): void {
  try {
    fs.writeFileSync(filePath, content);
    console.log('✅ env file created successfully at:', filePath);
  } catch (error) {
    console.error('❌ Failed to create env file:', filePath, error);
    throw error;
  }
}

export const createProjectEnvFile = async (config: RuntimeConfig, wallet: Wallet) => {
  const oracleMatrixHomeServerUrl = config.getOrThrow('oracleMatrixHomeServerUrl');
  const network = config.getOrThrow('network') as NETWORK;
  const regResult = config.getOrThrow('registerUserResult');

  // Use matrix-js-sdk login to get a clean access token for the oracle.
  const freshMx = await mxLogin({
    homeServerUrl: oracleMatrixHomeServerUrl,
    username: regResult.matrixUserId,
    password: regResult.matrixPassword,
    deviceName: 'Oracle Service',
  });
  const projectPath = config.getOrThrow('projectPath');
  const envDir = projectPath;

  console.log('Creating env files in:', envDir);

  if (!fs.existsSync(envDir)) {
    console.log('Creating directory:', envDir);
    fs.mkdirSync(envDir, { recursive: true });
  }

  const oracleName = (config.getValue('projectName') as string) ?? '';
  const entityDid = config.getOrThrow('entityDid');

  // Mint a Composio API key for the oracle. This is delegated by the *user's*
  // wallet identity (not the oracle's): the ED signing mnemonic lives in the
  // user's Matrix room and the on-chain verification method is added to the
  // user's IID, signed by the user's wallet. Using the oracle's account here
  // would fail because the oracle cannot modify the user's IID document.
  let composioApiKey = '';
  try {
    console.log('🔑 Setting up Composio API key...');

    const userMatrixHomeServer = wallet.matrixHomeServer;
    const userMatrix = wallet.matrix;
    if (!userMatrixHomeServer || !userMatrix?.roomId || !wallet.address || !wallet.did) {
      throw new Error('User wallet Matrix credentials are incomplete');
    }

    // Use a fresh user Matrix token (offline wallets re-login) so a stale
    // stored token doesn't break the room-state read/write below.
    const userMatrixAccessToken = await wallet.getFreshMatrixAccessToken();

    const edMnemonic = await fetchOrCreateEdMnemonic({
      matrixHomeServerUrl: userMatrixHomeServer,
      matrixAccessToken: userMatrixAccessToken,
      matrixRoomId: userMatrix.roomId,
      pin: regResult.pin,
    });

    composioApiKey = await createComposioApiKey({
      userDid: wallet.did,
      oracleDid: regResult.did,
      address: wallet.address,
      edMnemonic,
      network,
      label: oracleName,
      signAndBroadcast: (msgs, memo) => wallet.signAndBroadcast(msgs, memo),
    });
    console.log('✅ Composio API key created');
    console.log(`💡 Manage your Composio API keys at ${COMPOSIO_BASE_URL}`);
  } catch (err) {
    console.warn(`⚠️  Could not create Composio API key (${(err as Error).message}). Set COMPOSIO_API_KEY manually.`);
  }

  // Write main .env with full values for the current network
  const envContent = buildEnvContent(network, {
    oracleName,
    network,
    matrixBaseUrl: oracleMatrixHomeServerUrl,
    matrixAccessToken: freshMx.accessToken,
    matrixPassword: regResult.matrixPassword,
    matrixUserId: regResult.matrixUserId,
    matrixRecoveryPhrase: regResult.matrixRecoveryPhrase,
    matrixPin: regResult.pin,
    matrixRoomId: regResult.matrixRoomId,
    mnemonic: regResult.mnemonic,
    entityDid,
    oracleAddress: regResult.address,
    oracleDid: regResult.did,
    composioApiKey,
  });
  // Write full values to network-specific file (e.g. .env.testnet)
  const networkFilename = `.env.${network}`;
  writeEnvFile(path.join(envDir, networkFilename), envContent);

  // Copy to .env (active config the app reads)
  writeEnvFile(path.join(envDir, '.env'), envContent);

  // Write blank templates for other networks only if they don't already exist
  const allNetworks: { net: NETWORK; filename: string }[] = [
    { net: 'devnet', filename: '.env.devnet' },
    { net: 'testnet', filename: '.env.testnet' },
    { net: 'mainnet', filename: '.env.mainnet' },
  ];

  for (const { net, filename } of allNetworks) {
    if (net === network) continue;
    const filePath = path.join(envDir, filename);
    if (fs.existsSync(filePath)) continue;
    const content = buildEnvContentForNetwork(net, oracleName);
    writeEnvFile(filePath, content);
  }
};
