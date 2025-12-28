/**
 * Unit tests for OXC Parser Service
 * Tests the OXC parser implementation for JavaScript/TypeScript files
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type {
  ParserLanguage,
  ExtractedSymbol,
  ExtractedImport,
  UnifiedParseResult,
} from '../types';

// Test samples for parsing
const SAMPLE_TYPESCRIPT_CLASS = `
/**
 * A sample user class
 */
export class User {
  private id: number;
  public name: string;

  constructor(id: number, name: string) {
    this.id = id;
    this.name = name;
  }

  /**
   * Gets the user's display name
   */
  public getDisplayName(): string {
    return this.name;
  }

  public getId(): number {
    return this.id;
  }
}
`;

const SAMPLE_FUNCTION = `
import { formatDate } from './utils';

/**
 * Calculates the total price with tax
 * @param price - The base price
 * @param taxRate - The tax rate as a decimal
 * @returns The total price including tax
 */
export function calculateTotal(price: number, taxRate: number): number {
  return price * (1 + taxRate);
}

const formatPrice = (amount: number): string => {
  return \`$\${amount.toFixed(2)}\`;
};

export default formatPrice;
`;

const SAMPLE_REACT_COMPONENT = `
import React, { useState, useEffect } from 'react';
import type { FC } from 'react';

interface ButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * A reusable button component
 */
export const Button: FC<ButtonProps> = ({ label, onClick, disabled = false }) => {
  const [isPressed, setIsPressed] = useState(false);

  useEffect(() => {
    if (isPressed) {
      const timer = setTimeout(() => setIsPressed(false), 200);
      return () => clearTimeout(timer);
    }
  }, [isPressed]);

  const handleClick = () => {
    setIsPressed(true);
    onClick();
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={isPressed ? 'pressed' : ''}
    >
      {label}
    </button>
  );
};
`;

const SAMPLE_IMPORTS = `
// Named imports
import { UserService, AuthService } from './services';
import { User as UserModel } from './models/User';

// Default import
import express from 'express';

// Namespace import
import * as utils from './utils';

// Side-effect import
import './styles.css';

// Mixed import
import React, { Component, useState } from 'react';
`;

const SAMPLE_TYPESCRIPT_GENERICS = `
export interface Repository<T> {
  find(id: string): Promise<T | null>;
  findAll(): Promise<T[]>;
  save(entity: T): Promise<T>;
  delete(id: string): Promise<void>;
}

export class UserRepository implements Repository<User> {
  private users: Map<string, User> = new Map();

  async find(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  async findAll(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async save(user: User): Promise<User> {
    this.users.set(user.id, user);
    return user;
  }

  async delete(id: string): Promise<void> {
    this.users.delete(id);
  }
}
`;

// Mock implementation - to be replaced with actual OXC parser
// This demonstrates the expected interface and behavior
class MockOXCParser {
  detectLanguage(filePath: string): ParserLanguage | null {
    const ext = filePath.substring(filePath.lastIndexOf('.'));
    switch (ext) {
      case '.ts':
      case '.tsx':
        return 'typescript';
      case '.js':
      case '.jsx':
      case '.mjs':
      case '.cjs':
        return 'javascript';
      default:
        return null;
    }
  }

  canParse(filePath: string): boolean {
    return this.detectLanguage(filePath) !== null;
  }

  parseContent(
    content: string,
    filePath: string,
    language: ParserLanguage
  ): Omit<UnifiedParseResult, 'filePath' | 'parseTimeMs' | 'parser' | 'loc'> {
    // This is a mock implementation
    // The actual OXC parser will use the oxc-parser npm package
    return {
      symbols: [],
      imports: [],
      language,
    };
  }

  parseFile(filePath: string): Promise<UnifiedParseResult> {
    return Promise.reject(new Error('Not implemented - mock only'));
  }
}

describe('OXC Parser', () => {
  let parser: MockOXCParser;

  beforeEach(() => {
    parser = new MockOXCParser();
  });

  // ============================================
  // Language Detection Tests
  // ============================================

  describe('detectLanguage', () => {
    it('should detect TypeScript files', () => {
      expect(parser.detectLanguage('/path/to/file.ts')).toBe('typescript');
      expect(parser.detectLanguage('/src/components/App.tsx')).toBe('typescript');
    });

    it('should detect JavaScript files', () => {
      expect(parser.detectLanguage('/path/to/file.js')).toBe('javascript');
      expect(parser.detectLanguage('/src/components/Button.jsx')).toBe('javascript');
    });

    it('should detect ES Module JavaScript files', () => {
      expect(parser.detectLanguage('/utils/helper.mjs')).toBe('javascript');
      expect(parser.detectLanguage('/config/settings.cjs')).toBe('javascript');
    });

    it('should return null for unsupported files', () => {
      expect(parser.detectLanguage('/path/to/file.py')).toBeNull();
      expect(parser.detectLanguage('/path/to/file.txt')).toBeNull();
      expect(parser.detectLanguage('/path/to/README.md')).toBeNull();
    });

    it('should handle paths without extensions', () => {
      expect(parser.detectLanguage('/path/to/Makefile')).toBeNull();
      expect(parser.detectLanguage('/usr/bin/node')).toBeNull();
    });

    it('should handle relative paths', () => {
      expect(parser.detectLanguage('./src/index.ts')).toBe('typescript');
      expect(parser.detectLanguage('../utils/helper.js')).toBe('javascript');
    });
  });

  describe('canParse', () => {
    it('should return true for JavaScript files', () => {
      expect(parser.canParse('/app.js')).toBe(true);
      expect(parser.canParse('/component.jsx')).toBe(true);
      expect(parser.canParse('/module.mjs')).toBe(true);
    });

    it('should return true for TypeScript files', () => {
      expect(parser.canParse('/app.ts')).toBe(true);
      expect(parser.canParse('/component.tsx')).toBe(true);
    });

    it('should return false for Python files', () => {
      expect(parser.canParse('/script.py')).toBe(false);
    });

    it('should return false for other files', () => {
      expect(parser.canParse('/README.md')).toBe(false);
      expect(parser.canParse('/data.json')).toBe(false);
      expect(parser.canParse('/styles.css')).toBe(false);
    });
  });

  // ============================================
  // Symbol Extraction Tests
  // ============================================

  describe('parseContent - Symbol Extraction', () => {
    it.skip('should extract class name and methods', () => {
      const result = parser.parseContent(
        SAMPLE_TYPESCRIPT_CLASS,
        '/models/User.ts',
        'typescript'
      );

      expect(result.symbols).toHaveLength(1);
      const classSymbol = result.symbols[0];

      expect(classSymbol.name).toBe('User');
      expect(classSymbol.type).toBe('class');
      expect(classSymbol.exports).toBe(true);
      expect(classSymbol.children).toHaveLength(3); // constructor, getDisplayName, getId

      const methods = classSymbol.children.filter((s) => s.type === 'function');
      expect(methods).toHaveLength(2);
      expect(methods.map((m) => m.name)).toContain('getDisplayName');
      expect(methods.map((m) => m.name)).toContain('getId');
    });

    it.skip('should extract function parameters', () => {
      const result = parser.parseContent(
        SAMPLE_FUNCTION,
        '/utils/price.ts',
        'typescript'
      );

      const calculateTotal = result.symbols.find((s) => s.name === 'calculateTotal');
      expect(calculateTotal).toBeDefined();
      expect(calculateTotal?.parameters).toEqual(['price', 'taxRate']);
    });

    it.skip('should extract return types', () => {
      const result = parser.parseContent(
        SAMPLE_FUNCTION,
        '/utils/price.ts',
        'typescript'
      );

      const calculateTotal = result.symbols.find((s) => s.name === 'calculateTotal');
      expect(calculateTotal?.returnType).toBe('number');
    });

    it.skip('should extract JSDoc comments', () => {
      const result = parser.parseContent(
        SAMPLE_TYPESCRIPT_CLASS,
        '/models/User.ts',
        'typescript'
      );

      const classSymbol = result.symbols[0];
      expect(classSymbol.docstring).toContain('A sample user class');

      const getDisplayName = classSymbol.children.find((s) => s.name === 'getDisplayName');
      expect(getDisplayName?.docstring).toContain("Gets the user's display name");
    });

    it.skip('should handle arrow functions', () => {
      const result = parser.parseContent(
        SAMPLE_FUNCTION,
        '/utils/price.ts',
        'typescript'
      );

      const formatPrice = result.symbols.find((s) => s.name === 'formatPrice');
      expect(formatPrice).toBeDefined();
      expect(formatPrice?.type).toBe('function');
      expect(formatPrice?.parameters).toEqual(['amount']);
    });

    it.skip('should handle nested functions', () => {
      const code = `
        function outer() {
          function inner() {
            return 42;
          }
          return inner();
        }
      `;

      const result = parser.parseContent(code, '/test.ts', 'typescript');

      const outer = result.symbols.find((s) => s.name === 'outer');
      expect(outer?.children).toHaveLength(1);
      expect(outer?.children[0].name).toBe('inner');
    });

    it.skip('should extract generic type parameters', () => {
      const result = parser.parseContent(
        SAMPLE_TYPESCRIPT_GENERICS,
        '/repository.ts',
        'typescript'
      );

      const repository = result.symbols.find((s) => s.name === 'Repository');
      expect(repository?.signature).toContain('<T>');

      const userRepo = result.symbols.find((s) => s.name === 'UserRepository');
      expect(userRepo?.signature).toContain('Repository<User>');
    });

    it.skip('should handle React components', () => {
      const result = parser.parseContent(
        SAMPLE_REACT_COMPONENT,
        '/components/Button.tsx',
        'typescript'
      );

      const button = result.symbols.find((s) => s.name === 'Button');
      expect(button).toBeDefined();
      expect(button?.type).toBe('function'); // or 'component' if we detect React components
      expect(button?.exports).toBe(true);

      // Should find nested functions
      const handleClick = button?.children.find((s) => s.name === 'handleClick');
      expect(handleClick).toBeDefined();
    });

    it.skip('should detect exported symbols', () => {
      const result = parser.parseContent(
        SAMPLE_FUNCTION,
        '/utils/price.ts',
        'typescript'
      );

      const calculateTotal = result.symbols.find((s) => s.name === 'calculateTotal');
      expect(calculateTotal?.exports).toBe(true);

      const formatPrice = result.symbols.find((s) => s.name === 'formatPrice');
      expect(formatPrice?.exports).toBe(true); // default export
    });
  });

  // ============================================
  // Import Extraction Tests
  // ============================================

  describe('parseContent - Import Extraction', () => {
    it.skip('should extract named imports', () => {
      const result = parser.parseContent(
        SAMPLE_IMPORTS,
        '/app.ts',
        'typescript'
      );

      const servicesImport = result.imports.find((i) => i.source === './services');
      expect(servicesImport).toBeDefined();
      expect(servicesImport?.items).toContain('UserService');
      expect(servicesImport?.items).toContain('AuthService');
      expect(servicesImport?.isDefault).toBe(false);
    });

    it.skip('should extract default imports', () => {
      const result = parser.parseContent(
        SAMPLE_IMPORTS,
        '/app.ts',
        'typescript'
      );

      const expressImport = result.imports.find((i) => i.source === 'express');
      expect(expressImport).toBeDefined();
      expect(expressImport?.isDefault).toBe(true);
      expect(expressImport?.items).toEqual(['express']);
    });

    it.skip('should extract namespace imports', () => {
      const result = parser.parseContent(
        SAMPLE_IMPORTS,
        '/app.ts',
        'typescript'
      );

      const utilsImport = result.imports.find((i) => i.source === './utils');
      expect(utilsImport).toBeDefined();
      expect(utilsImport?.items).toEqual(['*']);
    });

    it.skip('should detect relative imports', () => {
      const result = parser.parseContent(
        SAMPLE_IMPORTS,
        '/app.ts',
        'typescript'
      );

      const servicesImport = result.imports.find((i) => i.source === './services');
      expect(servicesImport?.isRelative).toBe(true);

      const expressImport = result.imports.find((i) => i.source === 'express');
      expect(expressImport?.isRelative).toBe(false);
    });

    it.skip('should handle aliased imports', () => {
      const result = parser.parseContent(
        SAMPLE_IMPORTS,
        '/app.ts',
        'typescript'
      );

      const userImport = result.imports.find((i) => i.source === './models/User');
      expect(userImport).toBeDefined();
      // The 'User as UserModel' should be captured as 'UserModel' or both
    });

    it.skip('should handle mixed imports', () => {
      const result = parser.parseContent(
        SAMPLE_IMPORTS,
        '/app.ts',
        'typescript'
      );

      const reactImport = result.imports.find((i) => i.source === 'react');
      expect(reactImport).toBeDefined();
      expect(reactImport?.items).toContain('Component');
      expect(reactImport?.items).toContain('useState');
      // Should also capture React as default
    });

    it.skip('should ignore side-effect imports for symbol extraction', () => {
      const result = parser.parseContent(
        SAMPLE_IMPORTS,
        '/app.ts',
        'typescript'
      );

      const cssImport = result.imports.find((i) => i.source === './styles.css');
      // May be included with empty items array, or excluded entirely
      expect(cssImport?.items || []).toHaveLength(0);
    });
  });

  // ============================================
  // Export Extraction Tests
  // ============================================

  describe('parseContent - Export Extraction', () => {
    it.skip('should extract named exports', () => {
      const code = `
        export const API_KEY = 'abc123';
        export function fetchData() { return []; }
        export class DataService {}
      `;

      const result = parser.parseContent(code, '/api.ts', 'typescript');

      expect(result.symbols.some((s) => s.name === 'API_KEY' && s.exports)).toBe(true);
      expect(result.symbols.some((s) => s.name === 'fetchData' && s.exports)).toBe(true);
      expect(result.symbols.some((s) => s.name === 'DataService' && s.exports)).toBe(true);
    });

    it.skip('should extract default exports', () => {
      const code = `
        function main() { return 'hello'; }
        export default main;
      `;

      const result = parser.parseContent(code, '/main.ts', 'typescript');

      const main = result.symbols.find((s) => s.name === 'main');
      expect(main?.exports).toBe(true);
    });

    it.skip('should handle re-exports', () => {
      const code = `
        export { User } from './models/User';
        export * from './utils';
      `;

      const result = parser.parseContent(code, '/index.ts', 'typescript');

      // Re-exports should appear in imports
      expect(result.imports.some((i) => i.source === './models/User')).toBe(true);
      expect(result.imports.some((i) => i.source === './utils')).toBe(true);
    });
  });

  // ============================================
  // Edge Cases and Error Handling
  // ============================================

  describe('Edge Cases', () => {
    it.skip('should handle empty files', () => {
      const result = parser.parseContent('', '/empty.ts', 'typescript');

      expect(result.symbols).toEqual([]);
      expect(result.imports).toEqual([]);
    });

    it.skip('should handle files with only comments', () => {
      const code = `
        // This is a comment
        /* This is a
           multiline comment */
      `;

      const result = parser.parseContent(code, '/comments.ts', 'typescript');

      expect(result.symbols).toEqual([]);
      expect(result.imports).toEqual([]);
    });

    it.skip('should handle syntax errors gracefully', () => {
      const code = `
        function broken( {
          return 'oops';
        }
      `;

      // Should not throw, but may return partial results or empty
      expect(() => {
        parser.parseContent(code, '/broken.ts', 'typescript');
      }).not.toThrow();
    });

    it.skip('should handle very large files', () => {
      const largeCode = 'const x = 1;\n'.repeat(10000);

      expect(() => {
        parser.parseContent(largeCode, '/large.ts', 'typescript');
      }).not.toThrow();
    });

    it.skip('should handle Unicode characters', () => {
      const code = `
        export const greeting = '你好世界';
        export function café() { return '☕'; }
      `;

      const result = parser.parseContent(code, '/unicode.ts', 'typescript');

      expect(result.symbols.some((s) => s.name === 'greeting')).toBe(true);
      expect(result.symbols.some((s) => s.name === 'café')).toBe(true);
    });
  });

  // ============================================
  // Performance Tests
  // ============================================

  describe('Performance', () => {
    it.skip('should parse typical files in under 100ms', () => {
      const start = Date.now();
      parser.parseContent(SAMPLE_TYPESCRIPT_CLASS, '/test.ts', 'typescript');
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it.skip('should include parsing time in result', () => {
      // This would be tested with the actual parseFile method
      // which returns UnifiedParseResult with parseTimeMs
    });
  });

  // ============================================
  // Integration Tests
  // ============================================

  describe('Integration', () => {
    it.skip('should match expected UnifiedParseResult structure', () => {
      const result = parser.parseContent(
        SAMPLE_FUNCTION,
        '/utils/price.ts',
        'typescript'
      );

      // Verify structure matches UnifiedParseResult interface
      expect(result).toHaveProperty('symbols');
      expect(result).toHaveProperty('imports');
      expect(result).toHaveProperty('language');
      expect(Array.isArray(result.symbols)).toBe(true);
      expect(Array.isArray(result.imports)).toBe(true);
    });

    it.skip('should work with real file reading', async () => {
      // This would test parseFile() which reads from disk
      // await expect(parser.parseFile('/real/file.ts')).resolves.toBeDefined();
    });
  });
});
