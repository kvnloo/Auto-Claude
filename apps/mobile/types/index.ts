/**
 * Type exports for the mobile companion app
 */

// Settings types
export type {
  ConnectionState,
  ConnectionErrorType,
  ConnectionError,
  ConnectionSettings,
  AppSettings,
  SettingsState,
} from './settings';

export {
  DEFAULT_CONNECTION_SETTINGS,
  DEFAULT_APP_SETTINGS,
  DEFAULT_SETTINGS_STATE,
  TAILSCALE_CGNAT,
  TAILSCALE_IP_PATTERN,
} from './settings';

// API types
export type {
  // Health check types
  HealthStatus,
  HealthCheckResponse,
  // Version types
  VersionResponse,
  // Error types
  ApiErrorResponse,
  ApiResponseWrapper,
  // Status types
  ComponentStatus,
  ApiComponentStatus,
  ProjectStoreStatus,
  MemoryUsage,
  SystemStatusResponse,
  // Connection types
  ApiConnectionState,
  ConnectionStatus,
  // Request/Response types
  HttpMethod,
  ApiEndpoint,
  // Task types
  TaskStatus,
  SubtaskStatus,
  ExecutionPhase,
  TaskSummary,
  ListTasksResponse,
  ProjectSummary,
  ListProjectsResponse,
  // Pagination types
  PaginationParams,
  PaginatedResponse,
} from './api';

export {
  // Type guards
  isApiErrorResponse,
  isHealthy,
  isDegraded,
  isUnhealthy,
} from './api';
