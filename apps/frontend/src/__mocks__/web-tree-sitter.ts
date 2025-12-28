/**
 * Mock for web-tree-sitter module in tests
 * Provides a lightweight mock that simulates tree-sitter behavior without WASM
 */
import { vi } from 'vitest';

// Mock TreeSitter types
export interface MockTreeSitterNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  childCount: number;
  namedChildren: MockTreeSitterNode[];
  children: MockTreeSitterNode[];
  parent: MockTreeSitterNode | null;
  childForFieldName: (name: string) => MockTreeSitterNode | null;
}

export interface MockTreeSitterTree {
  rootNode: MockTreeSitterNode;
  delete: () => void;
}

export interface MockTreeSitterLanguage {
  name?: string;
}

export interface MockTreeSitterParser {
  parse: (code: string) => MockTreeSitterTree;
  setLanguage: (language: MockTreeSitterLanguage) => void;
  getLanguage: () => MockTreeSitterLanguage;
  delete: () => void;
}

// Helper to create mock nodes
function createMockNode(
  type: string,
  text: string,
  children: MockTreeSitterNode[] = []
): MockTreeSitterNode {
  const node: MockTreeSitterNode = {
    type,
    text,
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: text.length },
    childCount: children.length,
    namedChildren: children,
    children,
    parent: null,
    childForFieldName: (name: string) => {
      // Simple field mapping for common Python structures
      const fieldMappings: Record<string, number> = {
        name: 0,      // Function/class name is usually first child
        parameters: 1, // Parameters are second
        body: -1,      // Body is usually last
        return_type: 2, // Return type annotation
        superclasses: 1 // Superclasses in class definition
      };

      const index = fieldMappings[name];
      if (index === undefined) return null;
      if (index === -1) return children[children.length - 1] || null;
      return children[index] || null;
    }
  };

  // Set parent references
  children.forEach(child => {
    child.parent = node;
  });

  return node;
}

