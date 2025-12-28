/**
 * Unit tests for Node Selection and Info Panel functionality
 * Tests that clicking a node correctly selects it and displays info panel
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  GraphNode,
  GraphEdge,
  DepthLevel,
  NodeType,
  SelectedNodeInfo,
  ComplexityRating,
  ParserLanguage
} from '../../shared/types';

// ============================================
// Test Data Setup
// ============================================

// Helper to create test graph nodes
function createTestNode(overrides: Partial<GraphNode>): GraphNode {
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

// Create comprehensive test data with rich metadata for info panel testing
const testNodes: GraphNode[] = [
  // File node with full metadata
  createTestNode({
    id: 'file-app',
    name: 'App.tsx',
    type: 'file',
    depth: 2,
    filePath: 'src/App.tsx',
    metadata: {
      loc: 150,
      complexity: 'medium' as ComplexityRating,
      exports: ['App', 'AppProvider'],
      language: 'typescript' as ParserLanguage
    }
  }),
  // Class node with docstring
  createTestNode({
    id: 'class-user',
    name: 'User',
    type: 'class',
    depth: 3,
    filePath: 'src/models/User.ts',
    metadata: {
      loc: 80,
      complexity: 'low' as ComplexityRating,
      docstring: 'Represents a user in the system with authentication and profile management.',
      startLine: 10,
      endLine: 90,
      exports: ['User']
    }
  }),
  // Function node with signature and parameters
  createTestNode({
    id: 'func-authenticate',
    name: 'authenticate',
    type: 'function',
    depth: 4,
    filePath: 'src/auth/auth.ts',
    metadata: {
      loc: 25,
      complexity: 'high' as ComplexityRating,
      signature: 'async function authenticate(username: string, password: string): Promise<User>',
      parameters: ['username: string', 'password: string'],
      returnType: 'Promise<User>',
      docstring: 'Authenticates a user with username and password.',
      startLine: 15,
      endLine: 40
    }
  }),
  // Symbol node
  createTestNode({
    id: 'symbol-config',
    name: 'CONFIG',
    type: 'symbol',
    depth: 5,
    filePath: 'src/config.ts',
    metadata: {
      loc: 10,
      docstring: 'Application configuration constants',
      startLine: 1,
      endLine: 10
    }
  }),
  // Directory node
  createTestNode({
    id: 'dir-src',
    name: 'src',
    type: 'directory',
    depth: 1,
    filePath: 'src',
    metadata: {
      loc: 0
    }
  }),
  // Additional nodes for relationship testing
  createTestNode({
    id: 'file-utils',
    name: 'utils.ts',
    type: 'file',
    depth: 2,
    filePath: 'src/utils.ts',
    metadata: {
      loc: 50,
      exports: ['formatDate', 'parseJSON']
    }
  }),
  createTestNode({
    id: 'func-log',
    name: 'log',
    type: 'function',
    depth: 4,
    filePath: 'src/utils.ts',
    metadata: {
      loc: 8,
      signature: 'function log(message: string): void',
      parameters: ['message: string'],
      returnType: 'void'
    }
  })
];

const testEdges: GraphEdge[] = [
  // Contains relationships
  { id: 'e1', source: 'dir-src', target: 'file-app', type: 'contains' },
  { id: 'e2', source: 'dir-src', target: 'file-utils', type: 'contains' },
  { id: 'e3', source: 'file-app', target: 'class-user', type: 'contains' },
  { id: 'e4', source: 'file-utils', target: 'func-log', type: 'contains' },
  // Import relationships
  { id: 'e5', source: 'file-app', target: 'file-utils', type: 'imports' },
  { id: 'e6', source: 'file-app', target: 'symbol-config', type: 'imports' },
  // Call relationships
  { id: 'e7', source: 'func-authenticate', target: 'func-log', type: 'calls' },
  { id: 'e8', source: 'class-user', target: 'func-authenticate', type: 'calls' },
  // Inheritance
  { id: 'e9', source: 'class-user', target: 'file-app', type: 'inherits' }
];

// ============================================
// Helper Functions (mirroring useExplorer logic)
// ============================================

/**
 * Get node information including relationships
 * This mirrors the logic used to populate SelectedNodeInfo
 */
