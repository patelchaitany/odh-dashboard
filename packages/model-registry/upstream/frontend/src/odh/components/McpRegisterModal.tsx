import React from 'react';
import {
  Alert,
  Button,
  Form,
  FormGroup,
  FormHelperText,
  Flex,
  FlexItem,
  HelperText,
  HelperTextItem,
  Label,
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
import { CheckCircleIcon, TimesCircleIcon } from '@patternfly/react-icons';
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

type McpStatus = {
  registryMcp: { enabled: boolean };
  featureServerMcp: {
    enabled: boolean;
    transport?: string;
    serverName?: string;
    serverVersion?: string;
  };
};

type FeastProject = {
  crdName: string;
  namespace: string;
  feastProject: string;
  registryReady: boolean;
  mcpStatus: McpStatus;
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

  // MCP enable form state
  const [isEnablingMcp, setIsEnablingMcp] = React.useState(false);
  const [fsMcpTransport, setFsMcpTransport] = React.useState('sse');
  const [fsMcpTransportOpen, setFsMcpTransportOpen] = React.useState(false);
  const [fsMcpServerName, setFsMcpServerName] = React.useState('feast-mcp-server');
  const [fsMcpServerVersion, setFsMcpServerVersion] = React.useState('1.0.0');

  // Route state
  const [selectedRoute, setSelectedRoute] = React.useState<RouteInfo>();
  const [routeSelectOpen, setRouteSelectOpen] = React.useState(false);
  const [showCreateRoute, setShowCreateRoute] = React.useState(false);
  const [newRouteName, setNewRouteName] = React.useState('');
  const [selectedService, setSelectedService] = React.useState<string>('');
  const [serviceSelectOpen, setServiceSelectOpen] = React.useState(false);
  const [newRoutePort, setNewRoutePort] = React.useState(6567);
  const [isCreatingRoute, setIsCreatingRoute] = React.useState(false);

  // Registration state
  const [serviceUrl, setServiceUrl] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<Error>();

  const fetchProjects = React.useCallback(() => {
    setLoaded(false);
    setLoadError(undefined);

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

        if (selectedProject) {
          const updated = data.feastProjects.find(
            (p) =>
              p.namespace === selectedProject.namespace && p.crdName === selectedProject.crdName,
          );
          if (updated) {
            setSelectedProject(updated);
          }
        }
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoaded(true);
      });
  }, [selectedProject]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    setSelectedProject(undefined);
    setSelectedRoute(undefined);
    setServiceUrl('');
    setDisplayName('');
    setDescription('');
    setShowCreateRoute(false);
    fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleToggleMcp = React.useCallback(
    async (type: 'registry' | 'featureServer', enable: boolean) => {
      if (!selectedProject) {
        return;
      }

      setIsEnablingMcp(true);
      setSubmitError(undefined);

      try {
        const body: Record<string, unknown> = {
          namespace: selectedProject.namespace,
          crdName: selectedProject.crdName,
        };

        if (type === 'registry') {
          body.registryMcpEnabled = enable;
        } else {
          body.featureServerMcp = {
            enabled: enable,
            transport: fsMcpTransport,
            serverName: fsMcpServerName,
            serverVersion: fsMcpServerVersion,
          };
        }

        const res = await fetch('/api/featurestores/mcp-enable', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errorData: { message?: string } = await res.json().catch(() => ({}));
          throw new Error(errorData.message || `Failed to enable MCP: ${res.statusText}`);
        }

        fetchProjects();
      } catch (e) {
        setSubmitError(e instanceof Error ? e : new Error('Failed to enable MCP'));
      } finally {
        setIsEnablingMcp(false);
      }
    },
    [selectedProject, fsMcpTransport, fsMcpServerName, fsMcpServerVersion, fetchProjects],
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

      const data: { routeUrl: string } = await res.json();
      setServiceUrl(data.routeUrl);
      setShowCreateRoute(false);
      fetchProjects();
    } catch (e) {
      setSubmitError(e instanceof Error ? e : new Error('Failed to create route'));
    } finally {
      setIsCreatingRoute(false);
    }
  }, [selectedProject, newRouteName, selectedService, newRoutePort, fetchProjects]);

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
          namespace: selectedProject.namespace,
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
                        description={`Namespace: ${project.namespace} | ${
                          project.registryReady ? 'Ready' : 'Not ready'
                        }`}
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

          {/* MCP Status section */}
          {selectedProject && (
            <FormGroup label="MCP status" fieldId="mcp-status">
              <Stack hasGutter>
                {/* Registry MCP */}
                <StackItem>
                  <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapSm' }}>
                    <FlexItem>Registry MCP:</FlexItem>
                    <FlexItem>
                      {selectedProject.mcpStatus.registryMcp.enabled ? (
                        <Flex
                          alignItems={{ default: 'alignItemsCenter' }}
                          gap={{ default: 'gapSm' }}
                        >
                          <FlexItem>
                            <Label
                              color="green"
                              icon={<CheckCircleIcon />}
                              data-testid="mcp-registry-enabled"
                            >
                              Enabled
                            </Label>
                          </FlexItem>
                          <FlexItem>
                            <Button
                              variant="link"
                              size="sm"
                              isDanger
                              onClick={() => handleToggleMcp('registry', false)}
                              isDisabled={isEnablingMcp}
                              isLoading={isEnablingMcp}
                              data-testid="mcp-registry-disable-button"
                            >
                              Disable
                            </Button>
                          </FlexItem>
                        </Flex>
                      ) : (
                        <Flex
                          alignItems={{ default: 'alignItemsCenter' }}
                          gap={{ default: 'gapSm' }}
                        >
                          <FlexItem>
                            <Label
                              color="red"
                              icon={<TimesCircleIcon />}
                              data-testid="mcp-registry-disabled"
                            >
                              Disabled
                            </Label>
                          </FlexItem>
                          <FlexItem>
                            <Button
                              variant="link"
                              size="sm"
                              onClick={() => handleToggleMcp('registry', true)}
                              isDisabled={isEnablingMcp}
                              isLoading={isEnablingMcp}
                              data-testid="mcp-registry-enable-button"
                            >
                              Enable
                            </Button>
                          </FlexItem>
                        </Flex>
                      )}
                    </FlexItem>
                  </Flex>
                </StackItem>

                {/* Feature Server MCP */}
                <StackItem>
                  <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapSm' }}>
                    <FlexItem>Feature Server MCP:</FlexItem>
                    <FlexItem>
                      {selectedProject.mcpStatus.featureServerMcp.enabled ? (
                        <Flex
                          alignItems={{ default: 'alignItemsCenter' }}
                          gap={{ default: 'gapSm' }}
                        >
                          <FlexItem>
                            <Label
                              color="green"
                              icon={<CheckCircleIcon />}
                              data-testid="mcp-fs-enabled"
                            >
                              Enabled (
                              {selectedProject.mcpStatus.featureServerMcp.transport || 'sse'})
                            </Label>
                          </FlexItem>
                          <FlexItem>
                            <Button
                              variant="link"
                              size="sm"
                              isDanger
                              onClick={() => handleToggleMcp('featureServer', false)}
                              isDisabled={isEnablingMcp}
                              isLoading={isEnablingMcp}
                              data-testid="mcp-fs-disable-button"
                            >
                              Disable
                            </Button>
                          </FlexItem>
                        </Flex>
                      ) : (
                        <Label color="red" icon={<TimesCircleIcon />} data-testid="mcp-fs-disabled">
                          Disabled
                        </Label>
                      )}
                    </FlexItem>
                  </Flex>

                  {/* Feature Server MCP enable form */}
                  {!selectedProject.mcpStatus.featureServerMcp.enabled && (
                    <Stack hasGutter className="pf-v6-u-mt-sm pf-v6-u-ml-lg">
                      <StackItem>
                        <FormGroup label="Transport" fieldId="mcp-fs-transport">
                          <Select
                            id="mcp-fs-transport"
                            isOpen={fsMcpTransportOpen}
                            selected={fsMcpTransport}
                            onSelect={(_e, value) => {
                              setFsMcpTransport(String(value));
                              setFsMcpTransportOpen(false);
                            }}
                            onOpenChange={setFsMcpTransportOpen}
                            toggle={(toggleRef) => (
                              <MenuToggle
                                ref={toggleRef}
                                onClick={() => setFsMcpTransportOpen(!fsMcpTransportOpen)}
                                isExpanded={fsMcpTransportOpen}
                                data-testid="mcp-fs-transport-toggle"
                              >
                                {fsMcpTransport}
                              </MenuToggle>
                            )}
                          >
                            <SelectList>
                              <SelectOption value="sse">sse</SelectOption>
                              <SelectOption value="http">http</SelectOption>
                            </SelectList>
                          </Select>
                        </FormGroup>
                      </StackItem>
                      <StackItem>
                        <FormGroup label="Server name" fieldId="mcp-fs-server-name">
                          <TextInput
                            id="mcp-fs-server-name"
                            value={fsMcpServerName}
                            onChange={(_e, value) => setFsMcpServerName(value)}
                            data-testid="mcp-fs-server-name-input"
                          />
                        </FormGroup>
                      </StackItem>
                      <StackItem>
                        <FormGroup label="Server version" fieldId="mcp-fs-server-version">
                          <TextInput
                            id="mcp-fs-server-version"
                            value={fsMcpServerVersion}
                            onChange={(_e, value) => setFsMcpServerVersion(value)}
                            data-testid="mcp-fs-server-version-input"
                          />
                        </FormGroup>
                      </StackItem>
                      <StackItem>
                        <Button
                          variant="secondary"
                          onClick={() => handleToggleMcp('featureServer', true)}
                          isDisabled={isEnablingMcp}
                          isLoading={isEnablingMcp}
                          data-testid="mcp-fs-enable-button"
                        >
                          Enable Feature Server MCP
                        </Button>
                      </StackItem>
                    </Stack>
                  )}
                </StackItem>
              </Stack>
            </FormGroup>
          )}

          {/* Route selector */}
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
                    <SelectOption value="__create_new__" description="Create a new reencrypt route">
                      + Create new route
                    </SelectOption>
                  </SelectList>
                </Select>
              </FormGroup>

              {showCreateRoute && (
                <Stack hasGutter className="pf-v6-u-ml-lg pf-v6-u-mb-md">
                  <StackItem>
                    <FormGroup label="Route name" isRequired fieldId="mcp-register-new-route-name">
                      <TextInput
                        id="mcp-register-new-route-name"
                        value={newRouteName}
                        onChange={(_e, value) => setNewRouteName(value)}
                        placeholder="e.g. feast-mcp-online"
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
                              description={`Ports: ${svc.ports.map((p) => p.port).join(', ')}${
                                svc.isDefaultMcp ? ' (default MCP)' : ''
                              }`}
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
                    >
                      Create route
                    </Button>
                  </StackItem>
                </Stack>
              )}

              <FormGroup label="Service URL" isRequired fieldId="mcp-register-url">
                <TextInput
                  id="mcp-register-url"
                  value={serviceUrl}
                  onChange={(_e, value) => setServiceUrl(value)}
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
                  onChange={(_e, value) => setDisplayName(value)}
                  data-testid="mcp-register-name-input"
                />
              </FormGroup>

              <FormGroup label="Description" fieldId="mcp-register-description">
                <TextInput
                  id="mcp-register-description"
                  value={description}
                  onChange={(_e, value) => setDescription(value)}
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
