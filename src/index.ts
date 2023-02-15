import dotenv from 'dotenv';
import { Server } from '@chainlink/ccip-read-server';
import { dohQuery } from '@ensdomains/dnsprovejs';
import { makeApp } from './app';

dotenv.config({ path: '../.env' });

const app = makeApp(
  dohQuery(process.env.DOH_GATEWAY_URL as string),
  '/',
  Server
);
app.listen(8080);
console.log('Server listening on port 8080');
