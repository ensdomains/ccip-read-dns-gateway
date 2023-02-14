import { Server } from '@ensdomains/ccip-read-cf-worker';
import { makeApp } from './app';

const routeHandler = (env: any) => {
  const { DOH_API } = env;
  const app = makeApp(DOH_API, '/', Server);
  console.log(`Serving with DoH Resolver ${DOH_API}`);
  return app;
};

module.exports = {
  fetch: async function(request: Request, env: any, _context: any) {
    const router = routeHandler(env);
    return await router.handle(request);
  },
};
