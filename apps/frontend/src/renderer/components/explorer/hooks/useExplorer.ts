import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  useExplorerStore,
  loadProjectGraph,
  refreshProjectGraph,
  getNodeInfo
} from '../../../stores/explorer-store';
import type {
  GraphNode,
  GraphEdge,
  DepthLevel,
  ExplorerLoadingStatus,
  GraphData,
  NodeType,
  EdgeType
} from '../../../../shared/types';

interface UseExplorerOptions {
  /** Callback when a node is clicked for navigation (e.g., open file) */
  onNavigateToFile?: (filePath: string, line?: number) => void;
  /** Automatically load graph on mount */
  autoLoad?: boolean;
}

/**
 * Set up IPC listeners for explorer events
 */
function setupExplorerListeners(projectId: string): () => void {
  const store = useExplorerStore.getState();

  // Listen for parse progress updates
  const unsubProgress = window.electronAPI.explorer.onParseProgress(
    (eventProjectId: string, status: ExplorerLoadingStatus) => {
      if (eventProjectId === projectId) {
        store.setLoadingStatus(status);
        if (status.phase === 'parsing' || status.phase === 'building-graph') {
          store.setIsLoading(true);
        }
      }
    }
  );

  // Listen for parse completion
  const unsubComplete = window.electronAPI.explorer.onParseComplete(
    (eventProjectId: string, graph: GraphData) => {
      if (eventProjectId === projectId) {
        store.setGraph(graph);
        store.setIsLoading(false);
        store.setLoadingStatus({
          phase: 'complete',
          progress: 100,
          message: 'Graph loaded successfully'
        });
      }
    }
  );

  // Listen for parse errors
  const unsubError = window.electronAPI.explorer.onParseError(
    (eventProjectId: string, error: string) => {
      if (eventProjectId === projectId) {
        store.setGraphError(error);
        store.setIsLoading(false);
        store.setLoadingStatus({
          phase: 'error',
          progress: 0,
          message: error,
          error
        });
      }
    }
  );

  // Return cleanup function
  return () => {
    unsubProgress();
    unsubComplete();
    unsubError();
  };
}

/**
 * Filter nodes based on current depth level
 */
function filterNodesByDepth(nodes: GraphNode[], depthLevel: DepthLevel): GraphNode[] {
  return nodes.filter((node) => node.depth <= depthLevel);
}

/**
 * Filter edges to only include those between visible nodes
 */
function filterEdgesByNodes(edges: GraphEdge[], visibleNodeIds: Set<string>): GraphEdge[] {
  return edges.filter((edge) => {
    const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
    return visibleNodeIds.has(sourceId) && visibleNodeIds.has(targetId);
  });
}

/**
 * Hook to manage codebase explorer state and actions
 * Orchestrates the explorer store, IPC calls, and component logic
 */
