import { useEffect, useMemo, type ReactElement } from 'react';
import { EmbeddedPanelConnection, type EmbeddedPanelConnectionOptions } from './messaging/embedded-bridge';
import { KoshkoRepository } from './state/repository';
import { PanelApp } from './ui/panel-app';
import './ui/ui.css';

export { startCapture, type CaptureDelivery } from './capture';
export { startConsoleCapture } from './console-capture';
export { EmbeddedPanelConnection } from './messaging/embedded-bridge';
export type {
  EmbeddedBridgeMessage,
  EmbeddedBridgeEventTarget,
  EmbeddedBridgeParentWindow,
  EmbeddedPanelConnectionOptions,
} from './messaging/embedded-bridge';

export interface EmbeddedInspectorAppProps {
  parentOrigin: string;
  connectionOptions?: Omit<EmbeddedPanelConnectionOptions, 'parentOrigin'>;
}

/**
 * Supported demo integration boundary. It intentionally has no Chrome APIs
 * and owns the repository/connection lifecycle for an inspector iframe.
 */
export function EmbeddedInspectorApp({
  parentOrigin,
  connectionOptions,
}: EmbeddedInspectorAppProps): ReactElement {
  const repository = useMemo(() => new KoshkoRepository(), []);
  const connection = useMemo(() => new EmbeddedPanelConnection({
    parentOrigin,
    parentWindow: connectionOptions?.parentWindow ?? window.parent,
    eventTarget: connectionOptions?.eventTarget,
    createSessionId: connectionOptions?.createSessionId,
    resetTimeoutMs: connectionOptions?.resetTimeoutMs,
  }), [connectionOptions, parentOrigin]);

  useEffect(() => () => connection.dispose(), [connection]);

  return (
    <PanelApp
      repository={repository}
      connection={connection}
      environment={{ kind: 'embedded' }}
      downloadJsonl={downloadJsonl}
      copyText={(text) => navigator.clipboard.writeText(text)}
    />
  );
}

function downloadJsonl(jsonl: string): void {
  const blob = new Blob([jsonl], { type: 'application/jsonl' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'koshko.jsonl';
  link.click();
  URL.revokeObjectURL(url);
}
