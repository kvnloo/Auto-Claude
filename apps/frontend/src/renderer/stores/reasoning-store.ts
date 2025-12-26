import { create } from 'zustand';
import type {
  DecisionNode,
  DecisionNodeStatus,
  ReasoningEdge,
  ReasoningProgress,
  CurrentReasoning,
  AgentStatus,
  ReasoningStats,
  ReasoningTreeConfig,
  AddNodePayload,
  UpdateNodeStatusPayload,
  UpdateProgressPayload,
  ReasoningPhase,
  PHASE_WEIGHTS,
} from '../../shared/types/reasoning';
import {
  DEFAULT_REASONING_PROGRESS,
  DEFAULT_TREE_CONFIG,
  DEFAULT_REASONING_STATS,
} from '../../shared/types/reasoning';

// ============================================
// Store Interface
// ============================================

interface ReasoningStoreState {
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

  // === Actions ===

  // Node management
  addNode: (payload: AddNodePayload) => void;
  updateNodeStatus: (payload: UpdateNodeStatusPayload) => void;
  removeNode: (nodeId: string) => void;

  // Edge management
  addEdge: (edge: Omit<ReasoningEdge, 'id'>) => void;
  removeEdge: (edgeId: string) => void;

  // Selection
  selectDecision: (decision: DecisionNode | null) => void;

  // Reasoning text
  updateReasoning: (text: string) => void;
  clearReasoning: () => void;

  // Progress
  updateProgress: (payload: UpdateProgressPayload) => void;
  setProgress: (progress: ReasoningProgress) => void;

  // Agent status
  setAgentStatus: (status: AgentStatus) => void;
  setTaskId: (taskId: string | null) => void;

  // UI actions
  openInspector: () => void;
  closeInspector: () => void;
  toggleBranchCollapse: (nodeId: string) => void;
  setTreeConfig: (config: Partial<ReasoningTreeConfig>) => void;

  // Error handling
  setError: (error: string) => void;
  clearError: () => void;

  // Reset
  reset: () => void;
  resetForNewTask: (taskId: string) => void;

