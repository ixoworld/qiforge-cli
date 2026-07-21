import { isCancel, log, spinner, text } from "@clack/prompts";
import { customMessages, ixo, utils } from "@ixo/impactxclient-sdk";
import {
  LinkedResource,
  Service,
} from "@ixo/impactxclient-sdk/types/codegen/ixo/iid/v1beta1/types";
import { NETWORK } from "@ixo/signx-sdk/types/types/transact";
import { logoutMatrixClient } from "./account/matrix";
import {
  registerUserSimplified,
  SimplifiedRegistrationResult,
} from "./account/simplifiedRegistration";
import {
  AgentCardContent,
  buildAgentCard,
  fetchAgentCardSchema,
  validateAgentCard,
} from "./agent-card";
import {
  checkRequiredPin,
  DOMAIN_INDEXER_URL,
  RELAYER_NODE_DID,
} from "./common";
import {
  prepareEncryptionKey,
  activateEncryptionKey,
  buildAddKeyAgreementMsg,
} from "./encryption-key";
import { publicUpload } from "./matrix/upload-to-matrix";
import { RuntimeConfig } from "./runtime-config";
import { Wallet } from "./wallet";

interface CreateEntityParams {
  profile: {
    orgName: string;
    name: string;
    logo: string;
    coverImage: string;
    location: string;
    description: string;
    url?: string;
  };
  services: Service[];
  parentProtocol: string;
  oracleConfig: {
    oracleName: string;
    price: number;
  };
  matrixHomeServerUrl: string;
  relayerNodeDid?: string;
  pin?: string;
  /** Optional Agent Card content — confirmed by the developer beforehand. */
  agentCard?: AgentCardContent;
}
type Denom =
  | "uixo"
  | "ibc/6BBE9BD4246F8E04948D5A4EEE7164B2630263B9EBB5E7DC5F0A46C62A2FF97B";

export class CreateEntity {
  private readonly wallet: Wallet;
  constructor(
    wallet: Wallet,
    private config: RuntimeConfig,
  ) {
    if (!wallet.did || !wallet.pubKey || !wallet.address || !wallet.algo) {
      throw new Error("Wallet not found");
    }
    this.wallet = wallet;
  }

  private buildMsgCreateEntity(
    matrixHomeServerUrl: string,
    relayerNodeDid?: string,
  ) {
    const msg = {
      typeUrl: "/ixo.entity.v1beta1.MsgCreateEntity",
      value: ixo.entity.v1beta1.MsgCreateEntity.fromPartial({
        entityType: "oracle",
        context: [],
        entityStatus: 0,
        verification: [
          ...customMessages.iid.createIidVerificationMethods({
            did: this.wallet.did!,
            pubkey: new Uint8Array(Buffer.from(this.wallet.pubKey!)),
            address: this.wallet.address!,
            controller: this.wallet.did!,
            type: this.wallet.algo === "ed25519" ? "ed" : "secp",
          }),
        ],
        controller: [this.wallet.did!],
        ownerAddress: this.wallet.address!,
        ownerDid: this.wallet.did!,
        relayerNode:
          relayerNodeDid ??
          RELAYER_NODE_DID[
            (this.config.getValue("network") as NETWORK) ?? "devnet"
          ],
        service: [
          ixo.iid.v1beta1.Service.fromPartial({
            id: "{id}#matrix",
            type: "MatrixHomeServer",
            serviceEndpoint: matrixHomeServerUrl,
          }),
        ],
        linkedResource: [],
        accordedRight: [],
        linkedEntity: [],
        linkedClaim: [],
        startDate: utils.proto.toTimestamp(new Date()),
        endDate: utils.proto.toTimestamp(
          new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
        ),
      }),
    };
    return msg;
  }

