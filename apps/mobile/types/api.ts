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
// Task Status & Enum Types
// ============================================

/**
 * Task status enum values
 */
export type TaskStatus = 'backlog' | 'in_progress' | 'ai_review' | 'human_review' | 'done';

/**
 * Task review reason
 */
export type TaskReviewReason = 'completed' | 'errors' | 'qa_rejected' | 'plan_review';

/**
 * Subtask status enum values
 */
export type SubtaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * Execution phase enum values
 */
export type ExecutionPhase = 'idle' | 'planning' | 'coding' | 'qa_review' | 'qa_fixing' | 'complete' | 'failed';

/**
 * Task category values
 */
export type TaskCategory =
  | 'feature'
  | 'bug_fix'
  | 'refactoring'
  | 'documentation'
  | 'security'
  | 'performance'
  | 'ui_ux'
  | 'infrastructure'
  | 'testing';

/**
 * Task complexity values
 */
export type TaskComplexity = 'trivial' | 'small' | 'medium' | 'large' | 'complex';

/**
 * Task impact values
 */
export type TaskImpact = 'low' | 'medium' | 'high' | 'critical';

/**
 * Task priority values
 */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * Task location in repository
 */
export type TaskLocation = 'main' | 'worktree';

// ============================================
// Subtask Types
// ============================================

/**
 * Subtask verification definition
 */
export interface SubtaskVerification {
  type?: 'command' | 'browser';
  run?: string;
  scenario?: string;
}

/**
 * Full subtask definition
 */
export interface Subtask {
  id: string;
  title: string;
  description: string;
  status: SubtaskStatus;
  files: string[];
  verification?: SubtaskVerification;
}

// ============================================
// QA Types
// ============================================

/**
 * QA issue severity
 */
export type QAIssueSeverity = 'critical' | 'major' | 'minor';

/**
 * QA report status
 */
export type QAReportStatus = 'passed' | 'failed' | 'pending';

/**
 * QA issue definition
 */
export interface QAIssue {
  id: string;
  severity: QAIssueSeverity;
  description: string;
  file?: string;
  line?: number;
}

/**
 * QA report definition
 */
export interface QAReport {
  status: QAReportStatus;
  issues: QAIssue[];
  timestamp: string;
}

// ============================================
// Execution Progress Types
// ============================================

/**
 * Execution progress information
 */
export interface ExecutionProgress {
  phase: ExecutionPhase;
  phaseProgress: number;
  overallProgress: number;
  currentSubtask?: string;
  message?: string;
  startedAt?: string;
}

// ============================================
// Task Metadata Types
// ============================================

/**
 * Task metadata with all optional fields
 */
export interface TaskMetadata {
  sourceType?: 'ideation' | 'manual' | 'imported' | 'insights' | 'roadmap' | 'linear' | 'github';
  ideationType?: string;
  ideaId?: string;
  featureId?: string;
  linearIssueId?: string;
  linearIdentifier?: string;
  linearUrl?: string;
  githubIssueNumber?: number;
  githubIssueNumbers?: number[];
  githubUrl?: string;
  githubBatchTheme?: string;
  category?: TaskCategory;
  complexity?: TaskComplexity;
  impact?: TaskImpact;
  priority?: TaskPriority;
  rationale?: string;
  problemSolved?: string;
  targetAudience?: string;
  affectedFiles?: string[];
  dependencies?: string[];
  acceptanceCriteria?: string[];
  estimatedEffort?: TaskComplexity;
  securitySeverity?: 'low' | 'medium' | 'high' | 'critical';
  performanceCategory?: string;
  uiuxCategory?: string;
  codeQualitySeverity?: 'suggestion' | 'minor' | 'major' | 'critical';
  requireReviewBeforeCoding?: boolean;
  model?: 'haiku' | 'sonnet' | 'opus';
  thinkingLevel?: 'none' | 'low' | 'medium' | 'high' | 'ultrathink';
  isAutoProfile?: boolean;
  baseBranch?: string;
  archivedAt?: string;
  archivedInVersion?: string;
}

// ============================================
// Full Task Type
// ============================================

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
 * Full task object from the API
 * GET /api/tasks/:id
 */
export interface Task extends TaskSummary {
  description: string;
  reviewReason?: TaskReviewReason;
  subtasks: Subtask[];
  qaReport?: QAReport;
  logs: string[];
  metadata?: TaskMetadata;
  executionProgress?: ExecutionProgress;
  releasedInVersion?: string;
  stagedInMainProject?: boolean;
  stagedAt?: string;
  location?: TaskLocation;
  specsPath?: string;
}

// ============================================
// Project Types
// ============================================

/**
 * Memory backend type
 */
export type MemoryBackend = 'graphiti' | 'file';

/**
 * Notification settings
 */
export interface NotificationSettings {
  onTaskComplete: boolean;
  onTaskFailed: boolean;
  onReviewNeeded: boolean;
  sound: boolean;
}

/**
 * Project settings
 */
export interface ProjectSettings {
  model: string;
  memoryBackend: MemoryBackend;
  linearSync: boolean;
  linearTeamId?: string;
  notifications: NotificationSettings;
  graphitiMcpEnabled: boolean;
  graphitiMcpUrl?: string;
  mainBranch?: string;
}

