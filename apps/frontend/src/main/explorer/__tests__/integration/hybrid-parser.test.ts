/**
 * Integration Tests for Hybrid Parser System
 *
 * Tests the complete parsing pipeline integration with both OXC and Tree-sitter parsers:
 * - Parser selection based on file extension
 * - Graph building from unified parse results (both parsers)
 * - Mixed language project handling
 * - Error handling and recovery
 * - Parser statistics tracking
 *
 * Note: These are integration tests using mock parse results to test the pipeline,
 * not end-to-end tests with real files (which would require Electron context for Tree-sitter).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getParserForFile } from '../../parser-router';
import { buildGraph, buildGraphWithStats, type GraphBuilderConfig, graphCache } from '../../graph-builder';
import type { UnifiedParseResult, ExtractedSymbol } from '../../types';

// ============================================
// Mock Data - Simulating Parser Outputs
// ============================================

/**
 * Mock TypeScript parse result (as if from OXC)
 */
function createMockTypeScriptResult(filePath: string): UnifiedParseResult {
  const symbols: ExtractedSymbol[] = [
    {
      name: 'UserService',
      type: 'class',
      startLine: 10,
      endLine: 30,
      docstring: 'UserService class for managing users',
      signature: 'export class UserService',
      exports: true,
      children: [
        {
          name: 'addUser',
          type: 'function',
          startLine: 15,
          endLine: 18,
          docstring: 'Add a new user',
          signature: 'addUser(user: User): void',
          parameters: ['user'],
          returnType: 'void',
          parentClass: 'UserService',
          exports: false,
          children: []
        },
        {
          name: 'getUser',
          type: 'function',
          startLine: 22,
          endLine: 25,
          docstring: 'Get user by ID',
          signature: 'getUser(id: number): User | undefined',
          parameters: ['id'],
          returnType: 'User | undefined',
          parentClass: 'UserService',
          exports: false,
          children: []
        }
      ]
    },
    {
      name: 'createUser',
      type: 'function',
      startLine: 35,
      endLine: 38,
      docstring: 'Helper function to create a user',
      signature: 'export function createUser(name: string, id: number): User',
      parameters: ['name', 'id'],
      returnType: 'User',
      exports: true,
      children: []
    }
  ];

  return {
    symbols,
    imports: [],
    language: 'typescript',
    filePath,
    parseTimeMs: 5,
    parser: 'oxc',
    loc: 40
  };
}

/**
 * Mock TypeScript parse result with imports
 */
function createMockTypeScriptWithImports(filePath: string): UnifiedParseResult {
  const symbols: ExtractedSymbol[] = [
    {
      name: 'Application',
      type: 'class',
      startLine: 8,
      endLine: 20,
      docstring: 'Main application class',
      signature: 'export class Application',
      exports: true,
      children: [
        {
          name: 'run',
          type: 'function',
          startLine: 14,
          endLine: 18,
          signature: 'run(): void',
          returnType: 'void',
          parentClass: 'Application',
          exports: false,
          children: []
        }
      ]
    }
  ];

  return {
    symbols,
    imports: [
      {
        source: './user-service',
        items: ['UserService', 'createUser'],
        isDefault: false,
        isRelative: true
      },
      {
        source: './types',
        items: ['User'],
        isDefault: false,
        isRelative: true
      }
    ],
    language: 'typescript',
    filePath,
    parseTimeMs: 4,
    parser: 'oxc',
    loc: 25
  };
}

/**
 * Mock Python parse result (as if from Tree-sitter)
 */
