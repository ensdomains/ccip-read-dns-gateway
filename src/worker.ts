import { Server } from '@ensdomains/ccip-read-cf-worker';
import { dohQuery } from '@ensdomains/dnsprovejs';
import { makeApp } from './app';

const routeHandler = (env: any) => {
  const { DOH_GATEWAY_URL } = env;
  const app = makeApp(dohQuery(DOH_GATEWAY_URL as string), '/', Server);
  console.log(`Serving with DoH Resolver ${DOH_GATEWAY_URL}`);
  return app;
};

module.exports = {
  fetch: async function(request: Request, env: any, _context: any) {
    const router = routeHandler(env);
    return await router.handle(request);
  },
};
