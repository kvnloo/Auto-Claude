import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import type { IPCResult, GraphData, SelectedNodeInfo } from '../../shared/types';
import { projectStore } from '../project-store';

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
        // TODO: Wire up to explorerService.getGraph() in phase 4
        // For now, return null to indicate no cached graph
        // The frontend will show the empty state prompting user to parse
        return { success: true, data: null };
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
        // Emit progress updates to renderer
        const mainWindow = getMainWindow();

        // TODO: Wire up to explorerService.parseProject() in phase 4
        // The service will emit progress events during parsing
        if (mainWindow) {
          mainWindow.webContents.send(EXPLORER_CHANNELS.PARSE_PROGRESS, projectId, {
            phase: 'scanning-files',
            progress: 0,
            message: 'Scanning project files...'
          });
        }

        // Placeholder: Return error until explorer service is implemented
        return {
          success: false,
          error: 'Explorer parsing not yet implemented. Tree-sitter service will be added in phase 4.'
        };
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
      const project = projectStore.getProject(projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      try {
        const mainWindow = getMainWindow();

        // TODO: Wire up to explorerService.refreshGraph() in phase 4
        // This will invalidate cache and re-parse all files
        if (mainWindow) {
          mainWindow.webContents.send(EXPLORER_CHANNELS.PARSE_PROGRESS, projectId, {
            phase: 'scanning-files',
            progress: 0,
            message: 'Re-scanning project files...'
          });
        }

        // Placeholder: Return error until explorer service is implemented
        return {
          success: false,
          error: 'Explorer refresh not yet implemented. Tree-sitter service will be added in phase 4.'
        };
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
        // TODO: Wire up to explorerService.getNodeInfo() in phase 4
        // This will look up the node in the cached graph and compute relationships
        return { success: true, data: null };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get node info'
        };
      }
    }
  );
}
