/**
 * Unit tests for Backend Discovery Module
 *
 * Tests port file management, health check verification, and stale file cleanup
 * for multi-instance backend discovery.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import path from 'path';

// Test directories
const TEST_DIR = '/tmp/backend-discovery-test';
const USER_DATA_PATH = path.join(TEST_DIR, 'userData');
const PORT_FILE_PATH = path.join(USER_DATA_PATH, 'backend.port');

// Mock Electron before importing the module
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return USER_DATA_PATH;
      return TEST_DIR;
    }),
  },
}));

// Mock fetch for health check tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Setup test directories
function setupTestDirs(): void {
  mkdirSync(USER_DATA_PATH, { recursive: true });
}

// Cleanup test directories
function cleanupTestDirs(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe('Backend Discovery', () => {
  beforeEach(async () => {
    cleanupTestDirs();
    setupTestDirs();
    vi.resetModules();
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanupTestDirs();
    vi.clearAllMocks();
  });

  describe('writePortFile', () => {
    it('should create port file with correct content', async () => {
      const { writePortFile } = await import('../api/backend-discovery');

      const result = writePortFile(3001);

      expect(result).toBe(true);
      expect(existsSync(PORT_FILE_PATH)).toBe(true);
      expect(readFileSync(PORT_FILE_PATH, 'utf-8')).toBe('3001');
    });

    it('should overwrite existing port file', async () => {
      const { writePortFile } = await import('../api/backend-discovery');

      // Write initial file
      writePortFile(3001);
      expect(readFileSync(PORT_FILE_PATH, 'utf-8')).toBe('3001');

      // Overwrite with new port
      const result = writePortFile(4000);

      expect(result).toBe(true);
      expect(readFileSync(PORT_FILE_PATH, 'utf-8')).toBe('4000');
    });

    it('should create userData directory if it does not exist', async () => {
      // Remove the directory
      rmSync(USER_DATA_PATH, { recursive: true, force: true });
      expect(existsSync(USER_DATA_PATH)).toBe(false);

      const { writePortFile } = await import('../api/backend-discovery');

      const result = writePortFile(3001);

      expect(result).toBe(true);
      expect(existsSync(USER_DATA_PATH)).toBe(true);
      expect(existsSync(PORT_FILE_PATH)).toBe(true);
    });
  });

  describe('cleanupPortFile', () => {
    it('should remove existing port file', async () => {
      const { writePortFile, cleanupPortFile } = await import('../api/backend-discovery');

      // Create port file
      writePortFile(3001);
      expect(existsSync(PORT_FILE_PATH)).toBe(true);

      // Clean up
      const result = cleanupPortFile();

      expect(result).toBe(true);
      expect(existsSync(PORT_FILE_PATH)).toBe(false);
    });

    it('should return true if port file does not exist', async () => {
      const { cleanupPortFile } = await import('../api/backend-discovery');

      expect(existsSync(PORT_FILE_PATH)).toBe(false);

      const result = cleanupPortFile();

      expect(result).toBe(true);
    });
  });

  describe('hasPortFile', () => {
    it('should return true if port file exists', async () => {
      const { writePortFile, hasPortFile } = await import('../api/backend-discovery');

      writePortFile(3001);

      expect(hasPortFile()).toBe(true);
    });

    it('should return false if port file does not exist', async () => {
      const { hasPortFile } = await import('../api/backend-discovery');

      expect(hasPortFile()).toBe(false);
    });
  });

  describe('getStoredPort', () => {
    it('should return port number from valid port file', async () => {
      const { writePortFile, getStoredPort } = await import('../api/backend-discovery');

      writePortFile(3001);

      const port = getStoredPort();

      expect(port).toBe(3001);
    });

    it('should return null if port file does not exist', async () => {
      const { getStoredPort } = await import('../api/backend-discovery');

      const port = getStoredPort();

      expect(port).toBeNull();
    });

    it('should return null for invalid port content (NaN)', async () => {
      const { getStoredPort } = await import('../api/backend-discovery');

      writeFileSync(PORT_FILE_PATH, 'not-a-number', 'utf-8');

      const port = getStoredPort();

      expect(port).toBeNull();
    });

    it('should return null for port below valid range', async () => {
      const { getStoredPort } = await import('../api/backend-discovery');

      writeFileSync(PORT_FILE_PATH, '0', 'utf-8');

      const port = getStoredPort();

      expect(port).toBeNull();
    });

    it('should return null for port above valid range', async () => {
      const { getStoredPort } = await import('../api/backend-discovery');

      writeFileSync(PORT_FILE_PATH, '70000', 'utf-8');

      const port = getStoredPort();

      expect(port).toBeNull();
    });

    it('should handle port with whitespace', async () => {
      const { getStoredPort } = await import('../api/backend-discovery');

      writeFileSync(PORT_FILE_PATH, '  3001  \n', 'utf-8');

      const port = getStoredPort();

      expect(port).toBe(3001);
    });
  });

  describe('getPortFileLocation', () => {
    it('should return correct path to port file', async () => {
      const { getPortFileLocation } = await import('../api/backend-discovery');

      const location = getPortFileLocation();

      expect(location).toBe(PORT_FILE_PATH);
    });
  });

  describe('discoverExistingBackend', () => {
    it('should return null if port file does not exist', async () => {
      const { discoverExistingBackend } = await import('../api/backend-discovery');

      const result = await discoverExistingBackend();

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return backend info if health check succeeds', async () => {
      const { writePortFile, discoverExistingBackend } = await import('../api/backend-discovery');

      // Write port file
      writePortFile(3001);

      // Mock successful health check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'healthy' }),
      });

      const result = await discoverExistingBackend();

      expect(result).not.toBeNull();
      expect(result?.port).toBe(3001);
      expect(result?.address).toBe('http://localhost:3001');
      expect(result?.wsAddress).toBe('ws://localhost:3001/ws');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/health',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should return null and clean up if health check fails', async () => {
      const { writePortFile, discoverExistingBackend } = await import('../api/backend-discovery');

      // Write port file
      writePortFile(3001);
      expect(existsSync(PORT_FILE_PATH)).toBe(true);

      // Mock failed health check (network error)
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await discoverExistingBackend();

      expect(result).toBeNull();
      // Should clean up stale port file
      expect(existsSync(PORT_FILE_PATH)).toBe(false);
    });

    it('should return null and clean up if health check returns non-OK status', async () => {
      const { writePortFile, discoverExistingBackend } = await import('../api/backend-discovery');

      // Write port file
      writePortFile(3001);

      // Mock health check with error status
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      const result = await discoverExistingBackend();

      expect(result).toBeNull();
      expect(existsSync(PORT_FILE_PATH)).toBe(false);
    });

    it('should clean up invalid port file content', async () => {
      const { discoverExistingBackend } = await import('../api/backend-discovery');

      // Write invalid port
      writeFileSync(PORT_FILE_PATH, 'invalid-port', 'utf-8');

      const result = await discoverExistingBackend();

      expect(result).toBeNull();
      expect(existsSync(PORT_FILE_PATH)).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should clean up port file with out-of-range port', async () => {
      const { discoverExistingBackend } = await import('../api/backend-discovery');

      // Write out-of-range port
      writeFileSync(PORT_FILE_PATH, '99999', 'utf-8');

      const result = await discoverExistingBackend();

      expect(result).toBeNull();
      expect(existsSync(PORT_FILE_PATH)).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle health check timeout', async () => {
      const { writePortFile, discoverExistingBackend } = await import('../api/backend-discovery');

      // Write port file
      writePortFile(3001);

      // Mock timeout via AbortError
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const result = await discoverExistingBackend();

      expect(result).toBeNull();
      expect(existsSync(PORT_FILE_PATH)).toBe(false);
    });

    it('should handle health check with empty JSON response', async () => {
      const { writePortFile, discoverExistingBackend } = await import('../api/backend-discovery');

      // Write port file
      writePortFile(3001);

      // Mock health check with OK but no status in response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const result = await discoverExistingBackend();

      expect(result).not.toBeNull();
      expect(result?.port).toBe(3001);
    });

    it('should handle health check with invalid JSON response', async () => {
      const { writePortFile, discoverExistingBackend } = await import('../api/backend-discovery');

      // Write port file
      writePortFile(3001);

      // Mock health check with OK but JSON parse error
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      });

      const result = await discoverExistingBackend();

      // Should still be considered healthy if response was OK
      expect(result).not.toBeNull();
      expect(result?.port).toBe(3001);
    });
  });

  describe('stale file detection', () => {
    it('should detect and clean up stale port file when backend is not responding', async () => {
      const { discoverExistingBackend } = await import('../api/backend-discovery');

      // Create port file for a backend that's not running
      writeFileSync(PORT_FILE_PATH, '3001', 'utf-8');
      expect(existsSync(PORT_FILE_PATH)).toBe(true);

      // Mock connection refused (backend not running)
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const result = await discoverExistingBackend();

      expect(result).toBeNull();
      expect(existsSync(PORT_FILE_PATH)).toBe(false);
    });

    it('should detect stale port file when port is used by different process', async () => {
      const { discoverExistingBackend } = await import('../api/backend-discovery');

      // Create port file
      writeFileSync(PORT_FILE_PATH, '3001', 'utf-8');

      // Mock response from different service (not our health endpoint)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await discoverExistingBackend();

      expect(result).toBeNull();
      expect(existsSync(PORT_FILE_PATH)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty port file', async () => {
      const { getStoredPort, discoverExistingBackend } = await import(
        '../api/backend-discovery'
      );

      writeFileSync(PORT_FILE_PATH, '', 'utf-8');

      expect(getStoredPort()).toBeNull();

      const discoverResult = await discoverExistingBackend();
      expect(discoverResult).toBeNull();
    });

    it('should handle port file with only whitespace', async () => {
      const { getStoredPort, discoverExistingBackend } = await import(
        '../api/backend-discovery'
      );

      writeFileSync(PORT_FILE_PATH, '   \n\t  ', 'utf-8');

      expect(getStoredPort()).toBeNull();

      const discoverResult = await discoverExistingBackend();
      expect(discoverResult).toBeNull();
    });

    it('should handle negative port number', async () => {
      const { getStoredPort, discoverExistingBackend } = await import(
        '../api/backend-discovery'
      );

      writeFileSync(PORT_FILE_PATH, '-1', 'utf-8');

      expect(getStoredPort()).toBeNull();

      const discoverResult = await discoverExistingBackend();
      expect(discoverResult).toBeNull();
    });

    it('should handle float port number', async () => {
      const { getStoredPort } = await import('../api/backend-discovery');

      // parseInt will parse "3001.5" as 3001
      writeFileSync(PORT_FILE_PATH, '3001.5', 'utf-8');

      const port = getStoredPort();

      expect(port).toBe(3001);
    });

    it('should handle minimum valid port (1)', async () => {
      const { writePortFile, getStoredPort } = await import('../api/backend-discovery');

      writePortFile(1);

      expect(getStoredPort()).toBe(1);
    });

    it('should handle maximum valid port (65535)', async () => {
      const { writePortFile, getStoredPort } = await import('../api/backend-discovery');

      writePortFile(65535);

      expect(getStoredPort()).toBe(65535);
    });
  });
});
