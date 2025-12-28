import type {
  GraphData,
  SelectedNodeInfo,
  ExplorerLoadingStatus,
  IPCResult
} from '../../../shared/types';
import { createIpcListener, invokeIpc, IpcListenerCleanup } from './ipc-utils';

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
 * Explorer API operations for codebase visualization
 */
export interface ExplorerAPI {
  // Operations
  getGraph: (projectId: string) => Promise<IPCResult<GraphData | null>>;
  parseProject: (projectId: string) => Promise<IPCResult<GraphData>>;
  refreshGraph: (projectId: string) => Promise<IPCResult<GraphData>>;
  getNodeInfo: (projectId: string, nodeId: string) => Promise<IPCResult<SelectedNodeInfo | null>>;

  // Event Listeners
  onParseProgress: (
    callback: (projectId: string, status: ExplorerLoadingStatus) => void
  ) => IpcListenerCleanup;
  onParseComplete: (
    callback: (projectId: string, graph: GraphData) => void
  ) => IpcListenerCleanup;
  onParseError: (
    callback: (projectId: string, error: string) => void
  ) => IpcListenerCleanup;
}

/**
 * Creates the Explorer API implementation
 */
export const createExplorerAPI = (): ExplorerAPI => ({
  // Operations
  getGraph: (projectId: string): Promise<IPCResult<GraphData | null>> =>
    invokeIpc(EXPLORER_CHANNELS.GET_GRAPH, projectId),

  parseProject: (projectId: string): Promise<IPCResult<GraphData>> =>
    invokeIpc(EXPLORER_CHANNELS.PARSE_PROJECT, projectId),

  refreshGraph: (projectId: string): Promise<IPCResult<GraphData>> =>
    invokeIpc(EXPLORER_CHANNELS.REFRESH_GRAPH, projectId),

  getNodeInfo: (projectId: string, nodeId: string): Promise<IPCResult<SelectedNodeInfo | null>> =>
    invokeIpc(EXPLORER_CHANNELS.GET_NODE_INFO, projectId, nodeId),

  // Event Listeners
  onParseProgress: (
    callback: (projectId: string, status: ExplorerLoadingStatus) => void
  ): IpcListenerCleanup =>
    createIpcListener(EXPLORER_CHANNELS.PARSE_PROGRESS, callback),

  onParseComplete: (
    callback: (projectId: string, graph: GraphData) => void
  ): IpcListenerCleanup =>
    createIpcListener(EXPLORER_CHANNELS.PARSE_COMPLETE, callback),

  onParseError: (
    callback: (projectId: string, error: string) => void
  ): IpcListenerCleanup =>
    createIpcListener(EXPLORER_CHANNELS.PARSE_ERROR, callback)
});
