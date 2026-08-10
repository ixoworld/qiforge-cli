import { NETWORK } from '@ixo/signx-sdk/types/types/transact';
import { SimplifiedRegistrationResult } from './account/simplifiedRegistration';
import { AgentCard } from './agent-card';

interface Config {
  projectPath: string;
  projectName: string;
  entityDid: string;
  network: NETWORK;
  oracleMatrixHomeServerUrl: string;
  registerUserResult: SimplifiedRegistrationResult & {
    matrixDeviceName: string;
  };
  // Set by `new` command so `create-entity` can skip re-prompting
  oracleName: string;
  prefillDescription: string;
  prefillOrgName: string;
  prefillLogo: string;
  newCommandContext: string;
  agentCard: AgentCard;
}

export class RuntimeConfig {
  private config: Partial<Config> = {};
  private static instance: RuntimeConfig;
  private constructor() {}

  public static getInstance(): RuntimeConfig {
    if (!RuntimeConfig.instance) {
      RuntimeConfig.instance = new RuntimeConfig();
    }
    return RuntimeConfig.instance;
  }

  public addValue<K extends keyof Config>(key: K, value: Config[K]) {
    this.config[key] = value;
  }

  public getValue<K extends keyof Config>(key: K): Config[K] {
    return this.config[key] as Config[K];
  }

  public getOrThrow<K extends keyof Config>(key: K): Config[K] {
    const value = this.getValue(key);
    if (!value) {
      throw new Error(`Value ${key} is not set`);
    }
    return value as Config[K];
  }

  public getConfig() {
    return this.config;
  }

  public deleteValue(key: keyof Config) {
    delete this.config[key];
  }
}
