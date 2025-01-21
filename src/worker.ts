import {
  Request as CFWRequest,
  ExecutionContext,
} from '@cloudflare/workers-types';
import { Server } from '@ensdomains/ccip-read-cf-worker';
import { PropsDecoder, Tracker } from '@ensdomains/server-analytics';
import { dohQuery } from '@ensdomains/dnsprovejs';
import { ethers } from 'ethers';
import { makeApp } from './app';
import { extractENSRecord, logAsync } from './utils';

interface ENV {
  DOH_GATEWAY_URL: string;
  PLAUSIBLE_BASE_URL: string;
}

const abi_RRSetWithSignature = [
  ethers.utils.ParamType.from({
    components: [
      { type: 'bytes', name: 'rrset' },
      { type: 'bytes', name: 'sig' },
    ],
    type: 'tuple[]',
  }),
];

const tracker = new Tracker<CFWRequest>(
  'ccip-read-dns-worker.ens-cf.workers.dev',
  {
    enableLogging: true,
  }
);

const routeHandler = (env: ENV, trackEvent?: Function) => {
  const { DOH_GATEWAY_URL } = env;
  const app = makeApp(
    dohQuery(DOH_GATEWAY_URL as string),
    '/',
    Server,
    trackEvent
  );
  console.log(`Serving with DoH Resolver ${DOH_GATEWAY_URL}`);
  return app;
};

const propsDecoder: PropsDecoder<CFWRequest> = (
  _: CFWRequest | unknown,
  data?: string
) => {
  if (!data) return {};

  const decodedData = ethers.utils.defaultAbiCoder.decode(
    abi_RRSetWithSignature,
    data
  )[0];
  const structuredData = decodedData.map((item: string[]) => ({
    rrset: item[0],
    sig: item[1],
  }));
  return { result: extractENSRecord(structuredData) };
};

export default {
  fetch: async function(
    request: CFWRequest,
    env: ENV,
    _context: ExecutionContext
  ) {
    if (env.PLAUSIBLE_BASE_URL) {
      tracker.apiEndpoint = env.PLAUSIBLE_BASE_URL;
    }
    // analytics non-blocking
    logAsync(tracker.trackEvent, request, 'request', {}, true);
    logAsync(tracker.trackPageview, request, {}, true);
    const router = routeHandler(env, (...args: any) => 
      logAsync(tracker.trackEvent.bind(tracker, request), ...args)
    );
    return router
      .handle(request)
      .then((result: any) => {
        logAsync(tracker.logResult, propsDecoder, request, result);
        return result;
      });
  },
};
