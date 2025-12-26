/**
 * Reasoning data structures for Agent Reasoning & Progress Dashboard
 *
 * These types support real-time agent reasoning visualization, decision tree
 * rendering via React Flow, and progress tracking with ETA.
 */

// ============================================
// Decision Node Types (Decision Tree)
// ============================================

/**
 * Type of decision made by the agent
 */
export type DecisionType =
  | 'planning'      // High-level planning decisions
  | 'execution'     // Code execution decisions
  | 'analysis'      // Code/file analysis decisions
  | 'tool_call'     // Tool invocation decisions
  | 'reasoning'     // Reasoning/thinking steps
  | 'result'        // Final results/outputs
  | 'error';        // Error handling decisions

/**
 * Status of a decision node in the tree
 */
export type DecisionNodeStatus =
  | 'pending'       // Not yet processed
  | 'active'        // Currently being processed
  | 'completed'     // Successfully completed
  | 'failed';       // Failed with error

/**
 * A decision node in the agent's reasoning tree.
 * Compatible with React Flow node structure.
 */
export interface DecisionNode {
  /** Unique identifier for this decision node */
  id: string;
  /** Display label for the node (short description) */
  label: string;
  /** Type of decision */
  type: DecisionType;
  /** Current status of this decision */
  status: DecisionNodeStatus;
  /** When this decision was made (ISO string) */
  timestamp: string;
  /** Full reasoning text for this decision */
  reasoning: string;
  /** Context that led to this decision */
  context?: string;
  /** Alternatives that were considered */
  alternatives?: string[];
  /** ID of the parent decision node (for tree structure) */
  parentId?: string;
  /** IDs of child decision nodes */
  childIds: string[];
  /** Tool name if this is a tool_call decision */
  toolName?: string;
  /** Tool input if this is a tool_call decision */
  toolInput?: string;
  /** Result or output of this decision */
  result?: string;
  /** Error message if status is 'failed' */
  error?: string;
  /** Associated subtask ID if relevant */
  subtaskId?: string;
  /** Depth level in the tree (0 = root) */
  depth: number;
}

/**
 * React Flow compatible node data for decision nodes.
 * Used when rendering nodes in the decision tree visualization.
 */
export interface DecisionNodeData {
  /** Display label */
  label: string;
  /** Decision type for styling */
  type: DecisionType;
  /** Node status for highlighting */
  status: DecisionNodeStatus;
  /** Timestamp for display */
  timestamp: string;
  /** Truncated reasoning text */
  reasoningPreview: string;
  /** Full decision node reference */
  decision: DecisionNode;
}

/**
 * React Flow node position
 */
export interface NodePosition {
  x: number;
  y: number;
}

/**
 * React Flow compatible node for decision tree
 */
export interface ReactFlowDecisionNode {
  /** Unique node ID */
  id: string;
  /** Node type (for custom node rendering) */
  type: 'decision';
  /** Position in the canvas */
  position: NodePosition;
  /** Node data */
  data: DecisionNodeData;
  /** Whether node is selected */
  selected?: boolean;
}

// ============================================
// Reasoning Edge Types
// ============================================

/**
 * Type of edge connection
 */
export type EdgeType =
  | 'default'       // Normal parent-child connection
  | 'alternative'   // Connection to an alternative path
  | 'error';        // Error flow connection

/**
 * Edge connecting decision nodes in the tree.
 * Compatible with React Flow edge structure.
 */
export interface ReasoningEdge {
  /** Unique identifier for this edge */
  id: string;
  /** ID of the source (parent) node */
  source: string;
  /** ID of the target (child) node */
  target: string;
  /** Type of edge for styling */
  type: EdgeType;
  /** Whether this edge is animated (for active connections) */
  animated?: boolean;
  /** Edge label (optional) */
  label?: string;
}

// ============================================
// Progress Tracking Types
// ============================================

/**
 * Execution phase for progress tracking
 * Extends the existing ExecutionPhase from task.ts
 */
export type ReasoningPhase =
  | 'idle'
  | 'initializing'
  | 'planning'
  | 'coding'
  | 'qa_review'
  | 'qa_fixing'
  | 'complete'
  | 'failed';

/**
 * Progress data for agent reasoning execution.
 * Used for the progress tracker component with ETA.
 */
export interface ReasoningProgress {
  /** Current execution phase */
  phase: ReasoningPhase;
  /** Progress within current phase (0-100) */
  phaseProgress: number;
  /** Overall progress across all phases (0-100) */
  overallProgress: number;
  /** Estimated time remaining in milliseconds */
  etaMs?: number;
  /** Human-readable ETA string (e.g., "~3 min remaining") */
  etaFormatted?: string;
  /** Current phase display label */
  phaseLabel: string;
  /** When execution started (ISO string) */
  startedAt?: string;
  /** When current phase started (ISO string) */
  phaseStartedAt?: string;
  /** Number of completed phases */
  completedPhases: number;
  /** Total number of phases */
  totalPhases: number;
  /** Current subtask being processed */
  currentSubtask?: string;
  /** Status message for display */
  message?: string;
}

// ============================================
// Reasoning State Types (for Zustand store)
// ============================================

/**
 * Agent status for dashboard display
 */
export type AgentStatus =
  | 'idle'          // No agent running
  | 'running'       // Agent actively executing
  | 'paused'        // Agent paused (waiting for input)
  | 'stopped'       // Agent stopped (user action)
  | 'completed'     // Agent completed successfully
  | 'error';        // Agent encountered error

/**
 * Current reasoning text with metadata
 */
