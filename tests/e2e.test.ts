import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import * as dotenv from 'dotenv';
import { Contract, ethers } from 'ethers';
import { JsonRpcSigner, Web3Provider } from '@ethersproject/providers';
import { Server } from '@chainlink/ccip-read-server';
import { dohQuery } from '@ensdomains/dnsprovejs';
import * as packet from 'dns-packet';
import supertest from 'supertest';
import { makeApp } from '../src/app';
// All artifacts from ens-contracts clone (staging branch)
import ExtendedDNSResolver_abi from '../ens-contracts/artifacts/contracts/resolvers/profiles/ExtendedDNSResolver.sol/ExtendedDNSResolver.json';
import OffchainDNSResolver_abi from '../ens-contracts/artifacts/contracts/dnsregistrar/OffchainDNSResolver.sol/OffchainDNSResolver.json';
import Resolver_abi from '../ens-contracts/artifacts/contracts/resolvers/OwnedResolver.sol/OwnedResolver.json';
import ENSRegistry_abi from '../ens-contracts/artifacts/contracts/registry/ENSRegistry.sol/ENSRegistry.json';
import BaseRegistrar_abi from '../ens-contracts/artifacts/contracts/ethregistrar/BaseRegistrarImplementation.sol/BaseRegistrarImplementation.json';
import {
  BaseProvider,
  BlockTag,
  TransactionRequest,
  Network,
} from '@ethersproject/providers';
import { fetchJson } from '@ethersproject/web';
import { arrayify, BytesLike, hexlify } from '@ethersproject/bytes';
dotenv.config();
chai.use(chaiAsPromised);

export type Fetch = (url: string, json?: string) => Promise<any>;

const Resolver = new ethers.utils.Interface(Resolver_abi.abi);

// Hardhat deterministic deployment addresses
const ENS_ADDRESS = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9'; // ENSRegistry
const DNSSEC_IMPL = '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e';
const PUBLIC_RESOLVER = '0x1291Be112d480055DaFd8a610b7d1e203891C274';
const BASE_REGISTRAR = '0xE6E340D132b5f46d1e472DebcD681B2aBc16e57E';

const TEST_URL = 'https://localhost:8000/query';
const TEST_NAME = 'tanrikulu.xyz'; // DNS TXT: ENS1 dnsname.ens.eth a[60]=<address>
// This address comes from the DNS TXT record context: a[60]=0x0D59d0f7DcC0fBF0A3305cE0261863aAf7Ab685c
const TEST_ADDRESS = '0x0D59d0f7DcC0fBF0A3305cE0261863aAf7Ab685c';

const CCIP_READ_INTERFACE = new ethers.utils.Interface(
  OffchainDNSResolver_abi.abi
);

function deploySolidity(data: any, signer: ethers.Signer, ...args: any[]) {
  const factory = ethers.ContractFactory.fromSolidity(data, signer);
  return factory.deploy(...args);
}

export class MockProvider extends BaseProvider {
  readonly parent: BaseProvider;
  readonly fetcher: Fetch;

  /**
   * Constructor.
   * @param provider: The Ethers provider to wrap.
   */
  constructor(provider: BaseProvider, fetcher: Fetch = fetchJson) {
    super(31337);
    this.parent = provider;
    this.fetcher = fetcher;
  }

  async perform(method: string, params: any): Promise<any> {
    switch (method) {
      case 'call':
        const { result } = await this.handleCall(this, params);
        return result;
      default:
        return this.parent.perform(method, params);
    }
  }

  async handleCall(
    provider: MockProvider,
    params: { transaction: TransactionRequest; blockTag?: BlockTag }
  ): Promise<{ transaction: TransactionRequest; result: BytesLike }> {
    let result = await provider.parent.perform('call', params);

    if (
      !result.startsWith('0x556f1830') ||
      ethers.utils.hexDataLength(result) % 32 != 4
    ) {
      // iface: OffchainLookup(address,string[],bytes,bytes4,bytes)
      return {
        transaction: params.transaction,
        result,
      };
    }

    let bytes = arrayify(result);
    const {
      urls,
      callData,
      callbackFunction,
      extraData,
    } = CCIP_READ_INTERFACE.decodeErrorResult('OffchainLookup', bytes);

    const response = await this.sendRPC(
      provider.fetcher,
      urls,
      params.transaction.to,
      callData
    );

    let encodedData = CCIP_READ_INTERFACE.encodeFunctionData(callbackFunction, [
      response,
      extraData,
    ]);
    params.transaction.data = encodedData;

    let resultCallback = await provider.parent.perform('call', params);

    return {
      transaction: params.transaction,
      result: resultCallback,
    };
  }

  async sendRPC(
    fetcher: Fetch,
    urls: string[],
    to: any,
    callData: BytesLike
  ): Promise<BytesLike> {
    const args = { sender: hexlify(to), data: hexlify(callData) };
    const url = urls[0];
    const data = await fetcher(url, JSON.stringify(args));
    return data.body.data;
  }

  detectNetwork(): Promise<Network> {
    return this.parent.detectNetwork();
  }
}

interface RevertError {
  error: {
    code: number;
    data: string;
  };
}

function isOffchainLookupError(e: any): e is RevertError {
  try {
    const error = CCIP_READ_INTERFACE.parseError(e?.error?.data);
    return error.name === 'OffchainLookup';
  } catch {
    return false;
  }
}

export function hexEncodeName(name: string) {
  return '0x' + (packet as any).name.encode(name).toString('hex');
}

