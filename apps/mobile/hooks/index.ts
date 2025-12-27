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

// API client for authenticated REST requests
export {
  // Main hook
  useApiClient,
  // Convenience hooks
  useApiClientReady,
  // TanStack Query integration helpers
  createQueryFn,
  createMutationFn,
  // Error class
  NotConnectedError,
  // Re-exported type guards
  isApiError,
  isApiSuccess,
  // Types
  type UseApiClientOptions,
  type UseApiClientResult,
  type ApiResult,
  type ApiError,
  type ApiResponse,
} from './useApiClient';
