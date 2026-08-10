import { resolve } from 'node:path';
import { EnterpriseFixtureServer } from '../../../packages/bench/src/enterprise-oracle.js';

const server = new EnterpriseFixtureServer(resolve('fixtures/enterprise'));
await server.start();
console.log(`primary=${server.url('/')}`);
console.log(`cross_origin=${server.crossOriginUrl('/')}`);

const stop = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
