import dotenv from 'dotenv';
import { makeApp } from './app';
import { dohQuery } from '@ensdomains/dnsprovejs';

dotenv.config({ path: '../.env' });

const app = makeApp(dohQuery(process.env.DOH_GATEWAY_URL as string), '/')
app.listen(8080);
console.log('Server listening on port 8080');
