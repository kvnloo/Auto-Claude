import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import type { IPCResult, GraphData, SelectedNodeInfo } from '../../shared/types';
import { projectStore } from '../project-store';
import { explorerService } from '../explorer/explorer-service';

// IPC Channel names for explorer operations
// TODO: Move to shared/constants/ipc.ts in subtask-3-5
const EXPLORER_CHANNELS = {
  GET_GRAPH: 'explorer:getGraph',
  PARSE_PROJECT: 'explorer:parseProject',
  REFRESH_GRAPH: 'explorer:refreshGraph',
  GET_NODE_INFO: 'explorer:getNodeInfo',
  // Events (main -> renderer)
  PARSE_PROGRESS: 'explorer:parseProgress',
  PARSE_COMPLETE: 'explorer:parseComplete',
  PARSE_ERROR: 'explorer:parseError'
} as const;

/**
 * Register all explorer-related IPC handlers
 * Handles codebase visualization operations including parsing and graph building
 */
export function registerExplorerHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  // ============================================
  // Explorer Graph Operations
  // ============================================

  /**
   * Get the cached graph for a project
   * Returns the existing graph from cache if available
   */
  ipcMain.handle(
    EXPLORER_CHANNELS.GET_GRAPH,
    async (_, projectId: string): Promise<IPCResult<GraphData | null>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        const graph = await explorerService.getProjectGraph(projectId, project.path);
        return { success: true, data: graph };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get graph'
        };
      }
    }
  );

  /**
   * Parse project and build a new graph
   * This triggers full project parsing with Tree-sitter
   */
  ipcMain.handle(
    EXPLORER_CHANNELS.PARSE_PROJECT,
    async (_, projectId: string): Promise<IPCResult<GraphData>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        const mainWindow = getMainWindow();

        // Set up event listeners to forward status updates to renderer
        const statusHandler = (eventProjectId: string, status: unknown) => {
          if (eventProjectId === projectId && mainWindow) {
            mainWindow.webContents.send(EXPLORER_CHANNELS.PARSE_PROGRESS, projectId, status);
          }
        };

        const completeHandler = (eventProjectId: string, graph: GraphData) => {
          if (eventProjectId === projectId && mainWindow) {
            mainWindow.webContents.send(EXPLORER_CHANNELS.PARSE_COMPLETE, projectId, graph);
          }
        };

        const errorHandler = (eventProjectId: string, error: unknown) => {
          if (eventProjectId === projectId && mainWindow) {
            mainWindow.webContents.send(EXPLORER_CHANNELS.PARSE_ERROR, projectId, error);
          }
        };

        explorerService.on('status', statusHandler);
        explorerService.on('parse-complete', completeHandler);
        explorerService.on('parse-error', errorHandler);

        try {
          const result = await explorerService.parseProject(projectId, project.path);
          return { success: true, data: result.graph };
        } finally {
          // Clean up event listeners
          explorerService.off('status', statusHandler);
          explorerService.off('parse-complete', completeHandler);
          explorerService.off('parse-error', errorHandler);
        }
      } catch (error) {
        const mainWindow = getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send(EXPLORER_CHANNELS.PARSE_ERROR, projectId,
            error instanceof Error ? error.message : 'Unknown error');
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to parse project'
        };
      }
    }
  );

  /**
   * Refresh the graph by re-parsing all project files
   * Forces a full re-parse even if cached graph exists
   */
  ipcMain.handle(
    EXPLORER_CHANNELS.REFRESH_GRAPH,
    async (_, projectId: string): Promise<IPCResult<GraphData>> => {
      console.warn('[Explorer] refreshGraph called for projectId:', projectId);
      const project = projectStore.getProject(projectId);
      if (!project) {
        console.warn('[Explorer] Project not found:', projectId);
        return { success: false, error: 'Project not found' };
      }
      console.warn('[Explorer] Found project:', project.name, 'path:', project.path);

      try {
        const mainWindow = getMainWindow();

        // Set up event listeners to forward status updates to renderer
        const statusHandler = (eventProjectId: string, status: unknown) => {
          if (eventProjectId === projectId && mainWindow) {
            mainWindow.webContents.send(EXPLORER_CHANNELS.PARSE_PROGRESS, projectId, status);
          }
        };

        const completeHandler = (eventProjectId: string, graph: GraphData) => {
          if (eventProjectId === projectId && mainWindow) {
            mainWindow.webContents.send(EXPLORER_CHANNELS.PARSE_COMPLETE, projectId, graph);
          }
        };

        const errorHandler = (eventProjectId: string, error: unknown) => {
          if (eventProjectId === projectId && mainWindow) {
            mainWindow.webContents.send(EXPLORER_CHANNELS.PARSE_ERROR, projectId, error);
          }
        };

        explorerService.on('status', statusHandler);
        explorerService.on('parse-complete', completeHandler);
        explorerService.on('parse-error', errorHandler);

        try {
          console.warn('[Explorer] Starting refreshGraph...');
          const graph = await explorerService.refreshGraph(projectId, project.path);
          console.warn('[Explorer] Graph generated:', graph ? `${graph.nodes.length} nodes, ${graph.edges.length} edges` : 'null');
          return { success: true, data: graph };
        } finally {
          // Clean up event listeners
          explorerService.off('status', statusHandler);
          explorerService.off('parse-complete', completeHandler);
          explorerService.off('parse-error', errorHandler);
        }
      } catch (error) {
        const mainWindow = getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send(EXPLORER_CHANNELS.PARSE_ERROR, projectId,
            error instanceof Error ? error.message : 'Unknown error');
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to refresh graph'
        };
      }
    }
  );

  /**
   * Get detailed information about a specific node
   * Includes relationships (incoming/outgoing edges), parent, children
   */
  ipcMain.handle(
    EXPLORER_CHANNELS.GET_NODE_INFO,
    async (_, projectId: string, nodeId: string): Promise<IPCResult<SelectedNodeInfo | null>> => {
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      if (!nodeId) {
        return { success: false, error: 'Node ID is required' };
      }

      try {
        const nodeInfo = explorerService.getNodeInfo(projectId, nodeId);
        return { success: true, data: nodeInfo };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get node info'
        };
      }
    }
  );
}
