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
import OffchainDNSResolver_abi from '@ensdomains/ens-contracts/artifacts/contracts/dnsregistrar/OffchainDNSResolver.sol/OffchainDNSResolver.json';
import Resolver_abi from '@ensdomains/ens-contracts/artifacts/contracts/resolvers/OwnedResolver.sol/OwnedResolver.json';
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

const ENS_ADDRESS = '0xE6E340D132b5f46d1e472DebcD681B2aBc16e57E';
const DNSSEC_IMPL = '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e';
const OWNED_RESOLVER = '0x5eb3Bc0a489C5A8288765d2336659EbCA68FCd00';

const TEST_URL = 'https://localhost:8000/query';
const TEST_NAME = 'tanrikulu.xyz'; // use a domain with resolver txt set (e.g. ENS1 0x5eb3Bc0a489C5A8288765d2336659EbCA68FCd00)
const TEST_ADDRESS = '0xfefeFEFeFEFEFEFEFeFefefefefeFEfEfefefEfe';

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
  let resolver: Contract, ownedResolver: Contract;

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
    await checkIfContractIsReachable(OWNED_RESOLVER, 'OWNED_RESOLVER');

    resolver = (
      await deploySolidity(
        OffchainDNSResolver_abi,
        signer,
        ENS_ADDRESS,
        DNSSEC_IMPL,
        TEST_URL
      )
    ).connect(mockProvider);

    ownedResolver = new ethers.Contract(
      OWNED_RESOLVER,
      Resolver_abi.abi,
      signer
    );
  });

  describe('resolve()', () => {
    it('resolves calls to addr(bytes32)', async () => {
      await ownedResolver['setAddr(bytes32,address)'](
        ethers.utils.namehash(TEST_NAME),
        TEST_ADDRESS
      );

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