function getNodeInfo(
  nodes: GraphNode[],
  edges: GraphEdge[],
  nodeId: string
): SelectedNodeInfo | null {
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return null;

  // Get incoming edges (edges where this node is the target)
  const incomingEdges = edges.filter(e => {
    const targetId = typeof e.target === 'string' ? e.target : e.target.id;
    return targetId === nodeId;
  });

  // Get outgoing edges (edges where this node is the source)
  const outgoingEdges = edges.filter(e => {
    const sourceId = typeof e.source === 'string' ? e.source : e.source.id;
    return sourceId === nodeId;
  });

  // Find parent (node that contains this node)
  const parentEdge = incomingEdges.find(e => e.type === 'contains');
  let parent: GraphNode | undefined;
  if (parentEdge) {
    const parentId = typeof parentEdge.source === 'string' ? parentEdge.source : parentEdge.source.id;
    parent = nodes.find(n => n.id === parentId);
  }

  // Find children (nodes that this node contains)
  const childEdges = outgoingEdges.filter(e => e.type === 'contains');
  const children = childEdges
    .map(e => {
      const childId = typeof e.target === 'string' ? e.target : e.target.id;
      return nodes.find(n => n.id === childId);
    })
    .filter((n): n is GraphNode => n !== undefined);

  return {
    node,
    incomingEdges,
    outgoingEdges,
    parent,
    children
  };
}

/**
 * Simulate node selection logic
 */
function createNodeSelectionHandler() {
  let selectedNodeId: string | null = null;
  let isInfoPanelOpen = false;
  let selectedNodeInfo: SelectedNodeInfo | null = null;

  return {
    getState: () => ({
      selectedNodeId,
      isInfoPanelOpen,
      selectedNodeInfo
    }),

    selectNode: (nodeId: string | null, nodes: GraphNode[], edges: GraphEdge[]) => {
      if (nodeId === null) {
        selectedNodeId = null;
        isInfoPanelOpen = false;
        selectedNodeInfo = null;
      } else {
        selectedNodeId = nodeId;
        isInfoPanelOpen = true;
        selectedNodeInfo = getNodeInfo(nodes, edges, nodeId);
      }
    },

    handleNodeClick: (node: GraphNode, nodes: GraphNode[], edges: GraphEdge[]) => {
      if (selectedNodeId === node.id) {
        // Toggle off if already selected
        selectedNodeId = null;
        isInfoPanelOpen = false;
        selectedNodeInfo = null;
      } else {
        selectedNodeId = node.id;
        isInfoPanelOpen = true;
        selectedNodeInfo = getNodeInfo(nodes, edges, node.id);
      }
    },

    closeInfoPanel: () => {
      selectedNodeId = null;
      isInfoPanelOpen = false;
      selectedNodeInfo = null;
    }
  };
}

// ============================================
// Tests
// ============================================

