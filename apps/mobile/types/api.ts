/**
 * API Response Type Definitions for the Mobile Companion App
 *
 * These types define the contracts for REST API communication between
 * the mobile app and the AutoClaude REST API server.
 *
 * Types are synchronized with the frontend API types at:
 * @see apps/frontend/src/main/api/types/index.ts
 * @see apps/frontend/src/main/api/schemas/index.ts
 */

// ============================================
// Health Check Types
// ============================================

/**
 * Health status values returned by the API
 *
 * - healthy: Server is fully operational
 * - degraded: Server is operational but experiencing issues
 * - unhealthy: Server is not fully operational
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Health check response from GET /api/health
 *
 * This is a public endpoint (no authentication required).
 * Used for connectivity checks and monitoring.
 *
 * @see apps/frontend/src/main/api/routes/monitoring.ts
 */
export interface HealthCheckResponse {
  /**
   * Current health status of the server
   */
  status: HealthStatus;

  /**
   * ISO 8601 timestamp of the health check
   */
  timestamp: string;

  /**
   * Server uptime in seconds
   */
  uptime: number;

  /**
   * Application version string
   */
  version: string;
}

// ============================================
// Version Types
// ============================================

/**
 * Version response from GET /api/version
 *
 * This is a public endpoint (no authentication required).
 * Returns version information for the API and application.
 *
 * @see apps/frontend/src/main/api/routes/monitoring.ts
 */
export interface VersionResponse {
  /**
   * Application version (from package.json)
   */
  version: string;

  /**
   * REST API version (semantic versioning)
   */
  apiVersion: string;

  /**
   * Electron version (if running in Electron context)
   * Only present when the server is running within Electron
   */
  electronVersion?: string;
}

// ============================================
// Error Response Types
// ============================================

/**
 * Standard API error response returned by the server
 *
 * This structure is used for all HTTP error responses (4xx, 5xx).
 *
 * @see apps/frontend/src/main/api/types/index.ts - ApiErrorResponse
 */
export interface ApiErrorResponse {
  /**
   * Error type/name (e.g., 'Unauthorized', 'Not Found')
   */
  error: string;

  /**
   * Human-readable error message
   */
  message: string;

  /**
   * HTTP status code
   */
  statusCode: number;
}

/**
 * Generic API response wrapper used by some endpoints
 *
 * Provides consistent response structure with optional data/error.
 */
export interface ApiResponseWrapper<T = unknown> {
  /**
   * Whether the request was successful
   */
  success: boolean;

  /**
   * Response data (present on success)
   */
  data?: T;

  /**
   * Error message (present on failure)
   */
  error?: string;
}

// ============================================
// Status Response Types (Authenticated)
// ============================================

/**
 * Component health status
 */
export interface ComponentStatus {
  status: HealthStatus;
}

/**
 * API component status
 */
export interface ApiComponentStatus extends ComponentStatus {
  uptime: number;
}

/**
 * Project store component status
 */
export interface ProjectStoreStatus extends ComponentStatus {
  projectCount: number;
}

/**
 * Memory usage information
 */
export interface MemoryUsage {
  /**
   * Heap memory used in MB
   */
  heapUsed: number;

  /**
   * Total heap memory in MB
   */
  heapTotal: number;

  /**
   * Resident set size in MB
   */
  rss: number;
}

/**
 * Detailed system status response from GET /api/status
 *
 * This is a protected endpoint (requires authentication).
 * Returns comprehensive status including component health and resource usage.
 *
 * @see apps/frontend/src/main/api/routes/monitoring.ts
 */
export interface SystemStatusResponse {
  /**
   * Overall system health status
   */
  status: HealthStatus;

  /**
   * ISO 8601 timestamp
   */
  timestamp: string;

  /**
   * Server uptime in seconds
   */
  uptime: number;

  /**
   * Application version
   */
  version: string;

  /**
   * API version
   */
  apiVersion: string;

  /**
   * Individual component health statuses
   */
  components: {
    api: ApiComponentStatus;
    projectStore: ProjectStoreStatus;
  };

  /**
   * Memory usage information
   */
  memory: MemoryUsage;

  /**
   * Server start timestamp (ISO 8601)
   */
  startedAt: string | null;
}

