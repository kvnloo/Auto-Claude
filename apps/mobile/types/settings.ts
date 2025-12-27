/**
 * Settings type definitions for the mobile companion app
 *
 * These types define the configuration options for connecting
 * to the AutoClaude REST API via Tailscale network.
 */

// ============================================
// Connection Settings Types
// ============================================

/**
 * Connection state for Tailscale network connectivity
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

/**
 * Connection settings for the Tailscale-secured API connection
 *
 * @property tailscaleIp - Server's Tailscale IP address in CGNAT range (100.64.0.0/10)
 * @property apiPort - REST API server port (default: 3001)
 * @property isConfigured - Whether the connection has been configured
 */
export interface ConnectionSettings {
  /**
   * Tailscale IP address of the server
   * Must be in CGNAT range: 100.64.0.0 to 100.127.255.255
   * Format: 100.x.x.x where first octet after 100 is 64-127
   */
  tailscaleIp: string | null;

  /**
   * REST API server port
   * @default 3001
   */
  apiPort: number;

  /**
   * Whether the connection settings have been configured
   * True when a valid Tailscale IP has been entered
   */
  isConfigured: boolean;
}

/**
 * Default connection settings
 */
export const DEFAULT_CONNECTION_SETTINGS: ConnectionSettings = {
  tailscaleIp: null,
  apiPort: 3001,
  isConfigured: false,
};

// ============================================
// App Settings Types
// ============================================

/**
 * Application-wide settings
 *
 * @property connection - Tailscale connection configuration
 */
export interface AppSettings {
  connection: ConnectionSettings;
}

/**
 * Default application settings
 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  connection: DEFAULT_CONNECTION_SETTINGS,
};

// ============================================
// CGNAT Range Constants
// ============================================

/**
 * Tailscale CGNAT (Carrier-Grade NAT) IP range
 * RFC 6598 defines 100.64.0.0/10 as shared address space
 * Tailscale uses this range for its mesh network addresses
 */
export const TAILSCALE_CGNAT = {
  /**
   * First octet for all Tailscale IPs
   */
  FIRST_OCTET: 100,

  /**
   * Minimum value for second octet (64 = 0100 0000 in binary)
   */
  SECOND_OCTET_MIN: 64,

  /**
   * Maximum value for second octet (127 = 0111 1111 in binary)
   */
  SECOND_OCTET_MAX: 127,

  /**
   * CIDR notation for the range
   */
  CIDR: '100.64.0.0/10',

  /**
   * Human-readable range description
   */
  RANGE_DESCRIPTION: '100.64.0.0 - 100.127.255.255',
} as const;

/**
 * Regular expression pattern for validating Tailscale IP format
 * Matches: 100.X.Y.Z where X is 64-127, Y and Z are 0-255
 */
export const TAILSCALE_IP_PATTERN =
  /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/;
