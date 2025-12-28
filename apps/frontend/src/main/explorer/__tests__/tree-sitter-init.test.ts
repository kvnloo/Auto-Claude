/**
 * Tree-sitter Parser Initialization Tests
 *
 * Verifies that the tree-sitter parser initializes correctly after WASM path fix.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import {
  initTreeSitter,
  getParser,
  parseCode,
  detectLanguage,
  isParseableFile,
  getParserStats,
  clearParsers
} from '../tree-sitter-parser';

describe('Tree-sitter Parser Initialization', () => {
  beforeAll(async () => {
    // Initialize tree-sitter before running tests
    await initTreeSitter();
  });

  afterAll(() => {
    // Clean up cached parsers
    clearParsers();
  });

  describe('Initialization', () => {
    it('should initialize tree-sitter successfully', async () => {
      const stats = getParserStats();
      expect(stats.initialized).toBe(true);
    });

    it('should report correct supported extensions', () => {
      const stats = getParserStats();
      expect(stats.supportedExtensions).toContain('.py');
      expect(stats.supportedExtensions).toContain('.ts');
      expect(stats.supportedExtensions).toContain('.tsx');
      expect(stats.supportedExtensions).toContain('.js');
      expect(stats.supportedExtensions).toContain('.jsx');
    });
  });

  describe('Language Detection', () => {
    it('should detect Python files', () => {
      expect(detectLanguage('test.py')).toBe('python');
      expect(detectLanguage('test.pyi')).toBe('python');
    });

    it('should detect TypeScript files', () => {
      expect(detectLanguage('test.ts')).toBe('typescript');
      expect(detectLanguage('test.tsx')).toBe('typescript');
    });

    it('should detect JavaScript files', () => {
      expect(detectLanguage('test.js')).toBe('javascript');
      expect(detectLanguage('test.jsx')).toBe('javascript');
      expect(detectLanguage('test.mjs')).toBe('javascript');
      expect(detectLanguage('test.cjs')).toBe('javascript');
    });

    it('should return null for unsupported files', () => {
      expect(detectLanguage('test.txt')).toBeNull();
      expect(detectLanguage('test.md')).toBeNull();
    });

    it('should check if file is parseable', () => {
      expect(isParseableFile('test.py')).toBe(true);
      expect(isParseableFile('test.ts')).toBe(true);
      expect(isParseableFile('test.txt')).toBe(false);
    });
  });

  describe('Python Parser', () => {
    it('should load Python parser', async () => {
      const parser = await getParser('python');
      expect(parser).toBeDefined();
      expect(parser.getLanguage()).toBeDefined();
    });

    it('should parse simple Python code', async () => {
      const parser = await getParser('python');
      const code = 'def hello():\n    print("Hello, World!")';
      const tree = parseCode(parser, code);

      expect(tree).toBeDefined();
      expect(tree.rootNode).toBeDefined();
      expect(tree.rootNode.type).toBe('module');

      // Tree should have function definition
      expect(tree.rootNode.text).toContain('def hello()');

      // Clean up
      tree.delete();
    });

    it('should parse Python class definition', async () => {
      const parser = await getParser('python');
      const code = `
class MyClass:
    def __init__(self, value):
        self.value = value

    def get_value(self):
        return self.value
`;
      const tree = parseCode(parser, code);

      expect(tree).toBeDefined();
      expect(tree.rootNode.type).toBe('module');
      expect(tree.rootNode.text).toContain('class MyClass');

      tree.delete();
    });
  });

  describe('TypeScript Parser', () => {
    it('should load TypeScript parser', async () => {
      const parser = await getParser('typescript');
      expect(parser).toBeDefined();
      expect(parser.getLanguage()).toBeDefined();
    });

    it('should parse simple TypeScript code', async () => {
      const parser = await getParser('typescript');
      const code = 'const greeting: string = "Hello, World!";';
      const tree = parseCode(parser, code);

      expect(tree).toBeDefined();
      expect(tree.rootNode).toBeDefined();
      expect(tree.rootNode.type).toBe('program');
      expect(tree.rootNode.text).toContain('greeting');

      tree.delete();
    });

    it('should parse TypeScript interface', async () => {
      const parser = await getParser('typescript');
      const code = `
interface User {
  id: number;
  name: string;
  email?: string;
}
`;
      const tree = parseCode(parser, code);

      expect(tree).toBeDefined();
      expect(tree.rootNode.type).toBe('program');
      expect(tree.rootNode.text).toContain('interface User');

      tree.delete();
    });

    it('should parse TSX/JSX syntax', async () => {
      const parser = await getParser('typescript');
      const code = `
const Component = () => {
  return <div className="container">Hello</div>;
};
`;
      const tree = parseCode(parser, code);

      expect(tree).toBeDefined();
      expect(tree.rootNode.type).toBe('program');
      expect(tree.rootNode.text).toContain('Component');

      tree.delete();
    });
  });

  describe('JavaScript Parser', () => {
    it('should load JavaScript parser', async () => {
      const parser = await getParser('javascript');
      expect(parser).toBeDefined();
      expect(parser.getLanguage()).toBeDefined();
    });

    it('should parse simple JavaScript code', async () => {
      const parser = await getParser('javascript');
      const code = 'const greeting = "Hello, World!";';
      const tree = parseCode(parser, code);

      expect(tree).toBeDefined();
      expect(tree.rootNode).toBeDefined();
      expect(tree.rootNode.type).toBe('program');

      tree.delete();
    });
  });

  describe('Parser Caching', () => {
    it('should cache parsers per language', async () => {
      const stats1 = getParserStats();
      const initialCachedCount = stats1.cachedLanguages.length;

      // Get a parser for a new language
      await getParser('python');

      const stats2 = getParserStats();
      expect(stats2.cachedLanguages.length).toBeGreaterThan(initialCachedCount);
      expect(stats2.cachedLanguages).toContain('python');
    });

    it('should reuse cached parsers', async () => {
      const parser1 = await getParser('python');
      const parser2 = await getParser('python');

      // Should return the same instance
      expect(parser1).toBe(parser2);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid code gracefully', async () => {
      const parser = await getParser('python');

      // Even invalid code should parse (tree-sitter is fault-tolerant)
      const code = 'def incomplete(';
      const tree = parseCode(parser, code);

      expect(tree).toBeDefined();
      expect(tree.rootNode).toBeDefined();

      tree.delete();
    });
  });
});
