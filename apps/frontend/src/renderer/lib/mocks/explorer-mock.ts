/**
 * Mock implementation for explorer operations (codebase visualization)
 */

import type { ExplorerAPI } from '../../../preload/api/modules/explorer-api';
import type {
  GraphData,
  ExplorerLoadingStatus,
  SelectedNodeInfo,
  ComplexityRating,
  NodeType,
  EdgeType,
  ParserLanguage
} from '../../../shared/types';

// Mock graph data for testing
const mockGraphData: GraphData = {
  nodes: [
    {
      id: 'dir-src',
      name: 'src',
      type: 'directory',
      filePath: 'src',
      depth: 1,
      metadata: {
        loc: 0
      }
    },
    {
      id: 'file-app',
      name: 'App.tsx',
      type: 'file',
      filePath: 'src/App.tsx',
      depth: 2,
      metadata: {
        loc: 150,
        complexity: 'medium' as ComplexityRating,
        exports: ['App'],
        language: 'typescript' as ParserLanguage
      }
    },
    {
      id: 'file-main',
      name: 'main.ts',
      type: 'file',
      filePath: 'src/main.ts',
      depth: 2,
      metadata: {
        loc: 50,
        complexity: 'low' as ComplexityRating,
        exports: [],
        language: 'typescript' as ParserLanguage
      }
    },
    {
      id: 'class-app',
      name: 'App',
      type: 'class',
      filePath: 'src/App.tsx',
      depth: 3,
      metadata: {
        loc: 100,
        startLine: 10,
        endLine: 110
      }
    },
    {
      id: 'func-render',
      name: 'render',
      type: 'function',
      filePath: 'src/App.tsx',
      depth: 4,
      metadata: {
        loc: 30,
        startLine: 50,
        endLine: 80,
        signature: 'render(): JSX.Element'
      }
    }
  ],
  edges: [
    {
      id: 'edge-1',
      source: 'dir-src',
      target: 'file-app',
      type: 'contains'
    },
    {
      id: 'edge-2',
      source: 'dir-src',
      target: 'file-main',
      type: 'contains'
    },
    {
      id: 'edge-3',
      source: 'file-app',
      target: 'class-app',
      type: 'contains'
    },
    {
      id: 'edge-4',
      source: 'class-app',
      target: 'func-render',
      type: 'contains'
    },
    {
      id: 'edge-5',
      source: 'file-main',
      target: 'file-app',
      type: 'imports'
    }
  ],
  projectId: 'mock-project',
  rootPath: '/mock/project',
  generatedAt: new Date(),
  stats: {
    totalNodes: 5,
    nodesByType: {
      directory: 1,
      file: 2,
      class: 1,
      function: 1,
      symbol: 0
    } as Record<NodeType, number>,
    edgesByType: {
      imports: 1,
      calls: 0,
      inherits: 0,
      contains: 4
    } as Record<EdgeType, number>,
    filesParsed: 2,
    totalLoc: 200,
    languages: ['typescript'] as ParserLanguage[],
    parseDurationMs: 100
  }
};

export const explorerMock: ExplorerAPI = {
  getGraph: async (_projectId: string) => {
    console.warn('[Browser Mock] explorer.getGraph called');
    return {
      success: true,
      data: mockGraphData
    };
  },

  parseProject: async (_projectId: string) => {
    console.warn('[Browser Mock] explorer.parseProject called');
    return {
      success: true,
      data: mockGraphData
    };
  },

  refreshGraph: async (_projectId: string) => {
    console.warn('[Browser Mock] explorer.refreshGraph called');
    return {
      success: true,
      data: mockGraphData
    };
  },

  getNodeInfo: async (_projectId: string, nodeId: string) => {
    console.warn('[Browser Mock] explorer.getNodeInfo called for:', nodeId);
    const node = mockGraphData.nodes.find(n => n.id === nodeId);
    if (!node) {
      return { success: true, data: null };
    }

    const incomingEdges = mockGraphData.edges.filter(e => e.target === nodeId);
    const outgoingEdges = mockGraphData.edges.filter(e => e.source === nodeId);

    const nodeInfo: SelectedNodeInfo = {
      node,
      incomingEdges,
      outgoingEdges,
      parent: undefined,
      children: []
    };

    return { success: true, data: nodeInfo };
  },

  onParseProgress: (callback: (projectId: string, status: ExplorerLoadingStatus) => void) => {
    console.warn('[Browser Mock] explorer.onParseProgress listener registered');
    // Simulate progress
    setTimeout(() => {
      callback('mock-project', {
        phase: 'scanning-files',
        message: 'Scanning files...',
        progress: 0.3
      });
    }, 100);
    return () => {};
  },

  onParseComplete: (callback: (projectId: string, graph: GraphData) => void) => {
    console.warn('[Browser Mock] explorer.onParseComplete listener registered');
    // Simulate completion after a delay
    setTimeout(() => {
      callback('mock-project', mockGraphData);
    }, 500);
    return () => {};
  },

  onParseError: (_callback: (projectId: string, error: string) => void) => {
    console.warn('[Browser Mock] explorer.onParseError listener registered');
    return () => {};
  }
};
