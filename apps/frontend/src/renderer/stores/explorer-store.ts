import { create } from 'zustand';
import type {
  GraphData,
  DepthLevel,
  ExplorerLoadingStatus,
  GraphFilterOptions,
  GraphViewport,
  SelectedNodeInfo
} from '../../shared/types';

interface ExplorerState {
  // Graph Data
  graph: GraphData | null;
  graphError: string | null;

  // Selection
  selectedNodeId: string | null;
  selectedNodeInfo: SelectedNodeInfo | null;

  // Depth Level (1-5 granularity)
  depthLevel: DepthLevel;

  // Loading State
  isLoading: boolean;
  loadingStatus: ExplorerLoadingStatus;

  // Filter Options
  filterOptions: GraphFilterOptions;

  // Viewport State
  viewport: GraphViewport;

  // Actions
  setGraph: (graph: GraphData | null) => void;
  setGraphError: (error: string | null) => void;
  setSelectedNodeId: (nodeId: string | null) => void;
  setSelectedNodeInfo: (info: SelectedNodeInfo | null) => void;
  setDepthLevel: (level: DepthLevel) => void;
  setIsLoading: (loading: boolean) => void;
  setLoadingStatus: (status: ExplorerLoadingStatus) => void;
  setFilterOptions: (options: Partial<GraphFilterOptions>) => void;
  setViewport: (viewport: Partial<GraphViewport>) => void;
  resetViewport: () => void;
  clearSelection: () => void;
  clearAll: () => void;
}

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

export const useExplorerStore = create<ExplorerState>((set) => ({
  // Graph Data
  graph: null,
  graphError: null,

  // Selection
  selectedNodeId: null,
  selectedNodeInfo: null,

  // Depth Level (default to 2 = directories + files)
  depthLevel: 2,

  // Loading State
  isLoading: false,
  loadingStatus: DEFAULT_LOADING_STATUS,

  // Filter Options
  filterOptions: DEFAULT_FILTER_OPTIONS,

  // Viewport State
  viewport: DEFAULT_VIEWPORT,

  // Actions
  setGraph: (graph) => set({ graph }),
  setGraphError: (error) => set({ graphError: error }),
  setSelectedNodeId: (nodeId) => set({ selectedNodeId: nodeId }),
  setSelectedNodeInfo: (info) => set({ selectedNodeInfo: info }),
  setDepthLevel: (level) =>
    set((state) => ({
      depthLevel: level,
      filterOptions: { ...state.filterOptions, depthLevel: level }
    })),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setLoadingStatus: (status) => set({ loadingStatus: status }),
  setFilterOptions: (options) =>
    set((state) => ({
      filterOptions: { ...state.filterOptions, ...options }
    })),
  setViewport: (viewport) =>
    set((state) => ({
      viewport: { ...state.viewport, ...viewport }
    })),
  resetViewport: () => set({ viewport: DEFAULT_VIEWPORT }),
  clearSelection: () =>
    set({
      selectedNodeId: null,
      selectedNodeInfo: null
    }),
  clearAll: () =>
    set({
      graph: null,
      graphError: null,
      selectedNodeId: null,
      selectedNodeInfo: null,
      depthLevel: 2,
      isLoading: false,
      loadingStatus: DEFAULT_LOADING_STATUS,
      filterOptions: DEFAULT_FILTER_OPTIONS,
      viewport: DEFAULT_VIEWPORT
    })
}));

/**
 * Load project graph data
 * Attempts to load from cache first, then parses if needed
 */
export async function loadProjectGraph(projectId: string): Promise<void> {
  const store = useExplorerStore.getState();
  store.setIsLoading(true);
  store.setGraphError(null);
  store.setLoadingStatus({
    phase: 'loading-cache',
    progress: 0,
    message: 'Loading cached graph...'
  });

  try {
    const result = await window.electronAPI.explorer.getGraph(projectId);
    if (result.success) {
      // data can be null if no cached graph exists - this is not an error
      store.setGraph(result.data);
      store.setLoadingStatus({
        phase: result.data ? 'complete' : 'idle',
        progress: result.data ? 100 : 0,
        message: result.data ? 'Graph loaded' : 'No cached graph available'
      });
    } else {
      // Actual error from the IPC call
      store.setGraphError(result.error || 'Failed to load project graph');
      store.setLoadingStatus({
        phase: 'error',
        progress: 0,
        message: result.error || 'Failed to load graph',
        error: result.error
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    store.setGraphError(errorMessage);
    store.setLoadingStatus({
      phase: 'error',
      progress: 0,
      message: errorMessage,
      error: errorMessage
    });
  } finally {
    store.setIsLoading(false);
  }
}

/**
 * Refresh project graph by re-parsing all files
 */
export async function refreshProjectGraph(projectId: string): Promise<void> {
  console.warn('[Explorer Store] refreshProjectGraph called for:', projectId);
  const store = useExplorerStore.getState();
  store.setIsLoading(true);
  store.setGraphError(null);
  store.setLoadingStatus({
    phase: 'scanning-files',
    progress: 0,
    message: 'Scanning project files...'
  });

  try {
    console.warn('[Explorer Store] Calling IPC refreshGraph...');
    const result = await window.electronAPI.explorer.refreshGraph(projectId);
    console.warn('[Explorer Store] IPC result:', result.success, result.data ? `${result.data.nodes?.length} nodes` : 'no data', result.error);
    if (result.success && result.data) {
      store.setGraph(result.data);
      store.setLoadingStatus({
        phase: 'complete',
        progress: 100,
        message: 'Graph refreshed'
      });
    } else {
      store.setGraphError(result.error || 'Failed to refresh project graph');
      store.setLoadingStatus({
        phase: 'error',
        progress: 0,
        message: result.error || 'Failed to refresh graph',
        error: result.error
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    store.setGraphError(errorMessage);
    store.setLoadingStatus({
      phase: 'error',
      progress: 0,
      message: errorMessage,
      error: errorMessage
    });
  } finally {
    store.setIsLoading(false);
  }
}

/**
 * Get information about a selected node including relationships
 */
export async function getNodeInfo(
  projectId: string,
  nodeId: string
): Promise<void> {
  const store = useExplorerStore.getState();
  store.setSelectedNodeId(nodeId);

  try {
    const result = await window.electronAPI.explorer.getNodeInfo(projectId, nodeId);
    if (result.success && result.data) {
      store.setSelectedNodeInfo(result.data);
    } else {
      store.setSelectedNodeInfo(null);
    }
  } catch (_error) {
    store.setSelectedNodeInfo(null);
  }
}
