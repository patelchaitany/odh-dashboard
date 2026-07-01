import { FastifyReply } from 'fastify';
import { PatchUtils } from '@kubernetes/client-node';
import { KubeFastifyInstance, OauthFastifyRequest } from '../../../types';
import { getAccessToken, getDirectCallOptions } from '../../../utils/directCallUtils';
import { createCustomError } from '../../../utils/requestUtils';
import createError from 'http-errors';
import {
  listFeastNamespaces,
  listFeastFeatureStoreCRDs,
  isRegistryReady,
  getUserScopedCustomObjectsApi,
} from './featureStoreUtils';

const DEFAULT_MCP_PORT = 6567;
const FEAST_API_GROUP = 'feast.dev';
const FEAST_API_VERSION = 'v1';
const FEAST_RESOURCE = 'featurestores';

interface RouteItem {
  metadata: { name: string; namespace: string };
  spec: {
    host?: string;
    to: { kind: string; name: string };
    port?: { targetPort: number | string };
  };
  status?: { ingress?: Array<{ host?: string }> };
}

interface McpStatus {
  registryMcp: { enabled: boolean };
  featureServerMcp: {
    enabled: boolean;
    transport?: string;
    serverName?: string;
    serverVersion?: string;
  };
}

interface FeastProject {
  crdName: string;
  namespace: string;
  feastProject: string;
  registryReady: boolean;
  mcpStatus: McpStatus;
  routes: Array<{
    name: string;
    host: string;
    serviceName: string;
    port: number | string;
    url: string;
  }>;
  services: Array<{
    name: string;
    ports: Array<{ name?: string; port: number }>;
    isDefaultMcp: boolean;
  }>;
}

function getRouteUrl(route: RouteItem): string {
  const host = route.status?.ingress?.[0]?.host || route.spec.host;
  return host ? `https://${host}` : '';
}

function extractKubeHeaders(
  fastify: KubeFastifyInstance,
  req: OauthFastifyRequest<Record<string, unknown>>,
): Promise<Record<string, string>> {
  return getDirectCallOptions(fastify, req, '').then(
    (opts) => opts.headers as Record<string, string>,
  );
}

function requireToken(kubeHeaders: Record<string, string>): string {
  const token = getAccessToken({ headers: kubeHeaders });
  if (!token) {
    throw createCustomError('No access token', 'User authentication required', 401);
  }
  return token;
}

