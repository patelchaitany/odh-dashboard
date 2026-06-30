import React from 'react';
import { Button, ButtonVariant, FlexItem } from '@patternfly/react-core';
import McpRegisterModal from '~/odh/components/McpRegisterModal';

const McpRegisterButton: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = React.useState(false);

  return (
    <FlexItem>
      <Button
        id="mcp-register-button"
        aria-label="Register MCP server"
        variant={ButtonVariant.primary}
        onClick={() => setIsModalOpen(true)}
        data-testid="mcp-register-button"
      >
        Register MCP server
      </Button>
      <McpRegisterModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </FlexItem>
  );
};

export default McpRegisterButton;
