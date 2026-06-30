import { KubeFastifyInstance } from '../../../types';

export default async (fastify: KubeFastifyInstance): Promise<void> => {
  await fastify.register(require('./featureStores'));
  await fastify.register(require('./feastMcpDiscovery'));
  await fastify.register(require('./feastMcpRegister'));
  await fastify.register(require('./fsworkbenchIntegration'));
  await fastify.register(require('./connectedWorkbenches'));
};
