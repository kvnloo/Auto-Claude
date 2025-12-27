/**
 * Unit tests for Tailscale IP validation utilities
 *
 * Tests CGNAT range validation (100.64.0.0/10), IP format validation,
 * and various edge cases for the mobile companion app.
 */
import { describe, it, expect } from 'vitest';

import {
  isValidIpv4Format,
  parseIpv4Address,
  isInCgnatRange,
  matchesTailscalePattern,
  validateTailscaleIp,
  isValidTailscaleIp,
  isValidPort,
  constructApiUrl,
  constructHealthCheckUrl,
  DEFAULT_API_PORT,
} from '../utils/validation';

import { TAILSCALE_CGNAT, TAILSCALE_IP_PATTERN } from '../types/settings';

describe('Tailscale IP Validation', () => {
  describe('isValidIpv4Format', () => {
    describe('valid IPv4 addresses', () => {
      it('should accept standard IPv4 addresses', () => {
        expect(isValidIpv4Format('192.168.1.1')).toBe(true);
        expect(isValidIpv4Format('10.0.0.1')).toBe(true);
        expect(isValidIpv4Format('172.16.0.1')).toBe(true);
        expect(isValidIpv4Format('8.8.8.8')).toBe(true);
      });

      it('should accept Tailscale CGNAT range IPs', () => {
        expect(isValidIpv4Format('100.64.0.1')).toBe(true);
        expect(isValidIpv4Format('100.127.255.255')).toBe(true);
        expect(isValidIpv4Format('100.100.100.100')).toBe(true);
      });

      it('should accept boundary values for each octet', () => {
        expect(isValidIpv4Format('0.0.0.0')).toBe(true);
        expect(isValidIpv4Format('255.255.255.255')).toBe(true);
        expect(isValidIpv4Format('1.1.1.1')).toBe(true);
      });

      it('should handle addresses with leading/trailing whitespace', () => {
        expect(isValidIpv4Format('  192.168.1.1  ')).toBe(true);
        expect(isValidIpv4Format('\t10.0.0.1\n')).toBe(true);
      });
    });

    describe('invalid IPv4 addresses', () => {
      it('should reject octets greater than 255', () => {
        expect(isValidIpv4Format('256.1.1.1')).toBe(false);
        expect(isValidIpv4Format('1.256.1.1')).toBe(false);
        expect(isValidIpv4Format('1.1.256.1')).toBe(false);
        expect(isValidIpv4Format('1.1.1.256')).toBe(false);
        expect(isValidIpv4Format('999.999.999.999')).toBe(false);
      });

      it('should reject addresses with wrong number of octets', () => {
        expect(isValidIpv4Format('1.2.3')).toBe(false);
        expect(isValidIpv4Format('1.2.3.4.5')).toBe(false);
        expect(isValidIpv4Format('1.2')).toBe(false);
        expect(isValidIpv4Format('1')).toBe(false);
      });

      it('should reject addresses with non-numeric characters', () => {
        expect(isValidIpv4Format('a.b.c.d')).toBe(false);
        expect(isValidIpv4Format('192.168.1.x')).toBe(false);
        expect(isValidIpv4Format('192.168.1.1a')).toBe(false);
        expect(isValidIpv4Format('not.an.ip.address')).toBe(false);
      });

      it('should reject negative numbers', () => {
        expect(isValidIpv4Format('-1.0.0.0')).toBe(false);
        expect(isValidIpv4Format('1.-1.0.0')).toBe(false);
      });

      it('should reject empty strings and whitespace-only', () => {
        expect(isValidIpv4Format('')).toBe(false);
        expect(isValidIpv4Format('   ')).toBe(false);
        expect(isValidIpv4Format('\t\n')).toBe(false);
      });

      it('should reject null and undefined', () => {
        expect(isValidIpv4Format(null)).toBe(false);
        expect(isValidIpv4Format(undefined)).toBe(false);
      });

      it('should reject special formats', () => {
        expect(isValidIpv4Format('192.168.1.1/24')).toBe(false); // CIDR notation
        expect(isValidIpv4Format('192.168.1.1:8080')).toBe(false); // With port
        expect(isValidIpv4Format('http://192.168.1.1')).toBe(false); // With protocol
      });
    });
  });

  describe('parseIpv4Address', () => {
    it('should parse valid IPv4 addresses into octets', () => {
      const result = parseIpv4Address('100.64.1.1');
      expect(result).not.toBeNull();
      expect(result?.octets).toEqual([100, 64, 1, 1]);
      expect(result?.raw).toBe('100.64.1.1');
    });

    it('should parse boundary addresses', () => {
      const minResult = parseIpv4Address('0.0.0.0');
      expect(minResult?.octets).toEqual([0, 0, 0, 0]);

      const maxResult = parseIpv4Address('255.255.255.255');
      expect(maxResult?.octets).toEqual([255, 255, 255, 255]);
    });

    it('should trim whitespace before parsing', () => {
      const result = parseIpv4Address('  100.64.1.1  ');
      expect(result).not.toBeNull();
      expect(result?.raw).toBe('100.64.1.1');
    });

    it('should return null for invalid addresses', () => {
      expect(parseIpv4Address('')).toBeNull();
      expect(parseIpv4Address('invalid')).toBeNull();
      expect(parseIpv4Address('256.1.1.1')).toBeNull();
      expect(parseIpv4Address(null)).toBeNull();
      expect(parseIpv4Address(undefined)).toBeNull();
    });
  });

  describe('isInCgnatRange', () => {
    describe('valid CGNAT range addresses (100.64.0.0/10)', () => {
      it('should accept IPs at the start of CGNAT range', () => {
        expect(isInCgnatRange('100.64.0.0')).toBe(true);
        expect(isInCgnatRange('100.64.0.1')).toBe(true);
      });

      it('should accept IPs at the end of CGNAT range', () => {
        expect(isInCgnatRange('100.127.255.254')).toBe(true);
        expect(isInCgnatRange('100.127.255.255')).toBe(true);
      });

      it('should accept IPs in the middle of CGNAT range', () => {
        expect(isInCgnatRange('100.80.50.25')).toBe(true);
        expect(isInCgnatRange('100.100.100.100')).toBe(true);
        expect(isInCgnatRange('100.64.128.128')).toBe(true);
      });

      it('should accept all valid second octets (64-127)', () => {
        // Test boundary values
        expect(isInCgnatRange('100.64.0.1')).toBe(true);
        expect(isInCgnatRange('100.65.0.1')).toBe(true);
        expect(isInCgnatRange('100.126.0.1')).toBe(true);
        expect(isInCgnatRange('100.127.0.1')).toBe(true);

        // Test middle values
        expect(isInCgnatRange('100.90.0.1')).toBe(true);
        expect(isInCgnatRange('100.95.0.1')).toBe(true);
      });

      it('should accept all third and fourth octet values', () => {
        expect(isInCgnatRange('100.64.0.0')).toBe(true);
        expect(isInCgnatRange('100.64.255.255')).toBe(true);
        expect(isInCgnatRange('100.64.128.64')).toBe(true);
      });
    });

    describe('invalid CGNAT range addresses', () => {
      it('should reject IPs just below CGNAT range', () => {
        expect(isInCgnatRange('100.63.255.255')).toBe(false);
        expect(isInCgnatRange('100.63.0.0')).toBe(false);
      });

      it('should reject IPs just above CGNAT range', () => {
        expect(isInCgnatRange('100.128.0.0')).toBe(false);
        expect(isInCgnatRange('100.128.0.1')).toBe(false);
      });

      it('should reject other 100.x.x.x addresses outside CGNAT', () => {
        expect(isInCgnatRange('100.0.0.1')).toBe(false);
        expect(isInCgnatRange('100.50.0.1')).toBe(false);
        expect(isInCgnatRange('100.200.0.1')).toBe(false);
        expect(isInCgnatRange('100.255.255.255')).toBe(false);
      });

      it('should reject private network addresses', () => {
        expect(isInCgnatRange('192.168.1.1')).toBe(false);
        expect(isInCgnatRange('10.0.0.1')).toBe(false);
        expect(isInCgnatRange('172.16.0.1')).toBe(false);
      });

      it('should reject public internet addresses', () => {
        expect(isInCgnatRange('8.8.8.8')).toBe(false);
        expect(isInCgnatRange('1.1.1.1')).toBe(false);
        expect(isInCgnatRange('208.67.222.222')).toBe(false);
      });

      it('should reject loopback addresses', () => {
        expect(isInCgnatRange('127.0.0.1')).toBe(false);
        expect(isInCgnatRange('127.255.255.255')).toBe(false);
      });

      it('should reject link-local addresses', () => {
        expect(isInCgnatRange('169.254.0.1')).toBe(false);
        expect(isInCgnatRange('169.254.255.255')).toBe(false);
      });

      it('should reject invalid inputs', () => {
        expect(isInCgnatRange('')).toBe(false);
        expect(isInCgnatRange('invalid')).toBe(false);
        expect(isInCgnatRange(null)).toBe(false);
        expect(isInCgnatRange(undefined)).toBe(false);
      });
    });
  });

  describe('matchesTailscalePattern', () => {
    it('should match valid Tailscale IPs', () => {
      expect(matchesTailscalePattern('100.64.0.1')).toBe(true);
      expect(matchesTailscalePattern('100.127.255.255')).toBe(true);
      expect(matchesTailscalePattern('100.100.100.100')).toBe(true);
    });

    it('should reject non-Tailscale IPs', () => {
      expect(matchesTailscalePattern('192.168.1.1')).toBe(false);
      expect(matchesTailscalePattern('100.128.0.1')).toBe(false);
      expect(matchesTailscalePattern('100.63.255.255')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(matchesTailscalePattern('')).toBe(false);
      expect(matchesTailscalePattern(null)).toBe(false);
      expect(matchesTailscalePattern(undefined)).toBe(false);
    });

    it('should trim whitespace', () => {
      expect(matchesTailscalePattern('  100.64.0.1  ')).toBe(true);
    });
  });

  describe('validateTailscaleIp', () => {
    describe('valid Tailscale IPs', () => {
      it('should return valid result for Tailscale CGNAT IPs', () => {
        const result = validateTailscaleIp('100.64.1.1');
        expect(result.valid).toBe(true);
        expect(result.message).toBe('Valid Tailscale IP address');
        expect(result.ip).toBe('100.64.1.1');
      });

      it('should trim and validate whitespace-padded IPs', () => {
        const result = validateTailscaleIp('  100.100.100.100  ');
        expect(result.valid).toBe(true);
        expect(result.ip).toBe('100.100.100.100');
      });

      it('should validate boundary IPs', () => {
        expect(validateTailscaleIp('100.64.0.0').valid).toBe(true);
        expect(validateTailscaleIp('100.127.255.255').valid).toBe(true);
      });
    });

    describe('empty input handling', () => {
      it('should return error for null', () => {
        const result = validateTailscaleIp(null);
        expect(result.valid).toBe(false);
        expect(result.message).toBe('IP address is required');
        expect(result.ip).toBeUndefined();
      });

      it('should return error for undefined', () => {
        const result = validateTailscaleIp(undefined);
        expect(result.valid).toBe(false);
        expect(result.message).toBe('IP address is required');
      });

      it('should return error for empty string', () => {
        const result = validateTailscaleIp('');
        expect(result.valid).toBe(false);
        expect(result.message).toBe('IP address is required');
      });

      it('should return error for whitespace-only string', () => {
        const result = validateTailscaleIp('   ');
        expect(result.valid).toBe(false);
        expect(result.message).toBe('IP address is required');
      });
    });

    describe('invalid format handling', () => {
      it('should return error for non-IP strings', () => {
        const result = validateTailscaleIp('not-an-ip');
        expect(result.valid).toBe(false);
        expect(result.message).toBe('Invalid IP address format. Expected format: X.X.X.X');
      });

      it('should return error for partial IPs', () => {
        const result = validateTailscaleIp('100.64.0');
        expect(result.valid).toBe(false);
        expect(result.message).toContain('Invalid IP address format');
      });

      it('should return error for out-of-range octets', () => {
        const result = validateTailscaleIp('256.64.0.1');
        expect(result.valid).toBe(false);
        expect(result.message).toContain('Invalid IP address format');
      });
    });

    describe('out of CGNAT range handling', () => {
      it('should return error for valid IPs outside CGNAT range', () => {
        const result = validateTailscaleIp('192.168.1.1');
        expect(result.valid).toBe(false);
        expect(result.message).toContain('Tailscale CGNAT range');
        expect(result.message).toContain(TAILSCALE_CGNAT.RANGE_DESCRIPTION);
      });

      it('should return error for 100.x.x.x outside CGNAT', () => {
        const result = validateTailscaleIp('100.128.0.1');
        expect(result.valid).toBe(false);
        expect(result.message).toContain('Tailscale CGNAT range');
      });
    });
  });

  describe('isValidTailscaleIp', () => {
    it('should return true for valid Tailscale IPs', () => {
      expect(isValidTailscaleIp('100.64.0.1')).toBe(true);
      expect(isValidTailscaleIp('100.127.255.255')).toBe(true);
      expect(isValidTailscaleIp('100.100.100.100')).toBe(true);
    });

    it('should return false for invalid inputs', () => {
      expect(isValidTailscaleIp('')).toBe(false);
      expect(isValidTailscaleIp(null)).toBe(false);
      expect(isValidTailscaleIp(undefined)).toBe(false);
      expect(isValidTailscaleIp('192.168.1.1')).toBe(false);
      expect(isValidTailscaleIp('100.128.0.1')).toBe(false);
      expect(isValidTailscaleIp('invalid')).toBe(false);
    });
  });

  describe('TAILSCALE_CGNAT constants', () => {
    it('should have correct CGNAT range values', () => {
      expect(TAILSCALE_CGNAT.FIRST_OCTET).toBe(100);
      expect(TAILSCALE_CGNAT.SECOND_OCTET_MIN).toBe(64);
      expect(TAILSCALE_CGNAT.SECOND_OCTET_MAX).toBe(127);
      expect(TAILSCALE_CGNAT.CIDR).toBe('100.64.0.0/10');
    });

    it('should have human-readable range description', () => {
      expect(TAILSCALE_CGNAT.RANGE_DESCRIPTION).toBe('100.64.0.0 - 100.127.255.255');
    });
  });

  describe('TAILSCALE_IP_PATTERN regex', () => {
    it('should match valid Tailscale IPs', () => {
      expect(TAILSCALE_IP_PATTERN.test('100.64.0.0')).toBe(true);
      expect(TAILSCALE_IP_PATTERN.test('100.127.255.255')).toBe(true);
      expect(TAILSCALE_IP_PATTERN.test('100.100.100.100')).toBe(true);
    });

    it('should not match invalid IPs', () => {
      expect(TAILSCALE_IP_PATTERN.test('100.63.255.255')).toBe(false);
      expect(TAILSCALE_IP_PATTERN.test('100.128.0.0')).toBe(false);
      expect(TAILSCALE_IP_PATTERN.test('192.168.1.1')).toBe(false);
    });
  });
});

describe('Port Validation', () => {
  describe('isValidPort', () => {
    it('should accept valid non-privileged ports', () => {
      expect(isValidPort(3001)).toBe(true);
      expect(isValidPort(8080)).toBe(true);
      expect(isValidPort(1024)).toBe(true);
      expect(isValidPort(65535)).toBe(true);
    });

    it('should reject privileged ports by default', () => {
      expect(isValidPort(80)).toBe(false);
      expect(isValidPort(443)).toBe(false);
      expect(isValidPort(22)).toBe(false);
      expect(isValidPort(1)).toBe(false);
      expect(isValidPort(1023)).toBe(false);
    });

    it('should accept privileged ports when allowed', () => {
      expect(isValidPort(80, { allowPrivileged: true })).toBe(true);
      expect(isValidPort(443, { allowPrivileged: true })).toBe(true);
      expect(isValidPort(1, { allowPrivileged: true })).toBe(true);
    });

    it('should reject ports out of range', () => {
      expect(isValidPort(0)).toBe(false);
      expect(isValidPort(65536)).toBe(false);
      expect(isValidPort(70000)).toBe(false);
      expect(isValidPort(-1)).toBe(false);
    });

    it('should reject non-integer values', () => {
      expect(isValidPort(3001.5)).toBe(false);
      expect(isValidPort(NaN)).toBe(false);
      expect(isValidPort(Infinity)).toBe(false);
    });

    it('should reject null and undefined', () => {
      expect(isValidPort(null)).toBe(false);
      expect(isValidPort(undefined)).toBe(false);
    });
  });

  describe('DEFAULT_API_PORT', () => {
    it('should be 3001', () => {
      expect(DEFAULT_API_PORT).toBe(3001);
    });
  });
});

describe('URL Construction', () => {
  describe('constructApiUrl', () => {
    it('should construct valid API URLs', () => {
      const url = constructApiUrl('100.64.1.1', 3001);
      expect(url).toBe('http://100.64.1.1:3001');
    });

    it('should construct URLs with paths', () => {
      expect(constructApiUrl('100.64.1.1', 3001, '/api/tasks'))
        .toBe('http://100.64.1.1:3001/api/tasks');
    });

    it('should add leading slash to paths without one', () => {
      expect(constructApiUrl('100.64.1.1', 3001, 'api/tasks'))
        .toBe('http://100.64.1.1:3001/api/tasks');
    });

    it('should use default port when not specified', () => {
      expect(constructApiUrl('100.64.1.1'))
        .toBe('http://100.64.1.1:3001');
    });

    it('should return null for invalid Tailscale IPs', () => {
      expect(constructApiUrl('192.168.1.1', 3001)).toBeNull();
      expect(constructApiUrl('invalid', 3001)).toBeNull();
      expect(constructApiUrl('', 3001)).toBeNull();
      expect(constructApiUrl(null, 3001)).toBeNull();
    });

    it('should return null for invalid ports', () => {
      expect(constructApiUrl('100.64.1.1', 0)).toBeNull();
      expect(constructApiUrl('100.64.1.1', -1)).toBeNull();
      expect(constructApiUrl('100.64.1.1', 70000)).toBeNull();
    });

    it('should allow privileged ports', () => {
      expect(constructApiUrl('100.64.1.1', 80))
        .toBe('http://100.64.1.1:80');
      expect(constructApiUrl('100.64.1.1', 443))
        .toBe('http://100.64.1.1:443');
    });
  });

  describe('constructHealthCheckUrl', () => {
    it('should construct health check URL', () => {
      expect(constructHealthCheckUrl('100.64.1.1'))
        .toBe('http://100.64.1.1:3001/api/health');
    });

    it('should use custom port', () => {
      expect(constructHealthCheckUrl('100.64.1.1', 8080))
        .toBe('http://100.64.1.1:8080/api/health');
    });

    it('should return null for invalid IPs', () => {
      expect(constructHealthCheckUrl('192.168.1.1')).toBeNull();
      expect(constructHealthCheckUrl('')).toBeNull();
      expect(constructHealthCheckUrl(null)).toBeNull();
    });
  });
});

describe('Edge Cases and Security', () => {
  describe('leading zeros in octets', () => {
    // Note: JavaScript parseInt handles leading zeros, but regex should validate format
    it('should handle IPs with potential leading zeros', () => {
      // These should be treated as invalid due to ambiguity
      expect(isValidIpv4Format('100.064.000.001')).toBe(false);
      expect(isValidIpv4Format('100.64.01.1')).toBe(false);
    });
  });

  describe('special characters', () => {
    it('should reject IPs with special characters', () => {
      expect(isValidIpv4Format('100.64.0.1;')).toBe(false);
      expect(isValidIpv4Format('100.64.0.1\n')).toBe(true); // trailing newline is trimmed like spaces
      expect(isValidIpv4Format('100.64.0.1 ')).toBe(true); // trailing space is trimmed
    });
  });

  describe('unicode and internationalized inputs', () => {
    it('should reject unicode numbers', () => {
      // Full-width digits
      expect(isValidIpv4Format('\uFF11\uFF10\uFF10.64.0.1')).toBe(false);
    });
  });

  describe('very long inputs', () => {
    it('should handle very long strings gracefully', () => {
      const longString = '1'.repeat(1000);
      expect(isValidIpv4Format(longString)).toBe(false);
      expect(isValidTailscaleIp(longString)).toBe(false);
    });
  });

  describe('type coercion edge cases', () => {
    it('should handle non-string inputs safely', () => {
      // @ts-expect-error - testing runtime behavior with wrong types
      expect(isValidIpv4Format(100)).toBe(false);
      // @ts-expect-error - testing runtime behavior with wrong types
      expect(isValidIpv4Format({})).toBe(false);
      // @ts-expect-error - testing runtime behavior with wrong types
      expect(isValidIpv4Format([])).toBe(false);
      // @ts-expect-error - testing runtime behavior with wrong types
      expect(isValidIpv4Format(true)).toBe(false);
    });
  });
});
