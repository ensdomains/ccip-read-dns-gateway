# CCIP-Read-DNS-Gateway

## Overview

CCIP-Read-DNS-Gateway is a specialized server providing DNS resolution services for ENS domains with a focus on gasless DNSSEC support. It leverages the CCIP-Read protocol to offer efficient, off-chain DNS resolution and DNSSEC validation.

## Core Components

- `index.ts`: Express server for handling incoming requests. Mostly suitable for self-hosting or cloud development.
- `worker.ts`: Cloudflare worker script for handling incoming requests in a (Cloudflare Worker) serverless environment.

- `app.ts`: Configures server routes and handlers. Utilizes the `@ensdomains/dnsprovejs` library for DNS queries and proof generation.

## Installation

```bash
git clone https://github.com/your-repo/ccip-read-dns-gateway.git
cd ccip-read-dns-gateway
npm install
```

## Configuration

Set the `DOH_GATEWAY_URL` environment variable to specify your DNS-over-HTTPS gateway:

```bash
export DOH_GATEWAY_URL=https://your-doh-gateway.com/dns-query
```

## Usage

### Local Development

To run the server locally:

```bash
npm start
```

The server will start on `http://localhost:8080` by default.

### Cloudflare Worker Deployment

1. Install Wrangler CLI:
   ```bash
   npm install -g @cloudflare/wrangler
   ```

2. Authenticate with your Cloudflare account:
   ```bash
   wrangler login
   ```

3. Update `wrangler.toml` with your DoH gateway URL:
   ```toml
   [vars]
   DOH_GATEWAY_URL = "https://your-doh-gateway.com/dns-query"
   ```

4. Deploy the worker:
   ```bash
   wrangler publish
   ```

## API Endpoints

- `GET /`: Health check endpoint
- `POST /`: Main endpoint for DNS resolution and proof generation

## Dependencies

- [`@ensdomains/dnsprovejs`](https://github.com/ensdomains/dnsprovejs): Library for DNS proof generation and validation
- [`@chainlink/ccip-read-server`](https://github.com/smartcontractkit/ccip-read): Framework for implementing CCIP-Read servers

## License

MIT

## Support

For support, please open an issue in the GitHub repository or contact our support team at support@ens.domains.