  public addLinkedAccounts(
    msg: ReturnType<typeof this.buildMsgCreateEntity>,
    { oracleAccountAddress }: { oracleAccountAddress: string },
  ) {
    if (!this.wallet.wallet) {
      throw new Error("Wallet not found");
    }
    const memoryEngineByNetwork = {
      devnet: "did:ixo:ixo17w9u5uk4qjyjgeyqfpnp92jwy58faey9vvp3ar",
      testnet: "did:ixo:ixo14vjrckltpngugp03tcasfgh5qakey9n3sgm6y2",
      mainnet: "did:ixo:ixo1d39eutxdc0e8mnp0fmzqjdy6aaf26s9hzrk33r",
    }[this.config.getValue("network") as NETWORK];

    const accounts = [memoryEngineByNetwork, `did:ixo:${oracleAccountAddress}`];
    const linkedAccounts = accounts.map((account) =>
      ixo.iid.v1beta1.LinkedEntity.fromPartial({
        id: account,
        type: "agent",
        relationship: "admin",
        service: "matrix",
      }),
    );

    msg.value.linkedEntity = linkedAccounts;
  }

  private async createAuthZConfig({
    oracleAccountAddress,
    oracleName,
    entityDid,
    homeServerUrl,
    accessToken,
  }: {
    oracleAccountAddress: string;
    oracleName: string;
    entityDid: string;
    homeServerUrl: string;
    accessToken: string;
  }): Promise<LinkedResource> {
    const config = {
      "@context": [
        "https://schema.org",
        {
          ixo: "https://w3id.org/ixo/context/v1",
          oracle: {
            "@id": entityDid,
            "@type": "@id",
          },
        },
      ],
      "@type": "Service",
      "@id": "oracle:OracleAuthorization",
      name: "OracleAuthorization",
      description: "OracleAuthorization",
      serviceType: "OracleClaimAuthorizationService",
      requiredPermissions: ["/ixo.claims.v1beta1.MsgCreateClaimAuthorization"],
      granteeAddress: oracleAccountAddress,
      granterAddress: "",
      oracleName: oracleName,
    };
    const response = await publicUpload({
      data: config,
      fileName: "authz",
      homeServerUrl,
      accessToken,
    });

    return ixo.iid.v1beta1.LinkedResource.fromPartial({
      id: "{id}#orz",
      type: "oracleAuthZConfig",
      proof: response.proof,
      right: "",
      encrypted: "false",
      mediaType: "application/json",
      description: "Orale AuthZ Config",
      serviceEndpoint: response.serviceEndpoint,
    });
  }

  private async createFeesConfig({
    entityDid,
    price,
    denom,
    homeServerUrl,
    accessToken,
  }: {
    entityDid: string;
    price: number;
    denom: Denom;
    homeServerUrl: string;
    accessToken: string;
  }): Promise<LinkedResource> {
    const config = {
      "@context": [
        "https://schema.org",
        {
          ixo: "https://w3id.org/ixo/context/v1",
          oracle: {
            "@id": entityDid,
            "@type": "@id",
          },
        },
      ],
      "@type": "Service",
      "@id": "oracle:ServiceFeeModel",
      name: "Pricing",
      description: "Pricing",
      serviceType: "",
      offers: {
        "@type": "Offer",
        priceCurrency: denom,
        priceSpecification: {
          "@type": "PaymentChargeSpecification",
          priceCurrency: denom,
          price: price * 1000, // 1 credit is 1000 uixo
          unitCode: "MON",
          billingIncrement: 1,
          billingPeriod: "P1M",
          priceType: "Subscription",
          maxPrice: price,
        },
        eligibleQuantity: {
          "@type": "QuantitativeValue",
          value: 1,
          unitCode: "MON",
        },
      },
    };
    const response = await publicUpload({
      data: config,
      fileName: "fees",
      homeServerUrl,
      accessToken,
    });
    return ixo.iid.v1beta1.LinkedResource.fromPartial({
      id: "{id}#fee",
      type: "pricingList",
      proof: response.proof,
      right: "",
      encrypted: "false",
      mediaType: "application/json",
      description: "Pricing List",
      serviceEndpoint: response.serviceEndpoint,
    });
  }

