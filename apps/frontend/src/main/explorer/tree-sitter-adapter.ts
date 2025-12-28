/**
 * Tree-sitter to Unified Interface Adapter
 *
 * Converts Tree-sitter ParseResult (raw AST) into UnifiedParseResult (extracted symbols/imports).
 * This adapter preserves Python-specific extraction logic that was in graph-builder.ts.
 *
 * Supports:
 * - Python: class definitions, function definitions, module-level assignments, imports
 * - TypeScript: classes, functions, interfaces, types, imports
 * - JavaScript: classes, functions, variables, imports
 */

import * as path from 'path';
import type {
  UnifiedParseResult,
  ExtractedSymbol,
  ExtractedImport,
  ParseResult,
  TreeSitterNode,
  ParserLanguage
} from './types';

// ============================================
// Node Type Mappings by Language
// ============================================

/**
 * AST node types that represent classes in each language
 */
const CLASS_NODE_TYPES: Record<ParserLanguage, string[]> = {
  typescript: ['class_declaration', 'class', 'abstract_class_declaration'],
  javascript: ['class_declaration', 'class'],
  python: ['class_definition']
};

/**
 * AST node types that represent functions in each language
 */
const FUNCTION_NODE_TYPES: Record<ParserLanguage, string[]> = {
  typescript: [
    'function_declaration',
    'method_definition',
    'arrow_function',
    'function',
    'function_expression',
    'method_signature'
  ],
  javascript: [
    'function_declaration',
    'method_definition',
    'arrow_function',
    'function',
    'function_expression'
  ],
  python: ['function_definition']
};

/**
 * AST node types that represent importable symbols (depth 5)
 */
const SYMBOL_NODE_TYPES: Record<ParserLanguage, string[]> = {
  typescript: [
    'variable_declaration',
    'lexical_declaration',
    'type_alias_declaration',
    'interface_declaration',
    'enum_declaration',
    'const_declaration'
  ],
  javascript: [
    'variable_declaration',
    'lexical_declaration'
  ],
  python: [
    'assignment',
    'expression_statement'
  ]
};

/**
 * AST node types that represent import statements
 */
const IMPORT_NODE_TYPES: Record<ParserLanguage, string[]> = {
  typescript: ['import_statement', 'import_declaration', 'import'],
  javascript: ['import_statement', 'import_declaration', 'import'],
  python: ['import_statement', 'import_from_statement']
};

// ============================================
// Main Adapter Function
// ============================================

/**
 * Convert Tree-sitter ParseResult to UnifiedParseResult
 *
 * @param parseResult - Raw Tree-sitter parse result with AST tree
 * @returns Unified parse result with extracted symbols and imports
 */
export function adaptTreeSitterResult(parseResult: ParseResult): UnifiedParseResult {
  const { tree, language, filePath, parseTimeMs } = parseResult;

  // Extract symbols from AST
  const symbols = extractSymbolsFromNode(tree.rootNode, language, null);

  // Extract import statements
  const imports = extractImportsFromNode(tree.rootNode, language);

  // Count lines of code
  const loc = tree.rootNode.endPosition.row + 1;

  return {
    symbols,
    imports,
    language,
    filePath,
    parseTimeMs,
    parser: 'tree-sitter',
    loc
  };
}

// ============================================
// Symbol Extraction
// ============================================

/**
 * Recursively extract symbols from an AST node
 */
