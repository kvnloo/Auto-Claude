import { useEffect, useState, useCallback } from 'react';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';

type BackendMode = 'primary' | 'secondary';
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

interface ConnectionStatusState {
  mode: BackendMode | null;
  connectionState: ConnectionState | null;
  isLoading: boolean;
}

/**
 * Connection status indicator showing whether this instance is primary (runs backend)
 * or secondary (connected/disconnected to primary backend).
 *
 * Displays:
 * - "Primary" for the first instance running the backend
 * - "Connected" for secondary instances connected to primary
 * - "Reconnecting..." for secondary instances attempting reconnection
 * - "Disconnected" for secondary instances that lost connection
 */
export function ConnectionStatus() {
  const [state, setState] = useState<ConnectionStatusState>({
    mode: null,
    connectionState: null,
    isLoading: true
  });

  const fetchStatus = useCallback(async () => {
    try {
      // Get backend mode (primary or secondary)
      const modeResult = await window.electronAPI.getBackendMode();
      const mode = modeResult.success && modeResult.data ? modeResult.data : null;

      // Only fetch connection status for secondary instances
      let connectionState: ConnectionState | null = null;
      if (mode === 'secondary') {
        const statusResult = await window.electronAPI.getConnectionStatus();
        if (statusResult.success && statusResult.data) {
          connectionState = statusResult.data.state;
        }
      }

      setState({
        mode,
        connectionState,
        isLoading: false
      });
    } catch {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    // Subscribe to connection state changes for secondary instances
    const cleanup = window.electronAPI.onConnectionStatusChange(
      (newState: ConnectionState) => {
        setState(prev => ({
          ...prev,
          connectionState: newState
        }));
      }
    );

    return cleanup;
  }, [fetchStatus]);

  if (state.isLoading) {
    return null;
  }

  // Primary instance - show primary badge
  if (state.mode === 'primary') {
    return (
      <ConnectionBadge
        variant="info"
        label="Primary"
        title="This instance is running the backend server"
      />
    );
  }

  // Secondary instance - show connection status
  if (state.mode === 'secondary') {
    switch (state.connectionState) {
      case 'connected':
        return (
          <ConnectionBadge
            variant="success"
            label="Connected"
            title="Connected to primary instance"
          />
        );
      case 'reconnecting':
        return (
          <ConnectionBadge
            variant="warning"
            label="Reconnecting..."
            title="Attempting to reconnect to primary instance"
            animate
          />
        );
      case 'connecting':
        return (
          <ConnectionBadge
            variant="warning"
            label="Connecting..."
            title="Connecting to primary instance"
            animate
          />
        );
      case 'disconnected':
      default:
        return (
          <ConnectionBadge
            variant="destructive"
            label="Disconnected"
            title="Disconnected from primary instance"
          />
        );
    }
  }

  // Unknown mode - don't show anything
  return null;
}

interface ConnectionBadgeProps {
  variant: 'success' | 'warning' | 'destructive' | 'info';
  label: string;
  title: string;
  animate?: boolean;
}

function ConnectionBadge({ variant, label, title, animate }: ConnectionBadgeProps) {
  return (
    <Badge
      variant={variant}
      className={cn(
        'text-[10px] py-0.5 px-1.5 gap-1',
        animate && 'animate-pulse'
      )}
      title={title}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          variant === 'success' && 'bg-success',
          variant === 'warning' && 'bg-warning',
          variant === 'destructive' && 'bg-destructive',
          variant === 'info' && 'bg-info'
        )}
      />
      {label}
    </Badge>
  );
}

export default ConnectionStatus;
