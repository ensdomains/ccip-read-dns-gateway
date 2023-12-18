import {
  Request as CFWRequest,
  ExecutionContext,
} from '@cloudflare/workers-types';
import { Server } from '@ensdomains/ccip-read-cf-worker';
import { dohQuery } from '@ensdomains/dnsprovejs';
import { makeApp } from './app';
import { Tracker } from './utils/analytics';

interface ENV {
  DOH_GATEWAY_URL: string;
}

const tracker = new Tracker('ccip-read-dns-worker.ens-cf.workers.dev', {
  enableLogging: true,
});

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

module.exports = {
  fetch: async function(
    request: CFWRequest,
    env: ENV,
    _context: ExecutionContext
  ) {
    await tracker.trackEvent(request, 'request', {}, true);
    await tracker.trackPageview(request, {}, true);
    const router = routeHandler(env, tracker.trackEvent.bind(tracker, request));
    return await router.handle(request);
  },
};