// Simple Python code parser that creates mock AST
function parsePythonCode(code: string): MockTreeSitterTree {
  const children: MockTreeSitterNode[] = [];

  // Parse decorators + functions/classes
  const decoratorPattern = /(@\w+(?:\([^)]*\))?)\s*/g;
  const funcPattern = /(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?:\s*(?:"""([^"]*?)"""|'''([^']*?)''')?/g;
  const classPattern = /class\s+(\w+)(?:\[([^\]]+)\])?(?:\(([^)]*)\))?:\s*(?:"""([^"]*?)"""|'''([^']*?)''')?/g;

  // Find all decorators
  let match;
  const decorators: Array<{ text: string; index: number }> = [];
  decoratorPattern.lastIndex = 0;
  while ((match = decoratorPattern.exec(code)) !== null) {
    decorators.push({ text: match[1], index: match.index });
  }

  // Find functions
  funcPattern.lastIndex = 0;
  while ((match = funcPattern.exec(code)) !== null) {
    const [fullMatch, name, params, returnType, docstring1, docstring2] = match;
    const docstring = docstring1 || docstring2;

    const nameNode = createMockNode('identifier', name);
    const paramsNode = createMockNode('parameters', `(${params})`);

    const bodyChildren: MockTreeSitterNode[] = [];
    if (docstring) {
      const stringNode = createMockNode('string', `"""${docstring}"""`);
      bodyChildren.push(createMockNode('expression_statement', `"""${docstring}"""`, [stringNode]));
    }

    const bodyNode = createMockNode('block', 'pass', bodyChildren);
    const funcChildren = [nameNode, paramsNode];

    if (returnType) {
      funcChildren.push(createMockNode('type', returnType.trim()));
    }

    funcChildren.push(bodyNode);

    // Check if this function has decorators immediately before it
    const applicableDecorators = decorators.filter(d => d.index < match.index && match.index - d.index < 200);

    if (applicableDecorators.length > 0) {
      const decoratorNodes = applicableDecorators.map(d => createMockNode('decorator', d.text));
      const funcNode = createMockNode('function_definition', fullMatch, funcChildren);
      children.push(createMockNode('decorated_definition', fullMatch, [...decoratorNodes, funcNode]));
    } else {
      children.push(createMockNode('function_definition', fullMatch, funcChildren));
    }
  }

  // Find classes and their contents
  classPattern.lastIndex = 0;
  while ((match = classPattern.exec(code)) !== null) {
    const [fullMatch, name, typeParams, superclasses, docstring1, docstring2] = match;
    const docstring = docstring1 || docstring2;

    const nameNode = createMockNode('identifier', name);

    // Find the class body (everything indented after the class line)
    const classStart = match.index + fullMatch.length;
    const classBodyMatch = code.slice(classStart).match(/^(?:[ \t]+.+$\n?)+/m);
    const classBody = classBodyMatch ? classBodyMatch[0] : '';

    const bodyChildren: MockTreeSitterNode[] = [];

    // Add docstring if present
    if (docstring) {
      const stringNode = createMockNode('string', `"""${docstring}"""`);
      bodyChildren.push(createMockNode('expression_statement', `"""${docstring}"""`, [stringNode]));
    }

    // Parse methods inside class
    const methodPattern = /(?:@\w+(?:\([^)]*\))?\s*)*(?:async\s+)?def\s+\w+\s*\([^)]*\)(?:\s*->\s*[^:]+)?:/g;
    let methodMatch;
    while ((methodMatch = methodPattern.exec(classBody)) !== null) {
      const methodText = methodMatch[0];
      if (methodText.includes('@')) {
        bodyChildren.push(createMockNode('decorated_definition', methodText));
      } else {
        bodyChildren.push(createMockNode('function_definition', methodText));
      }
    }

    // Parse class attributes (assignments)
    const attrPattern = /^\s{4}(\w+)\s*=\s*.+$/gm;
    let attrMatch;
    while ((attrMatch = attrPattern.exec(classBody)) !== null) {
      bodyChildren.push(createMockNode('expression_statement', attrMatch[0].trim()));
    }

    const bodyNode = createMockNode('block', classBody || 'pass', bodyChildren);
    const classChildren = [nameNode];

    if (superclasses) {
      const superNode = createMockNode('argument_list', `(${superclasses})`);
      classChildren.push(superNode);
    }

    classChildren.push(bodyNode);

    // Check for decorators
    const applicableDecorators = decorators.filter(d => d.index < match.index && match.index - d.index < 200);

    if (applicableDecorators.length > 0) {
      const decoratorNodes = applicableDecorators.map(d => createMockNode('decorator', d.text));
      const classNode = createMockNode('class_definition', fullMatch + classBody, classChildren);
      children.push(createMockNode('decorated_definition', fullMatch + classBody, [...decoratorNodes, classNode]));
    } else {
      children.push(createMockNode('class_definition', fullMatch + classBody, classChildren));
    }
  }

  // Parse standalone imports
  const importPattern = /^import\s+[\w., ]+$/gm;
  while ((match = importPattern.exec(code)) !== null) {
    children.push(createMockNode('import_statement', match[0]));
  }

  const fromImportPattern = /^from\s+[\w.]+\s+import\s+.+$/gm;
  while ((match = fromImportPattern.exec(code)) !== null) {
    children.push(createMockNode('import_from_statement', match[0]));
  }

  // Parse with statements
  if (code.includes('with ')) {
    const withPattern = /with\s+.+:/g;
    while ((match = withPattern.exec(code)) !== null) {
      children.push(createMockNode('with_statement', match[0]));
    }
  }

  // Parse try-except
  if (code.includes('try:')) {
    const tryPattern = /try:\s*[\s\S]*?(?:except\s+\w+.*?:[\s\S]*?)*(?:finally:[\s\S]*?)?(?=\n\S|$)/g;
    while ((match = tryPattern.exec(code)) !== null) {
      const tryText = match[0];
      const exceptMatches = Array.from(tryText.matchAll(/except\s+\w+.*?:/g));
      const finallyMatch = tryText.match(/finally:/);

      const tryChildren: MockTreeSitterNode[] = [];
      exceptMatches.forEach(em => {
        tryChildren.push(createMockNode('except_clause', em[0]));
      });
      if (finallyMatch) {
        tryChildren.push(createMockNode('finally_clause', 'finally:'));
      }

      children.push(createMockNode('try_statement', tryText, tryChildren));
    }
  }

  // Parse comprehensions
  if (code.includes('for ') && code.includes(' in ')) {
    const listCompPattern = /\[[^\]]+\s+for\s+[^\]]+\s+in\s+[^\]]+\]/g;
    while ((match = listCompPattern.exec(code)) !== null) {
      children.push(createMockNode('list_comprehension', match[0]));
    }

    const dictCompPattern = /\{[^}]+:\s*[^}]+\s+for\s+[^}]+\s+in\s+[^}]+\}/g;
    while ((match = dictCompPattern.exec(code)) !== null) {
      children.push(createMockNode('dictionary_comprehension', match[0]));
    }
  }

  // Parse if statements with walrus operator
  if (code.includes(':=')) {
    const walrusIfPattern = /if\s+\([^)]*:=[^)]*\):/g;
    while ((match = walrusIfPattern.exec(code)) !== null) {
      children.push(createMockNode('if_statement', match[0]));
    }
  }

  // Parse lambda
  if (code.includes('lambda ')) {
    const lambdaPattern = /lambda\s+[^:]+:\s*[^\n]+/g;
    while ((match = lambdaPattern.exec(code)) !== null) {
      children.push(createMockNode('lambda', match[0]));
    }
  }

  // Parse f-strings
  if (code.includes('f"') || code.includes("f'")) {
    const fstringPattern = /f["'][^"']*["']/g;
    while ((match = fstringPattern.exec(code)) !== null) {
      children.push(createMockNode('string', match[0]));
    }
  }

  // Parse module docstring (first """ or ''' in file)
  const moduleDocPattern = /^(?:\s*\n)*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/;
  match = code.match(moduleDocPattern);
  if (match) {
    const docstring = match[1] || match[2];
    const stringNode = createMockNode('string', match[0]);
    children.unshift(createMockNode('expression_statement', match[0], [stringNode]));
  }

  const rootNode = createMockNode('module', code, children);

  return {
    rootNode,
    delete: vi.fn()
  };
}

// Mock Language class (must be defined before MockParser)
class MockLanguage implements MockTreeSitterLanguage {
  name?: string;

  static async load(wasmPath: string): Promise<MockLanguage> {
    // Extract language name from path
    const match = wasmPath.match(/tree-sitter-(\w+)\.wasm/);
    const lang = new MockLanguage();
    lang.name = match ? match[1] : 'unknown';
    return lang;
  }
}

// Mock Parser class
class MockParser implements MockTreeSitterParser {
  private language: MockTreeSitterLanguage | null = null;

  // Static Language property (required by tree-sitter-parser)
  static Language = MockLanguage;

  parse(code: string): MockTreeSitterTree {
    // Simple mock parsing - just create a basic tree structure
    return parsePythonCode(code);
  }

  setLanguage(language: MockTreeSitterLanguage): void {
    this.language = language;
  }

  getLanguage(): MockTreeSitterLanguage {
    return this.language || { name: 'unknown' };
  }

  delete(): void {
    // No-op in mock
  }

  static async init(_options?: { locateFile?: (file: string) => string }): Promise<void> {
    // Mock initialization - just resolve immediately
    return Promise.resolve();
  }
}

// Export the mock Parser as default
export default MockParser;
export { MockParser as Parser, MockLanguage as Language };
