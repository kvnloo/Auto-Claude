/**
 * Validation utilities for the mobile companion app
 *
 * Provides IP address validation with focus on Tailscale CGNAT range validation.
 * CGNAT (Carrier-Grade NAT) range 100.64.0.0/10 is used by Tailscale for mesh network addresses.
 */

import {
  TAILSCALE_CGNAT,
  TAILSCALE_IP_PATTERN,
} from '../types/settings';

// ============================================
// Types
// ============================================

/**
 * Result of IP address validation
 */
export interface IpValidationResult {
  valid: boolean;
  message: string;
  ip?: string;
}

/**
 * Parsed IP address components
 */
export interface ParsedIpAddress {
  octets: [number, number, number, number];
  raw: string;
}

// ============================================
// IP Format Validation
// ============================================

/**
 * Regular expression for validating basic IPv4 format
 * Matches: X.X.X.X where X is 0-255
 */
const IPV4_PATTERN =
  /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/;

/**
 * Check if a string is a valid IPv4 address format
 *
 * @param ip - String to validate
 * @returns true if valid IPv4 format
 *
 * @example
 * isValidIpv4Format('192.168.1.1') // true
 * isValidIpv4Format('256.1.1.1')   // false
 * isValidIpv4Format('not.an.ip')   // false
 */
export function isValidIpv4Format(ip: string | null | undefined): boolean {
  if (!ip || typeof ip !== 'string') {
    return false;
  }

  const trimmed = ip.trim();
  return IPV4_PATTERN.test(trimmed);
}

/**
 * Parse an IPv4 address string into its octets
 *
 * @param ip - IPv4 address string
 * @returns Parsed IP address or null if invalid
 *
 * @example
 * parseIpv4Address('100.64.1.1') // { octets: [100, 64, 1, 1], raw: '100.64.1.1' }
 * parseIpv4Address('invalid')    // null
 */
export function parseIpv4Address(ip: string | null | undefined): ParsedIpAddress | null {
  if (!isValidIpv4Format(ip)) {
    return null;
  }

  const trimmed = (ip as string).trim();
  const parts = trimmed.split('.').map(Number);

  if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) {
    return null;
  }

  return {
    octets: parts as [number, number, number, number],
    raw: trimmed,
  };
}

// ============================================
// CGNAT Range Validation
// ============================================

/**
 * Check if an IP address is in the Tailscale CGNAT range (100.64.0.0/10)
 *
 * The CGNAT range is 100.64.0.0 to 100.127.255.255:
 * - First octet: must be 100
 * - Second octet: must be 64-127 (binary: 01xxxxxx)
 * - Third and fourth octets: any value 0-255
 *
 * @param ip - IPv4 address string to check
 * @returns true if IP is in Tailscale CGNAT range
 *
 * @example
 * isInCgnatRange('100.64.0.1')    // true  - start of range
 * isInCgnatRange('100.127.255.1') // true  - end of range
 * isInCgnatRange('100.128.0.1')   // false - just outside range
 * isInCgnatRange('192.168.1.1')   // false - private IP
 */
export function isInCgnatRange(ip: string | null | undefined): boolean {
  const parsed = parseIpv4Address(ip);
  if (!parsed) {
    return false;
  }

  const [first, second] = parsed.octets;

  return (
    first === TAILSCALE_CGNAT.FIRST_OCTET &&
    second >= TAILSCALE_CGNAT.SECOND_OCTET_MIN &&
    second <= TAILSCALE_CGNAT.SECOND_OCTET_MAX
  );
}

/**
 * Check if an IP address matches the Tailscale IP pattern
 * Uses the regex pattern defined in settings types
 *
 * @param ip - IPv4 address string to check
 * @returns true if IP matches Tailscale pattern
 */
export function matchesTailscalePattern(ip: string | null | undefined): boolean {
  if (!ip || typeof ip !== 'string') {
    return false;
  }

  return TAILSCALE_IP_PATTERN.test(ip.trim());
}

// ============================================
// Tailscale IP Validation
// ============================================

/**
 * Validate a Tailscale IP address
 *
 * Performs comprehensive validation:
 * 1. Checks for null/empty input
 * 2. Validates IPv4 format
 * 3. Verifies IP is in CGNAT range (100.64.0.0/10)
 *
 * @param ip - IP address to validate
 * @returns Validation result with success status and message
 *
 * @example
 * validateTailscaleIp('100.64.1.1')   // { valid: true, message: 'Valid Tailscale IP address', ip: '100.64.1.1' }
 * validateTailscaleIp('')             // { valid: false, message: 'IP address is required' }
 * validateTailscaleIp('192.168.1.1')  // { valid: false, message: 'IP address must be in Tailscale CGNAT range...' }
 */
