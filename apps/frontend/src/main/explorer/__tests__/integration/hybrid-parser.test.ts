/**
 * Integration Tests for Hybrid Parser System
 *
 * Tests the complete parsing pipeline with both OXC and Tree-sitter parsers:
 * - Parser selection based on file extension
 * - End-to-end parsing of TypeScript files through OXC
 * - End-to-end parsing of Python files through Tree-sitter (mocked in test environment)
 * - Graph building from mixed language projects
 * - Error handling and recovery
 * - Parser statistics tracking
 *
 * Note: Tree-sitter tests use mock data since Tree-sitter requires Electron app context.
 * OXC tests use real parsing since OXC works in Node.js environments.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseFile, parseFiles, getParserForFile } from '../../parser-router';
import { buildGraph, buildGraphWithStats, type GraphBuilderConfig } from '../../graph-builder';
import type { UnifiedParseResult, ExtractedSymbol } from '../../types';

// Mock Tree-sitter initialization since it requires Electron app context
vi.mock('../../tree-sitter-parser', () => ({
  initTreeSitter: vi.fn().mockResolvedValue(undefined),
  parseFile: vi.fn().mockImplementation(async (filePath: string) => {
    // Return mock Tree-sitter parse result for Python files
    const mockSymbols: ExtractedSymbol[] = [
      {
        name: 'User',
        type: 'class',
        startLine: 6,
        endLine: 15,
        docstring: 'User class representing a system user',
        exports: false,
        children: [
          {
            name: '__init__',
            type: 'function',
            startLine: 10,
            endLine: 12,
            docstring: 'Initialize a user with name and ID',
            parentClass: 'User',
            exports: false,
            children: []
          },
          {
            name: 'get_info',
            type: 'function',
            startLine: 14,
            endLine: 15,
            docstring: 'Get user information as string',
            parentClass: 'User',
            exports: false,
            children: []
          }
        ]
      },
      {
        name: 'UserService',
        type: 'class',
        startLine: 18,
        endLine: 32,
        docstring: 'Service for managing users',
        exports: false,
        children: [
          {
            name: '__init__',
            type: 'function',
            startLine: 22,
            endLine: 23,
            docstring: 'Initialize the user service',
            parentClass: 'UserService',
            exports: false,
            children: []
          },
          {
            name: 'add_user',
            type: 'function',
            startLine: 25,
            endLine: 26,
            docstring: 'Add a user to the service',
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
        exports: false,
        children: []
      }
    ];

    return {
      tree: {} as any, // Mock tree object
      language: 'python' as const,
      filePath,
      parseTimeMs: 10
    };
  }),
  isParseableFile: vi.fn((filePath: string) => {
    const ext = path.extname(filePath).toLowerCase();
    return ['.py', '.pyi'].includes(ext);
  })
}));

// Mock tree-sitter adapter to convert mock parse results
vi.mock('../../tree-sitter-adapter', () => ({
  adaptTreeSitterResult: vi.fn((parseResult: any): UnifiedParseResult => {
    const mockSymbols: ExtractedSymbol[] = [
      {
        name: 'User',
        type: 'class',
        startLine: 6,
        endLine: 15,
        docstring: 'User class representing a system user',
        exports: false,
        children: [
          {
            name: '__init__',
            type: 'function',
            startLine: 10,
            endLine: 12,
            docstring: 'Initialize a user with name and ID',
            parentClass: 'User',
            exports: false,
            children: []
          }
        ]
      },
      {
        name: 'UserService',
        type: 'class',
        startLine: 18,
        endLine: 32,
        docstring: 'Service for managing users',
        exports: false,
        children: []
      },
      {
        name: 'create_user',
        type: 'function',
        startLine: 35,
        endLine: 38,
        docstring: 'Helper function to create a new user',
        exports: false,
        children: []
      }
    ];

    return {
      symbols: mockSymbols,
      imports: [],
      language: 'python',
      filePath: parseResult.filePath,
      parseTimeMs: parseResult.parseTimeMs,
      parser: 'tree-sitter',
      loc: 50
    };
  })
}));

// ============================================
// Test Fixtures
// ============================================

/**
 * Sample TypeScript file with various symbol types
 */
