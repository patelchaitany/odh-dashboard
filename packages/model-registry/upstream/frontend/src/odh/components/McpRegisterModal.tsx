import React from 'react';
import {
  Alert,
  Button,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  MenuToggle,
  NumberInput,
  Select,
  SelectList,
  SelectOption,
  Spinner,
  Stack,
  StackItem,
  TextInput,
} from '@patternfly/react-core';
import { DashboardModalFooter } from 'mod-arch-shared';

type RouteInfo = {
  name: string;
  host: string;
  serviceName: string;
  port: number | string;
  url: string;
};

type ServiceInfo = {
  name: string;
  ports: Array<{ name?: string; port: number }>;
  isDefaultMcp: boolean;
};

type FeastProject = {
  crdName: string;
  namespace: string;
  feastProject: string;
  registryReady: boolean;
  routes: RouteInfo[];
  services: ServiceInfo[];
};

type McpRegisterModalProps = {
  isOpen?: boolean;
  onClose: () => void;
};

const McpRegisterModal: React.FC<McpRegisterModalProps> = ({ isOpen = true, onClose }) => {
  const [feastProjects, setFeastProjects] = React.useState<FeastProject[]>([]);
  const [defaultMcpPort, setDefaultMcpPort] = React.useState(6567);
  const [loaded, setLoaded] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string>();

  const [selectedProject, setSelectedProject] = React.useState<FeastProject>();
  const [projectSelectOpen, setProjectSelectOpen] = React.useState(false);

  const [selectedRoute, setSelectedRoute] = React.useState<RouteInfo>();
  const [routeSelectOpen, setRouteSelectOpen] = React.useState(false);

  const [showCreateRoute, setShowCreateRoute] = React.useState(false);
  const [newRouteName, setNewRouteName] = React.useState('');
  const [selectedService, setSelectedService] = React.useState<string>('');
  const [serviceSelectOpen, setServiceSelectOpen] = React.useState(false);
  const [newRoutePort, setNewRoutePort] = React.useState(6567);
  const [isCreatingRoute, setIsCreatingRoute] = React.useState(false);

  const [serviceUrl, setServiceUrl] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [description, setDescription] = React.useState('');

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<Error>();

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    setLoaded(false);
    setLoadError(undefined);
    setSelectedProject(undefined);
    setSelectedRoute(undefined);
    setServiceUrl('');
    setDisplayName('');
    setDescription('');
    setShowCreateRoute(false);

    fetch('/api/featurestores/mcp-servers')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch Feast projects: ${res.statusText}`);
        }
        return res.json();
      })
      .then((data: { feastProjects: FeastProject[]; defaultMcpPort: number }) => {
        setFeastProjects(data.feastProjects);
        setDefaultMcpPort(data.defaultMcpPort);
        setNewRoutePort(data.defaultMcpPort);
        setLoaded(true);
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoaded(true);
      });
  }, [isOpen]);

  const handleProjectSelect = React.useCallback(
    (_event: React.MouseEvent | undefined, value: string | number | undefined) => {
      const project = feastProjects.find((p) => `${p.namespace}/${p.crdName}` === value);
      if (project) {
        setSelectedProject(project);
        setSelectedRoute(undefined);
        setServiceUrl('');
        setDisplayName(`Feast-${project.feastProject}`);
        setDescription(
          `Feast MCP server for project ${project.feastProject} in namespace ${project.namespace}`,
        );
        setShowCreateRoute(false);

        const defaultService = project.services.find((s) => s.isDefaultMcp);
        if (defaultService) {
          setSelectedService(defaultService.name);
        }
        setNewRoutePort(defaultMcpPort);
      }
      setProjectSelectOpen(false);
    },
    [feastProjects, defaultMcpPort],
  );

  const handleRouteSelect = React.useCallback(
    (_event: React.MouseEvent | undefined, value: string | number | undefined) => {
      if (value === '__create_new__') {
        setShowCreateRoute(true);
        setSelectedRoute(undefined);
        setServiceUrl('');
        setRouteSelectOpen(false);
        return;
      }
      const route = selectedProject?.routes.find((r) => r.name === value);
      if (route) {
        setSelectedRoute(route);
        setServiceUrl(route.url);
        setShowCreateRoute(false);
      }
      setRouteSelectOpen(false);
    },
    [selectedProject],
  );

  const handleServiceSelect = React.useCallback(
    (_event: React.MouseEvent | undefined, value: string | number | undefined) => {
      setSelectedService(String(value));
      setServiceSelectOpen(false);
    },
    [],
  );

  const handleCreateRoute = React.useCallback(async () => {
    if (!selectedProject || !newRouteName || !selectedService || !newRoutePort) {
      return;
    }

    setIsCreatingRoute(true);
    setSubmitError(undefined);

    try {
      const res = await fetch('/api/featurestores/mcp-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namespace: selectedProject.namespace,
          routeName: newRouteName,
          serviceName: selectedService,
          port: newRoutePort,
        }),
      });

      if (!res.ok) {
        const errorData: { message?: string } = await res.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to create route: ${res.statusText}`);
      }

      const data: { routeUrl: string; routeName: string } = await res.json();
      setServiceUrl(data.routeUrl);
      setShowCreateRoute(false);
    } catch (e) {
      setSubmitError(e instanceof Error ? e : new Error('Failed to create route'));
    } finally {
      setIsCreatingRoute(false);
    }
  }, [selectedProject, newRouteName, selectedService, newRoutePort]);

  const handleRegister = React.useCallback(async () => {
    if (!selectedProject || !displayName || !serviceUrl) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(undefined);

    try {
      const res = await fetch('/api/featurestores/mcp-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: displayName,
          url: serviceUrl,
          description,
        }),
      });

      if (!res.ok) {
        const errorData: { message?: string } = await res.json().catch(() => ({}));
        throw new Error(errorData.message || `Registration failed: ${res.statusText}`);
      }

      onClose();
    } catch (e) {
      setSubmitError(e instanceof Error ? e : new Error('Failed to register MCP server'));
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedProject, displayName, serviceUrl, description, onClose]);

  const isRegisterDisabled =
    !selectedProject || !displayName || !serviceUrl || isSubmitting || isCreatingRoute;

  if (!loaded && isOpen) {
    return (
      <Modal isOpen={isOpen} variant="medium" onClose={onClose} data-testid="mcp-register-modal">
        <ModalHeader title="Register Feast MCP server" />
        <ModalBody>
          <Spinner aria-label="Loading Feast projects" />
        </ModalBody>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} variant="medium" onClose={onClose} data-testid="mcp-register-modal">
      <ModalHeader title="Register Feast MCP server" />
      <ModalBody>
        {loadError && (
          <Alert
            variant="danger"
            isInline
            title="Failed to discover Feast projects"
            className="pf-v6-u-mb-md"
          >
            {loadError}
          </Alert>
        )}
        <Form>
          {/* Feast Project selector */}
          <FormGroup label="Feast project" isRequired fieldId="mcp-register-feast-project">
            <Select
              id="mcp-register-feast-project"
              isOpen={projectSelectOpen}
              selected={
                selectedProject
                  ? `${selectedProject.namespace}/${selectedProject.crdName}`
                  : undefined
              }
              onSelect={handleProjectSelect}
              onOpenChange={setProjectSelectOpen}
              toggle={(toggleRef) => (
                <MenuToggle
                  ref={toggleRef}
                  onClick={() => setProjectSelectOpen(!projectSelectOpen)}
                  isExpanded={projectSelectOpen}
                  isFullWidth
                  data-testid="mcp-register-project-toggle"
                >
                  {selectedProject
                    ? `${selectedProject.feastProject} (${selectedProject.namespace})`
                    : 'Select a Feast project'}
                </MenuToggle>
              )}
            >
              <SelectList>
                {feastProjects.length === 0 ? (
                  <SelectOption isDisabled value="none">
                    No Feast projects found
                  </SelectOption>
                ) : (
                  feastProjects.map((project) => {
                    const key = `${project.namespace}/${project.crdName}`;
                    return (
                      <SelectOption
                        key={key}
                        value={key}
                        description={`Namespace: ${project.namespace} | ${project.registryReady ? 'Ready' : 'Not ready'} | ${project.routes.length} routes`}
                        isDisabled={!project.registryReady}
                      >
                        {project.feastProject}
                      </SelectOption>
                    );
                  })
                )}
              </SelectList>
            </Select>
          </FormGroup>

          {/* Route selector — shown after project is selected */}
          {selectedProject && (
            <>
              <FormGroup label="Route" isRequired fieldId="mcp-register-route">
                <Select
                  id="mcp-register-route"
                  isOpen={routeSelectOpen}
                  selected={selectedRoute?.name}
                  onSelect={handleRouteSelect}
                  onOpenChange={setRouteSelectOpen}
                  toggle={(toggleRef) => (
                    <MenuToggle
                      ref={toggleRef}
                      onClick={() => setRouteSelectOpen(!routeSelectOpen)}
                      isExpanded={routeSelectOpen}
                      isFullWidth
                      data-testid="mcp-register-route-toggle"
                    >
                      {selectedRoute
                        ? `${selectedRoute.name} → ${selectedRoute.serviceName}:${selectedRoute.port}`
                        : 'Select a route or create new'}
                    </MenuToggle>
                  )}
                >
                  <SelectList>
                    {selectedProject.routes.map((route) => (
                      <SelectOption
                        key={route.name}
                        value={route.name}
                        description={`Service: ${route.serviceName} | Port: ${route.port} | ${route.host}`}
                      >
                        {route.name}
                      </SelectOption>
                    ))}
                    <SelectOption
                      value="__create_new__"
                      description="Create a new reencrypt route for a Feast service"
                    >
                      + Create new route
                    </SelectOption>
                  </SelectList>
                </Select>
              </FormGroup>

              {/* Create new route form */}
              {showCreateRoute && (
                <Stack hasGutter className="pf-v6-u-ml-lg pf-v6-u-mb-md">
                  <StackItem>
                    <FormGroup label="Route name" isRequired fieldId="mcp-register-new-route-name">
                      <TextInput
                        id="mcp-register-new-route-name"
                        value={newRouteName}
                        onChange={(_event, value) => setNewRouteName(value)}
                        placeholder="e.g. feast-mcp-online"
                        data-testid="mcp-register-new-route-name"
                      />
                    </FormGroup>
                  </StackItem>
                  <StackItem>
                    <FormGroup label="Service" isRequired fieldId="mcp-register-service">
                      <Select
                        id="mcp-register-service"
                        isOpen={serviceSelectOpen}
                        selected={selectedService}
                        onSelect={handleServiceSelect}
                        onOpenChange={setServiceSelectOpen}
                        toggle={(toggleRef) => (
                          <MenuToggle
                            ref={toggleRef}
                            onClick={() => setServiceSelectOpen(!serviceSelectOpen)}
                            isExpanded={serviceSelectOpen}
                            isFullWidth
                            data-testid="mcp-register-service-toggle"
                          >
                            {selectedService || 'Select a service'}
                          </MenuToggle>
                        )}
                      >
                        <SelectList>
                          {selectedProject.services.map((svc) => (
                            <SelectOption
                              key={svc.name}
                              value={svc.name}
                              description={`Ports: ${svc.ports.map((p) => p.port).join(', ')}${svc.isDefaultMcp ? ' (default MCP)' : ''}`}
                            >
                              {svc.name}
                            </SelectOption>
                          ))}
                        </SelectList>
                      </Select>
                    </FormGroup>
                  </StackItem>
                  <StackItem>
                    <FormGroup label="Port" isRequired fieldId="mcp-register-port">
                      <NumberInput
                        id="mcp-register-port"
                        value={newRoutePort}
                        onMinus={() => setNewRoutePort((p) => Math.max(1, p - 1))}
                        onPlus={() => setNewRoutePort((p) => p + 1)}
                        onChange={(event) => {
                          const { target } = event;
                          if (target instanceof HTMLInputElement) {
                            const val = parseInt(target.value, 10);
                            if (!Number.isNaN(val)) {
                              setNewRoutePort(val);
                            }
                          }
                        }}
                        min={1}
                        max={65535}
                        data-testid="mcp-register-port"
                      />
                      <FormHelperText>
                        <HelperText>
                          <HelperTextItem>
                            Default Feast MCP port is {defaultMcpPort}
                          </HelperTextItem>
                        </HelperText>
                      </FormHelperText>
                    </FormGroup>
                  </StackItem>
                  <StackItem>
                    <Button
                      variant="secondary"
                      onClick={handleCreateRoute}
                      isDisabled={
                        !newRouteName || !selectedService || !newRoutePort || isCreatingRoute
                      }
                      isLoading={isCreatingRoute}
                      data-testid="mcp-register-create-route-button"
                    >
                      Create route
                    </Button>
                  </StackItem>
                </Stack>
              )}

              {/* Service URL */}
              <FormGroup label="Service URL" isRequired fieldId="mcp-register-url">
                <TextInput
                  id="mcp-register-url"
                  value={serviceUrl}
                  onChange={(_event, value) => setServiceUrl(value)}
                  data-testid="mcp-register-url-input"
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      The external route URL. Auto-filled when selecting a route, or editable
                      manually.
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>

              <FormGroup label="Display name" isRequired fieldId="mcp-register-name">
                <TextInput
                  id="mcp-register-name"
                  value={displayName}
                  onChange={(_event, value) => setDisplayName(value)}
                  data-testid="mcp-register-name-input"
                />
              </FormGroup>

              <FormGroup label="Description" fieldId="mcp-register-description">
                <TextInput
                  id="mcp-register-description"
                  value={description}
                  onChange={(_event, value) => setDescription(value)}
                  data-testid="mcp-register-description-input"
                />
              </FormGroup>
            </>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <DashboardModalFooter
          submitLabel="Register"
          onSubmit={handleRegister}
          onCancel={onClose}
          isSubmitDisabled={isRegisterDisabled}
          isSubmitLoading={isSubmitting}
          error={submitError}
          alertTitle="Registration failed"
        />
      </ModalFooter>
    </Modal>
  );
};

export default McpRegisterModal;
