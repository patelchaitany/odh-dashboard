import React from 'react';
import { HookNotify, useResolvedExtensions } from '@odh-dashboard/plugin-core';
import { isMcpServerRegisterModalExtension } from '~/odh/extension-points';
import McpRegisterModal from '~/odh/components/McpRegisterModal';

type McpRegisterModalExtensionProps = {
  render: (
    buttonState: { enabled: boolean; loading?: boolean; tooltip?: string },
    onOpenModal: () => void,
    isModalAvailable: boolean,
  ) => React.ReactNode;
};

const McpRegisterModalExtension: React.FC<McpRegisterModalExtensionProps> = ({ render }) => {
  const [extensions, extensionsLoaded] = useResolvedExtensions(isMcpServerRegisterModalExtension);

  const [registerAvailable, setRegisterAvailable] = React.useState<{
    available: boolean;
    loaded: boolean;
  }>({ available: false, loaded: false });

  const [openModal, setOpenModal] = React.useState(false);

  const onOpenModal = React.useCallback(() => {
    setOpenModal(true);
  }, []);

  const isModalAvailable = React.useMemo(
    () => extensionsLoaded && extensions.length > 0,
    [extensionsLoaded, extensions],
  );

  const buttonState = React.useMemo(() => {
    if (!registerAvailable.loaded) {
      return { enabled: false, loading: true, tooltip: 'Checking Feast MCP availability...' };
    }
    if (!registerAvailable.available) {
      return {
        enabled: false,
        loading: false,
        tooltip: 'Feast MCP registration is not available on this cluster',
      };
    }
    return { enabled: true, loading: false };
  }, [registerAvailable]);

  return (
    <>
      {extensions.map((extension) => (
        <HookNotify
          key={extension.uid}
          useHook={extension.properties.useIsRegisterAvailable}
          onNotify={(value) => {
            if (value) {
              setRegisterAvailable(value);
            }
          }}
        />
      ))}
      {render(buttonState, onOpenModal, isModalAvailable)}
      {isModalAvailable && (
        <McpRegisterModal isOpen={openModal} onClose={() => setOpenModal(false)} />
      )}
    </>
  );
};

export default McpRegisterModalExtension;
