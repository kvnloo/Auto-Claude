/**
 * Unit tests for Reasoning Store
 * Tests Zustand store for reasoning state management
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  useReasoningStore,
  startMonitoringTask,
  stopMonitoringTask,
  handleAgentCompleted,
  handleAgentError,
  formatEta,
  getPhaseColor,
  getDecisionTypeColor,
  getNodeStatusColor,
} from '../reasoning-store';
import type {
  DecisionNode,
  DecisionType,
  DecisionNodeStatus,
  ReasoningProgress,
  AgentStatus,
  ReasoningEdge,
  ReasoningTreeConfig,
  AddNodePayload,
} from '../../../shared/types/reasoning';
import {
  DEFAULT_REASONING_PROGRESS,
  DEFAULT_TREE_CONFIG,
  DEFAULT_REASONING_STATS,
} from '../../../shared/types/reasoning';

// Helper to create test decision nodes
function createTestNode(overrides: Partial<DecisionNode> = {}): DecisionNode {
  return {
    id: `node-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    label: 'Test Decision',
    type: 'reasoning' as DecisionType,
    status: 'pending' as DecisionNodeStatus,
    timestamp: new Date().toISOString(),
    reasoning: 'Test reasoning text',
    childIds: [],
    depth: 0,
    ...overrides,
  };
}

// Helper to create test edges
function createTestEdge(overrides: Partial<ReasoningEdge> = {}): ReasoningEdge {
  return {
    id: `edge-${Date.now()}`,
    source: 'source-node',
    target: 'target-node',
    type: 'default',
    animated: false,
    ...overrides,
  };
}

// Helper to create add node payload
function createAddNodePayload(overrides: Partial<AddNodePayload> = {}): AddNodePayload {
  return {
    id: `node-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    label: 'Test Decision',
    type: 'reasoning',
    reasoning: 'Test reasoning text',
    ...overrides,
  };
}

describe('Reasoning Store', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useReasoningStore.setState({
      nodes: [],
      edges: [],
      selectedDecision: null,
      currentReasoning: null,
      progress: { ...DEFAULT_REASONING_PROGRESS },
      agentStatus: 'idle',
      taskId: null,
      stats: { ...DEFAULT_REASONING_STATS },
      isInspectorOpen: false,
      collapsedBranches: new Set<string>(),
      treeConfig: { ...DEFAULT_TREE_CONFIG },
      lastError: null,
      hasError: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // Node Management Tests
  // ============================================

  describe('addNode', () => {
    it('should add node to empty array', () => {
      const payload = createAddNodePayload({ id: 'node-1' });

      useReasoningStore.getState().addNode(payload);

      expect(useReasoningStore.getState().nodes).toHaveLength(1);
      expect(useReasoningStore.getState().nodes[0].id).toBe('node-1');
    });

    it('should set node status to active', () => {
      const payload = createAddNodePayload({ id: 'node-1' });

      useReasoningStore.getState().addNode(payload);

      expect(useReasoningStore.getState().nodes[0].status).toBe('active');
    });

    it('should set timestamp on node', () => {
      const payload = createAddNodePayload({ id: 'node-1' });

      useReasoningStore.getState().addNode(payload);

      expect(useReasoningStore.getState().nodes[0].timestamp).toBeDefined();
    });

    it('should calculate depth 0 for root node', () => {
      const payload = createAddNodePayload({ id: 'node-1' });

      useReasoningStore.getState().addNode(payload);

      expect(useReasoningStore.getState().nodes[0].depth).toBe(0);
    });

    it('should calculate correct depth for child node', () => {
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'parent' }));
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'child', parentId: 'parent' }));

      const childNode = useReasoningStore.getState().nodes.find((n) => n.id === 'child');
      expect(childNode?.depth).toBe(1);
    });

    it('should update parent childIds when adding child node', () => {
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'parent' }));
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'child', parentId: 'parent' }));

      const parentNode = useReasoningStore.getState().nodes.find((n) => n.id === 'parent');
      expect(parentNode?.childIds).toContain('child');
    });

    it('should mark previous active node as pending', () => {
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'first' }));
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'second' }));

      const firstNode = useReasoningStore.getState().nodes.find((n) => n.id === 'first');
      const secondNode = useReasoningStore.getState().nodes.find((n) => n.id === 'second');

      expect(firstNode?.status).toBe('pending');
      expect(secondNode?.status).toBe('active');
    });

    it('should auto-create edge when parent exists', () => {
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'parent' }));
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'child', parentId: 'parent' }));

      expect(useReasoningStore.getState().edges).toHaveLength(1);
      expect(useReasoningStore.getState().edges[0].source).toBe('parent');
      expect(useReasoningStore.getState().edges[0].target).toBe('child');
    });

    it('should enforce maxNodes limit', () => {
      useReasoningStore.setState({
        treeConfig: { ...DEFAULT_TREE_CONFIG, maxNodes: 3 },
      });

      for (let i = 0; i < 5; i++) {
        useReasoningStore.getState().addNode(createAddNodePayload({ id: `node-${i}` }));
      }

      expect(useReasoningStore.getState().nodes).toHaveLength(3);
    });

    it('should update stats when adding nodes', () => {
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'node-1' }));
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'node-2' }));

      expect(useReasoningStore.getState().stats.totalDecisions).toBe(2);
    });

    it('should handle tool_call type nodes', () => {
      const payload = createAddNodePayload({
        id: 'tool-node',
        type: 'tool_call',
        toolName: 'Read',
        toolInput: '/path/to/file',
      });

      useReasoningStore.getState().addNode(payload);

      const node = useReasoningStore.getState().nodes[0];
      expect(node.type).toBe('tool_call');
      expect(node.toolName).toBe('Read');
      expect(node.toolInput).toBe('/path/to/file');
    });
  });

  describe('updateNodeStatus', () => {
    it('should update node status', () => {
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'node-1' }));

      useReasoningStore.getState().updateNodeStatus({
        nodeId: 'node-1',
        status: 'completed',
      });

      expect(useReasoningStore.getState().nodes[0].status).toBe('completed');
    });

    it('should update node result', () => {
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'node-1' }));

      useReasoningStore.getState().updateNodeStatus({
        nodeId: 'node-1',
        status: 'completed',
        result: 'Success result',
      });

      expect(useReasoningStore.getState().nodes[0].result).toBe('Success result');
    });

    it('should update node error on failure', () => {
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'node-1' }));

      useReasoningStore.getState().updateNodeStatus({
        nodeId: 'node-1',
        status: 'failed',
        error: 'Something went wrong',
      });

      expect(useReasoningStore.getState().nodes[0].status).toBe('failed');
      expect(useReasoningStore.getState().nodes[0].error).toBe('Something went wrong');
    });

    it('should update edge animation when status changes', () => {
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'parent' }));
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'child', parentId: 'parent' }));

      useReasoningStore.getState().updateNodeStatus({
        nodeId: 'child',
        status: 'completed',
      });

      const edge = useReasoningStore.getState().edges[0];
      expect(edge.animated).toBe(false);
    });

    it('should set edge type to error when node fails', () => {
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'parent' }));
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'child', parentId: 'parent' }));

      useReasoningStore.getState().updateNodeStatus({
        nodeId: 'child',
        status: 'failed',
      });

      const edge = useReasoningStore.getState().edges[0];
      expect(edge.type).toBe('error');
    });

    it('should not modify other nodes', () => {
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'node-1' }));
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'node-2' }));

      useReasoningStore.getState().updateNodeStatus({
        nodeId: 'node-1',
        status: 'completed',
      });

      const node2 = useReasoningStore.getState().nodes.find((n) => n.id === 'node-2');
      expect(node2?.status).toBe('active');
    });

    it('should update stats on status change', () => {
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'node-1' }));

      useReasoningStore.getState().updateNodeStatus({
        nodeId: 'node-1',
        status: 'completed',
      });

      expect(useReasoningStore.getState().stats.successfulDecisions).toBe(1);
    });
  });

  describe('removeNode', () => {
    it('should remove node by id', () => {
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'node-1' }));
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'node-2' }));

      useReasoningStore.getState().removeNode('node-1');

      expect(useReasoningStore.getState().nodes).toHaveLength(1);
      expect(useReasoningStore.getState().nodes[0].id).toBe('node-2');
    });

    it('should remove edges connected to node', () => {
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'parent' }));
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'child', parentId: 'parent' }));

      useReasoningStore.getState().removeNode('child');

      expect(useReasoningStore.getState().edges).toHaveLength(0);
    });

    it('should update parent childIds when removing node', () => {
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'parent' }));
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'child', parentId: 'parent' }));

      useReasoningStore.getState().removeNode('child');

      const parentNode = useReasoningStore.getState().nodes.find((n) => n.id === 'parent');
      expect(parentNode?.childIds).not.toContain('child');
    });

    it('should clear selection if removed node was selected', () => {
      const node = createTestNode({ id: 'node-1' });
      useReasoningStore.setState({
        nodes: [node],
        selectedDecision: node,
      });

      useReasoningStore.getState().removeNode('node-1');

      expect(useReasoningStore.getState().selectedDecision).toBeNull();
    });
  });

  // ============================================
  // Edge Management Tests
  // ============================================

  describe('addEdge', () => {
    it('should add edge to array', () => {
      useReasoningStore.getState().addEdge({
        source: 'node-1',
        target: 'node-2',
        type: 'default',
      });

      expect(useReasoningStore.getState().edges).toHaveLength(1);
      expect(useReasoningStore.getState().edges[0].source).toBe('node-1');
      expect(useReasoningStore.getState().edges[0].target).toBe('node-2');
    });

    it('should generate edge id', () => {
      useReasoningStore.getState().addEdge({
        source: 'node-1',
        target: 'node-2',
        type: 'default',
      });

      expect(useReasoningStore.getState().edges[0].id).toBe('edge-node-1-node-2');
    });
  });

  describe('removeEdge', () => {
    it('should remove edge by id', () => {
      useReasoningStore.setState({
        edges: [createTestEdge({ id: 'edge-1' }), createTestEdge({ id: 'edge-2' })],
      });

      useReasoningStore.getState().removeEdge('edge-1');

      expect(useReasoningStore.getState().edges).toHaveLength(1);
      expect(useReasoningStore.getState().edges[0].id).toBe('edge-2');
    });
  });

  // ============================================
  // Selection Tests
  // ============================================

  describe('selectDecision', () => {
    it('should set selected decision', () => {
      const node = createTestNode({ id: 'node-1' });

      useReasoningStore.getState().selectDecision(node);

      expect(useReasoningStore.getState().selectedDecision).toEqual(node);
    });

    it('should open inspector when selecting', () => {
      const node = createTestNode({ id: 'node-1' });

      useReasoningStore.getState().selectDecision(node);

      expect(useReasoningStore.getState().isInspectorOpen).toBe(true);
    });

    it('should close inspector when clearing selection', () => {
      useReasoningStore.setState({ isInspectorOpen: true });

      useReasoningStore.getState().selectDecision(null);

      expect(useReasoningStore.getState().selectedDecision).toBeNull();
      expect(useReasoningStore.getState().isInspectorOpen).toBe(false);
    });
  });

  // ============================================
  // Reasoning Text Tests
  // ============================================

  describe('updateReasoning', () => {
    it('should update reasoning text', () => {
      useReasoningStore.getState().updateReasoning('Current thinking...');

      const reasoning = useReasoningStore.getState().currentReasoning;
      expect(reasoning?.text).toBe('Current thinking...');
    });

    it('should set timestamp', () => {
      useReasoningStore.getState().updateReasoning('Current thinking...');

      const reasoning = useReasoningStore.getState().currentReasoning;
      expect(reasoning?.timestamp).toBeDefined();
    });

    it('should truncate long text', () => {
      const longText = 'a'.repeat(600);

      useReasoningStore.getState().updateReasoning(longText);

      const reasoning = useReasoningStore.getState().currentReasoning;
      expect(reasoning?.isTruncated).toBe(true);
      expect(reasoning?.text.length).toBeLessThan(600);
      expect(reasoning?.fullText).toBe(longText);
    });

    it('should not truncate short text', () => {
      const shortText = 'Short text';

      useReasoningStore.getState().updateReasoning(shortText);

      const reasoning = useReasoningStore.getState().currentReasoning;
      expect(reasoning?.isTruncated).toBe(false);
      expect(reasoning?.fullText).toBeUndefined();
    });
  });

  describe('clearReasoning', () => {
    it('should clear current reasoning', () => {
      useReasoningStore.setState({
        currentReasoning: {
          text: 'Some reasoning',
          timestamp: new Date().toISOString(),
          isTruncated: false,
        },
      });

      useReasoningStore.getState().clearReasoning();

      expect(useReasoningStore.getState().currentReasoning).toBeNull();
    });
  });

  // ============================================
  // Progress Tests
  // ============================================

  describe('updateProgress', () => {
    it('should update phase', () => {
      useReasoningStore.getState().updateProgress({
        phase: 'coding',
        phaseProgress: 50,
      });

      expect(useReasoningStore.getState().progress.phase).toBe('coding');
    });

    it('should update phase progress', () => {
      useReasoningStore.getState().updateProgress({
        phase: 'coding',
        phaseProgress: 50,
      });

      expect(useReasoningStore.getState().progress.phaseProgress).toBe(50);
    });

    it('should calculate overall progress', () => {
      useReasoningStore.getState().updateProgress({
        phase: 'coding',
        phaseProgress: 50,
      });

      // Coding phase: start=20, end=80, so 50% = 20 + (50/100) * (80-20) = 50
      expect(useReasoningStore.getState().progress.overallProgress).toBe(50);
    });

    it('should set phase label', () => {
      useReasoningStore.getState().updateProgress({
        phase: 'planning',
        phaseProgress: 0,
      });

      expect(useReasoningStore.getState().progress.phaseLabel).toBe('Planning');
    });

    it('should update message', () => {
      useReasoningStore.getState().updateProgress({
        phase: 'coding',
        phaseProgress: 50,
        message: 'Writing code...',
      });

      expect(useReasoningStore.getState().progress.message).toBe('Writing code...');
    });

    it('should update current subtask', () => {
      useReasoningStore.getState().updateProgress({
        phase: 'coding',
        phaseProgress: 50,
        currentSubtask: 'subtask-1',
      });

      expect(useReasoningStore.getState().progress.currentSubtask).toBe('subtask-1');
    });

    it('should calculate completed phases', () => {
      useReasoningStore.getState().updateProgress({
        phase: 'coding',
        phaseProgress: 50,
      });

      expect(useReasoningStore.getState().progress.completedPhases).toBe(2); // initializing, planning
    });

    it('should update phaseStartedAt when phase changes', () => {
      // Set an initial phase with a known timestamp
      useReasoningStore.setState({
        progress: {
          ...DEFAULT_REASONING_PROGRESS,
          phase: 'planning',
          phaseProgress: 50,
          phaseStartedAt: '2024-01-01T00:00:00.000Z',
        },
      });

      useReasoningStore.getState().updateProgress({
        phase: 'coding',
        phaseProgress: 0,
      });

      // phaseStartedAt should be updated to a new timestamp (not the old one)
      expect(useReasoningStore.getState().progress.phaseStartedAt).not.toBe('2024-01-01T00:00:00.000Z');
      expect(useReasoningStore.getState().progress.phaseStartedAt).toBeDefined();
    });

    it('should not update phaseStartedAt when phase stays same', () => {
      useReasoningStore.getState().updateProgress({
        phase: 'coding',
        phaseProgress: 25,
      });

      const phaseStart = useReasoningStore.getState().progress.phaseStartedAt;

      useReasoningStore.getState().updateProgress({
        phase: 'coding',
        phaseProgress: 50,
      });

      expect(useReasoningStore.getState().progress.phaseStartedAt).toBe(phaseStart);
    });
  });

  describe('setProgress', () => {
    it('should set complete progress object', () => {
      const progress: ReasoningProgress = {
        phase: 'qa_review',
        phaseProgress: 75,
        overallProgress: 90,
        phaseLabel: 'QA Review',
        completedPhases: 3,
        totalPhases: 4,
      };

      useReasoningStore.getState().setProgress(progress);

      expect(useReasoningStore.getState().progress).toEqual(progress);
    });
  });

  // ============================================
  // Agent Status Tests
  // ============================================

  describe('setAgentStatus', () => {
    it('should set agent status', () => {
      useReasoningStore.getState().setAgentStatus('running');

      expect(useReasoningStore.getState().agentStatus).toBe('running');
    });

    it('should set startedAt when transitioning from idle to running', () => {
      useReasoningStore.getState().setAgentStatus('running');

      expect(useReasoningStore.getState().progress.startedAt).toBeDefined();
    });

    it('should set phase to complete when completed', () => {
      useReasoningStore.getState().setAgentStatus('completed');

      expect(useReasoningStore.getState().progress.phase).toBe('complete');
      expect(useReasoningStore.getState().progress.overallProgress).toBe(100);
    });

    it('should set phase to failed when error', () => {
      useReasoningStore.getState().setAgentStatus('error');

      expect(useReasoningStore.getState().progress.phase).toBe('failed');
    });

    it('should set phase label to Stopped when stopped', () => {
      useReasoningStore.getState().setAgentStatus('stopped');

      expect(useReasoningStore.getState().progress.phaseLabel).toBe('Stopped');
    });
  });

  describe('setTaskId', () => {
    it('should set task id', () => {
      useReasoningStore.getState().setTaskId('task-123');

      expect(useReasoningStore.getState().taskId).toBe('task-123');
    });

    it('should clear task id with null', () => {
      useReasoningStore.setState({ taskId: 'task-123' });

      useReasoningStore.getState().setTaskId(null);

      expect(useReasoningStore.getState().taskId).toBeNull();
    });
  });

  // ============================================
  // UI Actions Tests
  // ============================================

  describe('openInspector', () => {
    it('should open inspector', () => {
      useReasoningStore.getState().openInspector();

      expect(useReasoningStore.getState().isInspectorOpen).toBe(true);
    });
  });

  describe('closeInspector', () => {
    it('should close inspector', () => {
      useReasoningStore.setState({ isInspectorOpen: true });

      useReasoningStore.getState().closeInspector();

      expect(useReasoningStore.getState().isInspectorOpen).toBe(false);
    });

    it('should clear selected decision', () => {
      const node = createTestNode();
      useReasoningStore.setState({
        isInspectorOpen: true,
        selectedDecision: node,
      });

      useReasoningStore.getState().closeInspector();

      expect(useReasoningStore.getState().selectedDecision).toBeNull();
    });
  });

  describe('toggleBranchCollapse', () => {
    it('should add node to collapsed branches', () => {
      useReasoningStore.getState().toggleBranchCollapse('node-1');

      expect(useReasoningStore.getState().collapsedBranches.has('node-1')).toBe(true);
    });

    it('should remove node from collapsed branches if already collapsed', () => {
      useReasoningStore.setState({
        collapsedBranches: new Set(['node-1']),
      });

      useReasoningStore.getState().toggleBranchCollapse('node-1');

      expect(useReasoningStore.getState().collapsedBranches.has('node-1')).toBe(false);
    });
  });

  describe('setTreeConfig', () => {
    it('should merge partial config', () => {
      useReasoningStore.getState().setTreeConfig({ maxNodes: 100 });

      expect(useReasoningStore.getState().treeConfig.maxNodes).toBe(100);
      expect(useReasoningStore.getState().treeConfig.maxDepth).toBe(DEFAULT_TREE_CONFIG.maxDepth);
    });

    it('should update multiple config values', () => {
      useReasoningStore.getState().setTreeConfig({
        maxNodes: 100,
        autoCollapse: false,
      });

      expect(useReasoningStore.getState().treeConfig.maxNodes).toBe(100);
      expect(useReasoningStore.getState().treeConfig.autoCollapse).toBe(false);
    });
  });

  // ============================================
  // Error Handling Tests
  // ============================================

  describe('setError', () => {
    it('should set error message', () => {
      useReasoningStore.getState().setError('Something went wrong');

      expect(useReasoningStore.getState().lastError).toBe('Something went wrong');
    });

    it('should set hasError to true', () => {
      useReasoningStore.getState().setError('Error');

      expect(useReasoningStore.getState().hasError).toBe(true);
    });

    it('should set agent status to error', () => {
      useReasoningStore.getState().setError('Error');

      expect(useReasoningStore.getState().agentStatus).toBe('error');
    });
  });

  describe('clearError', () => {
    it('should clear error message', () => {
      useReasoningStore.setState({
        lastError: 'Previous error',
        hasError: true,
      });

      useReasoningStore.getState().clearError();

      expect(useReasoningStore.getState().lastError).toBeNull();
    });

    it('should set hasError to false', () => {
      useReasoningStore.setState({
        lastError: 'Previous error',
        hasError: true,
      });

      useReasoningStore.getState().clearError();

      expect(useReasoningStore.getState().hasError).toBe(false);
    });
  });

  // ============================================
  // Reset Tests
  // ============================================

  describe('reset', () => {
    it('should reset all state to initial values', () => {
      // Set up some state
      useReasoningStore.setState({
        nodes: [createTestNode()],
        edges: [createTestEdge()],
        selectedDecision: createTestNode(),
        agentStatus: 'running',
        taskId: 'task-123',
        lastError: 'Error',
        hasError: true,
      });

      useReasoningStore.getState().reset();

      expect(useReasoningStore.getState().nodes).toHaveLength(0);
      expect(useReasoningStore.getState().edges).toHaveLength(0);
      expect(useReasoningStore.getState().selectedDecision).toBeNull();
      expect(useReasoningStore.getState().agentStatus).toBe('idle');
      expect(useReasoningStore.getState().taskId).toBeNull();
      expect(useReasoningStore.getState().lastError).toBeNull();
      expect(useReasoningStore.getState().hasError).toBe(false);
    });

    it('should reset collapsed branches', () => {
      useReasoningStore.setState({
        collapsedBranches: new Set(['node-1', 'node-2']),
      });

      useReasoningStore.getState().reset();

      expect(useReasoningStore.getState().collapsedBranches.size).toBe(0);
    });
  });

  describe('resetForNewTask', () => {
    it('should set task id', () => {
      useReasoningStore.getState().resetForNewTask('new-task-123');

      expect(useReasoningStore.getState().taskId).toBe('new-task-123');
    });

    it('should set agent status to running', () => {
      useReasoningStore.getState().resetForNewTask('new-task-123');

      expect(useReasoningStore.getState().agentStatus).toBe('running');
    });

    it('should set phase to initializing', () => {
      useReasoningStore.getState().resetForNewTask('new-task-123');

      expect(useReasoningStore.getState().progress.phase).toBe('initializing');
    });

    it('should set startedAt', () => {
      useReasoningStore.getState().resetForNewTask('new-task-123');

      expect(useReasoningStore.getState().progress.startedAt).toBeDefined();
    });

    it('should clear previous nodes and edges', () => {
      useReasoningStore.setState({
        nodes: [createTestNode()],
        edges: [createTestEdge()],
      });

      useReasoningStore.getState().resetForNewTask('new-task-123');

      expect(useReasoningStore.getState().nodes).toHaveLength(0);
      expect(useReasoningStore.getState().edges).toHaveLength(0);
    });
  });

  // ============================================
  // Selector Tests
  // ============================================

  describe('getNodeById', () => {
    it('should return node by id', () => {
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'node-1', label: 'First' }));
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'node-2', label: 'Second' }));

      const node = useReasoningStore.getState().getNodeById('node-1');

      expect(node?.label).toBe('First');
    });

    it('should return undefined for non-existent id', () => {
      const node = useReasoningStore.getState().getNodeById('nonexistent');

      expect(node).toBeUndefined();
    });
  });

  describe('getChildNodes', () => {
    it('should return child nodes', () => {
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'parent' }));
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'child-1', parentId: 'parent' }));
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'child-2', parentId: 'parent' }));

      const children = useReasoningStore.getState().getChildNodes('parent');

      expect(children).toHaveLength(2);
      expect(children.map((c) => c.id)).toContain('child-1');
      expect(children.map((c) => c.id)).toContain('child-2');
    });

    it('should return empty array for node with no children', () => {
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'node-1' }));

      const children = useReasoningStore.getState().getChildNodes('node-1');

      expect(children).toHaveLength(0);
    });

    it('should return empty array for non-existent node', () => {
      const children = useReasoningStore.getState().getChildNodes('nonexistent');

      expect(children).toHaveLength(0);
    });
  });

  describe('getRootNodes', () => {
    it('should return nodes without parent', () => {
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'root-1' }));
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'root-2' }));
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'child', parentId: 'root-1' }));

      const roots = useReasoningStore.getState().getRootNodes();

      expect(roots).toHaveLength(2);
      expect(roots.map((r) => r.id)).toContain('root-1');
      expect(roots.map((r) => r.id)).toContain('root-2');
      expect(roots.map((r) => r.id)).not.toContain('child');
    });

    it('should return empty array when no nodes', () => {
      const roots = useReasoningStore.getState().getRootNodes();

      expect(roots).toHaveLength(0);
    });
  });

  describe('getActiveNode', () => {
    it('should return active node', () => {
      useReasoningStore.getState().addNode(createAddNodePayload({ id: 'node-1' }));

      const active = useReasoningStore.getState().getActiveNode();

      expect(active?.id).toBe('node-1');
      expect(active?.status).toBe('active');
    });

    it('should return undefined when no active node', () => {
      useReasoningStore.setState({
        nodes: [createTestNode({ id: 'node-1', status: 'completed' })],
      });

      const active = useReasoningStore.getState().getActiveNode();

      expect(active).toBeUndefined();
    });
  });

  // ============================================
  // External Helper Function Tests
  // ============================================

  describe('startMonitoringTask', () => {
    it('should reset store for new task', () => {
      useReasoningStore.setState({
        nodes: [createTestNode()],
        taskId: 'old-task',
      });

      startMonitoringTask('new-task');

      expect(useReasoningStore.getState().taskId).toBe('new-task');
      expect(useReasoningStore.getState().nodes).toHaveLength(0);
      expect(useReasoningStore.getState().agentStatus).toBe('running');
    });
  });

  describe('stopMonitoringTask', () => {
    it('should set agent status to stopped', () => {
      useReasoningStore.setState({ agentStatus: 'running' });

      stopMonitoringTask();

      expect(useReasoningStore.getState().agentStatus).toBe('stopped');
    });
  });

  describe('handleAgentCompleted', () => {
    it('should set agent status to completed', () => {
      useReasoningStore.setState({ agentStatus: 'running' });

      handleAgentCompleted();

      expect(useReasoningStore.getState().agentStatus).toBe('completed');
    });
  });

  describe('handleAgentError', () => {
    it('should set error', () => {
      handleAgentError('Something failed');

      expect(useReasoningStore.getState().lastError).toBe('Something failed');
      expect(useReasoningStore.getState().hasError).toBe(true);
      expect(useReasoningStore.getState().agentStatus).toBe('error');
    });
  });

  describe('formatEta', () => {
    it('should return empty string for 0 or negative', () => {
      expect(formatEta(0)).toBe('');
      expect(formatEta(-1000)).toBe('');
    });

    it('should format seconds', () => {
      expect(formatEta(30000)).toBe('~30 sec remaining');
    });

    it('should format minutes', () => {
      expect(formatEta(180000)).toBe('~3 min remaining'); // 3 minutes
    });

    it('should format hours and minutes', () => {
      expect(formatEta(3900000)).toBe('~1h 5m remaining'); // 1 hour 5 minutes
    });
  });

  describe('getPhaseColor', () => {
    it('should return correct color for each phase', () => {
      expect(getPhaseColor('idle')).toBe('text-gray-500');
      expect(getPhaseColor('initializing')).toBe('text-blue-500');
      expect(getPhaseColor('planning')).toBe('text-purple-500');
      expect(getPhaseColor('coding')).toBe('text-green-500');
      expect(getPhaseColor('qa_review')).toBe('text-orange-500');
      expect(getPhaseColor('qa_fixing')).toBe('text-yellow-500');
      expect(getPhaseColor('complete')).toBe('text-emerald-500');
      expect(getPhaseColor('failed')).toBe('text-red-500');
    });
  });

  describe('getDecisionTypeColor', () => {
    it('should return correct color for each decision type', () => {
      expect(getDecisionTypeColor('planning')).toBe('bg-purple-500');
      expect(getDecisionTypeColor('execution')).toBe('bg-green-500');
      expect(getDecisionTypeColor('analysis')).toBe('bg-blue-500');
      expect(getDecisionTypeColor('tool_call')).toBe('bg-orange-500');
      expect(getDecisionTypeColor('reasoning')).toBe('bg-gray-500');
      expect(getDecisionTypeColor('result')).toBe('bg-emerald-500');
      expect(getDecisionTypeColor('error')).toBe('bg-red-500');
    });
  });

  describe('getNodeStatusColor', () => {
    it('should return correct color for each node status', () => {
      expect(getNodeStatusColor('pending')).toBe('border-gray-400');
      expect(getNodeStatusColor('active')).toBe('border-blue-500 ring-2 ring-blue-300');
      expect(getNodeStatusColor('completed')).toBe('border-green-500');
      expect(getNodeStatusColor('failed')).toBe('border-red-500');
    });
  });
});
