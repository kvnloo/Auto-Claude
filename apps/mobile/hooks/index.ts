/**
 * Hooks module exports for the mobile companion app
 */

// Tailscale connection management
export {
  // Main hook
  useTailscaleConnection,
  // Convenience hooks
  useTailscaleConnected,
  useTailscaleState,
  useTailscaleError,
  // Types
  type UseTailscaleConnectionOptions,
  type UseTailscaleConnectionResult,
} from './useTailscaleConnection';
