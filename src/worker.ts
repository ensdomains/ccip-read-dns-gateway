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

const logResult = async (request: CFWRequest, result: Response) => {
  if (!result.body) {
    return result;
  }
  const [streamForLog, streamForResult] = result.body.tee();
  const logResult = await new Response(streamForLog).json();

  await tracker.trackEvent(
    request,
    'result',
    { props: { result: logResult.data.substring(0, 200) } },
    true
  );
  return new Response(streamForResult, result);
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
    return router.handle(request).then(logResult.bind(this, request));
  },
};