  /**
   * Update the oracle domain (API URL) services on an existing entity.
   * Deletes the old #api and #ws services, then adds new ones with the updated URL.
   */
  public async updateOracleDomain(
    entityDid: string,
    newApiUrl: string,
  ): Promise<void> {
    const walletAddress = this.wallet.wallet?.address;

    if (!this.wallet.wallet || !walletAddress) {
      throw new Error("Wallet not found");
    }

    const deleteApiMsg = {
      typeUrl: "/ixo.iid.v1beta1.MsgDeleteService",
      value: ixo.iid.v1beta1.MsgDeleteService.fromPartial({
        id: entityDid,
        serviceId: `{id}#api`,
        signer: walletAddress,
      }),
    };

    const deleteWsMsg = {
      typeUrl: "/ixo.iid.v1beta1.MsgDeleteService",
      value: ixo.iid.v1beta1.MsgDeleteService.fromPartial({
        id: entityDid,
        serviceId: `{id}#ws`,
        signer: walletAddress,
      }),
    };

    const addApiMsg = {
      typeUrl: "/ixo.iid.v1beta1.MsgAddService",
      value: ixo.iid.v1beta1.MsgAddService.fromPartial({
        id: entityDid,
        serviceData: ixo.iid.v1beta1.Service.fromPartial({
          id: `{id}#api`,
          type: "oracleService",
          serviceEndpoint: newApiUrl,
        }),
        signer: walletAddress,
      }),
    };

    const addWsMsg = {
      typeUrl: "/ixo.iid.v1beta1.MsgAddService",
      value: ixo.iid.v1beta1.MsgAddService.fromPartial({
        id: entityDid,
        serviceData: ixo.iid.v1beta1.Service.fromPartial({
          id: `{id}#ws`,
          type: "wsService",
          serviceEndpoint: newApiUrl,
        }),
        signer: walletAddress,
      }),
    };

    log.info(`Sign to update oracle domain for entity ${entityDid}`);
    await this.wallet.signAndBroadcast([deleteApiMsg, deleteWsMsg, addApiMsg, addWsMsg]);
    log.success(`Oracle domain updated to ${newApiUrl}`);
  }

  /**
   * Add a controller to an existing entity
   */
  public async addControllerToEntity(
    entityDid: string,
    controllerDid: string,
  ): Promise<void> {
    const walletAddress = this.wallet.wallet?.address;

    if (!this.wallet.wallet || !walletAddress) {
      throw new Error("Wallet not found");
    }

    const addControllerMsg = {
      typeUrl: "/ixo.iid.v1beta1.MsgAddController",
      value: ixo.iid.v1beta1.MsgAddController.fromPartial({
        id: entityDid,
        controllerDid: controllerDid,
        signer: walletAddress,
      }),
    };

    log.info(`Sign to add controller ${controllerDid} to entity ${entityDid}`);
    await this.wallet.signAndBroadcast([addControllerMsg]);
    log.success(`Controller ${controllerDid} added to entity ${entityDid}`);
  }