  // Selectors
  getNodeById: (nodeId: string) => DecisionNode | undefined;
  getChildNodes: (nodeId: string) => DecisionNode[];
  getRootNodes: () => DecisionNode[];
  getActiveNode: () => DecisionNode | undefined;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Generate a unique ID for edges
 */
function generateEdgeId(source: string, target: string): string {
  return `edge-${source}-${target}`;
}

/**
 * Truncate text with ellipsis for display
 */
function truncateText(text: string, maxLength: number = 500): { text: string; isTruncated: boolean; fullText?: string } {
  if (text.length <= maxLength) {
    return { text, isTruncated: false };
  }
  return {
    text: text.substring(0, maxLength) + '...',
    isTruncated: true,
    fullText: text,
  };
}

/**
 * Calculate overall progress from phase and phase progress
 */
function calculateOverallProgress(phase: ReasoningPhase, phaseProgress: number): number {
  const phaseWeights: Record<ReasoningPhase, { start: number; end: number }> = {
    idle: { start: 0, end: 0 },
    initializing: { start: 0, end: 5 },
    planning: { start: 5, end: 20 },
    coding: { start: 20, end: 80 },
    qa_review: { start: 80, end: 95 },
    qa_fixing: { start: 80, end: 95 },
    complete: { start: 100, end: 100 },
    failed: { start: 0, end: 0 },
  };

  const weight = phaseWeights[phase];
  if (!weight) return 0;

  return weight.start + (phaseProgress / 100) * (weight.end - weight.start);
}

/**
 * Get phase label for display
 */
function getPhaseLabel(phase: ReasoningPhase): string {
  const labels: Record<ReasoningPhase, string> = {
    idle: 'Idle',
    initializing: 'Initializing',
    planning: 'Planning',
    coding: 'Coding',
    qa_review: 'QA Review',
    qa_fixing: 'Fixing Issues',
    complete: 'Complete',
    failed: 'Failed',
  };
  return labels[phase] || 'Unknown';
}

/**
 * Update stats based on node changes
 */
function updateStats(nodes: DecisionNode[], startTime?: string): ReasoningStats {
  const now = Date.now();
  const startedAt = startTime ? new Date(startTime).getTime() : now;
  const elapsedMs = now - startedAt;

  const totalDecisions = nodes.length;
  const successfulDecisions = nodes.filter((n) => n.status === 'completed').length;
  const failedDecisions = nodes.filter((n) => n.status === 'failed').length;
  const toolCalls = nodes.filter((n) => n.type === 'tool_call').length;

  const avgDecisionTimeMs = totalDecisions > 0 ? elapsedMs / totalDecisions : 0;

  return {
    totalDecisions,
    successfulDecisions,
    failedDecisions,
    toolCalls,
    elapsedMs,
    avgDecisionTimeMs,
  };
}

// ============================================
// Initial State
// ============================================

const initialState = {
  nodes: [] as DecisionNode[],
  edges: [] as ReasoningEdge[],
  selectedDecision: null as DecisionNode | null,
  currentReasoning: null as CurrentReasoning | null,
  progress: { ...DEFAULT_REASONING_PROGRESS },
  agentStatus: 'idle' as AgentStatus,
  taskId: null as string | null,
  stats: { ...DEFAULT_REASONING_STATS },
  isInspectorOpen: false,
  collapsedBranches: new Set<string>(),
  treeConfig: { ...DEFAULT_TREE_CONFIG },
  lastError: null as string | null,
  hasError: false,
};

// ============================================
// Store Implementation
// ============================================

export const useReasoningStore = create<ReasoningStoreState>((set, get) => ({
  // Initial state
  ...initialState,

  // === Node Management ===

  addNode: (payload) =>
    set((state) => {
      const { id, label, type, reasoning, parentId, context, toolName, toolInput, subtaskId } = payload;

      // Calculate depth based on parent
      let depth = 0;
      if (parentId) {
        const parent = state.nodes.find((n) => n.id === parentId);
        if (parent) {
          depth = parent.depth + 1;
        }
      }

      const newNode: DecisionNode = {
        id,
        label,
        type,
        status: 'active',
        timestamp: new Date().toISOString(),
        reasoning,
        context,
        parentId,
        childIds: [],
        toolName,
        toolInput,
        subtaskId,
        depth,
      };

      // Update parent's childIds if parent exists
      const updatedNodes = state.nodes.map((node) => {
        if (node.id === parentId) {
          return {
            ...node,
            childIds: [...node.childIds, id],
          };
        }
        return node;
      });

      // Mark previous active nodes as pending if they are still active
      const nodesWithNewActive = updatedNodes.map((node) => {
        if (node.status === 'active' && node.id !== id) {
          return { ...node, status: 'pending' as DecisionNodeStatus };
        }
        return node;
      });

      const newNodes = [...nodesWithNewActive, newNode];

      // Enforce maxNodes limit
      const { maxNodes } = state.treeConfig;
      const finalNodes = newNodes.length > maxNodes ? newNodes.slice(-maxNodes) : newNodes;

      // Auto-create edge if parent exists
      let newEdges = state.edges;
      if (parentId) {
        const newEdge: ReasoningEdge = {
          id: generateEdgeId(parentId, id),
          source: parentId,
          target: id,
          type: 'default',
          animated: true,
        };
        newEdges = [...state.edges, newEdge];
      }

      return {
        nodes: finalNodes,
        edges: newEdges,
        stats: updateStats(finalNodes, state.progress.startedAt),
      };
    }),

  updateNodeStatus: (payload) =>
    set((state) => {
      const { nodeId, status, result, error } = payload;

      const updatedNodes = state.nodes.map((node) => {
        if (node.id !== nodeId) return node;

        return {
          ...node,
          status,
          result: result ?? node.result,
          error: error ?? node.error,
        };
      });

      // Update edge animation based on status
      const updatedEdges = state.edges.map((edge) => {
        if (edge.target === nodeId) {
          return {
            ...edge,
            animated: status === 'active',
            type: status === 'failed' ? ('error' as const) : edge.type,
          };
        }
        return edge;
      });

      return {
        nodes: updatedNodes,
        edges: updatedEdges,
        stats: updateStats(updatedNodes, state.progress.startedAt),
      };
    }),

  removeNode: (nodeId) =>
    set((state) => {
      // Remove node and any edges connected to it
      const newNodes = state.nodes.filter((n) => n.id !== nodeId);
      const newEdges = state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);

      // Update parent's childIds
      const updatedNodes = newNodes.map((node) => ({
        ...node,
        childIds: node.childIds.filter((id) => id !== nodeId),
      }));

      return {
        nodes: updatedNodes,
        edges: newEdges,
        selectedDecision:
          state.selectedDecision?.id === nodeId ? null : state.selectedDecision,
      };
    }),

  // === Edge Management ===

  addEdge: (edge) =>
    set((state) => {
      const newEdge: ReasoningEdge = {
        ...edge,
        id: generateEdgeId(edge.source, edge.target),
      };
      return { edges: [...state.edges, newEdge] };
    }),

  removeEdge: (edgeId) =>
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== edgeId),
    })),

  // === Selection ===

  selectDecision: (decision) =>
    set({
      selectedDecision: decision,
      isInspectorOpen: decision !== null,
    }),

  // === Reasoning Text ===

  updateReasoning: (text) =>
    set(() => {
      const truncated = truncateText(text);
      return {
        currentReasoning: {
          text: truncated.text,
          timestamp: new Date().toISOString(),
          isTruncated: truncated.isTruncated,
          fullText: truncated.fullText,
        },
      };
    }),

  clearReasoning: () =>
    set({ currentReasoning: null }),

  // === Progress ===

  updateProgress: (payload) =>
    set((state) => {
      const { phase, phaseProgress, message, currentSubtask } = payload;

      const overallProgress = calculateOverallProgress(phase, phaseProgress);
      const phaseLabel = getPhaseLabel(phase);

      // Calculate completed phases
      const phaseOrder: ReasoningPhase[] = ['initializing', 'planning', 'coding', 'qa_review', 'complete'];
      const currentPhaseIndex = phaseOrder.indexOf(phase);
      const completedPhases = Math.max(0, currentPhaseIndex);

      // Calculate ETA based on progress
      let etaMs: number | undefined;
      let etaFormatted: string | undefined;

      if (state.progress.startedAt && overallProgress > 0 && overallProgress < 100) {
        const elapsed = Date.now() - new Date(state.progress.startedAt).getTime();
        const estimatedTotal = elapsed / (overallProgress / 100);
        etaMs = Math.max(0, estimatedTotal - elapsed);

        // Format ETA
        const seconds = Math.floor(etaMs / 1000);
        if (seconds < 60) {
          etaFormatted = `~${seconds} sec remaining`;
        } else {
          const minutes = Math.floor(seconds / 60);
          etaFormatted = `~${minutes} min remaining`;
        }
      }

      return {
        progress: {
          ...state.progress,
          phase,
          phaseProgress,
          overallProgress,
          phaseLabel,
          completedPhases,
          totalPhases: phaseOrder.length - 1, // Exclude 'complete' from count
          message,
          currentSubtask,
          etaMs,
          etaFormatted,
          phaseStartedAt:
            state.progress.phase !== phase ? new Date().toISOString() : state.progress.phaseStartedAt,
        },
      };
    }),

  setProgress: (progress) =>
    set({ progress }),

  // === Agent Status ===

  setAgentStatus: (status) =>
    set((state) => {
      // Update progress phase based on agent status
      let progressUpdate: Partial<ReasoningProgress> = {};

      if (status === 'running' && state.agentStatus === 'idle') {
        progressUpdate = {
          startedAt: new Date().toISOString(),
        };
      } else if (status === 'completed') {
        progressUpdate = {
          phase: 'complete',
          phaseProgress: 100,
          overallProgress: 100,
          phaseLabel: 'Complete',
        };
      } else if (status === 'error') {
        progressUpdate = {
          phase: 'failed',
          phaseLabel: 'Failed',
        };
      } else if (status === 'stopped') {
        progressUpdate = {
          phaseLabel: 'Stopped',
        };
      }

      return {
        agentStatus: status,
        progress: { ...state.progress, ...progressUpdate },
      };
    }),

  setTaskId: (taskId) =>
    set({ taskId }),

  // === UI Actions ===

  openInspector: () =>
    set({ isInspectorOpen: true }),

  closeInspector: () =>
    set({ isInspectorOpen: false, selectedDecision: null }),

  toggleBranchCollapse: (nodeId) =>
    set((state) => {
      const newCollapsed = new Set(state.collapsedBranches);
      if (newCollapsed.has(nodeId)) {
        newCollapsed.delete(nodeId);
      } else {
        newCollapsed.add(nodeId);
      }
      return { collapsedBranches: newCollapsed };
    }),

  setTreeConfig: (config) =>
    set((state) => ({
      treeConfig: { ...state.treeConfig, ...config },
    })),

  // === Error Handling ===

  setError: (error) =>
    set({
      lastError: error,
      hasError: true,
      agentStatus: 'error',
    }),

  clearError: () =>
    set({
      lastError: null,
      hasError: false,
    }),

  // === Reset ===

  reset: () =>
    set({
      ...initialState,
      collapsedBranches: new Set<string>(),
    }),

  resetForNewTask: (taskId) =>
    set({
      ...initialState,
      collapsedBranches: new Set<string>(),
      taskId,
      agentStatus: 'running',
      progress: {
        ...DEFAULT_REASONING_PROGRESS,
        startedAt: new Date().toISOString(),
        phase: 'initializing',
        phaseLabel: 'Initializing',
      },
    }),

  // === Selectors ===

  getNodeById: (nodeId) => {
    const state = get();
    return state.nodes.find((n) => n.id === nodeId);
  },

  getChildNodes: (nodeId) => {
    const state = get();
    const node = state.nodes.find((n) => n.id === nodeId);
    if (!node) return [];
    return state.nodes.filter((n) => node.childIds.includes(n.id));
  },

  getRootNodes: () => {
    const state = get();
    return state.nodes.filter((n) => !n.parentId);
  },

  getActiveNode: () => {
    const state = get();
    return state.nodes.find((n) => n.status === 'active');
  },
}));

