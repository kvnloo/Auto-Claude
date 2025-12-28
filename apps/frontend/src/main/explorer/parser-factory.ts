/**
 * Parser Factory - Lazy loading and initialization of parsers
 *
 * This module provides a factory for creating and managing parser instances.
 * Parsers are lazily initialized (only loaded when first used) to improve
 * startup performance.
 *
 * Key features:
 * - Singleton pattern for parser instances
 * - Lazy initialization (parsers loaded only when first used)
 * - Easy to test with reset functionality
 * - Promise-based async initialization
 */

import type { ParserBackend, UnifiedParseResult } from './types';

/**
 * Parser instance interface
 */
interface ParserInstance {
  /** Whether the parser has been initialized */
  initialized: boolean;
  /** Initialize the parser (load grammars, etc.) */
  initialize(): Promise<void>;
  /** Parse a file and extract symbols and imports */
  parseFile(filePath: string): Promise<UnifiedParseResult>;
}

/**
 * OXC parser implementation (for JavaScript/TypeScript)
 */
class OxcParserInstance implements ParserInstance {
  initialized = false;
  private parser: any = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // TODO: Import and initialize OXC parser
      // This will be implemented when OXC parser is available
      // For now, we just mark as initialized
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize OXC parser: ${error}`);
    }
  }

  async parseFile(filePath: string): Promise<UnifiedParseResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    // TODO: Implement OXC parsing
    // This is a placeholder that will be replaced with actual OXC parsing
    throw new Error('OXC parser not yet implemented');
  }
}

/**
 * Tree-sitter parser implementation (for all languages)
 */
class TreeSitterParserInstance implements ParserInstance {
  initialized = false;
  private parser: any = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // TODO: Import and initialize Tree-sitter parser
      // This will use the existing tree-sitter-parser.ts module
      // For now, we just mark as initialized
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize Tree-sitter parser: ${error}`);
    }
  }

  async parseFile(filePath: string): Promise<UnifiedParseResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    // TODO: Implement Tree-sitter parsing
    // This will use the existing tree-sitter-parser.ts module
    throw new Error('Tree-sitter parser not yet implemented');
  }
}

/**
 * Factory for creating and managing parser instances
 */
export class ParserFactory {
  private static oxcParser: ParserInstance | null = null;
  private static treeSitterParser: ParserInstance | null = null;

  /**
   * Get or create OXC parser instance
   * Lazily initializes the parser on first use
   */
  static async getOxcParser(): Promise<ParserInstance> {
    if (!this.oxcParser) {
      this.oxcParser = new OxcParserInstance();
    }
    if (!this.oxcParser.initialized) {
      await this.oxcParser.initialize();
    }
    return this.oxcParser;
  }

  /**
   * Get or create Tree-sitter parser instance
   * Lazily initializes the parser on first use
   */
  static async getTreeSitterParser(): Promise<ParserInstance> {
    if (!this.treeSitterParser) {
      this.treeSitterParser = new TreeSitterParserInstance();
    }
    if (!this.treeSitterParser.initialized) {
      await this.treeSitterParser.initialize();
    }
    return this.treeSitterParser;
  }

  /**
   * Get parser by backend type
   * @param backend - Parser backend to use ('oxc' or 'tree-sitter')
   * @returns Parser instance for the specified backend
   */
  static async getParser(backend: ParserBackend): Promise<ParserInstance> {
    switch (backend) {
      case 'oxc':
        return this.getOxcParser();
      case 'tree-sitter':
        return this.getTreeSitterParser();
      default:
        throw new Error(`Unknown parser backend: ${backend}`);
    }
  }

  /**
   * Initialize all parsers (for eager loading)
   * Useful for preloading parsers at app startup
   */
  static async initializeAll(): Promise<void> {
    await Promise.all([this.getOxcParser(), this.getTreeSitterParser()]);
  }

  /**
   * Check if a parser is initialized
   * @param backend - Parser backend to check
   * @returns True if the parser is initialized
   */
  static isInitialized(backend: ParserBackend): boolean {
    switch (backend) {
      case 'oxc':
        return this.oxcParser?.initialized ?? false;
      case 'tree-sitter':
        return this.treeSitterParser?.initialized ?? false;
      default:
        return false;
    }
  }

  /**
   * Reset all parsers (for testing)
   * Clears all parser instances and forces re-initialization
   */
  static reset(): void {
    this.oxcParser = null;
    this.treeSitterParser = null;
  }
}

/**
 * Default parser factory instance
 * Use this for most cases unless you need to manage the lifecycle yourself
 */
export const parserFactory = ParserFactory;
