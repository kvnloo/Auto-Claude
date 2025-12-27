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

// API types - Health & Monitoring
export type {
  HealthStatus,
  HealthCheckResponse,
  VersionResponse,
  SystemStatusResponse,
  ApiComponentStatus,
  ProjectStoreStatus,
  ComponentStatus,
  MemoryUsage,
} from './api';

// API types - Error Responses
export type {
  ApiErrorResponse,
  ApiResponseWrapper,
} from './api';

// API types - Connection
export type {
  ApiConnectionState,
  ConnectionStatus,
  HttpMethod,
  ApiEndpoint,
} from './api';

// API types - Task Enums & Status
export type {
  TaskStatus,
  TaskReviewReason,
  SubtaskStatus,
  ExecutionPhase,
  TaskCategory,
  TaskComplexity,
  TaskImpact,
  TaskPriority,
  TaskLocation,
} from './api';

// API types - Subtask & QA
export type {
  SubtaskVerification,
  Subtask,
  QAIssueSeverity,
  QAReportStatus,
  QAIssue,
  QAReport,
  ExecutionProgress,
  TaskMetadata,
} from './api';

// API types - Task & Project
export type {
  TaskSummary,
  Task,
  MemoryBackend,
  NotificationSettings,
  ProjectSettings,
  ProjectSummary,
  Project,
} from './api';

// API types - Task Request/Response
export type {
  CreateTaskRequest,
  CreateTaskResponse,
  ListTasksQuery,
  ListTasksResponse,
  GetTaskResponse,
  UpdateTaskRequest,
  TaskStartOptions,
  StartTaskRequest,
  SubmitReviewRequest,
  TaskActionResponse,
} from './api';

// API types - Project Request/Response
export type {
  AddProjectRequest,
  AddProjectResponse,
  GetProjectResponse,
  UpdateProjectSettingsRequest,
} from './api';

// API types - WebSocket
export type {
  WebSocketMessageType,
  WebSocketMessage,
  ImplementationPlanPhase,
  ImplementationPlan,
  TaskProgressPayload,
  TaskStatusChangePayload,
  TaskLogPayload,
  TaskErrorPayload,
  TaskExecutionProgressPayload,
  SubscribePayload,
  UnsubscribePayload,
  WebSocketErrorPayload,
} from './api';

// API types - Pagination
export type {
  PaginationParams,
  PaginatedResponse,
} from './api';

// API type guards
export {
  isApiErrorResponse,
  isHealthy,
  isDegraded,
  isUnhealthy,
} from './api';