// ============================================
// External Helper Functions (for IPC integration)
// ============================================

/**
 * Start monitoring a task for reasoning events
 */
export function startMonitoringTask(taskId: string): void {
  const store = useReasoningStore.getState();
  store.resetForNewTask(taskId);
}

/**
 * Stop monitoring the current task
 */
export function stopMonitoringTask(): void {
  const store = useReasoningStore.getState();
  store.setAgentStatus('stopped');
}

/**
 * Handle agent completion
 */
export function handleAgentCompleted(): void {
  const store = useReasoningStore.getState();
  store.setAgentStatus('completed');
}

/**
 * Handle agent error
 */
export function handleAgentError(error: string): void {
  const store = useReasoningStore.getState();
  store.setError(error);
}

/**
 * Format ETA from milliseconds to human-readable string
 */
export function formatEta(etaMs: number): string {
  if (etaMs <= 0) return '';

  const seconds = Math.floor(etaMs / 1000);
  if (seconds < 60) {
    return `~${seconds} sec remaining`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `~${minutes} min remaining`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `~${hours}h ${remainingMinutes}m remaining`;
}

/**
 * Get phase-specific color for styling
 */
export function getPhaseColor(phase: ReasoningPhase): string {
  const colors: Record<ReasoningPhase, string> = {
    idle: 'text-gray-500',
    initializing: 'text-blue-500',
    planning: 'text-purple-500',
    coding: 'text-green-500',
    qa_review: 'text-orange-500',
    qa_fixing: 'text-yellow-500',
    complete: 'text-emerald-500',
    failed: 'text-red-500',
  };
  return colors[phase] || 'text-gray-500';
}

/**
 * Get decision type color for node styling
 */
export function getDecisionTypeColor(type: DecisionNode['type']): string {
  const colors: Record<DecisionNode['type'], string> = {
    planning: 'bg-purple-500',
    execution: 'bg-green-500',
    analysis: 'bg-blue-500',
    tool_call: 'bg-orange-500',
    reasoning: 'bg-gray-500',
    result: 'bg-emerald-500',
    error: 'bg-red-500',
  };
  return colors[type] || 'bg-gray-500';
}

/**
 * Get node status color for styling
 */
export function getNodeStatusColor(status: DecisionNodeStatus): string {
  const colors: Record<DecisionNodeStatus, string> = {
    pending: 'border-gray-400',
    active: 'border-blue-500 ring-2 ring-blue-300',
    completed: 'border-green-500',
    failed: 'border-red-500',
  };
  return colors[status] || 'border-gray-400';
}