export function useExplorer(projectId: string, options: UseExplorerOptions = {}) {
  const { onNavigateToFile, autoLoad = true } = options;

  // Store state
  const graph = useExplorerStore((state) => state.graph);
  const graphError = useExplorerStore((state) => state.graphError);
  const selectedNodeId = useExplorerStore((state) => state.selectedNodeId);
  const selectedNodeInfo = useExplorerStore((state) => state.selectedNodeInfo);
  const depthLevel = useExplorerStore((state) => state.depthLevel);
  const isLoading = useExplorerStore((state) => state.isLoading);
  const loadingStatus = useExplorerStore((state) => state.loadingStatus);
  const filterOptions = useExplorerStore((state) => state.filterOptions);
  const viewport = useExplorerStore((state) => state.viewport);

  // Store actions
  const setDepthLevel = useExplorerStore((state) => state.setDepthLevel);
  const setSelectedNodeId = useExplorerStore((state) => state.setSelectedNodeId);
  const setSelectedNodeInfo = useExplorerStore((state) => state.setSelectedNodeInfo);
  const setFilterOptions = useExplorerStore((state) => state.setFilterOptions);
  const setViewport = useExplorerStore((state) => state.setViewport);
  const resetViewport = useExplorerStore((state) => state.resetViewport);
  const clearSelection = useExplorerStore((state) => state.clearSelection);
  const clearAll = useExplorerStore((state) => state.clearAll);

  // Local UI state
  const [isInfoPanelOpen, setIsInfoPanelOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showLegend, setShowLegend] = useState(true);

  // Set up IPC listeners and load graph on mount
  useEffect(() => {
    const cleanup = setupExplorerListeners(projectId);

    if (autoLoad) {
      loadProjectGraph(projectId);
    }

    return () => {
      cleanup();
      // Clear state when unmounting or project changes
      clearAll();
    };
  }, [projectId, autoLoad, clearAll]);

  // Filter nodes and edges based on depth level
  const filteredData = useMemo(() => {
    if (!graph) {
      return { nodes: [], edges: [] };
    }

    let nodes = filterNodesByDepth(graph.nodes, depthLevel);

    // Apply search filter if query exists
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      nodes = nodes.filter(
        (node) =>
          node.name.toLowerCase().includes(query) ||
          node.filePath.toLowerCase().includes(query)
      );
    }

    // Apply node type filter if specified
    if (filterOptions.nodeTypes && filterOptions.nodeTypes.length > 0) {
      nodes = nodes.filter((node) => filterOptions.nodeTypes!.includes(node.type));
    }

    const visibleNodeIds = new Set(nodes.map((n) => n.id));
    let edges = filterEdgesByNodes(graph.edges, visibleNodeIds);

    // Apply edge type filter if specified
    if (filterOptions.edgeTypes && filterOptions.edgeTypes.length > 0) {
      edges = edges.filter((edge) => filterOptions.edgeTypes!.includes(edge.type));
    }

    return { nodes, edges };
  }, [graph, depthLevel, searchQuery, filterOptions]);

  // Handle loading graph
  const loadGraph = useCallback(async () => {
    await loadProjectGraph(projectId);
  }, [projectId]);

  // Handle refreshing graph (force re-parse)
  const refreshGraph = useCallback(async () => {
    await refreshProjectGraph(projectId);
  }, [projectId]);

  // Handle node selection
  const selectNode = useCallback(
    async (nodeId: string | null) => {
      if (nodeId === null) {
        clearSelection();
        setIsInfoPanelOpen(false);
        return;
      }

      setSelectedNodeId(nodeId);
      setIsInfoPanelOpen(true);

      // Fetch detailed node info from backend
      await getNodeInfo(projectId, nodeId);
    },
    [projectId, clearSelection, setSelectedNodeId]
  );

  // Handle navigating to file from info panel
  const handleNavigateToFile = useCallback(
    (node: GraphNode) => {
      if (onNavigateToFile) {
        onNavigateToFile(node.filePath, node.metadata.startLine);
      }
    },
    [onNavigateToFile]
  );

  // Handle clicking a node in the graph
  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      if (selectedNodeId === node.id) {
        // Toggle off if already selected
        selectNode(null);
      } else {
        selectNode(node.id);
      }
    },
    [selectedNodeId, selectNode]
  );

  // Handle clicking an edge target to navigate to that node
  const handleEdgeClick = useCallback(
    (nodeId: string) => {
      selectNode(nodeId);
    },
    [selectNode]
  );

  // Handle depth level change
  const handleDepthChange = useCallback(
    (level: DepthLevel) => {
      setDepthLevel(level);
    },
    [setDepthLevel]
  );

  // Close info panel
  const closeInfoPanel = useCallback(() => {
    clearSelection();
    setIsInfoPanelOpen(false);
  }, [clearSelection]);

  // Toggle legend visibility
  const toggleLegend = useCallback(() => {
    setShowLegend((prev) => !prev);
  }, []);

  // Filter by node type
  const filterByNodeType = useCallback(
    (types: NodeType[]) => {
      setFilterOptions({ nodeTypes: types.length > 0 ? types : undefined });
    },
    [setFilterOptions]
  );

  // Filter by edge type
  const filterByEdgeType = useCallback(
    (types: EdgeType[]) => {
      setFilterOptions({ edgeTypes: types.length > 0 ? types : undefined });
    },
    [setFilterOptions]
  );

  // Toggle showing only connected nodes
  const toggleShowConnectedOnly = useCallback(() => {
    setFilterOptions({ showConnectedOnly: !filterOptions.showConnectedOnly });
  }, [filterOptions.showConnectedOnly, setFilterOptions]);

  // Get statistics for display
  const graphStats = useMemo(() => {
    if (!graph) return null;
    return {
      totalNodes: graph.stats.totalNodes,
      totalEdges: graph.edges.length,
      visibleNodes: filteredData.nodes.length,
      visibleEdges: filteredData.edges.length,
      filesParsed: graph.stats.filesParsed,
      totalLoc: graph.stats.totalLoc,
      languages: graph.stats.languages,
      parseErrors: graph.parseErrors?.length ?? 0
    };
  }, [graph, filteredData]);

  // Check if graph has data
  const hasGraph = graph !== null && graph.nodes.length > 0;

  // Check if graph is empty after filtering
  const isFilteredEmpty = hasGraph && filteredData.nodes.length === 0;

  return {
    // Graph data
    graph,
    graphError,
    filteredNodes: filteredData.nodes,
    filteredEdges: filteredData.edges,
    graphStats,
    hasGraph,
    isFilteredEmpty,

    // Selection state
    selectedNodeId,
    selectedNodeInfo,
    isInfoPanelOpen,

    // Depth and filtering
    depthLevel,
    filterOptions,
    searchQuery,

    // Loading state
    isLoading,
    loadingStatus,

    // Viewport state
    viewport,

    // UI state
    showLegend,

    // Actions
    loadGraph,
    refreshGraph,
    selectNode,
    handleNodeClick,
    handleEdgeClick,
    handleNavigateToFile,
    handleDepthChange,
    closeInfoPanel,
    toggleLegend,
    setSearchQuery,
    filterByNodeType,
    filterByEdgeType,
    toggleShowConnectedOnly,

    // Viewport actions
    setViewport,
    resetViewport,

    // Cleanup
    clearAll
  };
}
