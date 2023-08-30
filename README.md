# CCIP-Read-DNS-Gateway: Your Gasless DNSSEC Support

Welcome aboard the CCIP-Read-DNS-Gateway! This isn't just any gateway, it's a special server that provides DNS resolution services for ENS domains, with a focus on gasless DNSSEC support. 

## Inside the Gateway

Let's take a quick look at what makes this gateway tick:

- `index.ts`: This is the starting point for our application. It sets up the DNS prover with a specified DoH gateway URL and gets the server up and running.

- `app.ts`: This is where the server gets its instructions. It sets up the server with the necessary routes and handlers, and uses the `@ensdomains/dnsprovejs` library to perform DNS queries and proofs.

- `worker.ts`: This is our diligent Cloudflare worker, ready to handle incoming requests and direct them to the appropriate handlers. Useful for [getting started fast](#gateway-server).

## Ready to Get Started?

### I will run in local

To run this server locally, you'll need to provide a DoH (DNS over HTTPS) gateway URL. Set the DOH_GATEWAY_URL environment variable and you're all set! The server will use this gateway to perform DNS queries.

Once you're ready, just run the index.ts file. You'll be up and running on port 8080 (default).

### I will run as Cloudflare Worker

If you want to run this as a Cloudflare Worker, the process is slightly different, but still super easy.

First, you'll need to install wrangler on your machine. You can do this by following the instructions [here](https://developers.cloudflare.com/workers/wrangler/install-and-update/#install-wrangler-globally).

Once wrangler is installed, use wrangler login to configure your account.

Next, navigate to the wrangler.toml file and update the DOH_GATEWAY_URL environment variable with the DoH server you want to use.

Finally, run `wrangler publish` and voila! Your Cloudflare worker is up and running. Easy peasy!

## Our Companions

We've got some great companions on this journey:

- [`@ensdomains/dnsprovejs`](https://github.com/ensdomains/dnsprovejs): Our reliable ally for DNS proofs.
- [`@chainlink/ccip-read-server`](https://github.com/smartcontractkit/ccip-read): Sets the stage for a CCIP read server.

Remember, this is just a quick overview. For a deeper understanding, feel free to explore the source code. Happy coding!