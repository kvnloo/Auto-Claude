/**
 * Unit tests for Explorer Store
 * Tests Zustand store for codebase explorer state management
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useExplorerStore } from '../stores/explorer-store';
import type {
  GraphData,
  GraphNode,
  GraphEdge,
  DepthLevel,
  ExplorerLoadingStatus,
  GraphFilterOptions,
  GraphViewport,
  SelectedNodeInfo,
  NodeType,
  EdgeType
} from '../../shared/types';

// Helper to create test graph nodes
function createTestNode(overrides: Partial<GraphNode> = {}): GraphNode {
  const id = overrides.id || `node-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  return {
    id,
    name: 'test-node',
    type: 'file' as NodeType,
    filePath: '/src/test.ts',
    depth: 2 as DepthLevel,
    metadata: {},
    ...overrides
  };
}

// Helper to create test graph edges
function createTestEdge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  const id = overrides.id || `edge-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  return {
    id,
    source: 'source-node',
    target: 'target-node',
    type: 'imports' as EdgeType,
    ...overrides
  };
}

// Helper to create test graph data
function createTestGraphData(overrides: Partial<GraphData> = {}): GraphData {
  return {
    nodes: [createTestNode({ id: 'node-1' }), createTestNode({ id: 'node-2' })],
    edges: [createTestEdge({ id: 'edge-1', source: 'node-1', target: 'node-2' })],
    generatedAt: new Date(),
    projectId: 'project-1',
    rootPath: '/test/project',
    stats: {
      totalNodes: 2,
      nodesByType: {
        directory: 0,
        file: 2,
        class: 0,
        function: 0,
        symbol: 0
      },
      edgesByType: {
        imports: 1,
        calls: 0,
        inherits: 0,
        contains: 0
      },
      filesParsed: 2,
      totalLoc: 100,
      languages: ['typescript'],
      parseDurationMs: 500
    },
    ...overrides
  };
}

// Helper to create test selected node info
function createTestSelectedNodeInfo(overrides: Partial<SelectedNodeInfo> = {}): SelectedNodeInfo {
  return {
    node: createTestNode({ id: 'selected-node' }),
    incomingEdges: [],
    outgoingEdges: [],
    children: [],
    ...overrides
  };
}

// Default state values for comparison
const DEFAULT_LOADING_STATUS: ExplorerLoadingStatus = {
  phase: 'idle',
  progress: 0,
  message: ''
};

const DEFAULT_FILTER_OPTIONS: GraphFilterOptions = {
  depthLevel: 2,
  showConnectedOnly: false
};

const DEFAULT_VIEWPORT: GraphViewport = {
  zoom: 1,
  translateX: 0,
  translateY: 0
};

describe('Explorer Store', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useExplorerStore.setState({
      graph: null,
      graphError: null,
      selectedNodeId: null,
      selectedNodeInfo: null,
      depthLevel: 2,
      isLoading: false,
      loadingStatus: DEFAULT_LOADING_STATUS,
      filterOptions: DEFAULT_FILTER_OPTIONS,
      viewport: DEFAULT_VIEWPORT
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = useExplorerStore.getState();

      expect(state.graph).toBeNull();
      expect(state.graphError).toBeNull();
      expect(state.selectedNodeId).toBeNull();
      expect(state.selectedNodeInfo).toBeNull();
      expect(state.depthLevel).toBe(2);
      expect(state.isLoading).toBe(false);
      expect(state.loadingStatus).toEqual(DEFAULT_LOADING_STATUS);
      expect(state.filterOptions).toEqual(DEFAULT_FILTER_OPTIONS);
      expect(state.viewport).toEqual(DEFAULT_VIEWPORT);
    });
  });

  describe('setGraph', () => {
    it('should set graph data', () => {
      const graph = createTestGraphData();

      useExplorerStore.getState().setGraph(graph);

      expect(useExplorerStore.getState().graph).toEqual(graph);
    });

    it('should replace existing graph data', () => {
      const graph1 = createTestGraphData({ projectId: 'project-1' });
      const graph2 = createTestGraphData({ projectId: 'project-2' });

      useExplorerStore.getState().setGraph(graph1);
      useExplorerStore.getState().setGraph(graph2);

      expect(useExplorerStore.getState().graph?.projectId).toBe('project-2');
    });

    it('should clear graph with null', () => {
      useExplorerStore.setState({ graph: createTestGraphData() });

      useExplorerStore.getState().setGraph(null);

      expect(useExplorerStore.getState().graph).toBeNull();
    });

    it('should preserve graph nodes and edges', () => {
      const nodes = [
        createTestNode({ id: 'dir-1', type: 'directory', depth: 1 }),
        createTestNode({ id: 'file-1', type: 'file', depth: 2 }),
        createTestNode({ id: 'func-1', type: 'function', depth: 4 })
      ];
      const edges = [
        createTestEdge({ id: 'e1', source: 'dir-1', target: 'file-1', type: 'contains' }),
        createTestEdge({ id: 'e2', source: 'file-1', target: 'func-1', type: 'contains' })
      ];
      const graph = createTestGraphData({ nodes, edges });

      useExplorerStore.getState().setGraph(graph);

      const storedGraph = useExplorerStore.getState().graph;
      expect(storedGraph?.nodes).toHaveLength(3);
      expect(storedGraph?.edges).toHaveLength(2);
      expect(storedGraph?.nodes.find((n) => n.id === 'func-1')?.type).toBe('function');
    });
  });

  describe('setGraphError', () => {
    it('should set error message', () => {
      useExplorerStore.getState().setGraphError('Failed to parse project');

      expect(useExplorerStore.getState().graphError).toBe('Failed to parse project');
    });

    it('should clear error with null', () => {
      useExplorerStore.setState({ graphError: 'Previous error' });

      useExplorerStore.getState().setGraphError(null);

      expect(useExplorerStore.getState().graphError).toBeNull();
    });

    it('should replace existing error', () => {
      useExplorerStore.getState().setGraphError('First error');
      useExplorerStore.getState().setGraphError('Second error');

      expect(useExplorerStore.getState().graphError).toBe('Second error');
    });
  });

  describe('setSelectedNodeId', () => {
    it('should set selected node id', () => {
      useExplorerStore.getState().setSelectedNodeId('node-123');

      expect(useExplorerStore.getState().selectedNodeId).toBe('node-123');
    });

    it('should clear selection with null', () => {
      useExplorerStore.setState({ selectedNodeId: 'node-123' });

      useExplorerStore.getState().setSelectedNodeId(null);

      expect(useExplorerStore.getState().selectedNodeId).toBeNull();
    });

    it('should replace existing selection', () => {
      useExplorerStore.getState().setSelectedNodeId('node-1');
      useExplorerStore.getState().setSelectedNodeId('node-2');

      expect(useExplorerStore.getState().selectedNodeId).toBe('node-2');
    });
  });

  describe('setSelectedNodeInfo', () => {
    it('should set selected node info', () => {
      const nodeInfo = createTestSelectedNodeInfo();

      useExplorerStore.getState().setSelectedNodeInfo(nodeInfo);

      expect(useExplorerStore.getState().selectedNodeInfo).toEqual(nodeInfo);
    });

    it('should clear node info with null', () => {
      useExplorerStore.setState({ selectedNodeInfo: createTestSelectedNodeInfo() });

      useExplorerStore.getState().setSelectedNodeInfo(null);

      expect(useExplorerStore.getState().selectedNodeInfo).toBeNull();
    });

    it('should include node relationships', () => {
      const nodeInfo = createTestSelectedNodeInfo({
        node: createTestNode({ id: 'main-func', type: 'function' }),
        incomingEdges: [createTestEdge({ source: 'caller', target: 'main-func', type: 'calls' })],
        outgoingEdges: [createTestEdge({ source: 'main-func', target: 'helper', type: 'calls' })],
        parent: createTestNode({ id: 'parent-file', type: 'file' }),
        children: [createTestNode({ id: 'inner-var', type: 'symbol' })]
      });

      useExplorerStore.getState().setSelectedNodeInfo(nodeInfo);

      const stored = useExplorerStore.getState().selectedNodeInfo;
      expect(stored?.incomingEdges).toHaveLength(1);
      expect(stored?.outgoingEdges).toHaveLength(1);
      expect(stored?.parent?.id).toBe('parent-file');
      expect(stored?.children).toHaveLength(1);
    });
  });

  describe('setDepthLevel', () => {
    it('should set depth level', () => {
      useExplorerStore.getState().setDepthLevel(3);

      expect(useExplorerStore.getState().depthLevel).toBe(3);
    });

    it('should also update filterOptions.depthLevel', () => {
      useExplorerStore.getState().setDepthLevel(4);

      expect(useExplorerStore.getState().filterOptions.depthLevel).toBe(4);
    });

    it('should handle all valid depth levels (1-5)', () => {
      const levels: DepthLevel[] = [1, 2, 3, 4, 5];

      levels.forEach((level) => {
        useExplorerStore.getState().setDepthLevel(level);

        expect(useExplorerStore.getState().depthLevel).toBe(level);
        expect(useExplorerStore.getState().filterOptions.depthLevel).toBe(level);
      });
    });

    it('should preserve other filterOptions when changing depth', () => {
      useExplorerStore.setState({
        filterOptions: {
          depthLevel: 2,
          showConnectedOnly: true,
          nodeTypes: ['file', 'function'],
          searchQuery: 'test'
        }
      });

      useExplorerStore.getState().setDepthLevel(5);

      const options = useExplorerStore.getState().filterOptions;
      expect(options.depthLevel).toBe(5);
      expect(options.showConnectedOnly).toBe(true);
      expect(options.nodeTypes).toEqual(['file', 'function']);
      expect(options.searchQuery).toBe('test');
    });
  });

  describe('setIsLoading', () => {
    it('should set loading state to true', () => {
      useExplorerStore.getState().setIsLoading(true);

      expect(useExplorerStore.getState().isLoading).toBe(true);
    });

    it('should set loading state to false', () => {
      useExplorerStore.setState({ isLoading: true });

      useExplorerStore.getState().setIsLoading(false);

      expect(useExplorerStore.getState().isLoading).toBe(false);
    });
  });

  describe('setLoadingStatus', () => {
    it('should set loading status', () => {
      const status: ExplorerLoadingStatus = {
        phase: 'parsing',
        progress: 50,
        message: 'Parsing files...',
        currentFile: '/src/index.ts',
        totalFiles: 100,
        filesParsed: 50
      };

      useExplorerStore.getState().setLoadingStatus(status);

      expect(useExplorerStore.getState().loadingStatus).toEqual(status);
    });

    it('should handle all loading phases', () => {
      const phases: ExplorerLoadingStatus['phase'][] = [
        'idle',
        'loading-cache',
        'scanning-files',
        'parsing',
        'building-graph',
        'complete',
        'error'
      ];

      phases.forEach((phase) => {
        useExplorerStore.getState().setLoadingStatus({
          phase,
          progress: 0,
          message: `Phase: ${phase}`
        });

        expect(useExplorerStore.getState().loadingStatus.phase).toBe(phase);
      });
    });

    it('should include error message in error phase', () => {
      useExplorerStore.getState().setLoadingStatus({
        phase: 'error',
        progress: 0,
        message: 'Parse failed',
        error: 'Tree-sitter initialization failed'
      });

      const status = useExplorerStore.getState().loadingStatus;
      expect(status.phase).toBe('error');
      expect(status.error).toBe('Tree-sitter initialization failed');
    });

    it('should track parsing progress', () => {
      useExplorerStore.getState().setLoadingStatus({
        phase: 'parsing',
        progress: 25,
        message: 'Parsing src/utils.ts',
        currentFile: '/src/utils.ts',
        totalFiles: 100,
        filesParsed: 25
      });

      const status = useExplorerStore.getState().loadingStatus;
      expect(status.progress).toBe(25);
      expect(status.totalFiles).toBe(100);
      expect(status.filesParsed).toBe(25);
    });
  });

  describe('setFilterOptions', () => {
    it('should set filter options', () => {
      useExplorerStore.getState().setFilterOptions({
        searchQuery: 'component',
        showConnectedOnly: true
      });

      const options = useExplorerStore.getState().filterOptions;
      expect(options.searchQuery).toBe('component');
      expect(options.showConnectedOnly).toBe(true);
    });

    it('should merge with existing filter options', () => {
      useExplorerStore.setState({
        filterOptions: {
          depthLevel: 3,
          showConnectedOnly: false,
          nodeTypes: ['file']
        }
      });

      useExplorerStore.getState().setFilterOptions({
        searchQuery: 'test'
      });

      const options = useExplorerStore.getState().filterOptions;
      expect(options.depthLevel).toBe(3);
      expect(options.showConnectedOnly).toBe(false);
      expect(options.nodeTypes).toEqual(['file']);
      expect(options.searchQuery).toBe('test');
    });

    it('should allow filtering by node types', () => {
      useExplorerStore.getState().setFilterOptions({
        nodeTypes: ['directory', 'file', 'class']
      });

      expect(useExplorerStore.getState().filterOptions.nodeTypes).toEqual([
        'directory',
        'file',
        'class'
      ]);
    });

    it('should allow filtering by edge types', () => {
      useExplorerStore.getState().setFilterOptions({
        edgeTypes: ['imports', 'calls']
      });

      expect(useExplorerStore.getState().filterOptions.edgeTypes).toEqual(['imports', 'calls']);
    });
  });

  describe('setViewport', () => {
    it('should set viewport zoom', () => {
      useExplorerStore.getState().setViewport({ zoom: 1.5 });

      expect(useExplorerStore.getState().viewport.zoom).toBe(1.5);
    });

    it('should set viewport translation', () => {
      useExplorerStore.getState().setViewport({
        translateX: 100,
        translateY: -50
      });

      expect(useExplorerStore.getState().viewport.translateX).toBe(100);
      expect(useExplorerStore.getState().viewport.translateY).toBe(-50);
    });

    it('should merge with existing viewport', () => {
      useExplorerStore.setState({
        viewport: { zoom: 2, translateX: 50, translateY: 50 }
      });

      useExplorerStore.getState().setViewport({ zoom: 1.5 });

      const viewport = useExplorerStore.getState().viewport;
      expect(viewport.zoom).toBe(1.5);
      expect(viewport.translateX).toBe(50);
      expect(viewport.translateY).toBe(50);
    });

    it('should handle all viewport properties at once', () => {
      useExplorerStore.getState().setViewport({
        zoom: 0.75,
        translateX: 200,
        translateY: -100
      });

      const viewport = useExplorerStore.getState().viewport;
      expect(viewport.zoom).toBe(0.75);
      expect(viewport.translateX).toBe(200);
      expect(viewport.translateY).toBe(-100);
    });
  });

  describe('resetViewport', () => {
    it('should reset viewport to defaults', () => {
      useExplorerStore.setState({
        viewport: { zoom: 2.5, translateX: 500, translateY: -300 }
      });

      useExplorerStore.getState().resetViewport();

      expect(useExplorerStore.getState().viewport).toEqual(DEFAULT_VIEWPORT);
    });

    it('should reset zoom to 1', () => {
      useExplorerStore.setState({ viewport: { zoom: 3, translateX: 0, translateY: 0 } });

      useExplorerStore.getState().resetViewport();

      expect(useExplorerStore.getState().viewport.zoom).toBe(1);
    });

    it('should reset translations to 0', () => {
      useExplorerStore.setState({
        viewport: { zoom: 1, translateX: 1000, translateY: -500 }
      });

      useExplorerStore.getState().resetViewport();

      expect(useExplorerStore.getState().viewport.translateX).toBe(0);
      expect(useExplorerStore.getState().viewport.translateY).toBe(0);
    });
  });

  describe('clearSelection', () => {
    it('should clear selected node id', () => {
      useExplorerStore.setState({ selectedNodeId: 'node-123' });

      useExplorerStore.getState().clearSelection();

      expect(useExplorerStore.getState().selectedNodeId).toBeNull();
    });

    it('should clear selected node info', () => {
      useExplorerStore.setState({ selectedNodeInfo: createTestSelectedNodeInfo() });

      useExplorerStore.getState().clearSelection();

      expect(useExplorerStore.getState().selectedNodeInfo).toBeNull();
    });

    it('should clear both selection properties', () => {
      useExplorerStore.setState({
        selectedNodeId: 'node-123',
        selectedNodeInfo: createTestSelectedNodeInfo()
      });

      useExplorerStore.getState().clearSelection();

      expect(useExplorerStore.getState().selectedNodeId).toBeNull();
      expect(useExplorerStore.getState().selectedNodeInfo).toBeNull();
    });

    it('should not affect other state properties', () => {
      const graph = createTestGraphData();
      useExplorerStore.setState({
        graph,
        selectedNodeId: 'node-123',
        selectedNodeInfo: createTestSelectedNodeInfo(),
        depthLevel: 4
      });

      useExplorerStore.getState().clearSelection();

      expect(useExplorerStore.getState().graph).toEqual(graph);
      expect(useExplorerStore.getState().depthLevel).toBe(4);
    });
  });

  describe('setParserStats', () => {
    it('should set parser statistics', () => {
      const stats = {
        oxcFilesCount: 42,
        treeSitterFilesCount: 8,
        totalParseTimeMs: 1500,
        lastRefreshTime: Date.now()
      };

      useExplorerStore.getState().setParserStats(stats);

      expect(useExplorerStore.getState().parserStats).toEqual(stats);
    });

    it('should replace existing parser stats', () => {
      const stats1 = {
        oxcFilesCount: 10,
        treeSitterFilesCount: 5,
        totalParseTimeMs: 1000,
        lastRefreshTime: Date.now()
      };
      const stats2 = {
        oxcFilesCount: 20,
        treeSitterFilesCount: 10,
        totalParseTimeMs: 2000,
        lastRefreshTime: Date.now()
      };

      useExplorerStore.getState().setParserStats(stats1);
      useExplorerStore.getState().setParserStats(stats2);

      expect(useExplorerStore.getState().parserStats).toEqual(stats2);
    });

    it('should handle zero values', () => {
      const stats = {
        oxcFilesCount: 0,
        treeSitterFilesCount: 0,
        totalParseTimeMs: 0,
        lastRefreshTime: null
      };

      useExplorerStore.getState().setParserStats(stats);

      expect(useExplorerStore.getState().parserStats).toEqual(stats);
    });
  });

  describe('clearParserStats', () => {
    it('should clear parser statistics', () => {
      const stats = {
        oxcFilesCount: 42,
        treeSitterFilesCount: 8,
        totalParseTimeMs: 1500,
        lastRefreshTime: Date.now()
      };
      useExplorerStore.setState({ parserStats: stats });

      useExplorerStore.getState().clearParserStats();

      expect(useExplorerStore.getState().parserStats).toBeNull();
    });

    it('should handle clearing when already null', () => {
      useExplorerStore.setState({ parserStats: null });

      useExplorerStore.getState().clearParserStats();

      expect(useExplorerStore.getState().parserStats).toBeNull();
    });
  });

  describe('clearAll', () => {
    it('should reset all state to initial values', () => {
      useExplorerStore.setState({
        graph: createTestGraphData(),
        graphError: 'Some error',
        selectedNodeId: 'node-123',
        selectedNodeInfo: createTestSelectedNodeInfo(),
        depthLevel: 5,
        isLoading: true,
        loadingStatus: {
          phase: 'parsing',
          progress: 75,
          message: 'Parsing...'
        },
        filterOptions: {
          depthLevel: 5,
          showConnectedOnly: true,
          searchQuery: 'test'
        },
        viewport: { zoom: 2, translateX: 100, translateY: -50 },
        parserStats: {
          oxcFilesCount: 42,
          treeSitterFilesCount: 8,
          totalParseTimeMs: 1500,
          lastRefreshTime: Date.now()
        }
      });

      useExplorerStore.getState().clearAll();

      const state = useExplorerStore.getState();
      expect(state.graph).toBeNull();
      expect(state.graphError).toBeNull();
      expect(state.selectedNodeId).toBeNull();
      expect(state.selectedNodeInfo).toBeNull();
      expect(state.depthLevel).toBe(2);
      expect(state.isLoading).toBe(false);
      expect(state.loadingStatus).toEqual(DEFAULT_LOADING_STATUS);
      expect(state.filterOptions).toEqual(DEFAULT_FILTER_OPTIONS);
      expect(state.viewport).toEqual(DEFAULT_VIEWPORT);
      expect(state.parserStats).toBeNull();
    });

    it('should clear graph data', () => {
      useExplorerStore.setState({ graph: createTestGraphData() });

      useExplorerStore.getState().clearAll();

      expect(useExplorerStore.getState().graph).toBeNull();
    });

    it('should clear error state', () => {
      useExplorerStore.setState({ graphError: 'Previous error' });

      useExplorerStore.getState().clearAll();

      expect(useExplorerStore.getState().graphError).toBeNull();
    });

    it('should reset depth level to 2', () => {
      useExplorerStore.setState({ depthLevel: 5 });

      useExplorerStore.getState().clearAll();

      expect(useExplorerStore.getState().depthLevel).toBe(2);
    });

    it('should clear parser stats', () => {
      useExplorerStore.setState({
        parserStats: {
          oxcFilesCount: 42,
          treeSitterFilesCount: 8,
          totalParseTimeMs: 1500,
          lastRefreshTime: Date.now()
        }
      });

      useExplorerStore.getState().clearAll();

      expect(useExplorerStore.getState().parserStats).toBeNull();
    });
  });

  describe('State Interactions', () => {
    it('should allow loading and displaying graph in sequence', () => {
      // Start loading
      useExplorerStore.getState().setIsLoading(true);
      useExplorerStore.getState().setLoadingStatus({
        phase: 'parsing',
        progress: 0,
        message: 'Starting...'
      });

      expect(useExplorerStore.getState().isLoading).toBe(true);

      // Complete loading
      const graph = createTestGraphData();
      useExplorerStore.getState().setGraph(graph);
      useExplorerStore.getState().setLoadingStatus({
        phase: 'complete',
        progress: 100,
        message: 'Done'
      });
      useExplorerStore.getState().setIsLoading(false);

      expect(useExplorerStore.getState().isLoading).toBe(false);
      expect(useExplorerStore.getState().graph).toEqual(graph);
      expect(useExplorerStore.getState().loadingStatus.phase).toBe('complete');
    });

    it('should allow selecting node from graph', () => {
      const nodes = [
        createTestNode({ id: 'file-1', name: 'index.ts', type: 'file' }),
        createTestNode({ id: 'func-1', name: 'main', type: 'function' })
      ];
      const graph = createTestGraphData({ nodes });

      useExplorerStore.getState().setGraph(graph);
      useExplorerStore.getState().setSelectedNodeId('func-1');

      expect(useExplorerStore.getState().selectedNodeId).toBe('func-1');

      // Simulate setting node info after IPC call
      const nodeInfo = createTestSelectedNodeInfo({
        node: nodes[1],
        parent: nodes[0]
      });
      useExplorerStore.getState().setSelectedNodeInfo(nodeInfo);

      expect(useExplorerStore.getState().selectedNodeInfo?.node.name).toBe('main');
      expect(useExplorerStore.getState().selectedNodeInfo?.parent?.name).toBe('index.ts');
    });

    it('should handle error state correctly', () => {
      // Start loading
      useExplorerStore.getState().setIsLoading(true);
      useExplorerStore.getState().setGraphError(null);

      // Error occurs
      useExplorerStore.getState().setGraphError('Tree-sitter failed to initialize');
      useExplorerStore.getState().setLoadingStatus({
        phase: 'error',
        progress: 0,
        message: 'Parse failed',
        error: 'Tree-sitter failed to initialize'
      });
      useExplorerStore.getState().setIsLoading(false);

      expect(useExplorerStore.getState().isLoading).toBe(false);
      expect(useExplorerStore.getState().graphError).toBe('Tree-sitter failed to initialize');
      expect(useExplorerStore.getState().loadingStatus.phase).toBe('error');
    });

    it('should maintain filter state across graph updates', () => {
      useExplorerStore.getState().setFilterOptions({
        depthLevel: 4,
        showConnectedOnly: true,
        searchQuery: 'component'
      });

      useExplorerStore.getState().setGraph(createTestGraphData());

      // Filter options should persist
      expect(useExplorerStore.getState().filterOptions.depthLevel).toBe(4);
      expect(useExplorerStore.getState().filterOptions.showConnectedOnly).toBe(true);
      expect(useExplorerStore.getState().filterOptions.searchQuery).toBe('component');
    });
  });

  describe('Graph Filtering by Depth', () => {
    it('should have consistent depth level between store and filter options', () => {
      useExplorerStore.getState().setDepthLevel(3);

      expect(useExplorerStore.getState().depthLevel).toBe(3);
      expect(useExplorerStore.getState().filterOptions.depthLevel).toBe(3);
    });

    it('should support all 5 depth levels', () => {
      // Level 1: directories only
      useExplorerStore.getState().setDepthLevel(1);
      expect(useExplorerStore.getState().depthLevel).toBe(1);

      // Level 2: directories + files
      useExplorerStore.getState().setDepthLevel(2);
      expect(useExplorerStore.getState().depthLevel).toBe(2);

      // Level 3: + classes
      useExplorerStore.getState().setDepthLevel(3);
      expect(useExplorerStore.getState().depthLevel).toBe(3);

      // Level 4: + functions
      useExplorerStore.getState().setDepthLevel(4);
      expect(useExplorerStore.getState().depthLevel).toBe(4);

      // Level 5: all symbols
      useExplorerStore.getState().setDepthLevel(5);
      expect(useExplorerStore.getState().depthLevel).toBe(5);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty graph', () => {
      const emptyGraph = createTestGraphData({ nodes: [], edges: [] });

      useExplorerStore.getState().setGraph(emptyGraph);

      expect(useExplorerStore.getState().graph?.nodes).toHaveLength(0);
      expect(useExplorerStore.getState().graph?.edges).toHaveLength(0);
    });

    it('should handle graph with no edges', () => {
      const noEdgesGraph = createTestGraphData({
        nodes: [createTestNode()],
        edges: []
      });

      useExplorerStore.getState().setGraph(noEdgesGraph);

      expect(useExplorerStore.getState().graph?.nodes).toHaveLength(1);
      expect(useExplorerStore.getState().graph?.edges).toHaveLength(0);
    });

    it('should handle selecting non-existent node', () => {
      useExplorerStore.getState().setGraph(createTestGraphData());
      useExplorerStore.getState().setSelectedNodeId('non-existent-node');

      // Store should accept the ID even if node doesn't exist
      // (validation happens at component level)
      expect(useExplorerStore.getState().selectedNodeId).toBe('non-existent-node');
    });

    it('should handle very large progress values', () => {
      useExplorerStore.getState().setLoadingStatus({
        phase: 'complete',
        progress: 100,
        message: 'Complete',
        totalFiles: 10000,
        filesParsed: 10000
      });

      expect(useExplorerStore.getState().loadingStatus.totalFiles).toBe(10000);
    });

    it('should handle negative viewport translations', () => {
      useExplorerStore.getState().setViewport({
        translateX: -1000,
        translateY: -500
      });

      expect(useExplorerStore.getState().viewport.translateX).toBe(-1000);
      expect(useExplorerStore.getState().viewport.translateY).toBe(-500);
    });

    it('should handle very small zoom values', () => {
      useExplorerStore.getState().setViewport({ zoom: 0.1 });

      expect(useExplorerStore.getState().viewport.zoom).toBe(0.1);
    });

    it('should handle very large zoom values', () => {
      useExplorerStore.getState().setViewport({ zoom: 10 });

      expect(useExplorerStore.getState().viewport.zoom).toBe(10);
    });
  });

  describe('Async Functions', () => {
    let mockElectronAPI: any;
    let loadProjectGraph: (projectId: string) => Promise<void>;
    let refreshProjectGraph: (projectId: string) => Promise<void>;

    beforeEach(async () => {
      // Set up window mock for async tests
      if (typeof window === 'undefined') {
        // @ts-expect-error - Creating global window for tests
        global.window = {};
      }

      // Create base mock API structure
      mockElectronAPI = {
        explorer: {
          getGraph: vi.fn(),
          refreshGraph: vi.fn(),
          getNodeInfo: vi.fn()
        }
      };

      // @ts-expect-error - Mocking window.electronAPI
      window.electronAPI = mockElectronAPI;

      // Reset store before each test
      useExplorerStore.setState({
        graph: null,
        graphError: null,
        selectedNodeId: null,
        selectedNodeInfo: null,
        depthLevel: 2,
        isLoading: false,
        loadingStatus: DEFAULT_LOADING_STATUS,
        filterOptions: DEFAULT_FILTER_OPTIONS,
        viewport: DEFAULT_VIEWPORT,
        parserStats: null
      });

      // Reset modules to ensure fresh imports
      vi.resetModules();

      // Import functions after mock is set up
      const module = await import('../stores/explorer-store');
      loadProjectGraph = module.loadProjectGraph;
      refreshProjectGraph = module.refreshProjectGraph;
    });

    describe('loadProjectGraph', () => {
      it('should load graph from cache successfully', async () => {
        const mockGraph = createTestGraphData({ projectId: 'test-project' });
        mockElectronAPI.explorer.getGraph.mockResolvedValue({ success: true, data: mockGraph });

        await loadProjectGraph('test-project');

        const state = useExplorerStore.getState();
        expect(state.graph).toEqual(mockGraph);
        expect(state.isLoading).toBe(false);
        expect(state.loadingStatus.phase).toBe('complete');
      });

      it('should handle no cached graph (null data)', async () => {
        mockElectronAPI.explorer.getGraph.mockResolvedValue({ success: true, data: null });

        await loadProjectGraph('test-project');

        const state = useExplorerStore.getState();
        expect(state.graph).toBeNull();
        expect(state.isLoading).toBe(false);
        expect(state.loadingStatus.phase).toBe('idle');
        expect(state.graphError).toBeNull();
      });

      it('should handle IPC error', async () => {
        mockElectronAPI.explorer.getGraph.mockResolvedValue({ success: false, error: 'Failed to load graph' });

        await loadProjectGraph('test-project');

        const state = useExplorerStore.getState();
        expect(state.graphError).toBe('Failed to load graph');
        expect(state.isLoading).toBe(false);
        expect(state.loadingStatus.phase).toBe('error');
      });

      it('should extract and store parser stats from graph', async () => {
        const mockGraph = createTestGraphData({
          projectId: 'test-project',
          stats: {
            totalNodes: 2,
            nodesByType: { directory: 0, file: 2, class: 0, function: 0, symbol: 0 },
            edgesByType: { imports: 1, calls: 0, inherits: 0, contains: 0 },
            filesParsed: 50,
            totalLoc: 1000,
            languages: ['typescript'],
            parseDurationMs: 1500,
            oxcFilesCount: 42,
            treeSitterFilesCount: 8
          }
        });
        mockElectronAPI.explorer.getGraph.mockResolvedValue({ success: true, data: mockGraph });

        await loadProjectGraph('test-project');

        const state = useExplorerStore.getState();
        expect(state.parserStats).not.toBeNull();
        expect(state.parserStats?.oxcFilesCount).toBe(42);
        expect(state.parserStats?.treeSitterFilesCount).toBe(8);
        expect(state.parserStats?.totalParseTimeMs).toBe(1500);
        expect(state.parserStats?.lastRefreshTime).not.toBeNull();
      });
    });

    describe('refreshProjectGraph', () => {
      it('should refresh graph successfully', async () => {
        const mockGraph = createTestGraphData({ projectId: 'test-project' });
        mockElectronAPI.explorer.refreshGraph.mockResolvedValue({ success: true, data: mockGraph });

        await refreshProjectGraph('test-project');

        const state = useExplorerStore.getState();
        expect(state.graph).toEqual(mockGraph);
        expect(state.isLoading).toBe(false);
        expect(state.loadingStatus.phase).toBe('complete');
        expect(mockElectronAPI.explorer.refreshGraph).toHaveBeenCalledWith('test-project');
      });

      it('should handle refresh error', async () => {
        mockElectronAPI.explorer.refreshGraph.mockResolvedValue({ success: false, error: 'Parse failed' });

        await refreshProjectGraph('test-project');

        const state = useExplorerStore.getState();
        expect(state.graphError).toBe('Parse failed');
        expect(state.isLoading).toBe(false);
        expect(state.loadingStatus.phase).toBe('error');
      });

      it('should extract and store parser stats from refreshed graph', async () => {
        const mockGraph = createTestGraphData({
          projectId: 'test-project',
          stats: {
            totalNodes: 2,
            nodesByType: { directory: 0, file: 2, class: 0, function: 0, symbol: 0 },
            edgesByType: { imports: 1, calls: 0, inherits: 0, contains: 0 },
            filesParsed: 100,
            totalLoc: 2000,
            languages: ['typescript', 'javascript'],
            parseDurationMs: 3000,
            oxcFilesCount: 85,
            treeSitterFilesCount: 15
          }
        });
        mockElectronAPI.explorer.refreshGraph.mockResolvedValue({ success: true, data: mockGraph });

        await refreshProjectGraph('test-project');

        const state = useExplorerStore.getState();
        expect(state.parserStats).not.toBeNull();
        expect(state.parserStats?.oxcFilesCount).toBe(85);
        expect(state.parserStats?.treeSitterFilesCount).toBe(15);
        expect(state.parserStats?.totalParseTimeMs).toBe(3000);
        expect(state.parserStats?.lastRefreshTime).not.toBeNull();
      });

      it('should handle refresh with null data', async () => {
        mockElectronAPI.explorer.refreshGraph.mockResolvedValue({ success: true, data: null });

        await refreshProjectGraph('test-project');

        const state = useExplorerStore.getState();
        expect(state.graphError).toBe('Failed to refresh project graph');
        expect(state.loadingStatus.phase).toBe('error');
      });
    });
  });
});