  private async createOracleConfigFiles({
    oracleName,
    entityDid,
    price,
    oracleAccountAddress,
    homeServerUrl,
    accessToken,
  }: CreateEntityParams["oracleConfig"] & {
    entityDid: string;
    oracleAccountAddress: string;
    homeServerUrl: string;
    accessToken: string;
  }) {
    const walletAddress = this.wallet.wallet?.address;

    if (!this.wallet.wallet || !walletAddress) {
      throw new Error("Wallet not found");
    }

    const resources = await Promise.all([
      this.createAuthZConfig({
        oracleName,
        entityDid,
        oracleAccountAddress,
        homeServerUrl,
        accessToken,
      }),
      this.createFeesConfig({
        entityDid,
        price,
        denom:
          this.config.getValue("network") === "devnet"
            ? "uixo"
            : "ibc/6BBE9BD4246F8E04948D5A4EEE7164B2630263B9EBB5E7DC5F0A46C62A2FF97B",
        homeServerUrl,
        accessToken,
      }),
    ]);
    const linkedResourcesMsgs = resources.map((resource) => ({
      typeUrl: "/ixo.iid.v1beta1.MsgAddLinkedResource",
      value: ixo.iid.v1beta1.MsgAddLinkedResource.fromPartial({
        id: entityDid,
        linkedResource: ixo.iid.v1beta1.LinkedResource.fromPartial({
          id: resource.id,
          description: resource.description,
          type: resource.type,
          proof: resource.proof,
          mediaType: resource.mediaType,
          encrypted: resource.encrypted,
          serviceEndpoint: resource.serviceEndpoint,
        }),
        signer: walletAddress,
      }),
    }));

    // sign and send the msgs
    log.info("Sign to edit the entity and add the config files");
    return this.wallet.signAndBroadcast(linkedResourcesMsgs);
  }

  private async createDomainCard({
    profile,
    entityDid,
    homeServerUrl,
    accessToken,
  }: {
    profile: CreateEntityParams["profile"];
    entityDid: string;
    homeServerUrl: string;
    accessToken: string;
  }): Promise<LinkedResource> {
    const validFrom = new Date().toISOString();

    const domainCard = {
      "@context": [
        "https://www.w3.org/ns/credentials/v2",
        "https://w3id.org/ixo/context/v1",
        {
          schema: "https://schema.org/",
          ixo: "https://w3id.org/ixo/vocab/v1",
          prov: "http://www.w3.org/ns/prov#",
          proj: "https://linked.data.gov.au/def/project#",
          xsd: "http://www.w3.org/2001/XMLSchema#",
          id: "@id",
          type: "@type",
          "ixo:vector": {
            "@container": "@list",
            "@type": "xsd:double",
          },
          "@protected": true,
        },
      ],
      id: `${entityDid}#dmn`,
      type: ["VerifiableCredential", "ixo:DomainCard"],
      issuer: {
        id: this.wallet.did,
      },
      validFrom: validFrom,
      credentialSchema: {
        id: "https://github.com/ixoworld/domainCards/schemas/ixo-domain-card-1.json",
        type: "JsonSchema",
      },
      credentialSubject: {
        id: entityDid,
        type: ["ixo:oracle"],
        additionalType: ["schema:Organization"],
        name: profile.name,
        alternateName:
          profile.orgName !== profile.name ? [profile.orgName] : undefined,
        description: profile.description,
        logo: {
          type: "schema:ImageObject",
          id: profile.logo,
          contentUrl: profile.logo,
        },
        image: [
          {
            type: "schema:ImageObject",
            id: profile.coverImage,
            contentUrl: profile.coverImage,
          },
        ],
        address: {
          type: "schema:PostalAddress",
          addressLocality: profile.location,
        },
        ...(profile.url ? { url: profile.url } : {}),
      },
    };

    const response = await publicUpload({
      data: domainCard,
      fileName: "domainCard",
      homeServerUrl,
      accessToken,
    });

    return ixo.iid.v1beta1.LinkedResource.fromPartial({
      id: "{id}#dmn",
      type: "domainCard",
      proof: response.proof,
      right: "",
      encrypted: "false",
      mediaType: "application/json",
      description: "Domain Card",
      serviceEndpoint: response.serviceEndpoint,
    });
  }