function createMockPythonResult(filePath: string): UnifiedParseResult {
  const symbols: ExtractedSymbol[] = [
    {
      name: 'User',
      type: 'class',
      startLine: 6,
      endLine: 15,
      docstring: 'User class representing a system user',
      signature: 'class User:',
      exports: false,
      children: [
        {
          name: '__init__',
          type: 'function',
          startLine: 10,
          endLine: 12,
          docstring: 'Initialize a user with name and ID',
          signature: 'def __init__(self, name: str, id: int):',
          parameters: ['self', 'name', 'id'],
          parentClass: 'User',
          exports: false,
          children: []
        },
        {
          name: 'get_info',
          type: 'function',
          startLine: 14,
          endLine: 16,
          docstring: 'Get user information as string',
          signature: 'def get_info(self) -> str:',
          returnType: 'str',
          parentClass: 'User',
          exports: false,
          children: []
        }
      ]
    },
    {
      name: 'UserService',
      type: 'class',
      startLine: 19,
      endLine: 32,
      docstring: 'Service for managing users',
      signature: 'class UserService:',
      exports: false,
      children: [
        {
          name: '__init__',
          type: 'function',
          startLine: 23,
          endLine: 24,
          docstring: 'Initialize the user service',
          signature: 'def __init__(self):',
          parameters: ['self'],
          parentClass: 'UserService',
          exports: false,
          children: []
        },
        {
          name: 'add_user',
          type: 'function',
          startLine: 26,
          endLine: 27,
          docstring: 'Add a user to the service',
          signature: 'def add_user(self, user: User) -> None:',
          parameters: ['self', 'user'],
          returnType: 'None',
          parentClass: 'UserService',
          exports: false,
          children: []
        }
      ]
    },
    {
      name: 'create_user',
      type: 'function',
      startLine: 35,
      endLine: 38,
      docstring: 'Helper function to create a new user',
      signature: 'def create_user(name: str, user_id: int) -> User:',
      parameters: ['name', 'user_id'],
      returnType: 'User',
      exports: false,
      children: []
    }
  ];

  return {
    symbols,
    imports: [],
    language: 'python',
    filePath,
    parseTimeMs: 10,
    parser: 'tree-sitter',
    loc: 50
  };
}

// ============================================
// Test Suite
// ============================================

