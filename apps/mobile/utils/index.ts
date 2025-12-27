/**
 * Utility functions for the mobile companion app
 */

// Validation utilities
export {
  // Types
  type IpValidationResult,
  type ParsedIpAddress,
  // IP validation functions
  isValidIpv4Format,
  parseIpv4Address,
  // CGNAT range validation
  isInCgnatRange,
  matchesTailscalePattern,
  // Tailscale IP validation
  validateTailscaleIp,
  isValidTailscaleIp,
  // Port validation
  isValidPort,
  DEFAULT_API_PORT,
  // URL construction
  constructApiUrl,
  constructHealthCheckUrl,
} from './validation';