export default async (fastify: KubeFastifyInstance): Promise<void> => {
  // GET /api/featurestores/mcp-servers
  fastify.get(
    '/mcp-servers',
    async (req: OauthFastifyRequest<Record<string, never>>, reply: FastifyReply) => {
      try {
        const kubeHeaders = await extractKubeHeaders(fastify, req);
        requireToken(kubeHeaders);

        const namespaces = await listFeastNamespaces(fastify, kubeHeaders);

        if (namespaces.length === 0) {
          reply.send({ feastProjects: [], defaultMcpPort: DEFAULT_MCP_PORT });
          return;
        }

        const crdsByNamespace = await Promise.all(
          namespaces.map((ns) => listFeastFeatureStoreCRDs(fastify, ns, kubeHeaders)),
        );
        const allCRDs = crdsByNamespace.flat();

        const { api: userApi } = getUserScopedCustomObjectsApi(fastify, kubeHeaders);

        const feastProjects: FeastProject[] = await Promise.all(
          allCRDs.map(async (crd) => {
            const ns = crd.metadata.namespace;

            const registryMcpEnabled =
              crd.spec?.services?.registry?.local?.server?.mcp?.enabled === true;
            const onlineStoreMcp = crd.spec?.services?.onlineStore?.serving?.mcp;
            const mcpStatus: McpStatus = {
              registryMcp: { enabled: registryMcpEnabled },
              featureServerMcp: {
                enabled: onlineStoreMcp?.enabled === true,
                transport: onlineStoreMcp?.transport,
                serverName: onlineStoreMcp?.serverName,
                serverVersion: onlineStoreMcp?.serverVersion,
              },
            };

            let routes: RouteItem[] = [];
            try {
              const res = await userApi.listNamespacedCustomObject(
                'route.openshift.io',
                'v1',
                ns,
                'routes',
              );
              routes = (res.body as { items?: RouteItem[] }).items || [];
            } catch {
              // user may not have route access in this namespace
            }

            let serviceList: Array<{
              name: string;
              ports: Array<{ name?: string; port: number }>;
              isDefaultMcp: boolean;
            }> = [];
            try {
              const kc = fastify.kube.config;
              const userKc = new (await import('@kubernetes/client-node')).KubeConfig();
              const cluster = kc.getCurrentCluster();
              if (!cluster) {
                throw new Error('No current cluster configured');
              }
              userKc.loadFromClusterAndUser(cluster, {
                name: 'current-user',
                token: getAccessToken({ headers: kubeHeaders }) || '',
              });
              const coreApi = userKc.makeApiClient(
                (await import('@kubernetes/client-node')).CoreV1Api,
              );
              const res = await coreApi.listNamespacedService(ns);
              serviceList = (res.body.items || []).map((s) => ({
                name: s.metadata?.name || '',
                ports: (s.spec?.ports || []).map((p) => ({
                  name: p.name ?? undefined,
                  port: p.port,
                })),
                isDefaultMcp: (s.metadata?.name || '').includes('online'),
              }));
            } catch {
              // user may not have service list access
            }

            return {
              crdName: crd.metadata.name,
              namespace: ns,
              feastProject: crd.spec?.feastProject || crd.metadata.name,
              registryReady: isRegistryReady(crd),
              mcpStatus,
              routes: routes.map((r) => ({
                name: r.metadata.name,
                host: r.status?.ingress?.[0]?.host || r.spec.host || '',
                serviceName: r.spec.to.name,
                port: r.spec.port?.targetPort || '',
                url: getRouteUrl(r),
              })),
              services: serviceList,
            };
          }),
        );

        reply.send({ feastProjects, defaultMcpPort: DEFAULT_MCP_PORT });
      } catch (error) {
        if (createError.isHttpError(error)) {
          throw error;
        }
        fastify.log.error(`Failed to discover Feast MCP servers: ${error}`);
        throw createCustomError(
          'Failed to discover Feast MCP servers',
          'Unable to discover Feast MCP servers at this time',
          500,
        );
      }
    },
  );

  // PATCH /api/featurestores/mcp-enable — enable MCP on a FeatureStore CRD (user-scoped)
  fastify.patch(
    '/mcp-enable',
    async (
      req: OauthFastifyRequest<{
        Body: {
          namespace: string;
          crdName: string;
          registryMcpEnabled?: boolean;
          featureServerMcp?: {
            enabled: boolean;
            transport?: string;
            serverName?: string;
            serverVersion?: string;
          };
        };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const { namespace, crdName, registryMcpEnabled, featureServerMcp } = req.body;

        if (!namespace || !crdName) {
          throw createCustomError('Missing fields', 'namespace and crdName are required', 400);
        }

        const kubeHeaders = await extractKubeHeaders(fastify, req);
        requireToken(kubeHeaders);

        const { api: userApi } = getUserScopedCustomObjectsApi(fastify, kubeHeaders);

        const patchBody: Record<string, unknown> = { spec: { services: {} } };
        const services = patchBody.spec as { services: Record<string, unknown> };

        if (registryMcpEnabled !== undefined) {
          services.services.registry = {
            local: {
              server: {
                restAPI: true,
                mcp: { enabled: registryMcpEnabled },
              },
            },
          };
        }

        if (featureServerMcp) {
          services.services.onlineStore = {
            serving: {
              mcp: {
                enabled: featureServerMcp.enabled,
                ...(featureServerMcp.transport && { transport: featureServerMcp.transport }),
                ...(featureServerMcp.serverName && { serverName: featureServerMcp.serverName }),
                ...(featureServerMcp.serverVersion && {
                  serverVersion: featureServerMcp.serverVersion,
                }),
              },
            },
          };
        }

        await userApi.patchNamespacedCustomObject(
          FEAST_API_GROUP,
          FEAST_API_VERSION,
          namespace,
          FEAST_RESOURCE,
          crdName,
          patchBody,
          undefined,
          undefined,
          undefined,
          { headers: { 'Content-type': PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH } },
        );

        reply.send({
          message: `MCP configuration updated for FeatureStore ${namespace}/${crdName}`,
        });
      } catch (error) {
        if (createError.isHttpError(error)) {
          throw error;
        }
        fastify.log.error(`Failed to enable MCP on FeatureStore: ${error}`);
        throw createCustomError(
          'Failed to enable MCP',
          'Unable to update the FeatureStore MCP configuration',
          500,
        );
      }
    },
  );

  // POST /api/featurestores/mcp-route — create a reencrypt Route (user-scoped)
  fastify.post(
    '/mcp-route',
    async (
      req: OauthFastifyRequest<{
        Body: { namespace: string; routeName: string; serviceName: string; port: number };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const { namespace, routeName, serviceName, port } = req.body;

        if (!namespace || !routeName || !serviceName || !port) {
          throw createCustomError(
            'Missing fields',
            'namespace, routeName, serviceName, and port are required',
            400,
          );
        }

        const kubeHeaders = await extractKubeHeaders(fastify, req);
        requireToken(kubeHeaders);

        const { api: userApi } = getUserScopedCustomObjectsApi(fastify, kubeHeaders);

        const route = {
          apiVersion: 'route.openshift.io/v1',
          kind: 'Route',
          metadata: { name: routeName, namespace },
          spec: {
            to: { kind: 'Service', name: serviceName },
            port: { targetPort: port },
            tls: { termination: 'reencrypt' },
          },
        };

        await userApi.createNamespacedCustomObject(
          'route.openshift.io',
          'v1',
          namespace,
          'routes',
          route,
        );

        let routeUrl = '';
        try {
          const created = await userApi.getNamespacedCustomObject(
            'route.openshift.io',
            'v1',
            namespace,
            'routes',
            routeName,
          );
          routeUrl = getRouteUrl(created.body as RouteItem);
        } catch {
          // host not yet assigned
        }

        reply.code(201).send({ routeUrl, routeName });
      } catch (error) {
        if (createError.isHttpError(error)) {
          throw error;
        }
        fastify.log.error(`Failed to create MCP route: ${error}`);
        throw createCustomError(
          'Failed to create route',
          'Unable to create the MCP route at this time',
          500,
        );
      }
    },
  );
};