  private async createAgentCard({
    agentCard,
    entityDid,
    homeServerUrl,
    accessToken,
  }: {
    agentCard: AgentCardContent;
    entityDid: string;
    homeServerUrl: string;
    accessToken: string;
  }): Promise<LinkedResource> {
    const card = buildAgentCard({
      entityDid,
      issuerDid: this.wallet.did!,
      ...agentCard,
    });

    // Validate against the engine's schema (or the bundled snapshot) before
    // anything touches Matrix/chain — same lane as the `agent-card` command.
    const network = (this.config.getValue("network") as NETWORK) ?? "devnet";
    const { schema } = await fetchAgentCardSchema(network);
    const errors = validateAgentCard(card, schema);
    if (errors.length > 0) {
      throw new Error(
        `Agent Card failed schema validation:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
      );
    }

    const response = await publicUpload({
      data: card,
      fileName: "agentCard",
      homeServerUrl,
      accessToken,
    });

    return ixo.iid.v1beta1.LinkedResource.fromPartial({
      id: "{id}#acard",
      type: "agentCard",
      proof: response.proof,
      right: "",
      encrypted: "false",
      mediaType: "application/json",
      description: "Agent Card",
      serviceEndpoint: response.serviceEndpoint,
    });
  }

  private async addProfile({
    orgName,
    name,
    logo,
    coverImage,
    location,
    description,
    homeServerUrl,
    accessToken,
  }: CreateEntityParams["profile"] & {
    homeServerUrl: string;
    accessToken: string;
  }) {
    const profileData = {
      "@context": {
        ixo: "https://w3id.org/ixo/ns/protocol/",
        "@id": "@type",
        type: "@type",
        "@protected": false,
      },
      id: "ixo:entity#profile",
      type: "profile",
      orgName,
      name,
      image: coverImage,
      logo,
      brand: orgName,
      location,
      description,
    };

    const response = await publicUpload({
      data: profileData,
      fileName: "profile",
      homeServerUrl,
      accessToken,
    });

    return ixo.iid.v1beta1.LinkedResource.fromPartial({
      id: "{id}#pro",
      type: "Settings",
      description: "Profile",
      mediaType: "application/json",
      serviceEndpoint: response.serviceEndpoint,
      proof: response.proof,
      encrypted: "false",
      right: "",
    });
  }

  private addServices(
    msg: ReturnType<typeof this.buildMsgCreateEntity>,
    services: Service[],
  ) {
    msg.value.service.push(
      ...services.map((service) =>
        ixo.iid.v1beta1.Service.fromPartial(service),
      ),
    );
  }

  private setParentProtocol(
    msg: ReturnType<typeof this.buildMsgCreateEntity>,
    parentProtocol: string,
  ) {
    msg.value.context.push(
      ...customMessages.iid.createAgentIidContext([
        { key: "class", val: parentProtocol },
      ]),
    );
  }

  private async submitToDomainIndexer(entityDid: string): Promise<void> {
    const network = (this.config.getValue("network") as NETWORK) ?? "devnet";
    const indexerUrl = DOMAIN_INDEXER_URL[network];

    try {
      const response = await fetch(indexerUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          did: entityDid,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log.warn(
          `Failed to submit to domain indexer: ${response.status} ${errorText}`,
        );
        return;
      }

      log.success("Domain card submitted to domain indexer");
    } catch (error) {
      log.warn(
        `Error submitting to domain indexer: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  public async execute(params: CreateEntityParams): Promise<string> {
    if (!this.wallet.wallet) {
      throw new Error("Wallet not found");
    }

    const { matrixHomeServerUrl } = params;

    // =================================================================================================
    // 1. REGISTER ORACLE FIRST — we need oracle's credentials for uploads
    // =================================================================================================
    log.info("Creating Oracle Wallet and Matrix Account");
    let pin: string;
    if (params.pin) {
      pin = params.pin;
    } else {
      const pinInput = await text({
        message: "Enter a 6-digit PIN to secure your Matrix Vault:",
        placeholder: "123456",
        validate(value) {
          return checkRequiredPin(value);
        },
      });
      if (isCancel(pinInput)) {
        log.error("User cancelled");
        process.exit(1);
      }
      pin = pinInput as string;
    }
    const registerResult = await registerUserSimplified(
      {
        pin,
        oracleName: params.oracleConfig.oracleName,
        network: this.config.getValue("network") as NETWORK,
        oracleAvatarUrl: params.profile.logo,
        matrixHomeServerUrl,
      },
      async (address) => {
        await this.wallet.sendTokens(address, 250_000); // 250,000 uixo = 0.25 IXO;
      },
    );

    // Oracle's credentials for uploading to oracle's Matrix server
    const oracleHomeServerUrl = registerResult.matrixHomeServerUrl;
    const oracleAccessToken = registerResult.matrixAccessToken;

    // =================================================================================================
    // 2. UPLOAD PROFILE using oracle's credentials
    // =================================================================================================
    log.info("Adding profile");
    const profileResource = await this.addProfile({
      ...params.profile,
      homeServerUrl: oracleHomeServerUrl,
      accessToken: oracleAccessToken,
    });

    // =================================================================================================
    // 3. BUILD AND BROADCAST MsgCreateEntity
    // =================================================================================================
    const msg = this.buildMsgCreateEntity(
      matrixHomeServerUrl,
      params.relayerNodeDid,
    );

    // Add profile linked resource
    msg.value.linkedResource.push(profileResource);

    // Add services
    log.info("Adding services");
    this.addServices(msg, params.services);

    // Add parent protocol
    log.info("Adding parent protocol");
    this.setParentProtocol(msg, params.parentProtocol);

    // Add linked accounts
    this.addLinkedAccounts(msg, {
      oracleAccountAddress: registerResult.address,
    });

    log.info("Sign this transaction to create the entity");
    const response = await this.wallet.signAndBroadcast([msg]);
    log.success("Entity created -- wait to attach the required config files");

    // upload resources
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const did = utils.common.getValueFromEvents(
      response as any,
      "wasm",
      "token_id",
    );

    // =================================================================================================
    // 4. CREATE AND ATTACH DOMAIN CARD using oracle's credentials
    // =================================================================================================
    log.info("Creating domain card");
    const domainCardResource = await this.createDomainCard({
      profile: params.profile,
      entityDid: did,
      homeServerUrl: oracleHomeServerUrl,
      accessToken: oracleAccessToken,
    });

    // Add domain card to entity
    if (this.wallet.wallet?.address) {
      const addDomainCardMsg = {
        typeUrl: "/ixo.iid.v1beta1.MsgAddLinkedResource",
        value: ixo.iid.v1beta1.MsgAddLinkedResource.fromPartial({
          id: did,
          linkedResource: ixo.iid.v1beta1.LinkedResource.fromPartial({
            id: domainCardResource.id,
            description: domainCardResource.description,
            type: domainCardResource.type,
            proof: domainCardResource.proof,
            mediaType: domainCardResource.mediaType,
            encrypted: domainCardResource.encrypted,
            serviceEndpoint: domainCardResource.serviceEndpoint,
          }),
          signer: this.wallet.wallet.address,
        }),
      };
      log.info("Sign to add domain card to the entity");
      await this.wallet.signAndBroadcast([addDomainCardMsg]);
      log.success("Domain card added to entity");
    }

    // =================================================================================================
    // 4.5. CREATE AND ATTACH AGENT CARD (optional) using oracle's credentials
    // =================================================================================================
    if (params.agentCard && this.wallet.wallet?.address) {
      try {
        log.info("Creating agent card");
        const agentCardResource = await this.createAgentCard({
          agentCard: params.agentCard,
          entityDid: did,
          homeServerUrl: oracleHomeServerUrl,
          accessToken: oracleAccessToken,
        });

        const addAgentCardMsg = {
          typeUrl: "/ixo.iid.v1beta1.MsgAddLinkedResource",
          value: ixo.iid.v1beta1.MsgAddLinkedResource.fromPartial({
            id: did,
            linkedResource: ixo.iid.v1beta1.LinkedResource.fromPartial({
              id: agentCardResource.id,
              description: agentCardResource.description,
              type: agentCardResource.type,
              proof: agentCardResource.proof,
              mediaType: agentCardResource.mediaType,
              encrypted: agentCardResource.encrypted,
              serviceEndpoint: agentCardResource.serviceEndpoint,
            }),
            signer: this.wallet.wallet.address,
          }),
        };
        log.info("Sign to add agent card to the entity");
        await this.wallet.signAndBroadcast([addAgentCardMsg]);
        log.success("Agent card added to entity");
      } catch (error) {
        // An oracle without a card is valid — it just can't be contracted yet.
        log.warn(
          `Failed to publish agent card: ${error instanceof Error ? error.message : String(error)}`,
        );
        log.warn("You can publish it later using: qiforge-cli agent-card");
      }
    }

    // =================================================================================================
    // 5. CREATE AND ATTACH CONFIG FILES using oracle's credentials
    // =================================================================================================
    await this.createOracleConfigFiles({
      oracleName: params.oracleConfig.oracleName,
      price: params.oracleConfig.price,
      oracleAccountAddress: registerResult.address,
      entityDid: did,
      homeServerUrl: oracleHomeServerUrl,
      accessToken: oracleAccessToken,
    });
    log.success("Entity created -- config files attached");

    // =================================================================================================
    // 5.5. GENERATE AND PUBLISH P-256 ENCRYPTION KEY (keyAgreement)
    // =================================================================================================
    log.info("Setting up P-256 encryption key for secrets management");
    try {
      const encKeyResult = await prepareEncryptionKey({
        roomId: registerResult.matrixRoomId,
        accessToken: oracleAccessToken,
        homeServerUrl: oracleHomeServerUrl,
        pin: pin as string,
        oracleEntityDid: did,
      });

      const addKeyMsg = buildAddKeyAgreementMsg({
        oracleEntityDid: did,
        verificationMethodId: encKeyResult.verificationMethodId,
        publicKeyMultibase: encKeyResult.publicKeyMultibase,
        signerAddress: this.wallet.wallet!.address,
      });

      log.info("Sign to add P-256 encryption key (keyAgreement) to the entity");
      await this.wallet.signAndBroadcast([addKeyMsg]);

      // Mark key as active only after chain confirmation
      await activateEncryptionKey({
        roomId: registerResult.matrixRoomId,
        accessToken: oracleAccessToken,
        homeServerUrl: oracleHomeServerUrl,
        verificationMethodId: encKeyResult.verificationMethodId,
      });

      log.success("P-256 encryption key published to entity DID");
    } catch (error) {
      log.warn(
        `Failed to setup encryption key: ${error instanceof Error ? error.message : String(error)}`,
      );
      log.warn(
        "You can set it up later using: oracles-cli setup-encryption-key",
      );
    }

    // =================================================================================================
    // 6. LOGOUT ORACLE's Matrix session (no longer needed)
    // =================================================================================================
    await logoutMatrixClient({
      baseUrl: oracleHomeServerUrl,
      accessToken: oracleAccessToken,
      userId: registerResult.matrixUserId,
      deviceId: "",
    });

    const s = spinner();
    s.start("Creating Entity Matrix Room...");
    s.stop("Room created -- room joined");
    log.warn(
      "Please save the following information in a secure location as it is not stored:",
    );
    log.info(`ORACLE ACCOUNT DETAILS`);

    for (const key in registerResult) {
      log.info(
        `${key}: ${registerResult[key as keyof SimplifiedRegistrationResult]}`,
      );
    }
    this.config.addValue("registerUserResult", registerResult);
    this.config.addValue("entityDid", did);
    this.config.addValue("oracleMatrixHomeServerUrl", matrixHomeServerUrl);

    // Submit to domain indexer
    log.info("Submitting domain card to domain indexer");
    await this.submitToDomainIndexer(did);

    return did;
  }
}