function extractSymbolsFromNode(
  node: TreeSitterNode,
  language: ParserLanguage,
  parentClass: string | null
): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];
  const classTypes = CLASS_NODE_TYPES[language];
  const functionTypes = FUNCTION_NODE_TYPES[language];
  const symbolTypes = SYMBOL_NODE_TYPES[language];

  for (const child of node.children) {
    // Check if this is a class
    if (classTypes.includes(child.type)) {
      const classSymbol = extractClassSymbol(child, language);
      if (classSymbol) {
        symbols.push(classSymbol);
      }
      continue;
    }

    // Check if this is a function/method
    if (functionTypes.includes(child.type)) {
      const funcSymbol = extractFunctionSymbol(child, language, parentClass);
      if (funcSymbol) {
        symbols.push(funcSymbol);
      }
      continue;
    }

    // Check if this is a variable/symbol declaration (depth 5)
    if (symbolTypes.includes(child.type)) {
      const varSymbols = extractVariableSymbols(child, language);
      symbols.push(...varSymbols);
      continue;
    }

    // Check for exported declarations (TypeScript/JavaScript)
    if (child.type === 'export_statement' || child.type === 'export_declaration') {
      const exportedSymbols = extractExportedSymbols(child, language, parentClass);
      symbols.push(...exportedSymbols);
      continue;
    }

    // Recurse into statement blocks
    if (shouldRecurseInto(child.type)) {
      const nestedSymbols = extractSymbolsFromNode(child, language, parentClass);
      symbols.push(...nestedSymbols);
    }
  }

  return symbols;
}

/**
 * Extract class symbol with its methods
 */
function extractClassSymbol(
  node: TreeSitterNode,
  language: ParserLanguage
): ExtractedSymbol | null {
  const name = getNodeName(node, language);
  if (!name) return null;

  const docstring = getDocstring(node, language);
  const children = extractClassMembers(node, language, name);

  return {
    name,
    type: 'class',
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    docstring,
    exports: false, // Will be updated based on export context
    children
  };
}

/**
 * Extract class members (methods, properties)
 */
function extractClassMembers(
  node: TreeSitterNode,
  language: ParserLanguage,
  className: string
): ExtractedSymbol[] {
  const members: ExtractedSymbol[] = [];

  // Find the class body
  const body = findChildByType(node, ['class_body', 'block']);
  if (!body) return members;

  const functionTypes = FUNCTION_NODE_TYPES[language];

  for (const child of body.children) {
    if (functionTypes.includes(child.type)) {
      const method = extractFunctionSymbol(child, language, className);
      if (method) {
        members.push(method);
      }
    }
  }

  return members;
}

/**
 * Extract function/method symbol
 */
function extractFunctionSymbol(
  node: TreeSitterNode,
  language: ParserLanguage,
  parentClass: string | null
): ExtractedSymbol | null {
  const name = getNodeName(node, language);
  if (!name) return null;

  const docstring = getDocstring(node, language);
  const signature = getFunctionSignature(node, language);
  const parameters = getFunctionParameters(node, language);
  const returnType = getReturnType(node, language);

  return {
    name,
    type: 'function',
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    docstring,
    signature,
    parameters,
    returnType,
    parentClass: parentClass || undefined,
    exports: false,
    children: []
  };
}

/**
 * Extract variable declarations as symbols
 */
function extractVariableSymbols(
  node: TreeSitterNode,
  language: ParserLanguage
): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];

  // For TypeScript/JavaScript variable declarations
  if (language === 'typescript' || language === 'javascript') {
    const declarators = findChildrenByType(node, ['variable_declarator']);
    for (const decl of declarators) {
      const nameNode = findChildByType(decl, ['identifier']);
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          type: 'symbol',
          startLine: decl.startPosition.row + 1,
          endLine: decl.endPosition.row + 1,
          exports: false,
          children: []
        });
      }
    }
  }

  // For Python assignments at module level
  if (language === 'python') {
    const leftSide = node.children[0];
    if (leftSide && leftSide.type === 'identifier') {
      symbols.push({
        name: leftSide.text,
        type: 'symbol',
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        exports: true, // Python module-level = exported
        children: []
      });
    }
  }

  return symbols;
}

/**
 * Extract exported declarations (handles export statements)
 */