/**
 * Hack to ensure that revert data gets passed back from test nodes the same way as from real nodes.
 * This middleware catches Ganache's custom revert error and returns it as response data instead.
 */
class RevertNormalisingMiddleware extends ethers.providers.BaseProvider {
  readonly parent: ethers.providers.BaseProvider;

  constructor(provider: ethers.providers.BaseProvider) {
    super(provider.getNetwork());
    this.parent = provider;
  }

  getSigner(addressOrIndex?: string | number): JsonRpcSigner {
    return (this.parent as Web3Provider).getSigner(addressOrIndex);
  }

  async perform(method: string, params: any): Promise<any> {
    switch (method) {
      case 'call':
        try {
          return await this.parent.perform(method, params);
        } catch (e) {
          if (isOffchainLookupError(e)) {
            return e.error.data;
          }
          throw e;
        }
      default:
        const result = await this.parent.perform(method, params);
        return result;
    }
  }

  detectNetwork(): Promise<ethers.providers.Network> {
    return this.parent.detectNetwork();
  }
}

describe('End to end test', () => {
  const server = makeApp(
    dohQuery(process.env.DOH_GATEWAY_URL as string),
    '/',
    Server
  );

  async function fetcher(_url: string, json?: string) {
    const { sender: to, data } = JSON.parse(json as string);
    const ret = await supertest(server).get(`/${to}/${data}.json`);
    return ret;
  }
  const baseProvider = new ethers.providers.JsonRpcProvider(
    'http://127.0.0.1:8545'
  );
  const signer = baseProvider.getSigner();
  const proxyMiddleware = new RevertNormalisingMiddleware(baseProvider);
  const mockProvider = new MockProvider(proxyMiddleware, fetcher);
  let resolver: Contract;

  async function checkIfContractIsReachable(
    address: string,
    label: string
  ): Promise<void> {
    try {
      const code = await baseProvider.getCode(address);
      if (code !== '0x') console.log(`${label} contract is reachable.`);
    } catch (error) {
      console.log('getCode error', error);
    }
  }

  beforeAll(async () => {
    await checkIfContractIsReachable(ENS_ADDRESS, 'ENS');
    await checkIfContractIsReachable(DNSSEC_IMPL, 'DNSSEC_IMPL');
    await checkIfContractIsReachable(PUBLIC_RESOLVER, 'PUBLIC_RESOLVER');

    const signerAddress = await signer.getAddress();

    // Deploy ExtendedDNSResolver
    const extendedDNSResolver = await deploySolidity(
      ExtendedDNSResolver_abi,
      signer
    );

    // Set up contracts
    const ensRegistry = new ethers.Contract(
      ENS_ADDRESS,
      ENSRegistry_abi.abi,
      signer
    );
    const publicResolver = new ethers.Contract(
      PUBLIC_RESOLVER,
      Resolver_abi.abi,
      signer
    );
    const baseRegistrar = new ethers.Contract(
      BASE_REGISTRAR,
      BaseRegistrar_abi.abi,
      signer
    );

    // Check if ens.eth is already registered (from hardhat deploy scripts)
    const ensLabelHash = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes('ens')
    );
    const ensLabelId = ethers.BigNumber.from(ensLabelHash);

    const isAvailable = await baseRegistrar.available(ensLabelId);
    if (isAvailable) {
      // Add signer as controller of BaseRegistrar (owner can do this)
      await baseRegistrar.addController(signerAddress);

      // Register for 1 year (in seconds)
      const duration = 365 * 24 * 60 * 60;
      await baseRegistrar.register(ensLabelId, signerAddress, duration);
    }

    // Now we own ens.eth and can set up subdomains
    const ensEthNode = ethers.utils.namehash('ens.eth');
    const dnsnameLabel = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes('dnsname')
    );
    const dnsnameEnsEthNode = ethers.utils.namehash('dnsname.ens.eth');

    // Set subnode owner for 'dnsname' under 'ens.eth'
    await ensRegistry.setSubnodeOwner(ensEthNode, dnsnameLabel, signerAddress);

    // Set resolver for dnsname.ens.eth
    await ensRegistry.setResolver(dnsnameEnsEthNode, PUBLIC_RESOLVER);

    // Set addr for dnsname.ens.eth to ExtendedDNSResolver address
    await publicResolver['setAddr(bytes32,address)'](
      dnsnameEnsEthNode,
      extendedDNSResolver.address
    );

    // Deploy OffchainDNSResolver
    resolver = (
      await deploySolidity(
        OffchainDNSResolver_abi,
        signer,
        ENS_ADDRESS,
        DNSSEC_IMPL,
        TEST_URL
      )
    ).connect(mockProvider);
  }, 60000);

  describe('resolve()', () => {
    it('resolves calls to addr(bytes32)', async () => {
      // The DNS TXT record for tanrikulu.xyz contains:
      // ENS1 dnsname.ens.eth a[60]=0x0D59d0f7DcC0fBF0A3305cE0261863aAf7Ab685c
      // ExtendedDNSResolver parses the context and returns the address

      const callData = Resolver.encodeFunctionData('addr(bytes32)', [
        ethers.utils.namehash(TEST_NAME),
      ]);
      const dnsName = hexEncodeName(TEST_NAME);
      const response = await resolver.resolve(dnsName, callData);

      const resultData = Resolver.decodeFunctionResult(
        'addr(bytes32)',
        response
      );

      expect(resultData).to.deep.equal([TEST_ADDRESS]);
    });
  });
});
