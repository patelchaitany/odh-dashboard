import { FastifyReply } from 'fastify';
import * as k8s from '@kubernetes/client-node';
import { KubeFastifyInstance, OauthFastifyRequest } from '../../../types';
import { getAccessToken, getDirectCallOptions } from '../../../utils/directCallUtils';
import { createCustomError } from '../../../utils/requestUtils';
import createError from 'http-errors';

const MCP_CONFIGMAP_NAME = 'gen-ai-aa-mcp-servers';

interface RegisterMcpRequest {
  name: string;
  url: string;
  description?: string;
  transport?: string;
  namespace: string;
}

export default async (fastify: KubeFastifyInstance): Promise<void> => {
  fastify.post(
    '/mcp-register',
    async (req: OauthFastifyRequest<{ Body: RegisterMcpRequest }>, reply: FastifyReply) => {
      try {
        const { name, url, description, transport, namespace } = req.body;

        if (!name || !url || !namespace) {
          throw createCustomError(
            'Missing required fields',
            'name, url, and namespace are required',
            400,
          );
        }

        const kubeHeaders = (await getDirectCallOptions(fastify, req, '')).headers as Record<
          string,
          string
        >;
        const token = getAccessToken({ headers: kubeHeaders });

        if (!token) {
          throw createCustomError('No access token', 'User authentication required', 401);
        }

        const configEntry: Record<string, string> = { url };
        if (description) {
          configEntry.description = description;
        }
        if (transport) {
          configEntry.transport = transport;
        }

        const kc = fastify.kube.config;
        const coreV1Api = kc.makeApiClient(k8s.CoreV1Api);

        try {
          const { body: configMap } = await coreV1Api.readNamespacedConfigMap(
            MCP_CONFIGMAP_NAME,
            namespace,
          );

          if (!configMap.data) {
            configMap.data = {};
          }
          configMap.data[name] = JSON.stringify(configEntry);

          await coreV1Api.replaceNamespacedConfigMap(MCP_CONFIGMAP_NAME, namespace, configMap);
        } catch (e: unknown) {
          const statusCode = (e as { response?: { statusCode?: number } })?.response?.statusCode;
          if (statusCode === 404) {
            const newConfigMap: k8s.V1ConfigMap = {
              metadata: {
                name: MCP_CONFIGMAP_NAME,
                namespace,
              },
              data: {
                [name]: JSON.stringify(configEntry),
              },
            };
            await coreV1Api.createNamespacedConfigMap(namespace, newConfigMap);
          } else {
            throw e;
          }
        }

        reply.code(201).send({
          message: `MCP server '${name}' registered successfully`,
        });
      } catch (error) {
        if (createError.isHttpError(error)) {
          throw error;
        }
        fastify.log.error(`Failed to register MCP server: ${error}`);
        throw createCustomError(
          'Failed to register MCP server',
          'Unable to register the MCP server at this time',
          500,
        );
      }
    },
  );

  fastify.delete(
    '/mcp-register/:serverName',
    async (
      req: OauthFastifyRequest<{
        Params: { serverName: string };
        Querystring: { namespace: string };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const { serverName } = req.params;
        const namespace = (req.query as Record<string, string>).namespace;

        if (!serverName || !namespace) {
          throw createCustomError(
            'Missing required fields',
            'serverName and namespace are required',
            400,
          );
        }

        const kubeHeaders = (await getDirectCallOptions(fastify, req, '')).headers as Record<
          string,
          string
        >;
        const token = getAccessToken({ headers: kubeHeaders });

        if (!token) {
          throw createCustomError('No access token', 'User authentication required', 401);
        }

        const kc = fastify.kube.config;
        const coreV1Api = kc.makeApiClient(k8s.CoreV1Api);

        const { body: configMap } = await coreV1Api.readNamespacedConfigMap(
          MCP_CONFIGMAP_NAME,
          namespace,
        );

        if (!configMap.data || !(serverName in configMap.data)) {
          throw createCustomError(
            'Server not found',
            `MCP server '${serverName}' not found in ConfigMap`,
            404,
          );
        }

        delete configMap.data[serverName];

        await coreV1Api.replaceNamespacedConfigMap(MCP_CONFIGMAP_NAME, namespace, configMap);

        reply.send({
          message: `MCP server '${serverName}' unregistered successfully`,
        });
      } catch (error) {
        if (createError.isHttpError(error)) {
          throw error;
        }
        fastify.log.error(`Failed to unregister MCP server: ${error}`);
        throw createCustomError(
          'Failed to unregister MCP server',
          'Unable to unregister the MCP server at this time',
          500,
        );
      }
    },
  );
};