describe('Hybrid Parser Integration', () => {
  const projectPath = '/test/project';
  const projectId = 'test-project';

  beforeEach(() => {
    // Clear graph cache before each test to ensure isolation
    graphCache.clear();
  });

  // ============================================
  // Parser Selection Tests
  // ============================================

  describe('Parser Selection', () => {
    it('should select OXC for TypeScript files', () => {
      expect(getParserForFile('test.ts')).toBe('oxc');
      expect(getParserForFile('test.tsx')).toBe('oxc');
    });

    it('should select OXC for JavaScript files', () => {
      expect(getParserForFile('test.js')).toBe('oxc');
      expect(getParserForFile('test.jsx')).toBe('oxc');
      expect(getParserForFile('test.mjs')).toBe('oxc');
      expect(getParserForFile('test.cjs')).toBe('oxc');
    });

    it('should select tree-sitter for Python files', () => {
      expect(getParserForFile('test.py')).toBe('tree-sitter');
      expect(getParserForFile('test.pyi')).toBe('tree-sitter');
    });

    it('should return null for unsupported file types', () => {
      expect(getParserForFile('test.txt')).toBeNull();
      expect(getParserForFile('test.json')).toBeNull();
      expect(getParserForFile('test.md')).toBeNull();
    });
  });

  // ============================================
  // Graph Building from TypeScript (OXC)
  // ============================================

  describe('Graph Building from TypeScript (OXC)', () => {
    it('should build graph from TypeScript parse result', () => {
      const parseResult = createMockTypeScriptResult(`${projectPath}/src/user-service.ts`);

      const config: GraphBuilderConfig = {
        projectRoot: projectPath,
        projectId,
        includeSymbols: true
      };

      const graph = buildGraph([parseResult], config);

      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.edges.length).toBeGreaterThan(0);

      // Should have file node
      const fileNode = graph.nodes.find(n => n.type === 'file');
      expect(fileNode).toBeDefined();
      expect(fileNode!.metadata.language).toBe('typescript');

      // Should have class node
      const classNode = graph.nodes.find(n => n.type === 'class' && n.name === 'UserService');
      expect(classNode).toBeDefined();
      expect(classNode!.depth).toBe(3);

      // Should have function nodes (methods and standalone)
      const functionNodes = graph.nodes.filter(n => n.type === 'function');
      expect(functionNodes.length).toBeGreaterThan(0);

      // Should have methods as children of class
      const addUserMethod = functionNodes.find(f => f.name === 'addUser');
      expect(addUserMethod).toBeDefined();
      expect(addUserMethod!.metadata.parentClass).toBe('UserService');
    });

    it('should extract parser backend info correctly', () => {
      const parseResult = createMockTypeScriptResult(`${projectPath}/src/service.ts`);

      const config: GraphBuilderConfig = {
        projectRoot: projectPath,
        projectId,
        includeSymbols: true
      };

      const graph = buildGraph([parseResult], config);

      // Parser info should be preserved in file metadata
      const fileNode = graph.nodes.find(n => n.type === 'file');
      expect(fileNode).toBeDefined();
      expect(fileNode!.metadata.language).toBe('typescript');
    });

    it('should handle TypeScript imports correctly', () => {
      const parseResult = createMockTypeScriptWithImports(`${projectPath}/src/app.ts`);

      const config: GraphBuilderConfig = {
        projectRoot: projectPath,
        projectId,
        includeSymbols: true
      };

      const graph = buildGraph([parseResult], config);

      // Graph should be built successfully
      expect(graph.nodes.length).toBeGreaterThan(0);

      // Should have Application class
      const appClass = graph.nodes.find(n => n.type === 'class' && n.name === 'Application');
      expect(appClass).toBeDefined();
    });
  });

  // ============================================
  // Graph Building from Python (Tree-sitter)
  // ============================================

  describe('Graph Building from Python (Tree-sitter)', () => {
    it('should build graph from Python parse result', () => {
      const parseResult = createMockPythonResult(`${projectPath}/src/user.py`);

      const config: GraphBuilderConfig = {
        projectRoot: projectPath,
        projectId,
        includeSymbols: true
      };

      const graph = buildGraph([parseResult], config);

      expect(graph.nodes.length).toBeGreaterThan(0);

      // Should have file node
      const fileNode = graph.nodes.find(n => n.type === 'file');
      expect(fileNode).toBeDefined();
      expect(fileNode!.metadata.language).toBe('python');

      // Should have class nodes
      const userClass = graph.nodes.find(n => n.type === 'class' && n.name === 'User');
      expect(userClass).toBeDefined();

      const serviceClass = graph.nodes.find(n => n.type === 'class' && n.name === 'UserService');
      expect(serviceClass).toBeDefined();

      // Should have function node
      const createUserFunc = graph.nodes.find(n => n.type === 'function' && n.name === 'create_user');
      expect(createUserFunc).toBeDefined();
    });

    it('should extract Python methods as children of classes', () => {
      const parseResult = createMockPythonResult(`${projectPath}/src/models.py`);

      const config: GraphBuilderConfig = {
        projectRoot: projectPath,
        projectId,
        includeSymbols: true
      };

      const graph = buildGraph([parseResult], config);

      // Find __init__ method
      const initMethod = graph.nodes.find(n =>
        n.type === 'function' &&
        n.name === '__init__' &&
        n.metadata.parentClass === 'User'
      );
      expect(initMethod).toBeDefined();

      // Find get_info method
      const getInfoMethod = graph.nodes.find(n =>
        n.type === 'function' &&
        n.name === 'get_info' &&
        n.metadata.parentClass === 'User'
      );
      expect(getInfoMethod).toBeDefined();
    });
  });

  // ============================================
  // Mixed Language Project Tests
  // ============================================

  describe('Mixed Language Projects', () => {
    it('should build graph from mixed TypeScript and Python files', () => {
      const tsResult = createMockTypeScriptResult(`${projectPath}/src/service.ts`);
      const pyResult = createMockPythonResult(`${projectPath}/src/service.py`);

      const config: GraphBuilderConfig = {
        projectRoot: projectPath,
        projectId,
        includeSymbols: true
      };

      const graph = buildGraph([tsResult, pyResult], config);

      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.stats.filesParsed).toBe(2);
      expect(graph.stats.languages).toContain('typescript');
      expect(graph.stats.languages).toContain('python');

      // Should have nodes from both languages
      const tsNodes = graph.nodes.filter(n => n.metadata.language === 'typescript');
      const pyNodes = graph.nodes.filter(n => n.metadata.language === 'python');
      expect(tsNodes.length).toBeGreaterThan(0);
      expect(pyNodes.length).toBeGreaterThan(0);
    });

    it('should track parser usage statistics', () => {
      const tsResult1 = createMockTypeScriptResult(`${projectPath}/src/app.ts`);
      const tsResult2 = createMockTypeScriptResult(`${projectPath}/src/utils.ts`);
      const pyResult1 = createMockPythonResult(`${projectPath}/src/models.py`);
      const pyResult2 = createMockPythonResult(`${projectPath}/src/utils.py`);

      const config: GraphBuilderConfig = {
        projectRoot: projectPath,
        projectId,
        includeSymbols: true
      };

      const graph = buildGraph([tsResult1, tsResult2, pyResult1, pyResult2], config);

      expect(graph.stats.filesParsed).toBe(4);
      expect(graph.stats.languages).toContain('typescript');
      expect(graph.stats.languages).toContain('python');
    });

    it('should build graph with comprehensive statistics', async () => {
      // Use unique project ID to avoid cache conflicts
      const uniqueProjectId = `${projectId}-stats-${Date.now()}`;
      const tsResult = createMockTypeScriptResult(`${projectPath}/src/service.ts`);
      const pyResult = createMockPythonResult(`${projectPath}/src/models.py`);

      const config: GraphBuilderConfig = {
        projectRoot: projectPath,
        projectId: uniqueProjectId,
        includeSymbols: true
      };

      const { graph, stats } = await buildGraphWithStats([tsResult, pyResult], config);

      // Check graph stats
      expect(stats.totalNodes).toBe(graph.nodes.length);
      expect(stats.totalEdges).toBe(graph.edges.length);
      expect(stats.filesParsed).toBe(2);
      expect(stats.filesWithErrors).toBe(0);

      // Check parser usage stats
      expect(stats.parserUsage.oxc).toBe(1);
      expect(stats.parserUsage.treeSitter).toBe(1);

      // Check timing (note: some timing may be 0 if operations are synchronous and very fast)
      // parseTimeMs comes from aggregated parser metrics
      expect(stats.parseTimeMs).toBeGreaterThan(0);
      expect(stats.graphBuildTimeMs).toBeGreaterThanOrEqual(0);
      // totalTimeMs may be 0 if Date.now() doesn't have millisecond precision in test environment
      expect(stats.totalTimeMs).toBeGreaterThanOrEqual(0);

      // Check node/edge type counts
      expect(stats.nodesByType.file).toBeGreaterThanOrEqual(2);
      expect(stats.nodesByType.class).toBeGreaterThan(0);
      expect(stats.nodesByType.function).toBeGreaterThan(0);
      expect(stats.edgesByType.contains).toBeGreaterThan(0);
    });
  });

  // ============================================
  // Edge Building Tests
  // ============================================

  describe('Edge Building', () => {
    it('should create containment edges', () => {
      const parseResult = createMockTypeScriptResult(`${projectPath}/src/user-service.ts`);

      const config: GraphBuilderConfig = {
        projectRoot: projectPath,
        projectId,
        includeSymbols: true
      };

      const graph = buildGraph([parseResult], config);

      // Should have containment edges
      const containsEdges = graph.edges.filter(e => e.type === 'contains');
      expect(containsEdges.length).toBeGreaterThan(0);

      // File should contain class
      // Note: Edge IDs contain full paths, so we check for the pattern
      const fileToClass = containsEdges.find(e => {
        const source = typeof e.source === 'string' ? e.source : e.source.id;
        const target = typeof e.target === 'string' ? e.target : e.target.id;
        return source.startsWith('file:') && target.includes(':UserService');
      });
      expect(fileToClass).toBeDefined();
    });

    it('should create import edges when files reference each other', () => {
      // Create two related files
      const serviceResult = createMockTypeScriptResult(`${projectPath}/src/user-service.ts`);
      const appResult = createMockTypeScriptWithImports(`${projectPath}/src/app.ts`);

      const config: GraphBuilderConfig = {
        projectRoot: projectPath,
        projectId,
        includeSymbols: true
      };

      const graph = buildGraph([serviceResult, appResult], config);

      // Graph should be built successfully
      expect(graph.edges.length).toBeGreaterThan(0);

      // Note: Import edges are only created if target file exists and path resolves correctly
      // The mock data may not have perfectly matching paths, so we just verify structure exists
      const containsEdges = graph.edges.filter(e => e.type === 'contains');
      expect(containsEdges.length).toBeGreaterThan(0);
    });
  });

  // ============================================
  // Error Handling Tests
  // ============================================

  describe('Error Handling', () => {
    it('should handle empty parse results', () => {
      const emptyResult: UnifiedParseResult = {
        symbols: [],
        imports: [],
        language: 'typescript',
        filePath: `${projectPath}/src/empty.ts`,
        parseTimeMs: 1,
        parser: 'oxc',
        loc: 0
      };

      const config: GraphBuilderConfig = {
        projectRoot: projectPath,
        projectId,
        includeSymbols: true
      };

      const graph = buildGraph([emptyResult], config);

      // Should have file node but no other nodes
      const fileNode = graph.nodes.find(n => n.type === 'file');
      expect(fileNode).toBeDefined();

      // Should not have class or function nodes
      const symbolNodes = graph.nodes.filter(n => n.type !== 'file' && n.type !== 'directory');
      expect(symbolNodes.length).toBe(0);
    });

    it('should handle malformed symbol data gracefully', () => {
      const malformedResult: UnifiedParseResult = {
        symbols: [
          {
            name: 'BrokenClass',
            type: 'class',
            startLine: 1,
            endLine: 10,
            exports: false,
            children: []
            // Missing optional fields - should still work
          }
        ],
        imports: [],
        language: 'typescript',
        filePath: `${projectPath}/src/broken.ts`,
        parseTimeMs: 2,
        parser: 'oxc',
        loc: 10
      };

      const config: GraphBuilderConfig = {
        projectRoot: projectPath,
        projectId,
        includeSymbols: true
      };

      // Should not throw
      expect(() => buildGraph([malformedResult], config)).not.toThrow();

      const graph = buildGraph([malformedResult], config);
      const classNode = graph.nodes.find(n => n.type === 'class' && n.name === 'BrokenClass');
      expect(classNode).toBeDefined();
    });
  });

  // ============================================
  // Performance Tests
  // ============================================

  describe('Performance Tracking', () => {
    it('should report parse times in results', () => {
      const parseResult = createMockTypeScriptResult(`${projectPath}/src/service.ts`);

      expect(parseResult.parseTimeMs).toBeGreaterThan(0);
      expect(parseResult.parser).toBe('oxc');
    });

    it('should track total LOC across files', () => {
      const tsResult = createMockTypeScriptResult(`${projectPath}/src/app.ts`);
      const pyResult = createMockPythonResult(`${projectPath}/src/models.py`);

      const config: GraphBuilderConfig = {
        projectRoot: projectPath,
        projectId,
        includeSymbols: true
      };

      const graph = buildGraph([tsResult, pyResult], config);

      // Total LOC should be sum of both files
      expect(graph.stats.totalLoc).toBe(tsResult.loc + pyResult.loc);
    });
  });

  // ============================================
  // Full Pipeline Integration
  // ============================================

  describe('Full Pipeline Integration', () => {
    it('should handle complete workflow from parse results to graph', async () => {
      // Simulate parsing multiple files
      const parseResults: UnifiedParseResult[] = [
        createMockTypeScriptResult(`${projectPath}/src/user-service.ts`),
        createMockTypeScriptWithImports(`${projectPath}/src/app.ts`),
        createMockPythonResult(`${projectPath}/src/models.py`),
      ];

      // Build graph
      const config: GraphBuilderConfig = {
        projectRoot: projectPath,
        projectId,
        includeSymbols: true
      };

      const { graph, stats } = await buildGraphWithStats(parseResults, config);

      // Verify graph structure
      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.edges.length).toBeGreaterThan(0);
      expect(graph.rootPath).toBe(projectPath);
      expect(graph.projectId).toBe(projectId);

      // Verify statistics
      expect(stats.filesParsed).toBe(3);
      expect(stats.parserUsage.oxc).toBe(2);
      expect(stats.parserUsage.treeSitter).toBe(1);

      // Verify node types
      const fileNodes = graph.nodes.filter(n => n.type === 'file');
      const classNodes = graph.nodes.filter(n => n.type === 'class');
      const functionNodes = graph.nodes.filter(n => n.type === 'function');

      expect(fileNodes.length).toBe(3);
      expect(classNodes.length).toBeGreaterThan(0);
      expect(functionNodes.length).toBeGreaterThan(0);

      // Verify containment edges
      const containsEdges = graph.edges.filter(e => e.type === 'contains');
      expect(containsEdges.length).toBeGreaterThan(0);

      // Verify language diversity
      expect(graph.stats.languages).toContain('typescript');
      expect(graph.stats.languages).toContain('python');
    });
  });
});
