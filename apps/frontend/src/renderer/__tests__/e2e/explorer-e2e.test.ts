/**
 * End-to-End tests for Explorer feature
 * Tests the complete user flow from graph generation to node interaction
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useExplorer } from '../../components/explorer/hooks/useExplorer';
import {
  useExplorerStore,
  loadProjectGraph,
  refreshProjectGraph,
  getNodeInfo
} from '../../stores/explorer-store';
import type {
  GraphData,
  GraphNode,
  GraphEdge,
  ExplorerLoadingStatus,
  SelectedNodeInfo,
  NodeType,
  EdgeType,
  ComplexityRating,
  ParserLanguage,
  DepthLevel
} from '../../../shared/types';

// ============================================
// Test Data Setup
// ============================================

const createMockGraphData = (): GraphData => ({
  nodes: [
    {
      id: 'dir-src',
      name: 'src',
      type: 'directory' as NodeType,
      filePath: 'src',
      depth: 1 as DepthLevel,
      metadata: { loc: 0 }
    },
    {
      id: 'file-app',
      name: 'App.tsx',
      type: 'file' as NodeType,
      filePath: 'src/App.tsx',
      depth: 2 as DepthLevel,
      metadata: {
        loc: 150,
        complexity: 'medium' as ComplexityRating,
        exports: ['App'],
        language: 'typescript' as ParserLanguage
      }
    },
    {
      id: 'class-app',
      name: 'App',
      type: 'class' as NodeType,
      filePath: 'src/App.tsx',
      depth: 3 as DepthLevel,
      metadata: {
        loc: 100,
        startLine: 10,
        endLine: 110,
        docstring: 'Main application component'
      }
    },
    {
      id: 'func-render',
      name: 'render',
      type: 'function' as NodeType,
      filePath: 'src/App.tsx',
      depth: 4 as DepthLevel,
      metadata: {
        loc: 30,
        startLine: 50,
        endLine: 80,
        signature: 'render(): JSX.Element',
        complexity: 'low' as ComplexityRating
      }
    },
    {
      id: 'symbol-state',
      name: 'appState',
      type: 'symbol' as NodeType,
      filePath: 'src/App.tsx',
      depth: 5 as DepthLevel,
      metadata: {
        loc: 5,
        startLine: 12,
        endLine: 16
      }
    }
  ],
  edges: [
    { id: 'e1', source: 'dir-src', target: 'file-app', type: 'contains' as EdgeType },
    { id: 'e2', source: 'file-app', target: 'class-app', type: 'contains' as EdgeType },
    { id: 'e3', source: 'class-app', target: 'func-render', type: 'contains' as EdgeType },
    { id: 'e4', source: 'class-app', target: 'symbol-state', type: 'contains' as EdgeType }
  ],
  projectId: 'test-project',
  rootPath: '/test/project',
  generatedAt: new Date(),
  stats: {
    totalNodes: 5,
    nodesByType: {
      directory: 1,
      file: 1,
      class: 1,
      function: 1,
      symbol: 1
    },
    edgesByType: {
      imports: 0,
      calls: 0,
      inherits: 0,
      contains: 4
    },
    filesParsed: 1,
    totalLoc: 285,
    languages: ['typescript'],
    parseDurationMs: 250
  }
});

const createMockNodeInfo = (nodeId: string, graph: GraphData): SelectedNodeInfo => {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  const incomingEdges = graph.edges.filter((e) => e.target === nodeId);
  const outgoingEdges = graph.edges.filter((e) => e.source === nodeId);

  // Find parent (contains edge pointing to this node)
  const parentEdge = incomingEdges.find((e) => e.type === 'contains');
  const parent = parentEdge
    ? graph.nodes.find((n) => n.id === parentEdge.source)
    : undefined;

  // Find children (contains edges from this node)
  const childEdges = outgoingEdges.filter((e) => e.type === 'contains');
  const children = childEdges
    .map((e) => graph.nodes.find((n) => n.id === e.target))
    .filter((n): n is GraphNode => n !== undefined);

  return {
    node,
    incomingEdges,
    outgoingEdges,
    parent,
    children
  };
};

// ============================================
// Mock IPC API
// ============================================

const mockElectronAPI = {
  explorer: {
    getGraph: vi.fn(),
    refreshGraph: vi.fn(),
    getNodeInfo: vi.fn(),
    onParseProgress: vi.fn(() => () => {}),
    onParseComplete: vi.fn(() => () => {}),
    onParseError: vi.fn(() => () => {})
  }
};

// @ts-expect-error - Mocking window.electronAPI
global.window = {
  electronAPI: mockElectronAPI
} as any;

// ============================================
// Tests
// ============================================

describe('Explorer E2E', () => {
  const TEST_PROJECT_ID = 'test-project';
  let mockGraph: GraphData;

  beforeEach(() => {
    // Reset store
    useExplorerStore.getState().clearAll();

    // Reset mocks
    vi.clearAllMocks();

    // Create fresh mock data
    mockGraph = createMockGraphData();

    // Setup default mock responses
    mockElectronAPI.explorer.getGraph.mockResolvedValue({
      success: true,
      data: mockGraph
    });

    mockElectronAPI.explorer.refreshGraph.mockResolvedValue({
      success: true,
      data: mockGraph
    });

    mockElectronAPI.explorer.getNodeInfo.mockImplementation(
      async (_projectId: string, nodeId: string) => ({
        success: true,
        data: createMockNodeInfo(nodeId, mockGraph)
      })
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Graph Generation', () => {
    it('should generate graph from project files', async () => {
      await loadProjectGraph(TEST_PROJECT_ID);

      const state = useExplorerStore.getState();

      // Verify IPC call
      expect(mockElectronAPI.explorer.getGraph).toHaveBeenCalledWith(TEST_PROJECT_ID);

      // Verify graph loaded
      expect(state.graph).toBeTruthy();
      expect(state.graph?.nodes).toHaveLength(5);
      expect(state.graph?.edges).toHaveLength(4);
      expect(state.graph?.projectId).toBe(TEST_PROJECT_ID);

      // Verify stats
      expect(state.graph?.stats.totalNodes).toBe(5);
      expect(state.graph?.stats.filesParsed).toBe(1);
      expect(state.graph?.stats.totalLoc).toBe(285);

      // Verify no errors
      expect(state.graphError).toBeNull();
      expect(state.isLoading).toBe(false);
    });

    it('should update graph when files change', async () => {
      // Initial load
      await loadProjectGraph(TEST_PROJECT_ID);
      const initialGraph = useExplorerStore.getState().graph;
      expect(initialGraph?.nodes).toHaveLength(5);

      // Simulate file change - add new file
      const updatedGraph: GraphData = {
        ...mockGraph,
        nodes: [
          ...mockGraph.nodes,
          {
            id: 'file-utils',
            name: 'utils.ts',
            type: 'file',
            filePath: 'src/utils.ts',
            depth: 2,
            metadata: { loc: 50 }
          }
        ],
        stats: {
          ...mockGraph.stats,
          totalNodes: 6,
          totalLoc: 335,
          nodesByType: {
            ...mockGraph.stats.nodesByType,
            file: 2
          }
        }
      };

      mockElectronAPI.explorer.refreshGraph.mockResolvedValue({
        success: true,
        data: updatedGraph
      });

      // Refresh graph
      await refreshProjectGraph(TEST_PROJECT_ID);

      const state = useExplorerStore.getState();
      expect(state.graph?.nodes).toHaveLength(6);
      expect(state.graph?.stats.totalNodes).toBe(6);
      expect(state.graph?.stats.totalLoc).toBe(335);

      // Verify refresh was called
      expect(mockElectronAPI.explorer.refreshGraph).toHaveBeenCalledWith(TEST_PROJECT_ID);
    });

    it('should cache graph for performance', async () => {
      // First load - from cache (getGraph)
      await loadProjectGraph(TEST_PROJECT_ID);
      expect(mockElectronAPI.explorer.getGraph).toHaveBeenCalledTimes(1);
      expect(mockElectronAPI.explorer.refreshGraph).not.toHaveBeenCalled();

      // Second load - should use getGraph again (cache check)
      await loadProjectGraph(TEST_PROJECT_ID);
      expect(mockElectronAPI.explorer.getGraph).toHaveBeenCalledTimes(2);
      expect(mockElectronAPI.explorer.refreshGraph).not.toHaveBeenCalled();

      // Only refreshGraph forces re-parse
      await refreshProjectGraph(TEST_PROJECT_ID);
      expect(mockElectronAPI.explorer.refreshGraph).toHaveBeenCalledTimes(1);
    });

    it('should handle empty project (no files)', async () => {
      const emptyGraph: GraphData = {
        nodes: [],
        edges: [],
        projectId: TEST_PROJECT_ID,
        rootPath: '/test/project',
        generatedAt: new Date(),
        stats: {
          totalNodes: 0,
          nodesByType: {
            directory: 0,
            file: 0,
            class: 0,
            function: 0,
            symbol: 0
          },
          edgesByType: {
            imports: 0,
            calls: 0,
            inherits: 0,
            contains: 0
          },
          filesParsed: 0,
          totalLoc: 0,
          languages: [],
          parseDurationMs: 10
        }
      };

      mockElectronAPI.explorer.getGraph.mockResolvedValue({
        success: true,
        data: emptyGraph
      });

      await loadProjectGraph(TEST_PROJECT_ID);

      const state = useExplorerStore.getState();
      expect(state.graph?.nodes).toHaveLength(0);
      expect(state.graph?.edges).toHaveLength(0);
      expect(state.graphError).toBeNull();
    });

    it('should handle first-time project with no cached graph', async () => {
      mockElectronAPI.explorer.getGraph.mockResolvedValue({
        success: true,
        data: null // No cached graph
      });

      await loadProjectGraph(TEST_PROJECT_ID);

      const state = useExplorerStore.getState();
      expect(state.graph).toBeNull();
      expect(state.loadingStatus.message).toContain('No cached graph');
      expect(state.graphError).toBeNull();
    });
  });

  describe('Node Selection', () => {
    beforeEach(async () => {
      // Load graph first
      await loadProjectGraph(TEST_PROJECT_ID);
    });

    it('should show node info when selected', async () => {
      const nodeId = 'class-app';

      await getNodeInfo(TEST_PROJECT_ID, nodeId);

      const state = useExplorerStore.getState();
      expect(state.selectedNodeId).toBe(nodeId);
      expect(state.selectedNodeInfo).toBeTruthy();
      expect(state.selectedNodeInfo?.node.id).toBe(nodeId);
      expect(state.selectedNodeInfo?.node.name).toBe('App');
      expect(state.selectedNodeInfo?.node.type).toBe('class');

      // Verify IPC call
      expect(mockElectronAPI.explorer.getNodeInfo).toHaveBeenCalledWith(
        TEST_PROJECT_ID,
        nodeId
      );
    });

    it('should highlight connected nodes', async () => {
      const nodeId = 'class-app';

      await getNodeInfo(TEST_PROJECT_ID, nodeId);

      const state = useExplorerStore.getState();
      const nodeInfo = state.selectedNodeInfo!;

      // Verify relationships
      expect(nodeInfo.incomingEdges).toHaveLength(1);
      expect(nodeInfo.incomingEdges[0].source).toBe('file-app'); // Parent

      expect(nodeInfo.outgoingEdges).toHaveLength(2);
      expect(nodeInfo.outgoingEdges.map((e) => e.target)).toContain('func-render');
      expect(nodeInfo.outgoingEdges.map((e) => e.target)).toContain('symbol-state');

      // Verify parent and children
      expect(nodeInfo.parent?.id).toBe('file-app');
      expect(nodeInfo.children).toHaveLength(2);
      expect(nodeInfo.children.map((c) => c.id)).toContain('func-render');
      expect(nodeInfo.children.map((c) => c.id)).toContain('symbol-state');
    });

    it('should display node metadata in info panel', async () => {
      const nodeId = 'class-app';

      await getNodeInfo(TEST_PROJECT_ID, nodeId);

      const state = useExplorerStore.getState();
      const node = state.selectedNodeInfo?.node!;

      expect(node.metadata.loc).toBe(100);
      expect(node.metadata.startLine).toBe(10);
      expect(node.metadata.endLine).toBe(110);
      expect(node.metadata.docstring).toBe('Main application component');
    });

    it('should clear selection when node is deselected', () => {
      // Select node
      useExplorerStore.getState().setSelectedNodeId('class-app');
      useExplorerStore.getState().setSelectedNodeInfo(createMockNodeInfo('class-app', mockGraph));
      expect(useExplorerStore.getState().selectedNodeId).toBe('class-app');

      // Clear selection
      useExplorerStore.getState().clearSelection();
      expect(useExplorerStore.getState().selectedNodeId).toBeNull();
      expect(useExplorerStore.getState().selectedNodeInfo).toBeNull();
    });

    it('should switch selection when clicking different node', async () => {
      // Select first node
      await getNodeInfo(TEST_PROJECT_ID, 'class-app');
      expect(useExplorerStore.getState().selectedNodeId).toBe('class-app');

      // Select second node
      await getNodeInfo(TEST_PROJECT_ID, 'func-render');
      expect(useExplorerStore.getState().selectedNodeId).toBe('func-render');
      expect(useExplorerStore.getState().selectedNodeInfo?.node.name).toBe('render');
    });
  });

  describe('Depth Filtering', () => {
    beforeEach(async () => {
      await loadProjectGraph(TEST_PROJECT_ID);
    });

    it('should filter nodes by depth level', () => {
      // Depth 1: directories only
      useExplorerStore.getState().setDepthLevel(1);
      expect(useExplorerStore.getState().depthLevel).toBe(1);
      expect(useExplorerStore.getState().filterOptions.depthLevel).toBe(1);

      // Depth 2: directories + files
      useExplorerStore.getState().setDepthLevel(2);
      expect(useExplorerStore.getState().depthLevel).toBe(2);

      // Depth 3: + classes
      useExplorerStore.getState().setDepthLevel(3);
      expect(useExplorerStore.getState().depthLevel).toBe(3);

      // Depth 4: + functions
      useExplorerStore.getState().setDepthLevel(4);
      expect(useExplorerStore.getState().depthLevel).toBe(4);

      // Depth 5: all symbols
      useExplorerStore.getState().setDepthLevel(5);
      expect(useExplorerStore.getState().depthLevel).toBe(5);
    });

    it('should preserve selection after filtering', async () => {
      // Select a node at depth 3
      await getNodeInfo(TEST_PROJECT_ID, 'class-app');
      expect(useExplorerStore.getState().selectedNodeId).toBe('class-app');

      // Change depth to 2 (should hide the class node)
      useExplorerStore.getState().setDepthLevel(2);
      expect(useExplorerStore.getState().depthLevel).toBe(2);

      // Selection should still be preserved in state
      expect(useExplorerStore.getState().selectedNodeId).toBe('class-app');

      // Change depth to 3 (should show the class node again)
      useExplorerStore.getState().setDepthLevel(3);
      expect(useExplorerStore.getState().depthLevel).toBe(3);
      expect(useExplorerStore.getState().selectedNodeId).toBe('class-app');
    });

    it('should update visible nodes and edges when depth changes', () => {
      const store = useExplorerStore.getState();
      const graph = store.graph!;

      // Verify all nodes at depth 1
      const depth1Nodes = graph.nodes.filter((n) => n.depth <= 1);
      expect(depth1Nodes).toHaveLength(1); // Only directory

      // Verify all nodes at depth 2
      const depth2Nodes = graph.nodes.filter((n) => n.depth <= 2);
      expect(depth2Nodes).toHaveLength(2); // Directory + file

      // Verify all nodes at depth 3
      const depth3Nodes = graph.nodes.filter((n) => n.depth <= 3);
      expect(depth3Nodes).toHaveLength(3); // Directory + file + class

      // Verify all nodes at depth 5
      const depth5Nodes = graph.nodes.filter((n) => n.depth <= 5);
      expect(depth5Nodes).toHaveLength(5); // All nodes
    });

    it('should maintain other filter options when changing depth', () => {
      // Set multiple filter options
      useExplorerStore.getState().setFilterOptions({
        depthLevel: 2,
        showConnectedOnly: true,
        nodeTypes: ['file', 'class'],
        searchQuery: 'App'
      });

      // Change depth
      useExplorerStore.getState().setDepthLevel(4);

      // Verify depth changed
      const state = useExplorerStore.getState();
      expect(state.depthLevel).toBe(4);
      expect(state.filterOptions.depthLevel).toBe(4);

      // Verify other options preserved
      expect(state.filterOptions.showConnectedOnly).toBe(true);
      expect(state.filterOptions.nodeTypes).toEqual(['file', 'class']);
      expect(state.filterOptions.searchQuery).toBe('App');
    });
  });

  describe('Error States', () => {
    it('should show error when parsing fails', async () => {
      const errorMessage = 'Tree-sitter parsing failed';

      mockElectronAPI.explorer.getGraph.mockResolvedValue({
        success: false,
        error: errorMessage
      });

      await loadProjectGraph(TEST_PROJECT_ID);

      const state = useExplorerStore.getState();
      expect(state.graphError).toBe(errorMessage);
      expect(state.loadingStatus.phase).toBe('error');
      expect(state.loadingStatus.error).toBe(errorMessage);
      expect(state.isLoading).toBe(false);
    });

    it('should show empty state for new projects', async () => {
      mockElectronAPI.explorer.getGraph.mockResolvedValue({
        success: true,
        data: null // No cached graph
      });

      await loadProjectGraph(TEST_PROJECT_ID);

      const state = useExplorerStore.getState();
      expect(state.graph).toBeNull();
      expect(state.graphError).toBeNull();
      expect(state.loadingStatus.phase).toBe('idle');
    });

    it('should handle network errors gracefully', async () => {
      const networkError = new Error('Network timeout');

      mockElectronAPI.explorer.getGraph.mockRejectedValue(networkError);

      await loadProjectGraph(TEST_PROJECT_ID);

      const state = useExplorerStore.getState();
      expect(state.graphError).toBe('Network timeout');
      expect(state.loadingStatus.phase).toBe('error');
      expect(state.isLoading).toBe(false);
    });

    it('should handle IPC errors during refresh', async () => {
      // Initial load succeeds
      await loadProjectGraph(TEST_PROJECT_ID);
      expect(useExplorerStore.getState().graph).toBeTruthy();

      // Refresh fails
      mockElectronAPI.explorer.refreshGraph.mockResolvedValue({
        success: false,
        error: 'File system error'
      });

      await refreshProjectGraph(TEST_PROJECT_ID);

      const state = useExplorerStore.getState();
      expect(state.graphError).toBe('File system error');
      expect(state.loadingStatus.phase).toBe('error');
    });

    it('should handle missing node info gracefully', async () => {
      await loadProjectGraph(TEST_PROJECT_ID);

      mockElectronAPI.explorer.getNodeInfo.mockResolvedValue({
        success: true,
        data: null // Node not found
      });

      await getNodeInfo(TEST_PROJECT_ID, 'non-existent-node');

      const state = useExplorerStore.getState();
      expect(state.selectedNodeId).toBe('non-existent-node');
      expect(state.selectedNodeInfo).toBeNull();
    });
  });

  describe('Loading States', () => {
    it('should show loading state during graph generation', async () => {
      let resolveFn: (value: any) => void = () => {};
      const loadingPromise = new Promise((resolve) => {
        resolveFn = resolve;
      });

      mockElectronAPI.explorer.getGraph.mockReturnValue(loadingPromise);

      // Start loading
      const loadPromise = loadProjectGraph(TEST_PROJECT_ID);

      // Wait a tick for loading state to be set
      await new Promise(resolve => setTimeout(resolve, 0));

      // Check intermediate state
      const loadingState = useExplorerStore.getState();
      expect(loadingState.isLoading).toBe(true);
      expect(loadingState.loadingStatus.phase).toBe('loading-cache');

      // Resolve the loading
      resolveFn({ success: true, data: mockGraph });
      await loadPromise;

      // Check final state
      const finalState = useExplorerStore.getState();
      expect(finalState.isLoading).toBe(false);
      expect(finalState.loadingStatus.phase).toBe('complete');
    });

    it('should track parsing progress updates', async () => {
      let progressCallback: (projectId: string, status: ExplorerLoadingStatus) => void = () => {};

      mockElectronAPI.explorer.onParseProgress.mockImplementation((callback) => {
        progressCallback = callback;
        return () => {};
      });

      // Render hook to set up listeners
      const { unmount } = renderHook(() => useExplorer(TEST_PROJECT_ID, { autoLoad: false }));

      // Simulate progress updates
      const progressStates: ExplorerLoadingStatus[] = [
        { phase: 'scanning-files', progress: 0, message: 'Scanning...' },
        { phase: 'parsing', progress: 50, message: 'Parsing files...', filesParsed: 5, totalFiles: 10 },
        { phase: 'building-graph', progress: 90, message: 'Building graph...' }
      ];

      for (const status of progressStates) {
        progressCallback(TEST_PROJECT_ID, status);
        await new Promise(resolve => setTimeout(resolve, 10));
        const state = useExplorerStore.getState();
        expect(state.loadingStatus.phase).toBe(status.phase);
      }

      unmount();
    });
  });

  describe('useExplorer Hook', () => {
    it('should automatically load graph on mount', async () => {
      const { result, unmount } = renderHook(() => useExplorer(TEST_PROJECT_ID));

      // Wait for graph to load
      await waitFor(() => {
        expect(result.current.hasGraph).toBe(true);
      }, { timeout: 3000 });

      expect(mockElectronAPI.explorer.getGraph).toHaveBeenCalledWith(TEST_PROJECT_ID);
      expect(result.current.filteredNodes.length).toBeGreaterThan(0);

      unmount();
    });

    it('should filter nodes by depth level', async () => {
      const { result, unmount } = renderHook(() => useExplorer(TEST_PROJECT_ID));

      await waitFor(() => {
        expect(result.current.hasGraph).toBe(true);
      }, { timeout: 3000 });

      // Initial depth 2
      expect(result.current.depthLevel).toBe(2);

      // Change to depth 5
      result.current.handleDepthChange(5);

      await waitFor(() => {
        expect(result.current.depthLevel).toBe(5);
      }, { timeout: 1000 });

      unmount();
    });

    it('should handle node selection', async () => {
      const { result, unmount } = renderHook(() => useExplorer(TEST_PROJECT_ID));

      await waitFor(() => {
        expect(result.current.hasGraph).toBe(true);
      }, { timeout: 3000 });

      // Select node
      await result.current.selectNode('class-app');

      await waitFor(() => {
        expect(result.current.selectedNodeId).toBe('class-app');
        expect(result.current.isInfoPanelOpen).toBe(true);
      }, { timeout: 1000 });

      unmount();
    });

    it('should cleanup on unmount', async () => {
      const { unmount } = renderHook(() => useExplorer(TEST_PROJECT_ID));

      await waitFor(() => {
        expect(useExplorerStore.getState().graph).toBeTruthy();
      }, { timeout: 3000 });

      unmount();

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 100));

      // State should be cleared
      const state = useExplorerStore.getState();
      expect(state.graph).toBeNull();
      expect(state.selectedNodeId).toBeNull();
    });
  });

  describe('Graph Statistics', () => {
    beforeEach(async () => {
      await loadProjectGraph(TEST_PROJECT_ID);
    });

    it('should track node counts by type', () => {
      const state = useExplorerStore.getState();
      const stats = state.graph?.stats;

      expect(stats?.nodesByType.directory).toBe(1);
      expect(stats?.nodesByType.file).toBe(1);
      expect(stats?.nodesByType.class).toBe(1);
      expect(stats?.nodesByType.function).toBe(1);
      expect(stats?.nodesByType.symbol).toBe(1);
    });

    it('should track edge counts by type', () => {
      const state = useExplorerStore.getState();
      const stats = state.graph?.stats;

      expect(stats?.edgesByType.contains).toBe(4);
      expect(stats?.edgesByType.imports).toBe(0);
      expect(stats?.edgesByType.calls).toBe(0);
    });

    it('should track parse performance metrics', () => {
      const state = useExplorerStore.getState();
      const stats = state.graph?.stats;

      expect(stats?.parseDurationMs).toBe(250);
      expect(stats?.filesParsed).toBe(1);
      expect(stats?.totalLoc).toBe(285);
      expect(stats?.languages).toEqual(['typescript']);
    });
  });
});
