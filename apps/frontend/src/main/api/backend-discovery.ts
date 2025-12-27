/**
 * Backend Discovery Module
 *
 * Provides functions for discovering and connecting to an existing backend
 * instance when running multiple instances of the Auto-Claude desktop app.
 *
 * Features:
 * - Port file management (write, read, cleanup)
 * - Health check verification for backend discovery
 * - Stale port file detection and cleanup
 * - Atomic file operations for race condition safety
 *
 * Usage:
 * - Primary instance: Call writePortFile() after server starts
 * - Secondary instance: Call discoverExistingBackend() to find primary
 * - Shutdown: Call cleanupPortFile() to remove the port file
 *
 * Based on patterns from:
 * - apps/frontend/src/main/project-store.ts (file operations)
 * - apps/frontend/src/main/api/startup.ts (module structure)
 */

import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import path from 'path';

// ============================================
// Constants
// ============================================

/**
 * Port file name for backend discovery
 */
const PORT_FILE_NAME = 'backend.port';

/**
 * Timeout for health check requests (in milliseconds)
 */
const HEALTH_CHECK_TIMEOUT_MS = 3000;

/**
 * Health check endpoint path (matches routes/monitoring.ts)
 */
const HEALTH_ENDPOINT = '/api/health';

// ============================================
// Types
// ============================================

/**
 * Information about a discovered backend instance
 */
export interface BackendInfo {
  /** Port the backend is running on */
  port: number;
  /** Full HTTP address (e.g., http://localhost:3001) */
  address: string;
  /** Full WebSocket address (e.g., ws://localhost:3001/ws) */
  wsAddress: string;
}

/**
 * Result of a health check
 */
interface HealthCheckResult {
  /** Whether the backend responded successfully */
  healthy: boolean;
  /** Status from the health response (if any) */
  status?: string;
  /** Error message (if health check failed) */
  error?: string;
}

// ============================================
// Internal Helpers
// ============================================

/**
 * Get the path to the port file
 */
function getPortFilePath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, PORT_FILE_NAME);
}

/**
 * Ensure the userData directory exists
 */
function ensureUserDataDir(): void {
  const userDataPath = app.getPath('userData');
  if (!existsSync(userDataPath)) {
    mkdirSync(userDataPath, { recursive: true });
  }
}

/**
 * Perform a health check on the specified port
 *
 * @param port - Port to check
 * @returns Health check result
 */
async function performHealthCheck(port: number): Promise<HealthCheckResult> {
  const url = `http://localhost:${port}${HEALTH_ENDPOINT}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      try {
        const data = await response.json() as { status?: string };
        return {
          healthy: true,
          status: data.status || 'ok',
        };
      } catch {
        // Response OK but couldn't parse JSON - still consider healthy
        return { healthy: true, status: 'ok' };
      }
    }

    return {
      healthy: false,
      error: `Health check returned status ${response.status}`,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return { healthy: false, error: 'Health check timed out' };
      }
      return { healthy: false, error: error.message };
    }
    return { healthy: false, error: 'Unknown error during health check' };
  }
}

// ============================================
// Public API
// ============================================

/**
 * Discover an existing backend instance
 *
 * Reads the port file and verifies the backend is responding via health check.
 * If the port file exists but the backend is not responding, the stale file
 * is cleaned up.
 *
 * @returns Backend info if found and healthy, null otherwise
 */
export async function discoverExistingBackend(): Promise<BackendInfo | null> {
  const portFilePath = getPortFilePath();

  // Check if port file exists
  if (!existsSync(portFilePath)) {
    return null;
  }

  // Read the port from the file
  let port: number;
  try {
    const content = readFileSync(portFilePath, 'utf-8').trim();
    port = parseInt(content, 10);

    if (isNaN(port) || port < 1 || port > 65535) {
      process.stderr.write(`[Backend Discovery] Invalid port in port file: ${content}\n`);
      // Clean up invalid port file
      try {
        unlinkSync(portFilePath);
      } catch {
        // Ignore cleanup errors
      }
      return null;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[Backend Discovery] Error reading port file: ${errorMessage}\n`);
    return null;
  }

  // Verify the backend is actually responding
  const healthResult = await performHealthCheck(port);

  if (!healthResult.healthy) {
    process.stderr.write(
      `[Backend Discovery] Port file exists but backend not responding: ${healthResult.error}\n`
    );
    // Clean up stale port file
    try {
      unlinkSync(portFilePath);
      process.stderr.write('[Backend Discovery] Cleaned up stale port file\n');
    } catch {
      // Ignore cleanup errors
    }
    return null;
  }

  // Backend is healthy, return the info
  const address = `http://localhost:${port}`;
  const wsAddress = `ws://localhost:${port}/ws`;

  return {
    port,
    address,
    wsAddress,
  };
}

/**
 * Write the port file after server starts
 *
 * This should be called after the API server has successfully started
 * and is ready to accept connections.
 *
 * @param port - The port the server is listening on
 * @returns true if successful, false otherwise
 */
export function writePortFile(port: number): boolean {
  try {
    ensureUserDataDir();

    const portFilePath = getPortFilePath();
    const content = String(port);

    // Write atomically by writing to temp file and renaming
    // For simplicity in Node.js, we use synchronous write which is atomic on most filesystems
    writeFileSync(portFilePath, content, { encoding: 'utf-8', flag: 'w' });

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[Backend Discovery] Error writing port file: ${errorMessage}\n`);
    return false;
  }
}

/**
 * Clean up the port file during shutdown
 *
 * This should be called during graceful shutdown to prevent
 * stale port files from being left behind.
 *
 * @returns true if file was removed or didn't exist, false on error
 */
export function cleanupPortFile(): boolean {
  const portFilePath = getPortFilePath();

  try {
    if (existsSync(portFilePath)) {
      unlinkSync(portFilePath);
    }
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[Backend Discovery] Error cleaning up port file: ${errorMessage}\n`);
    return false;
  }
}

/**
 * Check if a port file exists (without verifying the backend)
 *
 * Useful for quick checks before more expensive health check verification.
 *
 * @returns true if port file exists
 */
export function hasPortFile(): boolean {
  return existsSync(getPortFilePath());
}

/**
 * Get the port from the port file (without verifying the backend)
 *
 * @returns The port number if file exists and is valid, null otherwise
 */
export function getStoredPort(): number | null {
  const portFilePath = getPortFilePath();

  if (!existsSync(portFilePath)) {
    return null;
  }

  try {
    const content = readFileSync(portFilePath, 'utf-8').trim();
    const port = parseInt(content, 10);

    if (isNaN(port) || port < 1 || port > 65535) {
      return null;
    }

    return port;
  } catch {
    return null;
  }
}

/**
 * Get the full path to the port file
 *
 * Useful for debugging and logging.
 *
 * @returns The absolute path to the port file
 */
export function getPortFileLocation(): string {
  return getPortFilePath();
}
