/**
 * Unit tests for Parser Router
 * Tests routing logic between OXC and tree-sitter parsers
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getParserForFile,
  isParseableFile,
  getExtensionsForParser,
  getSupportedExtensions,
  parseFile,
  parseFiles,
  initializeParsers,
  type BatchParseResult,
} from '../parser-router';
import type { UnifiedParseResult, ParserBackend } from '../types';

// Mock the parser backends
vi.mock('../oxc-parser', () => ({
  parseFile: vi.fn(),
}));

vi.mock('../tree-sitter-parser', () => ({
  parseFile: vi.fn(),
  initTreeSitter: vi.fn(),
}));

describe('Parser Router', () => {
  describe('getParserForFile', () => {
    it('should route .ts to oxc', () => {
      expect(getParserForFile('file.ts')).toBe('oxc');
    });

    it('should route .tsx to oxc', () => {
      expect(getParserForFile('file.tsx')).toBe('oxc');
    });

    it('should route .js to oxc', () => {
      expect(getParserForFile('file.js')).toBe('oxc');
    });

    it('should route .jsx to oxc', () => {
      expect(getParserForFile('file.jsx')).toBe('oxc');
    });

    it('should route .mjs to oxc', () => {
      expect(getParserForFile('file.mjs')).toBe('oxc');
    });

    it('should route .cjs to oxc', () => {
      expect(getParserForFile('file.cjs')).toBe('oxc');
    });

    it('should route .py to tree-sitter', () => {
      expect(getParserForFile('file.py')).toBe('tree-sitter');
    });

    it('should route .pyi to tree-sitter', () => {
      expect(getParserForFile('file.pyi')).toBe('tree-sitter');
    });

    it('should return null for unsupported files', () => {
      expect(getParserForFile('file.rs')).toBeNull();
      expect(getParserForFile('file.go')).toBeNull();
      expect(getParserForFile('file.java')).toBeNull();
      expect(getParserForFile('file.cpp')).toBeNull();
    });

    it('should handle files with no extension', () => {
      expect(getParserForFile('README')).toBeNull();
      expect(getParserForFile('Makefile')).toBeNull();
    });

    it('should be case-insensitive for extensions', () => {
      expect(getParserForFile('file.TS')).toBe('oxc');
      expect(getParserForFile('file.PY')).toBe('tree-sitter');
      expect(getParserForFile('file.Jsx')).toBe('oxc');
    });

    it('should handle paths with directories', () => {
      expect(getParserForFile('/src/components/App.tsx')).toBe('oxc');
      expect(getParserForFile('src/utils/helper.js')).toBe('oxc');
      expect(getParserForFile('/backend/api/routes.py')).toBe('tree-sitter');
    });
  });

  describe('isParseableFile', () => {
    it('should return true for TypeScript files', () => {
      expect(isParseableFile('app.ts')).toBe(true);
      expect(isParseableFile('component.tsx')).toBe(true);
    });

    it('should return true for JavaScript files', () => {
      expect(isParseableFile('main.js')).toBe(true);
      expect(isParseableFile('app.jsx')).toBe(true);
      expect(isParseableFile('module.mjs')).toBe(true);
      expect(isParseableFile('config.cjs')).toBe(true);
    });

    it('should return true for Python files', () => {
      expect(isParseableFile('main.py')).toBe(true);
      expect(isParseableFile('types.pyi')).toBe(true);
    });

    it('should return false for unsupported extensions', () => {
      expect(isParseableFile('data.json')).toBe(false);
      expect(isParseableFile('styles.css')).toBe(false);
      expect(isParseableFile('README.md')).toBe(false);
      expect(isParseableFile('image.png')).toBe(false);
    });

    it('should handle paths with directories', () => {
      expect(isParseableFile('/src/components/App.tsx')).toBe(true);
      expect(isParseableFile('/assets/logo.svg')).toBe(false);
    });

    it('should handle relative paths', () => {
      expect(isParseableFile('./src/index.ts')).toBe(true);
      expect(isParseableFile('../utils/helper.js')).toBe(true);
      expect(isParseableFile('../../backend/api.py')).toBe(true);
    });
  });

  describe('getExtensionsForParser', () => {
    it('should return JS/TS extensions for oxc', () => {
      const exts = getExtensionsForParser('oxc');
      expect(exts).toContain('.ts');
      expect(exts).toContain('.tsx');
      expect(exts).toContain('.js');
      expect(exts).toContain('.jsx');
      expect(exts).toContain('.mjs');
      expect(exts).toContain('.cjs');
    });

    it('should return Python extensions for tree-sitter', () => {
      const exts = getExtensionsForParser('tree-sitter');
      expect(exts).toContain('.py');
      expect(exts).toContain('.pyi');
    });

    it('should not overlap between parsers', () => {
      const oxcExts = getExtensionsForParser('oxc');
      const treeSitterExts = getExtensionsForParser('tree-sitter');

      const overlap = oxcExts.filter((ext) => treeSitterExts.includes(ext));
      expect(overlap).toHaveLength(0);
    });

    it('should return arrays that can be modified without affecting the source', () => {
      const exts1 = getExtensionsForParser('oxc');
      const exts2 = getExtensionsForParser('oxc');

      exts1.push('.fake');
      expect(exts2).not.toContain('.fake');
    });
  });

  describe('getSupportedExtensions', () => {
    it('should return all supported extensions', () => {
      const exts = getSupportedExtensions();

      // TypeScript/JavaScript
      expect(exts).toContain('.ts');
      expect(exts).toContain('.tsx');
      expect(exts).toContain('.js');
      expect(exts).toContain('.jsx');
      expect(exts).toContain('.mjs');
      expect(exts).toContain('.cjs');

      // Python
      expect(exts).toContain('.py');
      expect(exts).toContain('.pyi');
    });

    it('should return at least 8 extensions', () => {
      const exts = getSupportedExtensions();
      expect(exts.length).toBeGreaterThanOrEqual(8);
    });

    it('should return a new array each time', () => {
      const exts1 = getSupportedExtensions();
      const exts2 = getSupportedExtensions();

      exts1.push('.fake');
      expect(exts2).not.toContain('.fake');
    });
  });

  describe('parseFile', () => {
    let mockOxcParseFile: ReturnType<typeof vi.fn>;
    let mockTreeSitterParseFile: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      // Clear all mocks
      vi.clearAllMocks();

      // Get mock functions
      const oxcParser = await import('../oxc-parser');
      const treeSitterParser = await import('../tree-sitter-parser');
      mockOxcParseFile = oxcParser.parseFile as ReturnType<typeof vi.fn>;
      mockTreeSitterParseFile = treeSitterParser.parseFile as ReturnType<typeof vi.fn>;
    });

    it('should route TypeScript files to OXC parser', async () => {
      const mockResult: UnifiedParseResult = {
        symbols: [],
        imports: [],
        language: 'typescript',
        filePath: '/src/app.ts',
        parseTimeMs: 10,
        parser: 'oxc',
        loc: 100,
      };

      mockOxcParseFile.mockResolvedValue(mockResult);

      const result = await parseFile('/src/app.ts');

      expect(mockOxcParseFile).toHaveBeenCalledWith('/src/app.ts');
      expect(mockTreeSitterParseFile).not.toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });

    it('should route JavaScript files to OXC parser', async () => {
      const mockResult: UnifiedParseResult = {
        symbols: [],
        imports: [],
        language: 'javascript',
        filePath: '/src/main.js',
        parseTimeMs: 8,
        parser: 'oxc',
        loc: 50,
      };

      mockOxcParseFile.mockResolvedValue(mockResult);

      const result = await parseFile('/src/main.js');

      expect(mockOxcParseFile).toHaveBeenCalledWith('/src/main.js');
      expect(mockTreeSitterParseFile).not.toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });

    it('should route Python files to tree-sitter parser', async () => {
      const mockResult: UnifiedParseResult = {
        symbols: [],
        imports: [],
        language: 'python',
        filePath: '/backend/api.py',
        parseTimeMs: 15,
        parser: 'tree-sitter',
        loc: 200,
      };

      mockTreeSitterParseFile.mockResolvedValue(mockResult);

      const result = await parseFile('/backend/api.py');

      expect(mockTreeSitterParseFile).toHaveBeenCalledWith('/backend/api.py');
      expect(mockOxcParseFile).not.toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });

    it('should return null for unsupported file types', async () => {
      const result = await parseFile('/README.md');

      expect(result).toBeNull();
      expect(mockOxcParseFile).not.toHaveBeenCalled();
      expect(mockTreeSitterParseFile).not.toHaveBeenCalled();
    });

    it('should wrap parser errors with context', async () => {
      mockOxcParseFile.mockRejectedValue(new Error('Syntax error'));

      await expect(parseFile('/src/broken.ts')).rejects.toThrow(
        'Failed to parse /src/broken.ts with oxc'
      );
    });

    it('should handle non-Error rejections', async () => {
      mockTreeSitterParseFile.mockRejectedValue('Unknown error');

      await expect(parseFile('/backend/broken.py')).rejects.toThrow(
        'Failed to parse /backend/broken.py with tree-sitter: Unknown error'
      );
    });
  });

  describe('parseFiles', () => {
    let mockOxcParseFile: ReturnType<typeof vi.fn>;
    let mockTreeSitterParseFile: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      vi.clearAllMocks();

      const oxcParser = await import('../oxc-parser');
      const treeSitterParser = await import('../tree-sitter-parser');
      mockOxcParseFile = oxcParser.parseFile as ReturnType<typeof vi.fn>;
      mockTreeSitterParseFile = treeSitterParser.parseFile as ReturnType<typeof vi.fn>;
    });

    it('should route files to correct parsers', async () => {
      const tsResult: UnifiedParseResult = {
        symbols: [],
        imports: [],
        language: 'typescript',
        filePath: '/src/app.ts',
        parseTimeMs: 10,
        parser: 'oxc',
        loc: 100,
      };

      const pyResult: UnifiedParseResult = {
        symbols: [],
        imports: [],
        language: 'python',
        filePath: '/backend/api.py',
        parseTimeMs: 15,
        parser: 'tree-sitter',
        loc: 200,
      };

      mockOxcParseFile.mockResolvedValue(tsResult);
      mockTreeSitterParseFile.mockResolvedValue(pyResult);

      const result = await parseFiles(['/src/app.ts', '/backend/api.py']);

      expect(mockOxcParseFile).toHaveBeenCalledWith('/src/app.ts');
      expect(mockTreeSitterParseFile).toHaveBeenCalledWith('/backend/api.py');
      expect(result.results).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
    });

    it('should collect statistics', async () => {
      const tsResult: UnifiedParseResult = {
        symbols: [],
        imports: [],
        language: 'typescript',
        filePath: '/src/app.ts',
        parseTimeMs: 10,
        parser: 'oxc',
        loc: 100,
      };

      const jsResult: UnifiedParseResult = {
        symbols: [],
        imports: [],
        language: 'javascript',
        filePath: '/src/main.js',
        parseTimeMs: 8,
        parser: 'oxc',
        loc: 50,
      };

      const pyResult: UnifiedParseResult = {
        symbols: [],
        imports: [],
        language: 'python',
        filePath: '/backend/api.py',
        parseTimeMs: 15,
        parser: 'tree-sitter',
        loc: 200,
      };

      mockOxcParseFile.mockResolvedValue(tsResult);
      mockOxcParseFile.mockResolvedValueOnce(tsResult);
      mockOxcParseFile.mockResolvedValueOnce(jsResult);
      mockTreeSitterParseFile.mockResolvedValue(pyResult);

      const result = await parseFiles(['/src/app.ts', '/src/main.js', '/backend/api.py']);

      expect(result.stats.oxcCount).toBe(2);
      expect(result.stats.treeSitterCount).toBe(1);
      expect(result.stats.totalTimeMs).toBeGreaterThan(0);
    });

    it('should handle errors gracefully', async () => {
      const tsResult: UnifiedParseResult = {
        symbols: [],
        imports: [],
        language: 'typescript',
        filePath: '/src/app.ts',
        parseTimeMs: 10,
        parser: 'oxc',
        loc: 100,
      };

      mockOxcParseFile.mockResolvedValueOnce(tsResult);
      mockOxcParseFile.mockRejectedValueOnce(new Error('Syntax error'));

      const result = await parseFiles(['/src/app.ts', '/src/broken.ts']);

      expect(result.results).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].filePath).toBe('/src/broken.ts');
      expect(result.errors[0].error).toContain('Syntax error');
    });

    it('should skip unsupported files', async () => {
      const tsResult: UnifiedParseResult = {
        symbols: [],
        imports: [],
        language: 'typescript',
        filePath: '/src/app.ts',
        parseTimeMs: 10,
        parser: 'oxc',
        loc: 100,
      };

      mockOxcParseFile.mockResolvedValue(tsResult);

      const result = await parseFiles(['/src/app.ts', '/README.md', '/data.json']);

      expect(result.results).toHaveLength(1);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].filePath).toBe('/README.md');
      expect(result.errors[0].error).toBe('Unsupported file type');
      expect(result.errors[1].filePath).toBe('/data.json');
      expect(result.errors[1].error).toBe('Unsupported file type');
    });

    it('should parse files in parallel', async () => {
      const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      mockOxcParseFile.mockImplementation(async (filePath: string) => {
        await delay(100);
        return {
          symbols: [],
          imports: [],
          language: 'typescript',
          filePath,
          parseTimeMs: 100,
          parser: 'oxc',
          loc: 100,
        };
      });

      const startTime = performance.now();
      await parseFiles(['/src/app.ts', '/src/utils.ts', '/src/types.ts']);
      const elapsed = performance.now() - startTime;

      // If parallel, should take ~100ms, not ~300ms
      expect(elapsed).toBeLessThan(200);
    });

    it('should handle empty array', async () => {
      const result = await parseFiles([]);

      expect(result.results).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(result.stats.oxcCount).toBe(0);
      expect(result.stats.treeSitterCount).toBe(0);
    });

    it('should handle mixed success and failure', async () => {
      const tsResult: UnifiedParseResult = {
        symbols: [],
        imports: [],
        language: 'typescript',
        filePath: '/src/app.ts',
        parseTimeMs: 10,
        parser: 'oxc',
        loc: 100,
      };

      mockOxcParseFile
        .mockResolvedValueOnce(tsResult)
        .mockRejectedValueOnce(new Error('Parse error'))
        .mockResolvedValueOnce(tsResult);

      const result = await parseFiles(['/src/app.ts', '/src/broken.ts', '/src/utils.ts']);

      expect(result.results).toHaveLength(2);
      expect(result.errors).toHaveLength(1);
      expect(result.stats.oxcCount).toBe(2);
    });
  });

  describe('initializeParsers', () => {
    let mockTreeSitterInitialize: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      vi.clearAllMocks();

      const treeSitterParser = await import('../tree-sitter-parser');
      mockTreeSitterInitialize = treeSitterParser.initTreeSitter as ReturnType<typeof vi.fn>;
    });

    it('should initialize tree-sitter parser', async () => {
      mockTreeSitterInitialize.mockResolvedValue(undefined);

      await initializeParsers();

      expect(mockTreeSitterInitialize).toHaveBeenCalled();
    });

    it('should throw if tree-sitter initialization fails', async () => {
      mockTreeSitterInitialize.mockRejectedValue(new Error('Tree-sitter init failed'));

      await expect(initializeParsers()).rejects.toThrow('Failed to initialize parsers');
      await expect(initializeParsers()).rejects.toThrow('Tree-sitter init failed');
    });

    it('should handle non-Error rejections', async () => {
      mockTreeSitterInitialize.mockRejectedValue('Unknown error');

      await expect(initializeParsers()).rejects.toThrow('Failed to initialize parsers');
      await expect(initializeParsers()).rejects.toThrow('Unknown error');
    });
  });

  describe('Edge Cases', () => {
    it('should handle paths with multiple dots', () => {
      expect(getParserForFile('file.test.ts')).toBe('oxc');
      expect(getParserForFile('module.spec.js')).toBe('oxc');
      expect(getParserForFile('utils.helper.py')).toBe('tree-sitter');
    });

    it('should handle hidden files', () => {
      expect(getParserForFile('.eslintrc.js')).toBe('oxc');
      expect(getParserForFile('.babelrc.cjs')).toBe('oxc');
    });

    it('should handle Windows-style paths', () => {
      expect(getParserForFile('C:\\Users\\project\\src\\app.ts')).toBe('oxc');
      expect(getParserForFile('C:\\backend\\api.py')).toBe('tree-sitter');
    });

    it('should handle mixed path separators', () => {
      expect(getParserForFile('/src\\components/App.tsx')).toBe('oxc');
    });

    it('should handle very long paths', () => {
      const longPath = '/very/long/path/'.repeat(50) + 'file.ts';
      expect(getParserForFile(longPath)).toBe('oxc');
    });

    it('should handle paths with special characters', () => {
      expect(getParserForFile('/src/@types/index.ts')).toBe('oxc');
      expect(getParserForFile('/backend/api-v2.py')).toBe('tree-sitter');
      expect(getParserForFile('/utils/helper_util.py')).toBe('tree-sitter');
    });

    it('should handle trailing slashes', () => {
      // Paths shouldn't normally have trailing slashes for files, but test anyway
      expect(getParserForFile('file.ts/')).toBeNull();
    });
  });
});