/**
 * Basic project representation for list views
 */
export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Full project object from the API
 * GET /api/projects/:id
 */
export interface Project extends ProjectSummary {
  autoBuildPath: string;
  settings: ProjectSettings;
}

// ============================================
// Task API Request/Response Types
// ============================================

/**
 * Create task request body
 * POST /api/tasks
 */
export interface CreateTaskRequest {
  projectId: string;
  title: string;
  description: string;
  metadata?: TaskMetadata;
}

/**
 * Create task response
 */
export interface CreateTaskResponse {
  task: Task;
}

/**
 * List tasks query parameters
 * GET /api/tasks
 */
export interface ListTasksQuery {
  projectId: string;
  status?: TaskStatus;
}

/**
 * List tasks response from GET /api/tasks
 */
export interface ListTasksResponse {
  tasks: Task[];
}

/**
 * Get task response
 * GET /api/tasks/:id
 */
export interface GetTaskResponse {
  task: Task;
}

/**
 * Update task request body
 * PATCH /api/tasks/:id
 */
export interface UpdateTaskRequest {
  title?: string;
  description?: string;
}

/**
 * Task start options
 */
export interface TaskStartOptions {
  parallel?: boolean;
  workers?: number;
  model?: string;
  baseBranch?: string;
}

/**
 * Start task request body
 * POST /api/tasks/:id/start
 */
export interface StartTaskRequest {
  options?: TaskStartOptions;
}

/**
 * Submit review request body
 * POST /api/tasks/:id/review
 */
export interface SubmitReviewRequest {
  approved: boolean;
  feedback?: string;
}

/**
 * Task action response (start/stop/review)
 */
export interface TaskActionResponse {
  message: string;
  taskId?: string;
}

// ============================================
// Project API Request/Response Types
// ============================================

/**
 * Add project request body
 * POST /api/projects
 */
export interface AddProjectRequest {
  projectPath: string;
}

/**
 * Add project response
 */
export interface AddProjectResponse {
  project: Project;
}

/**
 * List projects response from GET /api/projects
 */
export interface ListProjectsResponse {
  projects: Project[];
}

/**
 * Get project response
 * GET /api/projects/:id
 */
export interface GetProjectResponse {
  project: Project;
}

/**
 * Update project settings request body
 * PATCH /api/projects/:id/settings
 */
export interface UpdateProjectSettingsRequest {
  settings: Partial<ProjectSettings>;
}

// ============================================
// WebSocket Message Types
// ============================================

/**
 * WebSocket message types for real-time events
 */
export type WebSocketMessageType =
  | 'task-progress'
  | 'task-status-change'
  | 'task-log'
  | 'task-error'
  | 'task-execution-progress'
  | 'subscribe'
  | 'unsubscribe'
  | 'ping'
  | 'pong'
  | 'error';

/**
 * Base WebSocket message structure
 */
export interface WebSocketMessage<T = unknown> {
  type: WebSocketMessageType;
  payload?: T;
  timestamp: string;
}

/**
 * Implementation plan phase
 */
export interface ImplementationPlanPhase {
  phase: number;
  name: string;
  type: string;
  subtasks: {
    id: string;
    description: string;
    status: SubtaskStatus;
    verification?: SubtaskVerification;
  }[];
  depends_on?: number[];
}

/**
 * Implementation plan from the task
 */
export interface ImplementationPlan {
  feature?: string;
  title?: string;
  workflow_type: string;
  services_involved?: string[];
  phases: ImplementationPlanPhase[];
  final_acceptance: string[];
  created_at: string;
  updated_at: string;
  spec_file: string;
  status?: TaskStatus;
  planStatus?: string;
  recoveryNote?: string;
  description?: string;
}

/**
 * Task progress WebSocket event payload
 */
export interface TaskProgressPayload {
  taskId: string;
  plan: ImplementationPlan;
}

/**
 * Task status change WebSocket event payload
 */
export interface TaskStatusChangePayload {
  taskId: string;
  status: TaskStatus;
  previousStatus?: TaskStatus;
}

/**
 * Task log WebSocket event payload
 */
export interface TaskLogPayload {
  taskId: string;
  log: string;
  timestamp: string;
}

/**
 * Task error WebSocket event payload
 */
export interface TaskErrorPayload {
  taskId: string;
  error: string;
  timestamp: string;
}

/**
 * Task execution progress WebSocket event payload
 */
export interface TaskExecutionProgressPayload {
  taskId: string;
  progress: ExecutionProgress;
}

/**
 * Subscribe message payload - client requests to subscribe to task events
 */
export interface SubscribePayload {
  taskIds?: string[];
  projectId?: string;
  events?: WebSocketMessageType[];
}

/**
 * Unsubscribe message payload - client requests to unsubscribe from events
 */
export interface UnsubscribePayload {
  taskIds?: string[];
  projectId?: string;
  events?: WebSocketMessageType[];
}

/**
 * WebSocket error payload
 */
export interface WebSocketErrorPayload {
  code: string;
  message: string;
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