export interface CurrentReasoning {
  /** The current reasoning/thinking text */
  text: string;
  /** When this reasoning was received (ISO string) */
  timestamp: string;
  /** Whether the text is truncated */
  isTruncated: boolean;
  /** Full text if truncated */
  fullText?: string;
}

/**
 * Configuration for reasoning tree limits
 */
export interface ReasoningTreeConfig {
  /** Maximum number of nodes to display (default: 50) */
  maxNodes: number;
  /** Maximum tree depth to display (default: 10) */
  maxDepth: number;
  /** Whether to auto-collapse old branches */
  autoCollapse: boolean;
  /** Number of recent nodes to keep expanded */
  recentNodeCount: number;
}

/**
 * Statistics about the reasoning session
 */
export interface ReasoningStats {
  /** Total number of decisions made */
  totalDecisions: number;
  /** Number of successful decisions */
  successfulDecisions: number;
  /** Number of failed decisions */
  failedDecisions: number;
  /** Number of tool calls made */
  toolCalls: number;
  /** Time elapsed in milliseconds */
  elapsedMs: number;
  /** Average decision time in milliseconds */
  avgDecisionTimeMs: number;
}

/**
 * Complete reasoning state for the dashboard.
 * Used as the shape of the Zustand reasoning store.
 */
export interface ReasoningState {
  // === Core State ===

  /** All decision nodes in the tree */
  nodes: DecisionNode[];
  /** All edges connecting nodes */
  edges: ReasoningEdge[];
  /** Currently selected decision for inspection */
  selectedDecision: DecisionNode | null;
  /** Current live reasoning text */
  currentReasoning: CurrentReasoning | null;
  /** Progress tracking data */
  progress: ReasoningProgress;
  /** Current agent status */
  agentStatus: AgentStatus;
  /** Task ID being monitored */
  taskId: string | null;
  /** Session statistics */
  stats: ReasoningStats;

  // === UI State ===

  /** Whether inspector panel is open */
  isInspectorOpen: boolean;
  /** IDs of collapsed tree branches */
  collapsedBranches: Set<string>;
  /** Tree configuration */
  treeConfig: ReasoningTreeConfig;

  // === Error State ===

  /** Last error message if any */
  lastError: string | null;
  /** Whether the dashboard is in error state */
  hasError: boolean;
}

// ============================================
// Action Types (for store actions)
// ============================================

/**
 * Payload for adding a new decision node
 */
export interface AddNodePayload {
  id: string;
  label: string;
  type: DecisionType;
  reasoning: string;
  parentId?: string;
  context?: string;
  toolName?: string;
  toolInput?: string;
  subtaskId?: string;
}

/**
 * Payload for updating node status
 */
export interface UpdateNodeStatusPayload {
  nodeId: string;
  status: DecisionNodeStatus;
  result?: string;
  error?: string;
}

/**
 * Payload for updating progress
 */
export interface UpdateProgressPayload {
  phase: ReasoningPhase;
  phaseProgress: number;
  message?: string;
  currentSubtask?: string;
}

// ============================================
// IPC Event Types
// ============================================

/**
 * Reasoning event emitted through IPC
 */
export type ReasoningEventType =
  | 'reasoning_start'     // Agent started reasoning
  | 'reasoning_update'    // Reasoning text update
  | 'decision_made'       // A decision was made
  | 'decision_completed'  // A decision completed
  | 'decision_failed'     // A decision failed
  | 'progress_update'     // Progress changed
  | 'agent_stopped'       // Agent stopped/crashed
  | 'agent_completed';    // Agent completed execution

/**
 * IPC event payload for reasoning updates
 */
export interface ReasoningEvent {
  /** Type of event */
  type: ReasoningEventType;
  /** Task ID this event belongs to */
  taskId: string;
  /** Event timestamp (ISO string) */
  timestamp: string;
  /** Decision node data (for decision events) */
  decision?: Partial<DecisionNode>;
  /** Reasoning text (for reasoning_update) */
  reasoning?: string;
  /** Progress data (for progress_update) */
  progress?: Partial<ReasoningProgress>;
  /** Error message (for error events) */
  error?: string;
}

// ============================================
// Utility Types
// ============================================

/**
 * Default values for reasoning progress
 */
export const DEFAULT_REASONING_PROGRESS: ReasoningProgress = {
  phase: 'idle',
  phaseProgress: 0,
  overallProgress: 0,
  phaseLabel: 'Idle',
  completedPhases: 0,
  totalPhases: 4, // planning, coding, qa_review, complete
};

/**
 * Default tree configuration
 */
export const DEFAULT_TREE_CONFIG: ReasoningTreeConfig = {
  maxNodes: 50,
  maxDepth: 10,
  autoCollapse: true,
  recentNodeCount: 10,
};

/**
 * Default reasoning stats
 */
export const DEFAULT_REASONING_STATS: ReasoningStats = {
  totalDecisions: 0,
  successfulDecisions: 0,
  failedDecisions: 0,
  toolCalls: 0,
  elapsedMs: 0,
  avgDecisionTimeMs: 0,
};

/**
 * Phase weights for progress calculation (matches agent-events.ts)
 */
export const PHASE_WEIGHTS: Record<ReasoningPhase, { start: number; end: number; label: string }> = {
  idle: { start: 0, end: 0, label: 'Idle' },
  initializing: { start: 0, end: 5, label: 'Initializing' },
  planning: { start: 5, end: 20, label: 'Planning' },
  coding: { start: 20, end: 80, label: 'Coding' },
  qa_review: { start: 80, end: 95, label: 'QA Review' },
  qa_fixing: { start: 80, end: 95, label: 'Fixing Issues' },
  complete: { start: 100, end: 100, label: 'Complete' },
  failed: { start: 0, end: 0, label: 'Failed' },
};
