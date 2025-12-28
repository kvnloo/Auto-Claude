/**
 * OXC Parser Service for JavaScript/TypeScript
 *
 * High-performance parser using oxc-parser for:
 * - TypeScript (.ts, .tsx)
 * - JavaScript (.js, .jsx, .mjs, .cjs)
 *
 * This parser extracts symbols (classes, functions, types) and imports
 * from JS/TS files and provides a unified interface compatible with
 * the explorer's type system.
 */

import { readFile } from 'fs/promises';
import { basename, extname } from 'path';
import { parseSync } from 'oxc-parser';
import type {
  ParserLanguage,
  UnifiedParseResult,
  ExtractedSymbol,
  ExtractedImport,
  ParserBackend,
} from './types';
import type { NodeType } from '../../shared/types';

// ============================================
// Language Detection
// ============================================

/**
 * Detect programming language from file extension
 */
export function detectLanguage(filePath: string): ParserLanguage | null {
  const ext = extname(filePath);
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

/**
 * Check if a file can be parsed by OXC
 */
export function canParse(filePath: string): boolean {
  return detectLanguage(filePath) !== null;
}

// ============================================
// Single File Parsing
// ============================================

/**
 * Parse a single file using OXC
 */
export async function parseFile(filePath: string): Promise<UnifiedParseResult> {
  const startTime = performance.now();

  // Detect language
  const language = detectLanguage(filePath);
  if (!language) {
    throw new Error(`Unsupported file type: ${filePath}`);
  }

  // Read file contents
  const sourceText = await readFile(filePath, 'utf-8');
  const loc = sourceText.split('\n').length;

  // Parse with OXC
  const sourceType = language === 'typescript' ? 'ts' : 'js';
  const parseResult = parseSync(sourceText, { sourceFilename: filePath, sourceType });

  if (parseResult.errors.length > 0) {
    const errorMessages = parseResult.errors.map((e) => e.message).join(', ');
    throw new Error(`Parse errors in ${filePath}: ${errorMessages}`);
  }

  // Extract symbols and imports from AST
  const symbols = extractSymbols(parseResult.program, filePath, sourceText);
  const imports = extractImports(parseResult.program);

  const parseTimeMs = performance.now() - startTime;

  return {
    symbols,
    imports,
    language,
    filePath,
    parseTimeMs,
    parser: 'oxc' as ParserBackend,
    loc,
  };
}

// ============================================
// Batch Parsing
// ============================================

/**
 * Parse multiple files in parallel
 */
export async function parseFiles(filePaths: string[]): Promise<{
  results: UnifiedParseResult[];
  errors: Array<{ filePath: string; error: string }>;
}> {
  const results: UnifiedParseResult[] = [];
  const errors: Array<{ filePath: string; error: string }> = [];

  await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        const result = await parseFile(filePath);
        results.push(result);
      } catch (error) {
        errors.push({
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );

  return { results, errors };
}

// ============================================
// Symbol Extraction
// ============================================

/**
 * Extract symbols (classes, functions, types, etc.) from OXC AST
 */
function extractSymbols(
  program: any,
  filePath: string,
  sourceText: string,
): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const lines = sourceText.split('\n');

  // Get line number from byte offset
  const getLineNumber = (offset: number): number => {
    let currentOffset = 0;
    for (let i = 0; i < lines.length; i++) {
      currentOffset += lines[i].length + 1; // +1 for newline
      if (currentOffset > offset) {
        return i + 1; // 1-indexed
      }
    }
    return lines.length;
  };

  // Extract JSDoc comment before a node
  const extractJSDoc = (startOffset: number): string | undefined => {
    const startLine = getLineNumber(startOffset);
    const relevantLines = lines.slice(Math.max(0, startLine - 10), startLine - 1);

    // Look for JSDoc comment (/** ... */)
    const jsDocPattern = /\/\*\*([\s\S]*?)\*\//;
    const reversed = [...relevantLines].reverse();

    for (const line of reversed) {
      const match = line.match(jsDocPattern);
      if (match) {
        return match[1]
          .split('\n')
          .map((l) => l.trim().replace(/^\*\s?/, ''))
          .join(' ')
          .trim();
      }
      // Stop if we hit a non-comment line
      if (line.trim() && !line.trim().startsWith('*') && !line.trim().startsWith('//')) {
        break;
      }
    }

    return undefined;
  };

  // Visit each top-level statement
  if (program.body && Array.isArray(program.body)) {
    for (const node of program.body) {
      const extracted = extractSymbolFromNode(node, sourceText, getLineNumber, extractJSDoc);
      if (extracted) {
        symbols.push(extracted);
      }
    }
  }

  return symbols;
}

/**
 * Extract a symbol from a single AST node
 */
function extractSymbolFromNode(
  node: any,
  sourceText: string,
  getLineNumber: (offset: number) => number,
  extractJSDoc: (offset: number) => string | undefined,
  parentClass?: string,
): ExtractedSymbol | null {
  const startLine = getLineNumber(node.span.start);
  const endLine = getLineNumber(node.span.end);
  const docstring = extractJSDoc(node.span.start);

  // Check if exported
  const isExport = node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration';

  // Handle export declarations
  if (isExport && node.declaration) {
    const innerSymbol = extractSymbolFromNode(
      node.declaration,
      sourceText,
      getLineNumber,
      extractJSDoc,
      parentClass,
    );
    if (innerSymbol) {
      innerSymbol.exports = true;
      return innerSymbol;
    }
  }

  switch (node.type) {
    case 'ClassDeclaration':
    case 'ClassExpression': {
      const className = node.id?.name || 'AnonymousClass';
      const children: ExtractedSymbol[] = [];

      // Extract methods
      if (node.body?.body && Array.isArray(node.body.body)) {
        for (const member of node.body.body) {
          if (member.type === 'MethodDefinition' || member.type === 'PropertyDefinition') {
            const method = extractSymbolFromNode(
              member,
              sourceText,
              getLineNumber,
              extractJSDoc,
              className,
            );
            if (method) {
              children.push(method);
            }
          }
        }
      }

      return {
        name: className,
        type: 'class' as NodeType,
        startLine,
        endLine,
        docstring,
        exports: isExport,
        children,
      };
    }

    case 'MethodDefinition': {
      const methodName = node.key?.name || 'unknown';
      const params =
        node.value?.params?.map((p: any) => p.pattern?.name || p.name || 'param') || [];

      return {
        name: methodName,
        type: 'function' as NodeType,
        startLine,
        endLine,
        docstring,
        parameters: params,
        parentClass,
        exports: false, // Methods inherit class export status
        children: [],
      };
    }

    case 'FunctionDeclaration':
    case 'FunctionExpression': {
      const funcName = node.id?.name || 'anonymous';
      const params = node.params?.map((p: any) => p.pattern?.name || p.name || 'param') || [];
      const returnType = node.returnType?.typeAnnotation?.type || undefined;

      return {
        name: funcName,
        type: 'function' as NodeType,
        startLine,
        endLine,
        docstring,
        parameters: params,
        returnType,
        exports: isExport,
        children: [],
      };
    }

    case 'ArrowFunctionExpression': {
      // Arrow functions are usually part of variable declarations
      return null;
    }

    case 'VariableDeclaration': {
      // Check if any declarator contains a function
      if (node.declarations && Array.isArray(node.declarations)) {
        for (const declarator of node.declarations) {
          if (
            declarator.init &&
            (declarator.init.type === 'ArrowFunctionExpression' ||
              declarator.init.type === 'FunctionExpression')
          ) {
            const funcName = declarator.id?.name || 'anonymous';
            const params =
              declarator.init.params?.map((p: any) => p.pattern?.name || p.name || 'param') || [];
            const returnType = declarator.init.returnType?.typeAnnotation?.type || undefined;

            return {
              name: funcName,
              type: 'function' as NodeType,
              startLine,
              endLine,
              docstring,
              parameters: params,
              returnType,
              exports: isExport,
              children: [],
            };
          }

          // Regular variable (const/let/var)
          const varName = declarator.id?.name || 'unknown';
          return {
            name: varName,
            type: 'symbol' as NodeType,
            startLine,
            endLine,
            docstring,
            exports: isExport,
            children: [],
          };
        }
      }
      return null;
    }

    case 'TSInterfaceDeclaration': {
      const interfaceName = node.id?.name || 'AnonymousInterface';
      return {
        name: interfaceName,
        type: 'symbol' as NodeType, // Use 'symbol' since NodeType doesn't have 'interface'
        startLine,
        endLine,
        docstring,
        exports: isExport,
        children: [],
      };
    }

    case 'TSTypeAliasDeclaration': {
      const typeName = node.id?.name || 'AnonymousType';
      return {
        name: typeName,
        type: 'symbol' as NodeType, // Use 'symbol' since NodeType doesn't have 'type'
        startLine,
        endLine,
        docstring,
        exports: isExport,
        children: [],
      };
    }

    case 'TSEnumDeclaration': {
      const enumName = node.id?.name || 'AnonymousEnum';
      return {
        name: enumName,
        type: 'symbol' as NodeType, // Use 'symbol' since NodeType doesn't have 'enum'
        startLine,
        endLine,
        docstring,
        exports: isExport,
        children: [],
      };
    }

    default:
      return null;
  }
}

// ============================================
// Import Extraction
// ============================================

/**
 * Extract import statements from OXC AST
 */
function extractImports(program: any): ExtractedImport[] {
  const imports: ExtractedImport[] = [];

  if (!program.body || !Array.isArray(program.body)) {
    return imports;
  }

  for (const node of program.body) {
    // ES Module imports
    if (node.type === 'ImportDeclaration') {
      const source = node.source?.value || '';
      const isRelative = source.startsWith('.') || source.startsWith('/');
      const items: string[] = [];
      let isDefault = false;

      // Extract imported items
      if (node.specifiers && Array.isArray(node.specifiers)) {
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportDefaultSpecifier') {
            items.push(specifier.local.name);
            isDefault = true;
          } else if (specifier.type === 'ImportNamespaceSpecifier') {
            items.push('*');
          } else if (specifier.type === 'ImportSpecifier') {
            items.push(specifier.imported?.name || specifier.local.name);
          }
        }
      }

      imports.push({
        source,
        items: items.length > 0 ? items : ['*'],
        isDefault,
        isRelative,
      });
    }

    // CommonJS require() - represented as variable declaration with require call
    if (node.type === 'VariableDeclaration' && node.declarations) {
      for (const declarator of node.declarations) {
        if (
          declarator.init &&
          declarator.init.type === 'CallExpression' &&
          declarator.init.callee?.name === 'require'
        ) {
          const source = declarator.init.arguments?.[0]?.value || '';
          const isRelative = source.startsWith('.') || source.startsWith('/');
          const varName = declarator.id?.name || 'unknown';

          imports.push({
            source,
            items: [varName],
            isDefault: true,
            isRelative,
          });
        }
      }
    }
  }

  return imports;
}