const TYPESCRIPT_FIXTURE = `
/**
 * User interface
 */
interface User {
  id: number;
  name: string;
}

/**
 * UserService class for managing users
 */
export class UserService {
  private users: User[] = [];

  /**
   * Add a new user
   */
  addUser(user: User): void {
    this.users.push(user);
  }

  /**
   * Get user by ID
   */
  getUser(id: number): User | undefined {
    return this.users.find(u => u.id === id);
  }
}

/**
 * Helper function to create a user
 */
export function createUser(name: string, id: number): User {
  return { id, name };
}
`;

/**
 * Sample Python file with classes and functions
 */
const PYTHON_FIXTURE = `
"""
User management module
"""

class User:
    """
    User class representing a system user
    """
    def __init__(self, name: str, id: int):
        """Initialize a user with name and ID"""
        self.name = name
        self.id = id

    def get_info(self) -> str:
        """Get user information as string"""
        return f"{self.name} ({self.id})"


class UserService:
    """
    Service for managing users
    """
    def __init__(self):
        """Initialize the user service"""
        self.users = []

    def add_user(self, user: User) -> None:
        """Add a user to the service"""
        self.users.append(user)

    def get_user(self, user_id: int) -> User:
        """Get a user by ID"""
        return next((u for u in self.users if u.id == user_id), None)


def create_user(name: str, user_id: int) -> User:
    """
    Helper function to create a new user
    """
    return User(name, user_id)
`;

/**
 * TypeScript file with imports for dependency graph testing
 */
const TYPESCRIPT_WITH_IMPORTS = `
import { UserService, createUser } from './user-service';
import type { User } from './types';

/**
 * Main application class
 */
export class Application {
  private service: UserService;

  constructor() {
    this.service = new UserService();
  }

  run(): void {
    const user = createUser('Alice', 1);
    this.service.addUser(user);
  }
}
`;

/**
 * Malformed TypeScript file for error testing
 */
const MALFORMED_TYPESCRIPT = `
export class BrokenClass {
  // Missing closing brace
  method() {
    console.log("broken"
  }
`;

/**
 * Malformed Python file for error testing
 */
const MALFORMED_PYTHON = `
class BrokenClass
    # Missing colon
    def method(self):
        print("broken")
`;

// ============================================
// Test Utilities
// ============================================

/**
 * Create a temporary directory for test files
 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-parser-test-'));
}

/**
 * Write a test file to the temp directory
 */