function extractExportedSymbols(
  node: TreeSitterNode,
  language: ParserLanguage,
  parentClass: string | null
): ExtractedSymbol[] {
  const symbols: ExtractedSymbol[] = [];

  // Find the declaration inside the export
  for (const child of node.children) {
    const nestedSymbols = extractSymbolsFromNode(child, language, parentClass);
    for (const sym of nestedSymbols) {
      sym.exports = true;
      symbols.push(sym);
    }
  }

  return symbols;
}

// ============================================
// Import Extraction
// ============================================

/**
 * Extract import statements from an AST node
 */
function extractImportsFromNode(
  node: TreeSitterNode,
  language: ParserLanguage
): ExtractedImport[] {
  const imports: ExtractedImport[] = [];
  const importTypes = IMPORT_NODE_TYPES[language];

  for (const child of node.children) {
    if (importTypes.includes(child.type)) {
      const extracted = extractSingleImport(child, language);
      if (extracted) {
        imports.push(extracted);
      }
    }
  }

  return imports;
}

/**
 * Extract a single import statement
 */
function extractSingleImport(
  node: TreeSitterNode,
  language: ParserLanguage
): ExtractedImport | null {
  if (language === 'typescript' || language === 'javascript') {
    return extractJSImport(node);
  }
  if (language === 'python') {
    return extractPythonImport(node);
  }
  return null;
}

/**
 * Extract JavaScript/TypeScript import
 */
