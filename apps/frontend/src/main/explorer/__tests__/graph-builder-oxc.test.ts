/**
 * Tests for OXC symbol extraction functions in graph-builder
 */

import { describe, it, expect } from 'vitest';
import { extractClassNodes, extractInterfaceNodes, symbolToNode, extractEdges, extractNodes } from '../graph-builder';
import type { UnifiedParseResult, ExtractedSymbol } from '../types';
import type { GraphNode } from '../../../shared/types';

describe('OXC Symbol Extraction', () => {
  const projectPath = '/test/project';

  describe('symbolToNode', () => {
    it('should convert a class symbol to a GraphNode', () => {
      const symbol: ExtractedSymbol = {
        name: 'MyClass',
        type: 'class',
        startLine: 1,
        endLine: 10,
        docstring: 'A test class',
        signature: 'class MyClass',
        parameters: [],
        returnType: undefined,
        parentClass: undefined,
        exports: true,
        children: []
      };

      const node = symbolToNode(symbol, 'src/MyClass.ts', projectPath);

      expect(node.id).toBe('class:src/MyClass.ts:MyClass');
      expect(node.name).toBe('MyClass');
      expect(node.type).toBe('class');
      expect(node.filePath).toBe('src/MyClass.ts');
      expect(node.depth).toBe(3);
      expect(node.metadata.startLine).toBe(1);
      expect(node.metadata.endLine).toBe(10);
      expect(node.metadata.loc).toBe(10);
      expect(node.metadata.docstring).toBe('A test class');
      expect(node.metadata.complexity).toBe('low');
    });

    it('should convert a function symbol to a GraphNode', () => {
      const symbol: ExtractedSymbol = {
        name: 'myFunction',
        type: 'function',
        startLine: 5,
        endLine: 20,
        docstring: 'A test function',
        signature: 'function myFunction(a: number): string',
        parameters: ['a'],
        returnType: 'string',
        parentClass: undefined,
        exports: false,
        children: []
      };

      const node = symbolToNode(symbol, 'src/utils.ts', projectPath);

      expect(node.id).toBe('function:src/utils.ts:myFunction');
      expect(node.name).toBe('myFunction');
      expect(node.type).toBe('function');
      expect(node.depth).toBe(4);
      expect(node.metadata.parameters).toEqual(['a']);
      expect(node.metadata.returnType).toBe('string');
    });

    it('should handle method symbols with parentClass', () => {
      const symbol: ExtractedSymbol = {
        name: 'myMethod',
        type: 'function',
        startLine: 12,
        endLine: 15,
        docstring: undefined,
        signature: 'myMethod()',
        parameters: [],
        returnType: 'void',
        parentClass: 'MyClass',
        exports: false,
        children: []
      };

      const node = symbolToNode(symbol, 'src/MyClass.ts', projectPath);

      expect(node.metadata.parentClass).toBe('MyClass');
    });
  });

  describe('extractClassNodes', () => {
    it('should extract class nodes from parse result', () => {
      const parseResult: UnifiedParseResult = {
        symbols: [
          {
            name: 'MyClass',
            type: 'class',
            startLine: 1,
            endLine: 10,
            docstring: 'A test class',
            exports: true,
            children: []
          },
          {
            name: 'myFunction',
            type: 'function',
            startLine: 12,
            endLine: 15,
            exports: false,
            children: []
          }
        ],
        imports: [],
        language: 'typescript',
        filePath: `${projectPath}/src/MyClass.ts`,
        parseTimeMs: 10,
        parser: 'oxc',
        loc: 20
      };

      const nodes = extractClassNodes(parseResult, projectPath);

      expect(nodes).toHaveLength(1);
      expect(nodes[0].name).toBe('MyClass');
      expect(nodes[0].type).toBe('class');
    });

    it('should extract nested class nodes', () => {
      const parseResult: UnifiedParseResult = {
        symbols: [
          {
            name: 'OuterClass',
            type: 'class',
            startLine: 1,
            endLine: 20,
            exports: true,
            children: [
              {
                name: 'InnerClass',
                type: 'class',
                startLine: 5,
                endLine: 10,
                exports: false,
                children: []
              },
              {
                name: 'method',
                type: 'function',
                startLine: 12,
                endLine: 15,
                exports: false,
                children: []
              }
            ]
          }
        ],
        imports: [],
        language: 'typescript',
        filePath: `${projectPath}/src/Nested.ts`,
        parseTimeMs: 10,
        parser: 'oxc',
        loc: 25
      };

      const nodes = extractClassNodes(parseResult, projectPath);

      expect(nodes).toHaveLength(2);
      expect(nodes[0].name).toBe('OuterClass');
      expect(nodes[1].name).toBe('InnerClass');
    });
  });

  describe('extractInterfaceNodes', () => {
    it('should extract interface nodes from TypeScript files', () => {
      const parseResult: UnifiedParseResult = {
        symbols: [
          {
            name: 'MyInterface',
            type: 'symbol',
            startLine: 1,
            endLine: 5,
            signature: 'interface MyInterface',
            docstring: 'An interface',
            exports: true,
            children: []
          },
          {
            name: 'MyType',
            type: 'symbol',
            startLine: 7,
            endLine: 10,
            signature: 'type MyType = string',
            exports: true,
            children: []
          }
        ],
        imports: [],
        language: 'typescript',
        filePath: `${projectPath}/src/types.ts`,
        parseTimeMs: 10,
        parser: 'oxc',
        loc: 15
      };

      const nodes = extractInterfaceNodes(parseResult, projectPath);

      expect(nodes).toHaveLength(2);
      expect(nodes[0].name).toBe('MyInterface');
      expect(nodes[1].name).toBe('MyType');
    });

    it('should return empty array for JavaScript files', () => {
      const parseResult: UnifiedParseResult = {
        symbols: [
          {
            name: 'myVariable',
            type: 'symbol',
            startLine: 1,
            endLine: 1,
            exports: false,
            children: []
          }
        ],
        imports: [],
        language: 'javascript',
        filePath: `${projectPath}/src/utils.js`,
        parseTimeMs: 10,
        parser: 'oxc',
        loc: 5
      };

      const nodes = extractInterfaceNodes(parseResult, projectPath);

      expect(nodes).toHaveLength(0);
    });

    it('should filter out non-interface symbols', () => {
      const parseResult: UnifiedParseResult = {
        symbols: [
          {
            name: 'MyInterface',
            type: 'symbol',
            startLine: 1,
            endLine: 5,
            signature: 'interface MyInterface',
            exports: true,
            children: []
          },
          {
            name: 'myVariable',
            type: 'symbol',
            startLine: 7,
            endLine: 7,
            signature: 'const myVariable = 42',
            exports: false,
            children: []
          }
        ],
        imports: [],
        language: 'typescript',
        filePath: `${projectPath}/src/types.ts`,
        parseTimeMs: 10,
        parser: 'oxc',
        loc: 10
      };

      const nodes = extractInterfaceNodes(parseResult, projectPath);

      expect(nodes).toHaveLength(1);
      expect(nodes[0].name).toBe('MyInterface');
    });
  });

  describe('extractEdges', () => {
    it('should build import edges from parse results', () => {
      const parseResult1: UnifiedParseResult = {
        symbols: [],
        imports: [
          {
            source: './utils',
            items: ['helper'],
            isDefault: false,
            isRelative: true
          }
        ],
        language: 'typescript',
        filePath: `${projectPath}/src/main.ts`,
        parseTimeMs: 10,
        parser: 'oxc',
        loc: 10
      };

      const parseResult2: UnifiedParseResult = {
        symbols: [],
        imports: [],
        language: 'typescript',
        filePath: `${projectPath}/src/utils.ts`,
        parseTimeMs: 10,
        parser: 'oxc',
        loc: 20
      };

      // Convert to extraction format by building nodes first
      const extractions = [
        {
          filePath: `${projectPath}/src/main.ts`,
          relativePath: 'src/main.ts',
          language: 'typescript' as const,
          symbols: [],
          imports: parseResult1.imports,
          loc: 10,
          parser: 'oxc' as const,
          parseTimeMs: 10
        },
        {
          filePath: `${projectPath}/src/utils.ts`,
          relativePath: 'src/utils.ts',
          language: 'typescript' as const,
          symbols: [],
          imports: [],
          loc: 20,
          parser: 'oxc' as const,
          parseTimeMs: 10
        }
      ];

      const nodes = extractNodes(extractions, { projectRoot: projectPath, projectId: 'test' });
      const edges = extractEdges(extractions, nodes, { projectRoot: projectPath, projectId: 'test' });

      // Find the import edge
      const importEdge = edges.find(e => e.type === 'imports');
      expect(importEdge).toBeDefined();
      expect(importEdge?.source).toBe('file:src/main.ts');
      expect(importEdge?.target).toBe('file:src/utils.ts');
      expect(importEdge?.label).toBe('helper');
    });

    it('should build containment edges', () => {
      const parseResult: UnifiedParseResult = {
        symbols: [
          {
            name: 'MyClass',
            type: 'class',
            startLine: 1,
            endLine: 10,
            exports: true,
            children: []
          }
        ],
        imports: [],
        language: 'typescript',
        filePath: `${projectPath}/src/MyClass.ts`,
        parseTimeMs: 10,
        parser: 'oxc',
        loc: 10
      };

      const extractions = [{
        filePath: parseResult.filePath,
        relativePath: 'src/MyClass.ts',
        language: parseResult.language,
        symbols: parseResult.symbols,
        imports: parseResult.imports,
        loc: parseResult.loc,
        parser: parseResult.parser,
        parseTimeMs: parseResult.parseTimeMs
      }];

      const nodes = extractNodes(extractions, { projectRoot: projectPath, projectId: 'test' });
      const edges = extractEdges(extractions, nodes, { projectRoot: projectPath, projectId: 'test' });

      // Should have containment edges: dir -> file and file -> class
      const containsEdges = edges.filter(e => e.type === 'contains');
      expect(containsEdges.length).toBeGreaterThan(0);

      // Verify file contains class
      const fileContainsClass = containsEdges.find(
        e => e.source === 'file:src/MyClass.ts' && e.target === 'class:src/MyClass.ts:MyClass'
      );
      expect(fileContainsClass).toBeDefined();
    });

    it('should skip external imports', () => {
      const parseResult: UnifiedParseResult = {
        symbols: [],
        imports: [
          {
            source: 'react',
            items: ['useState'],
            isDefault: false,
            isRelative: false  // External import
          }
        ],
        language: 'typescript',
        filePath: `${projectPath}/src/App.tsx`,
        parseTimeMs: 10,
        parser: 'oxc',
        loc: 30
      };

      const extractions = [{
        filePath: parseResult.filePath,
        relativePath: 'src/App.tsx',
        language: parseResult.language,
        symbols: parseResult.symbols,
        imports: parseResult.imports,
        loc: parseResult.loc,
        parser: parseResult.parser,
        parseTimeMs: parseResult.parseTimeMs
      }];

      const nodes = extractNodes(extractions, { projectRoot: projectPath, projectId: 'test' });
      const edges = extractEdges(extractions, nodes, { projectRoot: projectPath, projectId: 'test' });

      // Should not create import edges for external imports
      const importEdges = edges.filter(e => e.type === 'imports');
      expect(importEdges.length).toBe(0);
    });
  });
});
