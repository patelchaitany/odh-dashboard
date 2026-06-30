# Feast MCP Server Registration — Implementation Plan

## Problem

Feast MCP servers run on existing Feast pods (on a different port), but they are invisible in the MCP catalog UI. Users must manually create a `gen-ai-aa-mcp-servers` ConfigMap to make them available to AI agents. This feature adds auto-discovery and one-click registration from the MCP catalog page.

## High-Level Flow

```
User visits MCP Catalog page
  → Sees Feast MCP card (published to upstream Model Catalog with deploymentMode: "feast")
  → Clicks card → Details page shows "Register MCP server" button (not "Deploy")
  → Clicks "Register"
  → Modal auto-scans all namespaces for Feast MCP services
  → User selects one
  → If no K8s Service exists for MCP port → backend creates one
  → URL auto-fills
  → User hits Register
  → Entry written to gen-ai-aa-mcp-servers ConfigMap
  → Server now available to AI agents
```

## Architecture

### Three MCP Data Sources (existing)

| Source | API | What it powers |
|--------|-----|----------------|
| Model Catalog API (external, read-only) | `GET /mcp_catalog/mcp_servers` | Catalog tab cards |
| MCPServer CRs (`mcp.x-k8s.io/v1alpha1`) | CRUD `/mcp_deployments` | Deployments tab |
| gen-ai ConfigMap (`gen-ai-aa-mcp-servers`) | `GET /aaa/mcps` (read-only today) | AI agent MCP servers |

### What This Feature Adds

- **Feast discovery** endpoint in main backend → finds Feast instances with MCP enabled
- **ConfigMap write** endpoints in gen-ai BFF → creates/updates ConfigMap entries
- **"Register" button** on catalog details page → new extension point, separate from "Deploy"
- **Register modal** in gen-ai frontend → discovery + selection + ConfigMap write

## Dependency

**Feast Operator must add MCP as a service type** in the FeatureStore CRD (`feast.dev/v1`). Currently the CRD only supports `registry`, `offlineStore`, `onlineStore`, `ui`. The specific CRD field (likely `spec.services.mcp`) and MCP port are TBD.

## Detailed Changes

### 1. DeploymentMode Type Updates

Current values: `"local"` | `"remote"`. Add: `"feast"`.

| File | Change |
|------|--------|
| `packages/model-registry/upstream/bff/internal/models/mcp_server_catalog.go` | Add `McpDeploymentModeFeast = "feast"` |
| `packages/model-registry/upstream/frontend/src/app/mcpServerCatalogTypes.ts` | Add `'feast'` to union type |
| `packages/model-registry/upstream/frontend/src/app/pages/mcpCatalog/utils/mcpCatalogUtils.ts` | Add `isMcpFeastDeploymentMode()` helper |

### 2. FeatureStore CRD Type Update (blocked on Feast Operator)

| File | Change |
|------|--------|
| `frontend/src/k8sTypes.ts` | Add `mcp?: { server?: Server }` to `Services` type |

### 3. Backend: Feast MCP Discovery Endpoint

**New**: `backend/src/routes/api/featurestores/feastMcpDiscovery.ts`

**Route**: `GET /api/featurestores/mcp-servers`

Logic (reuses existing utilities from `featureStoreUtils.ts`):
1. `listFeastNamespaces()` → namespaces with label `opendatahub.io/feast=true`
2. `listFeastFeatureStoreCRDs()` → CRDs with label `feature-store-ui=enabled`
3. Check `spec.services.mcp` exists (TBD field)
4. Look for K8s Service `feast-{name}-mcp` in namespace
5. Derive URL if Service exists; return `serviceExists: false` otherwise
6. Check readiness via CRD status conditions

**Response**:
```json
{
  "feastMcpServers": [
    {
      "crdName": "my-feast",
      "namespace": "feast-ns",
      "feastProject": "my-project",
      "mcpEnabled": true,
      "serviceUrl": "http://feast-my-feast-mcp.feast-ns.svc.cluster.local:PORT",
      "serviceExists": true,
      "registryReady": true
    }
  ]
}
```

### 4. Backend: Create MCP Service Endpoint

**New**: `POST /api/featurestores/:namespace/:name/mcp-service`

When no K8s Service exists for the Feast MCP port:
- Derive pod selector labels from FeatureStore CRD (same pods as registry, different port)
- Create K8s Service targeting MCP port
- Service name: `feast-{crdName}-mcp` (TBD convention)
- Return created Service URL

### 5. Gen-AI BFF: ConfigMap Write Endpoints

**Existing read endpoint**: `GET /api/v1/aaa/mcps` (reads `gen-ai-aa-mcp-servers` ConfigMap)

**New endpoints**:

| Method | Path | Handler | Purpose |
|--------|------|---------|---------|
| POST | `/api/v1/aaa/mcps` | `MCPRegisterHandler` | Add entry to ConfigMap (create if absent) |
| DELETE | `/api/v1/aaa/mcps/:name` | `MCPUnregisterHandler` | Remove entry from ConfigMap |

**Files to modify**:
- `packages/gen-ai/bff/internal/repositories/mcp_client.go` — add `RegisterMCPServer()`, `UnregisterMCPServer()`
- `packages/gen-ai/bff/internal/api/aaa_mcps_handler.go` — add handler functions
- `packages/gen-ai/bff/internal/api/app.go` — register routes
- K8s client interface — add ConfigMap create/update methods

**ConfigMap data format** (each entry):
```yaml
data:
  Feast-My-Server: |
    {
      "url": "http://feast-my-feast-mcp.feast-ns.svc.cluster.local:PORT",
      "description": "Feast MCP server for my-feast project"
    }
```

### 6. Catalog Page UI Changes

**Details page** (`McpServerDetailsPage.tsx`):
- If `isMcpFeastDeploymentMode(server.deploymentMode)` → show `McpRegisterButton` instead of `McpDeployButton`

**Catalog card** (`McpCatalogCard.tsx`):
- Show "FEAST" badge label when `isMcpFeastDeploymentMode`

### 7. Register Extension Point + Button

Follow existing `mcp-catalog.mcp-server/deploy-modal` pattern:

**New extension point**: `mcp-catalog.mcp-server/register-modal`
- File: `packages/model-registry/upstream/frontend/src/odh/extension-points/mcp-register.ts`
- Provides `useIsRegisterAvailable` hook

**New button**: `McpRegisterButton.tsx`
- File: `packages/model-registry/upstream/frontend/src/odh/components/McpRegisterButton.tsx`
- Follows `McpDeployButton.tsx` pattern

**Extension registered** in gen-ai `extensions.ts`.

### 8. Register Modal

**New**: `RegisterFeastMcpModal.tsx` (gen-ai package frontend)

**Modal flow**:
1. On open → fetch `GET /api/featurestores/mcp-servers`
2. Show selectable table: CRD name, namespace, URL, ready status, service exists
3. User selects one
4. If `serviceExists: false` → call `POST /api/featurestores/:ns/:name/mcp-service` to create Service
5. URL auto-fills from service URL
6. User sets display name + description
7. On submit → `POST /gen-ai/api/v1/aaa/mcps` → ConfigMap entry created
8. Success → close modal

**Supporting files**:
- `useFetchFeastMcpServers.ts` — hook for discovery endpoint
- API service functions for `registerMcpServer()` / `unregisterMcpServer()`

## Implementation Phases

```
Phase 1 — Can start now (no Feast Operator dependency):
├── Gen-AI BFF ConfigMap write endpoints (POST/DELETE /aaa/mcps)
└── DeploymentMode type updates (Go + TypeScript + utility)

Phase 2 — Blocked on Feast Operator MCP CRD:
├── FeatureStore CRD type update (frontend/src/k8sTypes.ts)
├── Backend Feast MCP discovery endpoint
└── Backend MCP Service creation endpoint

Phase 3 — Depends on Phase 1 + 2:
├── Register extension point + button component
├── Register modal component + hooks
├── Catalog details page conditional Register/Deploy button
└── Catalog card Feast badge
```

## TBD Items (blocked on Feast Operator)

| Item | Depends On |
|------|------------|
| `spec.services.mcp` CRD field shape | Feast Operator CRD update |
| MCP port number | Feast Operator configuration |
| Pod label selector for MCP pods | Same as existing Feast pods (confirmed once CRD updated) |
| MCP Service naming convention | Team decision: `feast-{name}-mcp` or similar |
| How to check "MCP enabled" | Presence of `spec.services.mcp` or a status condition |

## Testing

- **Backend**: Unit tests for discovery and service creation endpoints
- **Gen-AI BFF**: Unit tests for register/unregister handlers and repository methods
- **Frontend**: Component tests for register modal and conditional button rendering

## Verification Checklist

1. Start dev server + gen-ai BFF
2. Deploy FeatureStore CRD with MCP enabled (once Feast Operator supports it)
3. Publish Feast MCP entry to Model Catalog with `deploymentMode: "feast"`
4. Navigate to MCP Servers > Catalog → Feast card with "FEAST" badge
5. Click card → details page shows "Register MCP server" button
6. Click Register → modal shows discovered Feast services
7. Select one with no Service → modal creates Service, shows URL
8. Click Register → ConfigMap `gen-ai-aa-mcp-servers` updated
9. Verify entry appears in AI Assets > MCP tab
