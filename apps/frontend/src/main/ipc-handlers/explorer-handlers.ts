import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import type { IPCResult, GraphData, SelectedNodeInfo } from '../../shared/types';
import { projectStore } from '../project-store';
import { explorerService, ExplorerError } from '../explorer/explorer-service';
import { parserMetrics } from '../explorer/parser-metrics';

// IPC Channel names for explorer operations
// TODO: Move to shared/constants/ipc.ts in subtask-3-5
const EXPLORER_CHANNELS = {
  GET_GRAPH: 'explorer:getGraph',
  PARSE_PROJECT: 'explorer:parseProject',
  REFRESH_GRAPH: 'explorer:refreshGraph',
  GET_NODE_INFO: 'explorer:getNodeInfo',
  GET_STATS: 'explorer:getStats',
  // Events (main -> renderer)
  PARSE_PROGRESS: 'explorer:parseProgress',
  PARSE_COMPLETE: 'explorer:parseComplete',
  PARSE_ERROR: 'explorer:parseError'
} as const;

/**
 * Enhanced explorer response with optional stats
 */
interface ExplorerResponse {
  success: boolean;
  data?: {
    graph: GraphData;
    stats?: {
      oxcFiles: number;
      treeSitterFiles: number;
      totalParseTime: number;
    };
  };
  error?: string;
  errorDetails?: {
    type: string;
    title: string;
    description: string;
    suggestions: string[];
    technicalDetails?: string;
  };
}

/**
 * Helper to convert ExplorerError to detailed error response
 */