export function validateTailscaleIp(ip: string | null | undefined): IpValidationResult {
  // Check for empty input
  if (!ip || typeof ip !== 'string') {
    return {
      valid: false,
      message: 'IP address is required',
    };
  }

  const trimmed = ip.trim();

  if (trimmed.length === 0) {
    return {
      valid: false,
      message: 'IP address is required',
    };
  }

  // Validate IPv4 format
  if (!isValidIpv4Format(trimmed)) {
    return {
      valid: false,
      message: 'Invalid IP address format. Expected format: X.X.X.X',
    };
  }

  // Validate CGNAT range
  if (!isInCgnatRange(trimmed)) {
    return {
      valid: false,
      message: `IP address must be in Tailscale CGNAT range (${TAILSCALE_CGNAT.RANGE_DESCRIPTION})`,
    };
  }

  return {
    valid: true,
    message: 'Valid Tailscale IP address',
    ip: trimmed,
  };
}

/**
 * Validate a Tailscale IP address (simple boolean check)
 *
 * Convenience function that returns a simple boolean result.
 * Use validateTailscaleIp() when you need detailed error messages.
 *
 * @param ip - IP address to validate
 * @returns true if valid Tailscale IP address
 *
 * @example
 * isValidTailscaleIp('100.64.1.1')   // true
 * isValidTailscaleIp('192.168.1.1')  // false
 */
export function isValidTailscaleIp(ip: string | null | undefined): boolean {
  return validateTailscaleIp(ip).valid;
}

// ============================================
// Port Validation
// ============================================

/**
 * Validate a port number
 *
 * @param port - Port number to validate
 * @param options - Validation options
 * @param options.allowPrivileged - Allow ports below 1024 (default: false)
 * @returns true if valid port number
 *
 * @example
 * isValidPort(3001)                      // true
 * isValidPort(80)                        // false (privileged)
 * isValidPort(80, { allowPrivileged: true }) // true
 * isValidPort(70000)                     // false (out of range)
 */
export function isValidPort(
  port: number | null | undefined,
  options: { allowPrivileged?: boolean } = {}
): boolean {
  if (port === null || port === undefined || typeof port !== 'number') {
    return false;
  }

  if (!Number.isInteger(port)) {
    return false;
  }

  const minPort = options.allowPrivileged ? 1 : 1024;
  const maxPort = 65535;

  return port >= minPort && port <= maxPort;
}

/**
 * Default API port for AutoClaude REST API
 */
export const DEFAULT_API_PORT = 3001;

// ============================================
// URL Construction Helpers
// ============================================

/**
 * Construct a URL for the AutoClaude API
 *
 * @param ip - Tailscale IP address
 * @param port - API port (default: 3001)
 * @param path - Optional path (default: '')
 * @returns Constructed URL string or null if invalid inputs
 *
 * @example
 * constructApiUrl('100.64.1.1', 3001)           // 'http://100.64.1.1:3001'
 * constructApiUrl('100.64.1.1', 3001, '/api/health') // 'http://100.64.1.1:3001/api/health'
 */
export function constructApiUrl(
  ip: string | null | undefined,
  port: number = DEFAULT_API_PORT,
  path: string = ''
): string | null {
  if (!isValidTailscaleIp(ip)) {
    return null;
  }

  if (!isValidPort(port, { allowPrivileged: true })) {
    return null;
  }

  const trimmedIp = (ip as string).trim();
  const normalizedPath = path.startsWith('/') ? path : path ? `/${path}` : '';

  return `http://${trimmedIp}:${port}${normalizedPath}`;
}

/**
 * Construct the health check URL for connectivity testing
 *
 * @param ip - Tailscale IP address
 * @param port - API port (default: 3001)
 * @returns Health check URL or null if invalid inputs
 *
 * @example
 * constructHealthCheckUrl('100.64.1.1') // 'http://100.64.1.1:3001/api/health'
 */
export function constructHealthCheckUrl(
  ip: string | null | undefined,
  port: number = DEFAULT_API_PORT
): string | null {
  return constructApiUrl(ip, port, '/api/health');
}