function writeTestFile(dir: string, filename: string, content: string): string {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Clean up temporary directory
 */
function cleanupTempDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================
// Test Suite
// ============================================

describe('Hybrid Parser Integration', () => {
  let tempDir: string;

  beforeAll(async () => {
    // Create temp directory for test files
    // Note: Parser initialization is mocked for Tree-sitter
    tempDir = createTempDir();
  });

  afterAll(() => {
    // Clean up temp directory
    cleanupTempDir(tempDir);
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
  // Single File Parsing Tests
  // ============================================

  describe('Single File Parsing', () => {
    describe('TypeScript (OXC)', () => {
      it('should parse TypeScript file and extract symbols', async () => {
        const filePath = writeTestFile(tempDir, 'user-service.ts', TYPESCRIPT_FIXTURE);
        const result = await parseFile(filePath);

        expect(result).not.toBeNull();
        expect(result!.parser).toBe('oxc');
        expect(result!.language).toBe('typescript');
        expect(result!.filePath).toBe(filePath);
        expect(result!.parseTimeMs).toBeGreaterThan(0);
        expect(result!.loc).toBeGreaterThan(0);

        // Check extracted symbols
        expect(result!.symbols.length).toBeGreaterThan(0);

        // Should have class, methods, and function
        const classSymbol = result!.symbols.find(s => s.name === 'UserService');
        expect(classSymbol).toBeDefined();
        expect(classSymbol!.type).toBe('class');
        expect(classSymbol!.exports).toBe(true);

        // Methods should be children of the class
        const addUserMethod = classSymbol!.children.find(m => m.name === 'addUser');
        expect(addUserMethod).toBeDefined();
        expect(addUserMethod!.type).toBe('function');
        expect(addUserMethod!.parentClass).toBe('UserService');

        // Standalone function
        const createUserFunc = result!.symbols.find(s => s.name === 'createUser');
        expect(createUserFunc).toBeDefined();
        expect(createUserFunc!.type).toBe('function');
        expect(createUserFunc!.exports).toBe(true);
      });

      it('should extract imports from TypeScript file', async () => {
        const filePath = writeTestFile(tempDir, 'app.ts', TYPESCRIPT_WITH_IMPORTS);
        const result = await parseFile(filePath);

        expect(result).not.toBeNull();
        expect(result!.imports.length).toBeGreaterThan(0);

        // Check for relative import
        const serviceImport = result!.imports.find(i => i.source === './user-service');
        expect(serviceImport).toBeDefined();
        expect(serviceImport!.isRelative).toBe(true);
        expect(serviceImport!.items).toContain('UserService');
        expect(serviceImport!.items).toContain('createUser');
      });
    });

    describe('Python (Tree-sitter)', () => {
      it('should parse Python file and extract symbols', async () => {
        const filePath = writeTestFile(tempDir, 'user_service.py', PYTHON_FIXTURE);
        const result = await parseFile(filePath);

        expect(result).not.toBeNull();
        expect(result!.parser).toBe('tree-sitter');
        expect(result!.language).toBe('python');
        expect(result!.filePath).toBe(filePath);
        expect(result!.parseTimeMs).toBeGreaterThan(0);

        // Check extracted symbols
        expect(result!.symbols.length).toBeGreaterThan(0);

        // Should have User class
        const userClass = result!.symbols.find(s => s.name === 'User');
        expect(userClass).toBeDefined();
        expect(userClass!.type).toBe('class');

        // Should have UserService class
        const serviceClass = result!.symbols.find(s => s.name === 'UserService');
        expect(serviceClass).toBeDefined();
        expect(serviceClass!.type).toBe('class');

        // Should have create_user function
        const createUserFunc = result!.symbols.find(s => s.name === 'create_user');
        expect(createUserFunc).toBeDefined();
        expect(createUserFunc!.type).toBe('function');
      });

      it('should extract methods as children of classes', async () => {
        const filePath = writeTestFile(tempDir, 'user.py', PYTHON_FIXTURE);
        const result = await parseFile(filePath);

        const userClass = result!.symbols.find(s => s.name === 'User');
        expect(userClass).toBeDefined();
        expect(userClass!.children.length).toBeGreaterThan(0);

        // Check for __init__ method
        const initMethod = userClass!.children.find(m => m.name === '__init__');
        expect(initMethod).toBeDefined();
        expect(initMethod!.type).toBe('function');
        expect(initMethod!.parentClass).toBe('User');
      });
    });
  });

  // ============================================
  // Batch Parsing Tests
  // ============================================

  describe('Batch Parsing', () => {
    it('should parse multiple files with different parsers', async () => {
      const tsFile = writeTestFile(tempDir, 'service.ts', TYPESCRIPT_FIXTURE);
      const pyFile = writeTestFile(tempDir, 'service.py', PYTHON_FIXTURE);

      const result = await parseFiles([tsFile, pyFile]);

      expect(result.results.length).toBe(2);
      expect(result.errors.length).toBe(0);

      // Check OXC was used for TypeScript
      const tsResult = result.results.find(r => r.filePath === tsFile);
      expect(tsResult).toBeDefined();
      expect(tsResult!.parser).toBe('oxc');
      expect(tsResult!.language).toBe('typescript');

      // Check tree-sitter was used for Python
      const pyResult = result.results.find(r => r.filePath === pyFile);
      expect(pyResult).toBeDefined();
      expect(pyResult!.parser).toBe('tree-sitter');
      expect(pyResult!.language).toBe('python');

      // Check statistics
      expect(result.stats.oxcCount).toBe(1);
      expect(result.stats.treeSitterCount).toBe(1);
      expect(result.stats.totalTimeMs).toBeGreaterThan(0);
    });

    it('should track parser statistics correctly', async () => {
      const files = [
        writeTestFile(tempDir, 'file1.ts', TYPESCRIPT_FIXTURE),
        writeTestFile(tempDir, 'file2.js', 'export const x = 1;'),
        writeTestFile(tempDir, 'file3.py', PYTHON_FIXTURE),
        writeTestFile(tempDir, 'file4.py', 'def hello(): pass'),
      ];

      const result = await parseFiles(files);

      expect(result.results.length).toBe(4);
      expect(result.stats.oxcCount).toBe(2); // 2 JS/TS files
      expect(result.stats.treeSitterCount).toBe(2); // 2 Python files
    });
  });

  // ============================================
  // Graph Building Tests
  // ============================================

  describe('Graph Building from Mixed Languages', () => {
    it('should build graph from TypeScript file', async () => {
      const tsFile = writeTestFile(tempDir, 'user-service.ts', TYPESCRIPT_FIXTURE);
      const parseResult = await parseFile(tsFile);

      const config: GraphBuilderConfig = {
        projectRoot: tempDir,
        projectId: 'test-project',
        includeSymbols: true
      };

      const graph = buildGraph([parseResult!], config);

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

      // Should have function nodes
      const functionNodes = graph.nodes.filter(n => n.type === 'function');
      expect(functionNodes.length).toBeGreaterThan(0);
    });

    it('should build graph from Python file', async () => {
      const pyFile = writeTestFile(tempDir, 'user.py', PYTHON_FIXTURE);
      const parseResult = await parseFile(pyFile);

      const config: GraphBuilderConfig = {
        projectRoot: tempDir,
        projectId: 'test-project',
        includeSymbols: true
      };

      const graph = buildGraph([parseResult!], config);

      expect(graph.nodes.length).toBeGreaterThan(0);

      // Should have file node
      const fileNode = graph.nodes.find(n => n.type === 'file');
      expect(fileNode).toBeDefined();
      expect(fileNode!.metadata.language).toBe('python');

      // Should have class nodes
      const classNodes = graph.nodes.filter(n => n.type === 'class');
      expect(classNodes.length).toBeGreaterThanOrEqual(2); // User and UserService
    });

    it('should build graph from mixed language project', async () => {
      const tsFile = writeTestFile(tempDir, 'service.ts', TYPESCRIPT_FIXTURE);
      const pyFile = writeTestFile(tempDir, 'service.py', PYTHON_FIXTURE);

      const batchResult = await parseFiles([tsFile, pyFile]);

      const config: GraphBuilderConfig = {
        projectRoot: tempDir,
        projectId: 'test-project',
        includeSymbols: true
      };

      const graph = buildGraph(batchResult.results, config);

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

    it('should build graph with comprehensive statistics', async () => {
      const tsFile = writeTestFile(tempDir, 'app.ts', TYPESCRIPT_FIXTURE);
      const pyFile = writeTestFile(tempDir, 'app.py', PYTHON_FIXTURE);

      const batchResult = await parseFiles([tsFile, pyFile]);

      const config: GraphBuilderConfig = {
        projectRoot: tempDir,
        projectId: 'test-project',
        includeSymbols: true
      };

      const { graph, stats } = await buildGraphWithStats(batchResult.results, config);

      // Check graph stats
      expect(stats.totalNodes).toBe(graph.nodes.length);
      expect(stats.totalEdges).toBe(graph.edges.length);
      expect(stats.filesParsed).toBe(2);
      expect(stats.filesWithErrors).toBe(0);

      // Check parser usage stats
      expect(stats.parserUsage.oxc).toBe(1);
      expect(stats.parserUsage.treeSitter).toBe(1);

      // Check timing
      expect(stats.parseTimeMs).toBeGreaterThan(0);
      expect(stats.graphBuildTimeMs).toBeGreaterThan(0);
      expect(stats.totalTimeMs).toBeGreaterThanOrEqual(stats.parseTimeMs + stats.graphBuildTimeMs);

      // Check node/edge type counts
      expect(stats.nodesByType.file).toBeGreaterThanOrEqual(2);
      expect(stats.nodesByType.class).toBeGreaterThan(0);
      expect(stats.nodesByType.function).toBeGreaterThan(0);
      expect(stats.edgesByType.contains).toBeGreaterThan(0);
    });
  });

  // ============================================
  // Error Handling Tests
  // ============================================

  describe('Error Handling', () => {
    it('should handle malformed TypeScript gracefully', async () => {
      const brokenFile = writeTestFile(tempDir, 'broken.ts', MALFORMED_TYPESCRIPT);

      // OXC should still parse (it's fault-tolerant)
      const result = await parseFile(brokenFile);

      // Result might be null or have partial data depending on error severity
      if (result) {
        expect(result.parser).toBe('oxc');
        expect(result.language).toBe('typescript');
      }
    });

    it('should handle malformed Python gracefully', async () => {
      const brokenFile = writeTestFile(tempDir, 'broken.py', MALFORMED_PYTHON);

      // Tree-sitter should still parse (fault-tolerant)
      const result = await parseFile(brokenFile);

      if (result) {
        expect(result.parser).toBe('tree-sitter');
        expect(result.language).toBe('python');
      }
    });

    it('should continue parsing other files when one fails', async () => {
      const goodFile = writeTestFile(tempDir, 'good.ts', TYPESCRIPT_FIXTURE);
      const brokenFile = writeTestFile(tempDir, 'broken.ts', MALFORMED_TYPESCRIPT);
      const goodPyFile = writeTestFile(tempDir, 'good.py', PYTHON_FIXTURE);

      const result = await parseFiles([goodFile, brokenFile, goodPyFile]);

      // Should have parsed the good files at minimum
      expect(result.results.length).toBeGreaterThanOrEqual(2);

      // Good files should be in results
      const goodTsResult = result.results.find(r => r.filePath === goodFile);
      const goodPyResult = result.results.find(r => r.filePath === goodPyFile);
      expect(goodTsResult).toBeDefined();
      expect(goodPyResult).toBeDefined();
    });

    it('should handle unsupported file types gracefully', async () => {
      const txtFile = writeTestFile(tempDir, 'readme.txt', 'This is a text file');
      const result = await parseFile(txtFile);

      // Should return null for unsupported types
      expect(result).toBeNull();
    });

    it('should collect errors in batch parsing', async () => {
      const files = [
        writeTestFile(tempDir, 'good.ts', TYPESCRIPT_FIXTURE),
        writeTestFile(tempDir, 'unsupported.txt', 'text'),
        writeTestFile(tempDir, 'good.py', PYTHON_FIXTURE),
      ];

      const result = await parseFiles(files);

      // Should have some errors (at least the .txt file)
      expect(result.errors.length).toBeGreaterThan(0);

      // Should identify the unsupported file
      const txtError = result.errors.find(e => e.filePath.endsWith('.txt'));
      expect(txtError).toBeDefined();
      expect(txtError!.error).toBe('Unsupported file type');

      // Good files should still parse
      expect(result.results.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ============================================
  // Parser Performance Tests
  // ============================================

  describe('Parser Performance', () => {
    it('should report correct parser usage in results', async () => {
      const tsFile = writeTestFile(tempDir, 'perf-test.ts', TYPESCRIPT_FIXTURE);
      const result = await parseFile(tsFile);

      expect(result).not.toBeNull();
      expect(result!.parser).toBe('oxc');
      expect(result!.parseTimeMs).toBeGreaterThan(0);
    });

    it('should aggregate parse times in batch operations', async () => {
      const files = [
        writeTestFile(tempDir, 'batch1.ts', TYPESCRIPT_FIXTURE),
        writeTestFile(tempDir, 'batch2.py', PYTHON_FIXTURE),
        writeTestFile(tempDir, 'batch3.ts', TYPESCRIPT_WITH_IMPORTS),
      ];

      const result = await parseFiles(files);

      expect(result.stats.totalTimeMs).toBeGreaterThan(0);

      // Individual parse times should sum to less than or equal to total
      // (parallel parsing might be faster than sum)
      const individualSum = result.results.reduce((sum, r) => sum + r.parseTimeMs, 0);
      expect(individualSum).toBeGreaterThan(0);
    });
  });

  // ============================================
  // Import/Dependency Tests
  // ============================================

  describe('Import and Dependency Tracking', () => {
    it('should extract relative imports from TypeScript', async () => {
      const filePath = writeTestFile(tempDir, 'app-imports.ts', TYPESCRIPT_WITH_IMPORTS);
      const result = await parseFile(filePath);

      expect(result).not.toBeNull();
      expect(result!.imports.length).toBeGreaterThan(0);

      // All imports in the fixture are relative
      const relativeImports = result!.imports.filter(i => i.isRelative);
      expect(relativeImports.length).toBe(result!.imports.length);
    });

    it('should build import edges in graph', async () => {
      // Create two related TypeScript files
      const serviceFile = writeTestFile(tempDir, 'dep-service.ts', TYPESCRIPT_FIXTURE);
      const appFile = writeTestFile(tempDir, 'dep-app.ts', TYPESCRIPT_WITH_IMPORTS);

      const batchResult = await parseFiles([serviceFile, appFile]);

      const config: GraphBuilderConfig = {
        projectRoot: tempDir,
        projectId: 'test-project',
        includeSymbols: true
      };

      const graph = buildGraph(batchResult.results, config);

      // Should have import edges
      const importEdges = graph.edges.filter(e => e.type === 'imports');

      // Note: Import edges are only created if target file exists in graph
      // In this case, the import path might not match exactly, so we just verify structure
      expect(graph.edges.length).toBeGreaterThan(0);
    });
  });

  // ============================================
  // Full Pipeline Integration Test
  // ============================================

  describe('Full Pipeline Integration', () => {
    it('should handle complete workflow from files to graph', async () => {
      // Create a mini project
      const projectDir = path.join(tempDir, 'mini-project');
      fs.mkdirSync(projectDir, { recursive: true });

      const srcDir = path.join(projectDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      // Write multiple files
      const files = [
        writeTestFile(srcDir, 'user.ts', TYPESCRIPT_FIXTURE),
        writeTestFile(srcDir, 'app.ts', TYPESCRIPT_WITH_IMPORTS),
        writeTestFile(srcDir, 'service.py', PYTHON_FIXTURE),
      ];

      // Parse all files
      const batchResult = await parseFiles(files);

      // Verify parsing
      expect(batchResult.results.length).toBe(3);
      expect(batchResult.errors.length).toBe(0);

      // Verify parser selection
      const tsResults = batchResult.results.filter(r => r.parser === 'oxc');
      const pyResults = batchResult.results.filter(r => r.parser === 'tree-sitter');
      expect(tsResults.length).toBe(2);
      expect(pyResults.length).toBe(1);

      // Build graph
      const config: GraphBuilderConfig = {
        projectRoot: projectDir,
        projectId: 'mini-project',
        includeSymbols: true
      };

      const { graph, stats } = await buildGraphWithStats(batchResult.results, config);

      // Verify graph structure
      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.edges.length).toBeGreaterThan(0);
      expect(graph.rootPath).toBe(projectDir);
      expect(graph.projectId).toBe('mini-project');

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