describe('Node Selection and Info Panel', () => {
  describe('Node Selection', () => {
    it('should select a node when clicked', () => {
      const handler = createNodeSelectionHandler();
      const node = testNodes.find(n => n.id === 'file-app')!;

      handler.handleNodeClick(node, testNodes, testEdges);

      const state = handler.getState();
      expect(state.selectedNodeId).toBe('file-app');
      expect(state.isInfoPanelOpen).toBe(true);
    });

    it('should toggle off selection when clicking the same node', () => {
      const handler = createNodeSelectionHandler();
      const node = testNodes.find(n => n.id === 'file-app')!;

      // First click - select
      handler.handleNodeClick(node, testNodes, testEdges);
      expect(handler.getState().selectedNodeId).toBe('file-app');

      // Second click - deselect
      handler.handleNodeClick(node, testNodes, testEdges);
      expect(handler.getState().selectedNodeId).toBeNull();
      expect(handler.getState().isInfoPanelOpen).toBe(false);
    });

    it('should switch selection when clicking a different node', () => {
      const handler = createNodeSelectionHandler();
      const node1 = testNodes.find(n => n.id === 'file-app')!;
      const node2 = testNodes.find(n => n.id === 'class-user')!;

      // Select first node
      handler.handleNodeClick(node1, testNodes, testEdges);
      expect(handler.getState().selectedNodeId).toBe('file-app');

      // Select second node
      handler.handleNodeClick(node2, testNodes, testEdges);
      expect(handler.getState().selectedNodeId).toBe('class-user');
    });

    it('should select a node using selectNode function', () => {
      const handler = createNodeSelectionHandler();

      handler.selectNode('func-authenticate', testNodes, testEdges);

      const state = handler.getState();
      expect(state.selectedNodeId).toBe('func-authenticate');
      expect(state.isInfoPanelOpen).toBe(true);
    });

    it('should clear selection when passing null to selectNode', () => {
      const handler = createNodeSelectionHandler();

      // First select a node
      handler.selectNode('file-app', testNodes, testEdges);
      expect(handler.getState().selectedNodeId).toBe('file-app');

      // Then clear selection
      handler.selectNode(null, testNodes, testEdges);
      expect(handler.getState().selectedNodeId).toBeNull();
      expect(handler.getState().isInfoPanelOpen).toBe(false);
    });
  });

  describe('Info Panel Opening', () => {
    it('should open info panel when node is selected', () => {
      const handler = createNodeSelectionHandler();
      const node = testNodes.find(n => n.id === 'class-user')!;

      // Initially closed
      expect(handler.getState().isInfoPanelOpen).toBe(false);

      // Select node
      handler.handleNodeClick(node, testNodes, testEdges);

      // Panel should be open
      expect(handler.getState().isInfoPanelOpen).toBe(true);
    });

    it('should close info panel when selection is cleared', () => {
      const handler = createNodeSelectionHandler();
      const node = testNodes.find(n => n.id === 'class-user')!;

      // Select node
      handler.handleNodeClick(node, testNodes, testEdges);
      expect(handler.getState().isInfoPanelOpen).toBe(true);

      // Clear selection
      handler.selectNode(null, testNodes, testEdges);
      expect(handler.getState().isInfoPanelOpen).toBe(false);
    });

    it('should close info panel using closeInfoPanel function', () => {
      const handler = createNodeSelectionHandler();
      const node = testNodes.find(n => n.id === 'file-app')!;

      // Select node and open panel
      handler.handleNodeClick(node, testNodes, testEdges);
      expect(handler.getState().isInfoPanelOpen).toBe(true);

      // Close panel
      handler.closeInfoPanel();
      expect(handler.getState().isInfoPanelOpen).toBe(false);
      expect(handler.getState().selectedNodeId).toBeNull();
    });
  });

  describe('Info Panel Content - LOC', () => {
    it('should display LOC for a file node', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'file-app');

      expect(nodeInfo).not.toBeNull();
      expect(nodeInfo!.node.metadata.loc).toBe(150);
    });

    it('should display LOC for a function node', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'func-authenticate');

      expect(nodeInfo).not.toBeNull();
      expect(nodeInfo!.node.metadata.loc).toBe(25);
    });

    it('should display LOC for a class node', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'class-user');

      expect(nodeInfo).not.toBeNull();
      expect(nodeInfo!.node.metadata.loc).toBe(80);
    });
  });

  describe('Info Panel Content - Relationships', () => {
    it('should show incoming edges (used by)', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'file-utils');

      expect(nodeInfo).not.toBeNull();
      // file-utils is imported by file-app and contained by dir-src
      expect(nodeInfo!.incomingEdges.length).toBeGreaterThan(0);

      const importEdge = nodeInfo!.incomingEdges.find(e => e.type === 'imports');
      expect(importEdge).toBeDefined();
      expect(importEdge!.source).toBe('file-app');
    });

    it('should show outgoing edges (uses)', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'file-app');

      expect(nodeInfo).not.toBeNull();
      // file-app imports file-utils and symbol-config
      const importEdges = nodeInfo!.outgoingEdges.filter(e => e.type === 'imports');
      expect(importEdges).toHaveLength(2);
    });

    it('should identify parent node correctly', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'file-app');

      expect(nodeInfo).not.toBeNull();
      expect(nodeInfo!.parent).toBeDefined();
      expect(nodeInfo!.parent!.id).toBe('dir-src');
      expect(nodeInfo!.parent!.type).toBe('directory');
    });

    it('should identify children nodes correctly', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'dir-src');

      expect(nodeInfo).not.toBeNull();
      // dir-src contains file-app and file-utils
      expect(nodeInfo!.children.length).toBe(2);
      expect(nodeInfo!.children.map(c => c.id)).toContain('file-app');
      expect(nodeInfo!.children.map(c => c.id)).toContain('file-utils');
    });

    it('should handle nodes with no relationships', () => {
      // Create a standalone node
      const standaloneNode = createTestNode({
        id: 'standalone',
        name: 'Standalone',
        type: 'file',
        depth: 2,
        filePath: 'standalone.ts'
      });

      const nodeInfo = getNodeInfo([standaloneNode], [], 'standalone');

      expect(nodeInfo).not.toBeNull();
      expect(nodeInfo!.incomingEdges).toHaveLength(0);
      expect(nodeInfo!.outgoingEdges).toHaveLength(0);
      expect(nodeInfo!.parent).toBeUndefined();
      expect(nodeInfo!.children).toHaveLength(0);
    });
  });

  describe('Info Panel Content - Docstring', () => {
    it('should display docstring for class node', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'class-user');

      expect(nodeInfo).not.toBeNull();
      expect(nodeInfo!.node.metadata.docstring).toBe(
        'Represents a user in the system with authentication and profile management.'
      );
    });

    it('should display docstring for function node', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'func-authenticate');

      expect(nodeInfo).not.toBeNull();
      expect(nodeInfo!.node.metadata.docstring).toBe(
        'Authenticates a user with username and password.'
      );
    });

    it('should display docstring for symbol node', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'symbol-config');

      expect(nodeInfo).not.toBeNull();
      expect(nodeInfo!.node.metadata.docstring).toBe(
        'Application configuration constants'
      );
    });
  });

  describe('Info Panel Content - Additional Metadata', () => {
    it('should display complexity rating', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'func-authenticate');

      expect(nodeInfo).not.toBeNull();
      expect(nodeInfo!.node.metadata.complexity).toBe('high');
    });

    it('should display function signature', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'func-authenticate');

      expect(nodeInfo).not.toBeNull();
      expect(nodeInfo!.node.metadata.signature).toBe(
        'async function authenticate(username: string, password: string): Promise<User>'
      );
    });

    it('should display function parameters', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'func-authenticate');

      expect(nodeInfo).not.toBeNull();
      expect(nodeInfo!.node.metadata.parameters).toEqual([
        'username: string',
        'password: string'
      ]);
    });

    it('should display return type', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'func-authenticate');

      expect(nodeInfo).not.toBeNull();
      expect(nodeInfo!.node.metadata.returnType).toBe('Promise<User>');
    });

    it('should display exports for file nodes', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'file-app');

      expect(nodeInfo).not.toBeNull();
      expect(nodeInfo!.node.metadata.exports).toEqual(['App', 'AppProvider']);
    });

    it('should display line range', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'class-user');

      expect(nodeInfo).not.toBeNull();
      expect(nodeInfo!.node.metadata.startLine).toBe(10);
      expect(nodeInfo!.node.metadata.endLine).toBe(90);
    });

    it('should display language', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'file-app');

      expect(nodeInfo).not.toBeNull();
      expect(nodeInfo!.node.metadata.language).toBe('typescript');
    });
  });

  describe('Close Button Behavior', () => {
    it('should clear selection when close button is clicked', () => {
      const handler = createNodeSelectionHandler();
      const node = testNodes.find(n => n.id === 'file-app')!;

      // Select node
      handler.handleNodeClick(node, testNodes, testEdges);
      expect(handler.getState().selectedNodeId).toBe('file-app');
      expect(handler.getState().isInfoPanelOpen).toBe(true);

      // Simulate close button click
      handler.closeInfoPanel();

      const state = handler.getState();
      expect(state.selectedNodeId).toBeNull();
      expect(state.isInfoPanelOpen).toBe(false);
      expect(state.selectedNodeInfo).toBeNull();
    });

    it('should allow reselection after closing', () => {
      const handler = createNodeSelectionHandler();
      const node = testNodes.find(n => n.id === 'file-app')!;

      // Select and close
      handler.handleNodeClick(node, testNodes, testEdges);
      handler.closeInfoPanel();
      expect(handler.getState().selectedNodeId).toBeNull();

      // Reselect
      handler.handleNodeClick(node, testNodes, testEdges);
      expect(handler.getState().selectedNodeId).toBe('file-app');
      expect(handler.getState().isInfoPanelOpen).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle selecting non-existent node', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'non-existent-id');
      expect(nodeInfo).toBeNull();
    });

    it('should handle selecting directory node', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'dir-src');

      expect(nodeInfo).not.toBeNull();
      expect(nodeInfo!.node.type).toBe('directory');
      expect(nodeInfo!.node.name).toBe('src');
    });

    it('should handle selecting symbol node', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'symbol-config');

      expect(nodeInfo).not.toBeNull();
      expect(nodeInfo!.node.type).toBe('symbol');
    });

    it('should preserve selected node info after selection', () => {
      const handler = createNodeSelectionHandler();
      handler.selectNode('func-authenticate', testNodes, testEdges);

      const state = handler.getState();
      expect(state.selectedNodeInfo).not.toBeNull();
      expect(state.selectedNodeInfo!.node.id).toBe('func-authenticate');
      expect(state.selectedNodeInfo!.node.metadata.signature).toBeDefined();
    });
  });

  describe('Relationship Type Grouping', () => {
    it('should correctly identify imports relationships', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'file-app');

      const importEdges = nodeInfo!.outgoingEdges.filter(e => e.type === 'imports');
      expect(importEdges.length).toBeGreaterThan(0);
      expect(importEdges.every(e => e.type === 'imports')).toBe(true);
    });

    it('should correctly identify calls relationships', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'func-authenticate');

      const callEdges = nodeInfo!.outgoingEdges.filter(e => e.type === 'calls');
      expect(callEdges).toHaveLength(1);
      expect(callEdges[0].target).toBe('func-log');
    });

    it('should correctly identify inherits relationships', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'class-user');

      const inheritEdges = nodeInfo!.outgoingEdges.filter(e => e.type === 'inherits');
      expect(inheritEdges).toHaveLength(1);
    });

    it('should correctly identify contains relationships', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'dir-src');

      const containsEdges = nodeInfo!.outgoingEdges.filter(e => e.type === 'contains');
      expect(containsEdges).toHaveLength(2);
    });
  });

  describe('Node Type Icons and Labels', () => {
    it('should have correct type for directory nodes', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'dir-src');
      expect(nodeInfo!.node.type).toBe('directory');
    });

    it('should have correct type for file nodes', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'file-app');
      expect(nodeInfo!.node.type).toBe('file');
    });

    it('should have correct type for class nodes', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'class-user');
      expect(nodeInfo!.node.type).toBe('class');
    });

    it('should have correct type for function nodes', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'func-authenticate');
      expect(nodeInfo!.node.type).toBe('function');
    });

    it('should have correct type for symbol nodes', () => {
      const nodeInfo = getNodeInfo(testNodes, testEdges, 'symbol-config');
      expect(nodeInfo!.node.type).toBe('symbol');
    });
  });
});
