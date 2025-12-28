/**
 * Unit tests for Depth Slider filtering logic
 * Tests that depth level changes correctly filter graph nodes
 */
import { describe, it, expect } from 'vitest';
import type {
  GraphNode,
  GraphEdge,
  DepthLevel,
  NodeType
} from '../../shared/types';

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

/**
 * Filter nodes based on current depth level
 * This mirrors the logic in useExplorer hook
 */
function filterNodesByDepth(nodes: GraphNode[], depthLevel: DepthLevel): GraphNode[] {
  return nodes.filter((node) => node.depth <= depthLevel);
}

/**
 * Filter edges to only include those between visible nodes
 * This mirrors the logic in useExplorer hook
 */
function filterEdgesByNodes(edges: GraphEdge[], visibleNodeIds: Set<string>): GraphEdge[] {
  return edges.filter((edge) => {
    const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
    return visibleNodeIds.has(sourceId) && visibleNodeIds.has(targetId);
  });
}

describe('Depth Slider Filtering', () => {
  // Create a comprehensive test graph with nodes at all depth levels
  const testNodes: GraphNode[] = [
    // Depth 1: Directories
    createTestNode({ id: 'dir-src', name: 'src', type: 'directory', depth: 1, filePath: 'src' }),
    createTestNode({ id: 'dir-lib', name: 'lib', type: 'directory', depth: 1, filePath: 'lib' }),

    // Depth 2: Files
    createTestNode({ id: 'file-app', name: 'App.tsx', type: 'file', depth: 2, filePath: 'src/App.tsx' }),
    createTestNode({ id: 'file-main', name: 'main.ts', type: 'file', depth: 2, filePath: 'src/main.ts' }),
    createTestNode({ id: 'file-utils', name: 'utils.ts', type: 'file', depth: 2, filePath: 'lib/utils.ts' }),

    // Depth 3: Classes
    createTestNode({ id: 'class-app', name: 'App', type: 'class', depth: 3, filePath: 'src/App.tsx' }),
    createTestNode({ id: 'class-logger', name: 'Logger', type: 'class', depth: 3, filePath: 'lib/utils.ts' }),

    // Depth 4: Functions
    createTestNode({ id: 'func-render', name: 'render', type: 'function', depth: 4, filePath: 'src/App.tsx' }),
    createTestNode({ id: 'func-init', name: 'initialize', type: 'function', depth: 4, filePath: 'src/main.ts' }),
    createTestNode({ id: 'func-log', name: 'log', type: 'function', depth: 4, filePath: 'lib/utils.ts' }),

    // Depth 5: Symbols
    createTestNode({ id: 'symbol-state', name: 'appState', type: 'symbol', depth: 5, filePath: 'src/App.tsx' }),
    createTestNode({ id: 'symbol-config', name: 'CONFIG', type: 'symbol', depth: 5, filePath: 'src/main.ts' })
  ];

  const testEdges: GraphEdge[] = [
    // Directory contains files
    { id: 'e1', source: 'dir-src', target: 'file-app', type: 'contains' },
    { id: 'e2', source: 'dir-src', target: 'file-main', type: 'contains' },
    { id: 'e3', source: 'dir-lib', target: 'file-utils', type: 'contains' },

    // File contains class
    { id: 'e4', source: 'file-app', target: 'class-app', type: 'contains' },
    { id: 'e5', source: 'file-utils', target: 'class-logger', type: 'contains' },

    // Class contains function
    { id: 'e6', source: 'class-app', target: 'func-render', type: 'contains' },
    { id: 'e7', source: 'class-logger', target: 'func-log', type: 'contains' },

    // Function contains symbol
    { id: 'e8', source: 'func-render', target: 'symbol-state', type: 'contains' },

    // Imports between files
    { id: 'e9', source: 'file-main', target: 'file-app', type: 'imports' },
    { id: 'e10', source: 'file-app', target: 'file-utils', type: 'imports' },

    // Function calls
    { id: 'e11', source: 'func-init', target: 'func-render', type: 'calls' }
  ];

  describe('Level 1: Directories Only', () => {
    it('should show only directories at depth level 1', () => {
      const filtered = filterNodesByDepth(testNodes, 1);

      expect(filtered).toHaveLength(2);
      expect(filtered.every((n) => n.type === 'directory')).toBe(true);
      expect(filtered.map((n) => n.id)).toEqual(['dir-src', 'dir-lib']);
    });

    it('should show no edges at depth level 1 (directories have no inter-edges)', () => {
      const filteredNodes = filterNodesByDepth(testNodes, 1);
      const visibleNodeIds = new Set(filteredNodes.map((n) => n.id));
      const filteredEdges = filterEdgesByNodes(testEdges, visibleNodeIds);

      expect(filteredEdges).toHaveLength(0);
    });
  });

  describe('Level 2: Directories + Files', () => {
    it('should show directories and files at depth level 2', () => {
      const filtered = filterNodesByDepth(testNodes, 2);

      expect(filtered).toHaveLength(5);
      expect(filtered.filter((n) => n.type === 'directory')).toHaveLength(2);
      expect(filtered.filter((n) => n.type === 'file')).toHaveLength(3);
    });

    it('should show edges between visible nodes at depth level 2', () => {
      const filteredNodes = filterNodesByDepth(testNodes, 2);
      const visibleNodeIds = new Set(filteredNodes.map((n) => n.id));
      const filteredEdges = filterEdgesByNodes(testEdges, visibleNodeIds);

      // Should include: dir->file contains (3), file->file imports (2)
      expect(filteredEdges).toHaveLength(5);
      expect(filteredEdges.filter((e) => e.type === 'contains')).toHaveLength(3);
      expect(filteredEdges.filter((e) => e.type === 'imports')).toHaveLength(2);
    });
  });

  describe('Level 3: Directories + Files + Classes', () => {
    it('should show directories, files, and classes at depth level 3', () => {
      const filtered = filterNodesByDepth(testNodes, 3);

      expect(filtered).toHaveLength(7);
      expect(filtered.filter((n) => n.type === 'directory')).toHaveLength(2);
      expect(filtered.filter((n) => n.type === 'file')).toHaveLength(3);
      expect(filtered.filter((n) => n.type === 'class')).toHaveLength(2);
    });

    it('should include file->class contains edges at depth level 3', () => {
      const filteredNodes = filterNodesByDepth(testNodes, 3);
      const visibleNodeIds = new Set(filteredNodes.map((n) => n.id));
      const filteredEdges = filterEdgesByNodes(testEdges, visibleNodeIds);

      // dir->file (3) + file->class (2) + file->file imports (2) = 7
      expect(filteredEdges).toHaveLength(7);
    });
  });

  describe('Level 4: + Functions', () => {
    it('should show directories, files, classes, and functions at depth level 4', () => {
      const filtered = filterNodesByDepth(testNodes, 4);

      expect(filtered).toHaveLength(10);
      expect(filtered.filter((n) => n.type === 'directory')).toHaveLength(2);
      expect(filtered.filter((n) => n.type === 'file')).toHaveLength(3);
      expect(filtered.filter((n) => n.type === 'class')).toHaveLength(2);
      expect(filtered.filter((n) => n.type === 'function')).toHaveLength(3);
    });

    it('should include function call edges at depth level 4', () => {
      const filteredNodes = filterNodesByDepth(testNodes, 4);
      const visibleNodeIds = new Set(filteredNodes.map((n) => n.id));
      const filteredEdges = filterEdgesByNodes(testEdges, visibleNodeIds);

      // Check that func-init -> func-render call edge is present
      const callEdges = filteredEdges.filter((e) => e.type === 'calls');
      expect(callEdges).toHaveLength(1);
      expect(callEdges[0].source).toBe('func-init');
      expect(callEdges[0].target).toBe('func-render');
    });
  });

  describe('Level 5: All Symbols', () => {
    it('should show all nodes at depth level 5', () => {
      const filtered = filterNodesByDepth(testNodes, 5);

      expect(filtered).toHaveLength(12);
      expect(filtered.filter((n) => n.type === 'directory')).toHaveLength(2);
      expect(filtered.filter((n) => n.type === 'file')).toHaveLength(3);
      expect(filtered.filter((n) => n.type === 'class')).toHaveLength(2);
      expect(filtered.filter((n) => n.type === 'function')).toHaveLength(3);
      expect(filtered.filter((n) => n.type === 'symbol')).toHaveLength(2);
    });

    it('should show all edges at depth level 5', () => {
      const filteredNodes = filterNodesByDepth(testNodes, 5);
      const visibleNodeIds = new Set(filteredNodes.map((n) => n.id));
      const filteredEdges = filterEdgesByNodes(testEdges, visibleNodeIds);

      // All 11 edges should be visible
      expect(filteredEdges).toHaveLength(11);
    });
  });

  describe('Progressive Disclosure', () => {
    it('should show more nodes as depth level increases', () => {
      const counts: number[] = [];

      for (let level = 1; level <= 5; level++) {
        const filtered = filterNodesByDepth(testNodes, level as DepthLevel);
        counts.push(filtered.length);
      }

      // Each level should show same or more nodes than previous
      for (let i = 1; i < counts.length; i++) {
        expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
      }

      // Specific expected counts
      expect(counts).toEqual([2, 5, 7, 10, 12]);
    });

    it('should show more edges as depth level increases', () => {
      const counts: number[] = [];

      for (let level = 1; level <= 5; level++) {
        const filteredNodes = filterNodesByDepth(testNodes, level as DepthLevel);
        const visibleNodeIds = new Set(filteredNodes.map((n) => n.id));
        const filteredEdges = filterEdgesByNodes(testEdges, visibleNodeIds);
        counts.push(filteredEdges.length);
      }

      // Each level should show same or more edges than previous
      for (let i = 1; i < counts.length; i++) {
        expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
      }
    });
  });

  describe('Edge Type Visibility', () => {
    it('should show imports edges only when both files are visible (level 2+)', () => {
      // Level 1: No imports (no files)
      let filteredNodes = filterNodesByDepth(testNodes, 1);
      let visibleNodeIds = new Set(filteredNodes.map((n) => n.id));
      let filteredEdges = filterEdgesByNodes(testEdges, visibleNodeIds);
      expect(filteredEdges.filter((e) => e.type === 'imports')).toHaveLength(0);

      // Level 2: Imports visible
      filteredNodes = filterNodesByDepth(testNodes, 2);
      visibleNodeIds = new Set(filteredNodes.map((n) => n.id));
      filteredEdges = filterEdgesByNodes(testEdges, visibleNodeIds);
      expect(filteredEdges.filter((e) => e.type === 'imports')).toHaveLength(2);
    });

    it('should show calls edges only when both functions are visible (level 4+)', () => {
      // Level 3: No calls (no functions)
      let filteredNodes = filterNodesByDepth(testNodes, 3);
      let visibleNodeIds = new Set(filteredNodes.map((n) => n.id));
      let filteredEdges = filterEdgesByNodes(testEdges, visibleNodeIds);
      expect(filteredEdges.filter((e) => e.type === 'calls')).toHaveLength(0);

      // Level 4: Calls visible
      filteredNodes = filterNodesByDepth(testNodes, 4);
      visibleNodeIds = new Set(filteredNodes.map((n) => n.id));
      filteredEdges = filterEdgesByNodes(testEdges, visibleNodeIds);
      expect(filteredEdges.filter((e) => e.type === 'calls')).toHaveLength(1);
    });
  });

  describe('Node Depth Property', () => {
    it('should correctly identify depth 1 nodes as directories', () => {
      const depth1 = testNodes.filter((n) => n.depth === 1);
      expect(depth1.every((n) => n.type === 'directory')).toBe(true);
    });

    it('should correctly identify depth 2 nodes as files', () => {
      const depth2 = testNodes.filter((n) => n.depth === 2);
      expect(depth2.every((n) => n.type === 'file')).toBe(true);
    });

    it('should correctly identify depth 3 nodes as classes', () => {
      const depth3 = testNodes.filter((n) => n.depth === 3);
      expect(depth3.every((n) => n.type === 'class')).toBe(true);
    });

    it('should correctly identify depth 4 nodes as functions', () => {
      const depth4 = testNodes.filter((n) => n.depth === 4);
      expect(depth4.every((n) => n.type === 'function')).toBe(true);
    });

    it('should correctly identify depth 5 nodes as symbols', () => {
      const depth5 = testNodes.filter((n) => n.depth === 5);
      expect(depth5.every((n) => n.type === 'symbol')).toBe(true);
    });
  });
});
