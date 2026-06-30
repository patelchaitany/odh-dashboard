import { FastifyReply } from 'fastify';
import { KubeFastifyInstance, OauthFastifyRequest } from '../../../types';
import { getAccessToken, getDirectCallOptions } from '../../../utils/directCallUtils';
import { createCustomError } from '../../../utils/requestUtils';
import createError from 'http-errors';
import {
  listFeastNamespaces,
  listFeastFeatureStoreCRDs,
  isRegistryReady,
} from './featureStoreUtils';

const DEFAULT_MCP_PORT = 6567;

interface RouteItem {
  metadata: { name: string; namespace: string };
  spec: {
    host?: string;
    to: { kind: string; name: string };
    port?: { targetPort: number | string };
  };
  status?: { ingress?: Array<{ host?: string }> };
}

interface ServiceItem {
  metadata: { name: string; namespace: string };
  spec: { ports?: Array<{ name?: string; port: number; targetPort?: number | string }> };
}

interface FeastProject {
  crdName: string;
  namespace: string;
  feastProject: string;
  registryReady: boolean;
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

export default async (fastify: KubeFastifyInstance): Promise<void> => {
  fastify.get(
    '/mcp-servers',
    async (req: OauthFastifyRequest<Record<string, never>>, reply: FastifyReply) => {
      try {
        const kubeHeaders = (await getDirectCallOptions(fastify, req, '')).headers as Record<
          string,
          string
        >;
        const token = getAccessToken({ headers: kubeHeaders });

        if (!token) {
          throw createCustomError('No access token', 'User authentication required', 401);
        }

        const namespaces = await listFeastNamespaces(fastify, kubeHeaders);

        if (namespaces.length === 0) {
          reply.send({ feastProjects: [], defaultMcpPort: DEFAULT_MCP_PORT });
          return;
        }

        const crdsByNamespace = await Promise.all(
          namespaces.map((ns) => listFeastFeatureStoreCRDs(fastify, ns, kubeHeaders)),
        );
        const allCRDs = crdsByNamespace.flat();

        const feastProjects: FeastProject[] = await Promise.all(
          allCRDs.map(async (crd) => {
            const ns = crd.metadata.namespace;

            let routes: RouteItem[] = [];
            try {
              const res = await fastify.kube.customObjectsApi.listNamespacedCustomObject(
                'route.openshift.io',
                'v1',
                ns,
                'routes',
              );
              routes = (res.body as { items?: RouteItem[] }).items || [];
            } catch {
              // ignore
            }

            let services: ServiceItem[] = [];
            try {
              const res = await fastify.kube.coreV1Api.listNamespacedService(ns);
              services = (res.body.items || []).map((s) => ({
                metadata: { name: s.metadata?.name || '', namespace: s.metadata?.namespace || '' },
                spec: {
                  ports: (s.spec?.ports || []).map((p) => ({
                    name: p.name ?? undefined,
                    port: p.port,
                    targetPort: p.targetPort as unknown as string | number | undefined,
                  })),
                },
              }));
            } catch {
              // ignore
            }

            return {
              crdName: crd.metadata.name,
              namespace: ns,
              feastProject: crd.spec?.feastProject || crd.metadata.name,
              registryReady: isRegistryReady(crd),
              routes: routes.map((r) => ({
                name: r.metadata.name,
                host: r.status?.ingress?.[0]?.host || r.spec.host || '',
                serviceName: r.spec.to.name,
                port: r.spec.port?.targetPort || '',
                url: getRouteUrl(r),
              })),
              services: services.map((s) => ({
                name: s.metadata.name,
                ports: (s.spec.ports || []).map((p) => ({ name: p.name, port: p.port })),
                isDefaultMcp: s.metadata.name.includes('online'),
              })),
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

        const kubeHeaders = (await getDirectCallOptions(fastify, req, '')).headers as Record<
          string,
          string
        >;
        const token = getAccessToken({ headers: kubeHeaders });
        if (!token) {
          throw createCustomError('No access token', 'User authentication required', 401);
        }

        const route = {
          apiVersion: 'route.openshift.io/v1',
          kind: 'Route',
          metadata: {
            name: routeName,
            namespace,
          },
          spec: {
            to: {
              kind: 'Service',
              name: serviceName,
            },
            port: {
              targetPort: port,
            },
            tls: {
              termination: 'reencrypt',
            },
          },
        };

        await fastify.kube.customObjectsApi.createNamespacedCustomObject(
          'route.openshift.io',
          'v1',
          namespace,
          'routes',
          route,
        );

        // Fetch the created route to get the assigned host
        let routeUrl = '';
        try {
          const created = await fastify.kube.customObjectsApi.getNamespacedCustomObject(
            'route.openshift.io',
            'v1',
            namespace,
            'routes',
            routeName,
          );
          const createdRoute = created.body as RouteItem;
          routeUrl = getRouteUrl(createdRoute);
        } catch {
          // Route was created but host not yet assigned
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
