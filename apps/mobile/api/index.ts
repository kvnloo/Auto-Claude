/**
 * API module exports for the mobile companion app
 */

// Tailscale connection detection and monitoring
export {
  // Constants
  NETINFO_TIMEOUTS,
  HEALTH_CHECK_INTERVAL,
  MIN_HEALTH_CHECK_INTERVAL,
  // Types
  type HealthCheckResult,
  type TailscaleConnectionStatus,
  type ConnectionStateCallback,
  type NetInfoStateCallback,
  type ConfigureNetInfoOptions,
  type CheckConnectivityOptions,
  // Configuration
  configureNetInfo,
  isNetInfoSetUp,
  getReachabilityUrl,
  resetNetInfoConfiguration,
  // Connectivity checking
  getNetworkState,
  isTailscaleReachable,
  checkHealthEndpoint,
  checkTailscaleConnectivity,
  // Connection monitoring
  subscribeToNetworkChanges,
  createConnectionMonitor,
  // Error utilities
  createConnectionError,
  isTimeoutError,
  isServerError,
  isAuthError,
} from './tailscale';