function extractJSImport(node: TreeSitterNode): ExtractedImport | null {
  // Find the source string
  const sourceNode = findChildByType(node, ['string', 'string_literal']);
  if (!sourceNode) return null;

  // Remove quotes from source
  const source = sourceNode.text.replace(/['"]/g, '');
  const isRelative = source.startsWith('.') || source.startsWith('/');

  // Find imported items
  const items: string[] = [];
  let isDefault = false;

  // Check for named imports { a, b, c }
  const namedImports = findChildByType(node, ['named_imports', 'import_specifier']);
  if (namedImports) {
    const identifiers = findChildrenByType(namedImports, ['identifier', 'import_specifier']);
    for (const id of identifiers) {
      items.push(id.text);
    }
  }

  // Check for default import
  const importClause = findChildByType(node, ['import_clause']);
  if (importClause) {
    const defaultId = findChildByType(importClause, ['identifier']);
    if (defaultId && !items.includes(defaultId.text)) {
      items.push(defaultId.text);
      isDefault = true;
    }
  }

  // Check for namespace import: import * as foo
  const namespaceImport = findChildByType(node, ['namespace_import']);
  if (namespaceImport) {
    items.push('*');
  }

  // If no items found, it might be a side-effect import
  if (items.length === 0) {
    items.push('*');
  }

  return { source, items, isDefault, isRelative };
}

/**
 * Extract Python import
 *
 * Handles:
 * - import foo, bar
 * - from foo import bar, baz
 * - from . import foo (relative imports)
 * - from ..module import bar (relative imports with dots)
 * - from foo import * (wildcard imports)
 */
function extractPythonImport(node: TreeSitterNode): ExtractedImport | null {
  const items: string[] = [];
  let source = '';

  if (node.type === 'import_statement') {
    // import foo, bar
    const names = findChildrenByType(node, ['dotted_name', 'aliased_import']);
    for (const nameNode of names) {
      const name = nameNode.text.split(' ')[0]; // Handle "foo as bar"
      items.push(name);
      if (!source) source = name;
    }
  } else if (node.type === 'import_from_statement') {
    // from foo import bar, baz
    const moduleNode = findChildByType(node, ['dotted_name', 'relative_import']);
    if (moduleNode) {
      source = moduleNode.text;
    }

    // Check for wildcard import
    if (node.text.includes('*')) {
      items.push('*');
    } else {
      const importedNames = findChildrenByType(node, ['dotted_name', 'aliased_import']);
      // Skip the first one (it's the module name)
      for (let i = 1; i < importedNames.length; i++) {
        const name = importedNames[i].text.split(' ')[0];
        items.push(name);
      }
    }
  }

  if (!source) return null;

  const isRelative = source.startsWith('.');
  return { source, items, isRelative };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get the name identifier from a node
 */
function getNodeName(
  node: TreeSitterNode,
  language: ParserLanguage
): string | null {
  // Look for common name patterns
  const nameTypes = ['identifier', 'name', 'property_identifier', 'type_identifier'];

  for (const child of node.children) {
    if (nameTypes.includes(child.type)) {
      return child.text;
    }
  }

  return null;
}

/**
 * Get docstring/JSDoc for a node
 */
function getDocstring(
  node: TreeSitterNode,
  language: ParserLanguage
): string | undefined {
  // Check previous sibling for comment
  const prev = node.previousNamedSibling;
  if (prev) {
    if (prev.type === 'comment' || prev.type === 'string' || prev.type === 'expression_statement') {
      const text = prev.text.trim();
      // Check if it looks like a docstring
      if (text.startsWith('/**') || text.startsWith('"""') || text.startsWith("'''") || text.startsWith('//')) {
        return cleanDocstring(text);
      }
    }
  }
  return undefined;
}

/**
 * Clean up docstring formatting
 */
function cleanDocstring(text: string): string {
  return text
    .replace(/^\/\*\*|\*\/$/g, '') // Remove /** and */
    .replace(/^"""|"""$/g, '')      // Remove Python triple quotes
    .replace(/^'''|'''$/g, '')      // Remove Python single triple quotes
    .replace(/^\s*\*\s?/gm, '')     // Remove leading * from JSDoc lines
    .replace(/^\/\/\s?/gm, '')      // Remove // from comments
    .trim();
}

/**
 * Get function signature
 */
function getFunctionSignature(
  node: TreeSitterNode,
  language: ParserLanguage
): string | undefined {
  const params = findChildByType(node, ['formal_parameters', 'parameters']);
  if (params) {
    return params.text;
  }
  return undefined;
}

/**
 * Get function parameters
 */
function getFunctionParameters(
  node: TreeSitterNode,
  language: ParserLanguage
): string[] | undefined {
  const params = findChildByType(node, ['formal_parameters', 'parameters']);
  if (!params) return undefined;

  const paramList: string[] = [];
  const paramTypes = ['identifier', 'required_parameter', 'optional_parameter', 'typed_parameter', 'default_parameter'];

  for (const child of params.children) {
    if (paramTypes.includes(child.type)) {
      const idNode = findChildByType(child, ['identifier']) || child;
      if (idNode.type === 'identifier') {
        paramList.push(idNode.text);
      }
    }
  }

  return paramList.length > 0 ? paramList : undefined;
}

/**
 * Get return type annotation
 */
function getReturnType(
  node: TreeSitterNode,
  language: ParserLanguage
): string | undefined {
  const returnType = findChildByType(node, ['type_annotation', 'return_type']);
  if (returnType) {
    return returnType.text.replace(/^:\s*/, '');
  }
  return undefined;
}

/**
 * Find child node by type
 */
function findChildByType(
  node: TreeSitterNode,
  types: string[]
): TreeSitterNode | null {
  for (const child of node.children) {
    if (types.includes(child.type)) {
      return child;
    }
  }
  return null;
}

/**
 * Find all children of given types
 */
function findChildrenByType(
  node: TreeSitterNode,
  types: string[]
): TreeSitterNode[] {
  const results: TreeSitterNode[] = [];

  const searchRecursive = (n: TreeSitterNode): void => {
    for (const child of n.children) {
      if (types.includes(child.type)) {
        results.push(child);
      }
      searchRecursive(child);
    }
  };

  searchRecursive(node);
  return results;
}

/**
 * Check if we should recurse into a node type
 */
function shouldRecurseInto(nodeType: string): boolean {
  const recurseTypes = [
    'program',
    'module',
    'statement_block',
    'block',
    'decorated_definition',
    'export_statement'
  ];
  return recurseTypes.includes(nodeType);
}