// ============================================
// Connection State Types
// ============================================

/**
 * Connection state for the API client
 *
 * Represents the current state of the Tailscale/API connection.
 * Re-exported from settings.ts for convenience.
 *
 * @see ConnectionState in settings.ts
 */
export type ApiConnectionState =
  | 'disconnected'   // Not connected to API
  | 'connecting'     // Attempting to connect
  | 'connected'      // Successfully connected
  | 'error';         // Connection failed

/**
 * Detailed connection status for the mobile app
 *
 * Combines network state with API availability.
 */
export interface ConnectionStatus {
  /**
   * Current connection state
   */
  state: ApiConnectionState;

  /**
   * Whether Tailscale network is reachable
   */
  tailscaleReachable: boolean;

  /**
   * Whether the API health endpoint responds
   */
  apiHealthy: boolean;

  /**
   * Whether authentication is valid
   */
  authenticated: boolean;

  /**
   * Last successful connection timestamp (ISO 8601)
   */
  lastConnectedAt: string | null;

  /**
   * Error message if state is 'error'
   */
  errorMessage: string | null;
}

// ============================================
// Request/Response Utility Types
// ============================================

/**
 * HTTP methods supported by the API
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * API endpoint paths
 */
export type ApiEndpoint =
  | '/api/health'
  | '/api/version'
  | '/api/status'
  | '/api/tasks'
  | `/api/tasks/${string}`
  | `/api/tasks/${string}/start`
  | `/api/tasks/${string}/stop`
  | `/api/tasks/${string}/review`
  | '/api/projects'
  | `/api/projects/${string}`
  | `/api/projects/${string}/settings`;

// ============================================
// Task API Types (for future use)
// ============================================

/**
 * Task status enum values
 */
export type TaskStatus = 'backlog' | 'in_progress' | 'ai_review' | 'human_review' | 'done';

/**
 * Subtask status enum values
 */
export type SubtaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * Execution phase enum values
 */
export type ExecutionPhase = 'idle' | 'planning' | 'coding' | 'qa_review' | 'qa_fixing' | 'complete' | 'failed';

/**
 * Basic task representation for list views
 */
export interface TaskSummary {
  id: string;
  specId: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * List tasks response from GET /api/tasks
 */
export interface ListTasksResponse {
  tasks: TaskSummary[];
}

/**
 * Basic project representation
 */
export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * List projects response from GET /api/projects
 */
export interface ListProjectsResponse {
  projects: ProjectSummary[];
}

// ============================================
// Pagination Types
// ============================================

/**
 * Pagination query parameters
 */
export interface PaginationParams {
  /**
   * Page number (1-based)
   */
  page?: number;

  /**
   * Items per page (max 100)
   */
  limit?: number;

  /**
   * Offset for pagination
   */
  offset?: number;
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  /**
   * Array of items for current page
   */
  items: T[];

  /**
   * Total number of items across all pages
   */
  total: number;

  /**
   * Current page number
   */
  page: number;

  /**
   * Items per page
   */
  limit: number;

  /**
   * Whether there are more pages
   */
  hasMore: boolean;
}

// ============================================
// Type Guards
// ============================================

/**
 * Check if a response is an API error response
 *
 * @param response - Response object to check
 * @returns true if the response is an error response
 */
export function isApiErrorResponse(response: unknown): response is ApiErrorResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'error' in response &&
    'message' in response &&
    'statusCode' in response
  );
}

/**
 * Check if a health response indicates the server is healthy
 *
 * @param response - Health check response
 * @returns true if status is 'healthy'
 */
export function isHealthy(response: HealthCheckResponse): boolean {
  return response.status === 'healthy';
}

/**
 * Check if a health response indicates degraded state
 *
 * @param response - Health check response
 * @returns true if status is 'degraded'
 */
export function isDegraded(response: HealthCheckResponse): boolean {
  return response.status === 'degraded';
}

/**
 * Check if a health response indicates unhealthy state
 *
 * @param response - Health check response
 * @returns true if status is 'unhealthy'
 */
export function isUnhealthy(response: HealthCheckResponse): boolean {
  return response.status === 'unhealthy';
}
