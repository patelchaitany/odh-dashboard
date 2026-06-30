package api

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/julienschmidt/httprouter"
	"github.com/opendatahub-io/gen-ai/internal/constants"
	"github.com/opendatahub-io/gen-ai/internal/models"
)

type MCPListEnvelope = Envelope[models.MCPListData, None]

// MCPListHandler handles GET /genai/v1/aa/mcps?namespace=<>
func (app *App) MCPListHandler(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	ctx := r.Context()

	identity, k8sClient, err := app.setupMCPEndpoint(ctx)
	if err != nil {
		app.badRequestResponse(w, r, err)
		return
	}

	_, _, _, err = app.parseMCPEndpointParams(r, false)
	if err != nil {
		app.badRequestResponse(w, r, err)
		return
	}

	result, err := app.repositories.MCPClient.GetMCPServersFromConfigWithMetadata(
		k8sClient,
		ctx,
		identity,
		app.dashboardNamespace,
		constants.MCPServerName,
	)
	if err != nil {
		app.handleConfigMapError(w, r, err, constants.MCPServerName, app.dashboardNamespace)
		return
	}

	servers := make([]models.MCPServerSummary, 0, len(result.Servers))
	for _, serverInfo := range result.Servers {
		status := app.determineServerStatusFromConfig(serverInfo.Config)
		var logo *string
		if serverInfo.Config.Logo != "" {
			logo = &serverInfo.Config.Logo
		}

		servers = append(servers, models.MCPServerSummary{
			Name:        serverInfo.Name,
			URL:         serverInfo.Config.URL,
			Transport:   app.normalizeTransportType(serverInfo.Config.Transport),
			Description: serverInfo.Config.Description,
			Logo:        logo,
			Status:      status,
		})
	}

	responseData := models.MCPListData{
		Servers:       servers,
		TotalCount:    len(servers),
		ConfigMapInfo: result.ConfigMapInfo,
	}

	response := MCPListEnvelope{
		Data: responseData,
	}

	if err := app.WriteJSON(w, http.StatusOK, response, nil); err != nil {
		app.serverErrorResponse(w, r, err)
		return
	}
}

// MCPRegisterRequest represents the request body for registering an MCP server
type MCPRegisterRequest struct {
	Name        string `json:"name"`
	URL         string `json:"url"`
	Description string `json:"description,omitempty"`
	Transport   string `json:"transport,omitempty"`
}

// MCPRegisterHandler handles POST /api/v1/aaa/mcps — registers an MCP server to the ConfigMap
func (app *App) MCPRegisterHandler(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	ctx := r.Context()

	identity, k8sClient, err := app.setupMCPEndpoint(ctx)
	if err != nil {
		app.badRequestResponse(w, r, err)
		return
	}

	var req MCPRegisterRequest
	if err := app.ReadJSON(w, r, &req); err != nil {
		app.badRequestResponse(w, r, err)
		return
	}

	if req.Name == "" {
		app.badRequestResponse(w, r, fmt.Errorf("name is required"))
		return
	}
	if req.URL == "" {
		app.badRequestResponse(w, r, fmt.Errorf("url is required"))
		return
	}

	config := models.MCPServerConfig{
		URL:         req.URL,
		Description: req.Description,
		Transport:   req.Transport,
	}

	if err := app.repositories.MCPClient.RegisterMCPServer(
		k8sClient, ctx, identity,
		app.dashboardNamespace,
		constants.MCPServerName,
		req.Name,
		config,
	); err != nil {
		app.handleConfigMapError(w, r, err, constants.MCPServerName, app.dashboardNamespace)
		return
	}

	if err := app.WriteJSON(w, http.StatusCreated, map[string]string{
		"message": fmt.Sprintf("MCP server '%s' registered successfully", req.Name),
	}, nil); err != nil {
		app.serverErrorResponse(w, r, err)
	}
}

// MCPUnregisterHandler handles DELETE /api/v1/aaa/mcps/:name — removes an MCP server from the ConfigMap
func (app *App) MCPUnregisterHandler(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	ctx := r.Context()

	identity, k8sClient, err := app.setupMCPEndpoint(ctx)
	if err != nil {
		app.badRequestResponse(w, r, err)
		return
	}

	serverName := ps.ByName("name")
	if serverName == "" {
		app.badRequestResponse(w, r, fmt.Errorf("server name is required"))
		return
	}

	if err := app.repositories.MCPClient.UnregisterMCPServer(
		k8sClient, ctx, identity,
		app.dashboardNamespace,
		constants.MCPServerName,
		serverName,
	); err != nil {
		app.handleConfigMapError(w, r, err, constants.MCPServerName, app.dashboardNamespace)
		return
	}

	if err := app.WriteJSON(w, http.StatusOK, map[string]string{
		"message": fmt.Sprintf("MCP server '%s' unregistered successfully", serverName),
	}, nil); err != nil {
		app.serverErrorResponse(w, r, err)
	}
}

// handleConfigMapError handles specific ConfigMap-related errors with appropriate HTTP status codes
func (app *App) handleConfigMapError(w http.ResponseWriter, r *http.Request, err error, configMapName, namespace string) {
	errMsg := err.Error()

	if containsAny(errMsg, []string{"not found", "NotFound", "404"}) {
		if err := app.WriteJSON(w, http.StatusNotFound, map[string]interface{}{
			"error": map[string]interface{}{
				"code":    "404",
				"message": fmt.Sprintf("ConfigMap '%s' not found in namespace '%s'", configMapName, namespace),
				"details": map[string]interface{}{
					"config_map_name": configMapName,
					"namespace":       namespace,
					"reason":          "ConfigMap does not exist",
				},
			},
		}, nil); err != nil {
			app.serverErrorResponse(w, r, err)
		}
		return
	}

	if containsAny(errMsg, []string{"forbidden", "Forbidden", "403", "permission denied"}) {
		if err := app.WriteJSON(w, http.StatusForbidden, map[string]interface{}{
			"error": map[string]interface{}{
				"code":    "403",
				"message": fmt.Sprintf("Access denied to ConfigMap '%s' in namespace '%s'", configMapName, namespace),
				"details": map[string]interface{}{
					"config_map_name": configMapName,
					"namespace":       namespace,
					"reason":          "Insufficient permissions",
				},
			},
		}, nil); err != nil {
			app.serverErrorResponse(w, r, err)
		}
		return
	}

	app.serverErrorResponse(w, r, err)
}

// determineServerStatusFromConfig determines server status based on ConfigMap data only (no MCP calls)
func (app *App) determineServerStatusFromConfig(config models.MCPServerConfig) string {
	if config.URL == "" {
		return "error"
	}

	// ConfigMap data is valid, assume server is healthy
	return "healthy"
}

// normalizeTransportType ensures transport type has a default value
func (app *App) normalizeTransportType(transport string) string {
	if transport == "" {
		return "streamable-http"
	}
	return transport
}

// containsAny checks if the string contains any of the given substrings (case-insensitive)
func containsAny(str string, substrings []string) bool {
	lowerStr := strings.ToLower(str)
	for _, substr := range substrings {
		if strings.Contains(lowerStr, strings.ToLower(substr)) {
			return true
		}
	}
	return false
}
