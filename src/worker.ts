import { Server } from '@ensdomains/ccip-read-cf-worker';
import { dohQuery } from '@ensdomains/dnsprovejs';
import { makeApp } from './app';

const routeHandler = (env: any) => {
  const { DOH_API } = env;
  const app = makeApp(dohQuery(DOH_API as string), '/', Server);
  console.log(`Serving with DoH Resolver ${DOH_API}`);
  return app;
};

module.exports = {
  fetch: async function(request: Request, env: any, _context: any) {
    const router = routeHandler(env);
    return await router.handle(request);
  },
};
