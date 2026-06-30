import type { Extension, CodeRef } from '@openshift/dynamic-plugin-sdk';
import { createExtensionGuard } from '@odh-dashboard/plugin-core/extension-points';

export type McpServerRegisterModalExtension = Extension<
  'mcp-catalog.mcp-server/register-modal',
  {
    useIsRegisterAvailable: CodeRef<() => { available: boolean; loaded: boolean }>;
  }
>;

export const isMcpServerRegisterModalExtension =
  createExtensionGuard<McpServerRegisterModalExtension>('mcp-catalog.mcp-server/register-modal');