function createErrorResponse<T = unknown>(error: unknown, context?: string): IPCResult<T> {
  const explorerError = error instanceof ExplorerError
    ? error
    : ExplorerError.fromError(error, context);

  return {
    success: false,
    error: explorerError.message,
    errorDetails: {
      type: explorerError.type,
      title: explorerError.title,
      description: explorerError.description,
      suggestions: explorerError.suggestions,
      technicalDetails: explorerError.technicalDetails
    }
  };
}

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
        return {
          success: false,
          error: `Project not found: ${projectId}`,
          errorDetails: {
            type: 'file-access',
            title: 'Project Not Found',
            description: 'The requested project does not exist in the project store.',
            suggestions: [
              'Verify the project is properly configured',
              'Try refreshing the project list',
              'Ensure the project has not been deleted'
            ]
          }
        };
      }

      try {
        const graph = await explorerService.getProjectGraph(projectId, project.path);
        return { success: true, data: graph };
      } catch (error) {
        console.error('[Explorer] Failed to get graph:', error);
        return createErrorResponse<GraphData | null>(error, project.path);
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
        return {
          success: false,
          error: `Project not found: ${projectId}`,
          errorDetails: {
            type: 'file-access',
            title: 'Project Not Found',
            description: 'The requested project does not exist in the project store.',
            suggestions: [
              'Verify the project is properly configured',
              'Try refreshing the project list',
              'Ensure the project has not been deleted'
            ]
          }
        };
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

          // Get parser statistics
          const stats = parserMetrics.getStats();

          return {
            success: true,
            data: result.graph,
            stats: {
              oxcFiles: stats.byParser.oxc.files,
              treeSitterFiles: stats.byParser.treeSitter.files,
              totalParseTime: stats.totalTimeMs
            }
          };
        } finally {
          // Clean up event listeners
          explorerService.off('status', statusHandler);
          explorerService.off('parse-complete', completeHandler);
          explorerService.off('parse-error', errorHandler);
        }
      } catch (error) {
        console.error('[Explorer] Failed to parse project:', error);
        const mainWindow = getMainWindow();

        // Forward structured error to renderer
        const errorResponse = createErrorResponse<GraphData>(error, project.path);
        if (mainWindow && errorResponse.errorDetails) {
          mainWindow.webContents.send(EXPLORER_CHANNELS.PARSE_ERROR, projectId, errorResponse.errorDetails);
        }

        return errorResponse;
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
      console.info('[Explorer] Refresh graph requested for projectId:', projectId);
      const project = projectStore.getProject(projectId);
      if (!project) {
        console.warn('[Explorer] Project not found:', projectId);
        return {
          success: false,
          error: `Project not found: ${projectId}`,
          errorDetails: {
            type: 'file-access',
            title: 'Project Not Found',
            description: 'The requested project does not exist in the project store.',
            suggestions: [
              'Verify the project is properly configured',
              'Try refreshing the project list',
              'Ensure the project has not been deleted'
            ]
          }
        };
      }
      console.info('[Explorer] Found project:', project.name, 'at path:', project.path);

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
          console.info('[Explorer] Starting graph refresh...');
          const graph = await explorerService.refreshGraph(projectId, project.path);
          console.info('[Explorer] Graph generated successfully:',
            `${graph.nodes.length} nodes, ${graph.edges.length} edges`);

          // Get parser statistics
          const stats = parserMetrics.getStats();

          return {
            success: true,
            data: graph,
            stats: {
              oxcFiles: stats.byParser.oxc.files,
              treeSitterFiles: stats.byParser.treeSitter.files,
              totalParseTime: stats.totalTimeMs
            }
          };
        } finally {
          // Clean up event listeners
          explorerService.off('status', statusHandler);
          explorerService.off('parse-complete', completeHandler);
          explorerService.off('parse-error', errorHandler);
        }
      } catch (error) {
        console.error('[Explorer] Failed to refresh graph:', error);
        const mainWindow = getMainWindow();

        // Forward structured error to renderer
        const errorResponse = createErrorResponse<GraphData>(error, project.path);
        if (mainWindow && errorResponse.errorDetails) {
          mainWindow.webContents.send(EXPLORER_CHANNELS.PARSE_ERROR, projectId, errorResponse.errorDetails);
        }

        return errorResponse;
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
        return {
          success: false,
          error: `Project not found: ${projectId}`,
          errorDetails: {
            type: 'file-access',
            title: 'Project Not Found',
            description: 'The requested project does not exist in the project store.',
            suggestions: [
              'Verify the project is properly configured',
              'Try refreshing the project list'
            ]
          }
        };
      }

      if (!nodeId) {
        return {
          success: false,
          error: 'Node ID is required',
          errorDetails: {
            type: 'unknown',
            title: 'Missing Node ID',
            description: 'A node ID must be provided to retrieve node information.',
            suggestions: ['Select a node in the graph to view its details']
          }
        };
      }

      try {
        const nodeInfo = explorerService.getNodeInfo(projectId, nodeId);

        if (!nodeInfo) {
          return {
            success: false,
            error: `Node not found: ${nodeId}`,
            errorDetails: {
              type: 'unknown',
              title: 'Node Not Found',
              description: `The node with ID "${nodeId}" does not exist in the graph.`,
              suggestions: [
                'The node may have been removed',
                'Try refreshing the graph',
                'Ensure the node ID is correct'
              ]
            }
          };
        }

        return { success: true, data: nodeInfo };
      } catch (error) {
        console.error('[Explorer] Failed to get node info:', error);
        return createErrorResponse<SelectedNodeInfo | null>(error, `node ${nodeId} in project ${project.path}`);
      }
    }
  );

  /**
   * Get parser statistics for the current session
   * Returns metrics about OXC vs Tree-sitter usage and performance
   */
  ipcMain.handle(
    EXPLORER_CHANNELS.GET_STATS,
    async (): Promise<IPCResult<{
      oxcFiles: number;
      treeSitterFiles: number;
      totalParseTime: number;
      filesPerSecond: number;
    }>> => {
      try {
        const stats = parserMetrics.getStats();

        return {
          success: true,
          data: {
            oxcFiles: stats.byParser.oxc.files,
            treeSitterFiles: stats.byParser.treeSitter.files,
            totalParseTime: stats.totalTimeMs,
            filesPerSecond: stats.filesPerSecond
          }
        };
      } catch (error) {
        console.error('[Explorer] Failed to get parser stats:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get parser statistics'
        };
      }
    }
  );
}
