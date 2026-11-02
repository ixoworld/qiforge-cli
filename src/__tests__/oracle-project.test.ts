import {
  buildCredentialsFile,
  buildDevVars,
  buildProjectTemplateVars,
  envLine,
  generateRateLimitNamespaceId,
  parseEnvContent,
  placeholderIdentity,
  serverNameOfUserId,
  toWorkerName,
} from '../utils/oracle-project';
import { FALLBACK_SCAFFOLD_VERSIONS } from '../utils/runtime-versions';

describe('toWorkerName', () => {
  it('lower-cases and replaces characters Workers script names do not allow', () => {
    expect(toWorkerName('My_Oracle')).toBe('my-oracle');
    expect(toWorkerName('demo--oracle_')).toBe('demo-oracle');
  });
});

describe('serverNameOfUserId', () => {
  it('returns the server part of a Matrix user id', () => {
    expect(serverNameOfUserId('@did-ixo-ixo1abc:devmx.ixo.earth')).toBe('devmx.ixo.earth');
  });

  it('rejects something that is not a user id', () => {
    expect(() => serverNameOfUserId('devmx.ixo.earth')).toThrow(/Not a Matrix user id/);
  });
});

describe('placeholderIdentity', () => {
  it('has the shapes the runtime env schema accepts', () => {
    const identity = placeholderIdentity('testnet');
    expect(identity.entityDid).toMatch(/^did:ixo:entity:[0-9a-f]{32}$/);
    expect(identity.oracleDid.startsWith('did:ixo:')).toBe(true);
    expect(identity.matrixBaseUrl).toBe('https://testmx.ixo.earth');
    expect(serverNameOfUserId(identity.matrixUserId)).toBe('testmx.ixo.earth');
    expect(identity.matrixRoomId.startsWith('!')).toBe(true);
  });
});

describe('generateRateLimitNamespaceId', () => {
  it('is a positive integer string', () => {
    for (let i = 0; i < 20; i++) {
      const id = generateRateLimitNamespaceId();
      expect(id).toMatch(/^[1-9][0-9]*$/);
    }
  });
});

describe('buildProjectTemplateVars', () => {
  it('derives the Worker names, per-network URLs and JSON literals', () => {
    const vars = buildProjectTemplateVars({
      projectName: 'My_Oracle',
      oracleName: 'My "Oracle"',
      org: 'Acme',
      description: 'Does things.',
      network: 'mainnet',
      versions: FALLBACK_SCAFFOLD_VERSIONS,
      identity: placeholderIdentity('mainnet'),
      rateLimitNamespaceId: '123456',
    });
    expect(vars.workerName).toBe('my-oracle');
    expect(vars.gatewayWorkerName).toBe('my-oracle-gateway');
    expect(JSON.parse(vars.oracleNameJson as string)).toBe('My "Oracle"');
    expect(vars.blocksyncUrl).toBe('https://blocksync-graphql.ixo.earth/graphql');
    expect(vars.vfsBaseUrl).toBe('https://vfs.ixo.earth');
    expect(vars.domainIndexerUrl).toBe('https://domain-indexer.ixo.earth');
    expect(vars.runtimeVersion).toBe(FALLBACK_SCAFFOLD_VERSIONS.runtimeVersion);
    expect(vars.matrixServerName).toBe('mx.ixo.earth');
  });
});

describe('envLine / parseEnvContent', () => {
  it('round-trips plain and quoted values', () => {
    const values: Record<string, string> = {
      PLAIN: 'abc123',
      WORDS: 'twelve word mnemonic phrase goes here and here and here and more',
      QUOTES: 'he said "hi" # not a comment',
      BACKSLASH: 'a\\b',
      EMPTY: '',
    };
    const content = Object.entries(values)
      .map(([key, value]) => envLine(key, value))
      .join('\n');
    expect(parseEnvContent(content)).toEqual(values);
  });

  it('skips comments and blank lines', () => {
    expect(parseEnvContent('# comment\n\nA=1\n# B=2\n')).toEqual({ A: '1' });
  });
});

describe('buildDevVars', () => {
  it('holds exactly the Worker secrets', () => {
    const env = parseEnvContent(
      buildDevVars({ matrixPassword: 'pw', matrixRecoveryPhrase: 'phrase with spaces', matrixPin: '123456' }),
    );
    expect(env).toEqual({
      MATRIX_ORACLE_ADMIN_PASSWORD: 'pw',
      MATRIX_RECOVERY_PHRASE: 'phrase with spaces',
      MATRIX_VALUE_PIN: '123456',
      OPEN_ROUTER_API_KEY: '',
    });
  });

  it('includes the Composio key when one was minted', () => {
    const env = parseEnvContent(
      buildDevVars({ matrixPassword: 'pw', matrixRecoveryPhrase: 'p', matrixPin: '1', composioApiKey: 'ck_1' }),
    );
    expect(env.COMPOSIO_API_KEY).toBe('ck_1');
  });
});

describe('buildCredentialsFile', () => {
  it('writes every key the other commands read back with --env', () => {
    const env = parseEnvContent(
      buildCredentialsFile({
        network: 'devnet',
        oracleAddress: 'ixo1abc',
        oracleDid: 'did:ixo:ixo1abc',
        entityDid: 'did:ixo:entity:0123456789abcdef0123456789abcdef',
        secpMnemonic: 'one two three',
        signingMnemonic: 'four five six',
        matrixBaseUrl: 'https://devmx.ixo.earth',
        matrixUserId: '@did-ixo-ixo1abc:devmx.ixo.earth',
        matrixPassword: 'pw',
        matrixRoomId: '!room:devmx.ixo.earth',
        matrixPin: '123456',
        matrixRecoveryPhrase: 'recovery phrase',
        matrixMnemonic: 'seven eight nine',
      }),
    );
    expect(env).toMatchObject({
      SECP_MNEMONIC: 'one two three',
      ORACLE_SIGNING_MNEMONIC: 'four five six',
      MATRIX_ORACLE_ADMIN_USER_ID: '@did-ixo-ixo1abc:devmx.ixo.earth',
      MATRIX_ORACLE_ADMIN_PASSWORD: 'pw',
      MATRIX_ACCOUNT_ROOM_ID: '!room:devmx.ixo.earth',
      MATRIX_VALUE_PIN: '123456',
      MATRIX_BASE_URL: 'https://devmx.ixo.earth',
    });
  });
});
