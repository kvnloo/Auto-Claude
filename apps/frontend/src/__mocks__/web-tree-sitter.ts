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

// Helper to create mock nodes from simple Python parsing
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
  const lines = code.split('\n').filter(line => line.trim());
  const children: MockTreeSitterNode[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Parse function definitions
    if (trimmed.startsWith('def ') || trimmed.startsWith('async def ')) {
      const funcMatch = trimmed.match(/(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?:/);
      if (funcMatch) {
        const [, name, params, returnType] = funcMatch;
        const nameNode = createMockNode('identifier', name);
        const paramsNode = createMockNode('parameters', `(${params})`, []);
        const bodyNode = createMockNode('block', 'pass', []);
        const funcChildren = [nameNode, paramsNode];

        if (returnType) {
          funcChildren.push(createMockNode('type', returnType.trim()));
        }

        funcChildren.push(bodyNode);
        children.push(createMockNode('function_definition', trimmed, funcChildren));
      }
    }

    // Parse class definitions
    else if (trimmed.startsWith('class ')) {
      const classMatch = trimmed.match(/class\s+(\w+)(?:\[([^\]]+)\])?(?:\(([^)]*)\))?:/);
      if (classMatch) {
        const [, name, typeParams, superclasses] = classMatch;
        const nameNode = createMockNode('identifier', name);
        const bodyNode = createMockNode('block', 'pass', []);
        const classChildren = [nameNode];

        if (superclasses) {
          const superNode = createMockNode('argument_list', `(${superclasses})`, []);
          classChildren.push(superNode);
        }

        classChildren.push(bodyNode);
        children.push(createMockNode('class_definition', trimmed, classChildren));
      }
    }

    // Parse decorators
    else if (trimmed.startsWith('@')) {
      children.push(createMockNode('decorator', trimmed, []));
    }

    // Parse import statements
    else if (trimmed.startsWith('import ')) {
      children.push(createMockNode('import_statement', trimmed, []));
    }
    else if (trimmed.startsWith('from ')) {
      children.push(createMockNode('import_from_statement', trimmed, []));
    }

    // Parse docstrings and strings
    else if (trimmed.startsWith('"""') || trimmed.startsWith("'''") || trimmed.startsWith('f"')) {
      const stringNode = createMockNode('string', trimmed, []);
      children.push(createMockNode('expression_statement', trimmed, [stringNode]));
    }

    // Parse lambda
    else if (trimmed.includes('lambda ')) {
      const lambdaMatch = trimmed.match(/lambda\s+[^:]+:\s*.+/);
      if (lambdaMatch) {
        children.push(createMockNode('lambda', lambdaMatch[0], []));
      }
    }

    // Parse with statements
    else if (trimmed.startsWith('with ')) {
      children.push(createMockNode('with_statement', trimmed, []));
    }

    // Parse try-except
    else if (trimmed.startsWith('try:')) {
      children.push(createMockNode('try_statement', 'try:', []));
    }
    else if (trimmed.startsWith('except ')) {
      children.push(createMockNode('except_clause', trimmed, []));
    }
    else if (trimmed.startsWith('finally:')) {
      children.push(createMockNode('finally_clause', trimmed, []));
    }

    // Parse comprehensions
    else if (trimmed.includes('[') && trimmed.includes('for ') && trimmed.includes('in ')) {
      children.push(createMockNode('list_comprehension', trimmed, []));
    }
    else if (trimmed.includes('{') && trimmed.includes('for ') && trimmed.includes('in ') && trimmed.includes(':')) {
      children.push(createMockNode('dictionary_comprehension', trimmed, []));
    }

    // Parse if statements
    else if (trimmed.startsWith('if ') && trimmed.includes(':=')) {
      children.push(createMockNode('if_statement', trimmed, []));
    }

    // Parse assignments and expressions
    else if (trimmed.includes('=') && !trimmed.includes('==')) {
      children.push(createMockNode('expression_statement', trimmed, []));
    }
  }

  // Handle decorated definitions
  const processedChildren: MockTreeSitterNode[] = [];
  let i = 0;
  while (i < children.length) {
    if (children[i].type === 'decorator') {
      const decorators: MockTreeSitterNode[] = [];
      while (i < children.length && children[i].type === 'decorator') {
        decorators.push(children[i]);
        i++;
      }
      if (i < children.length && (children[i].type === 'function_definition' || children[i].type === 'class_definition')) {
        const definition = children[i];
        const decorated = createMockNode(
          'decorated_definition',
          decorators.map(d => d.text).join('\n') + '\n' + definition.text,
          [...decorators, definition]
        );
        processedChildren.push(decorated);
        i++;
      }
    } else {
      processedChildren.push(children[i]);
      i++;
    }
  }

  const rootNode = createMockNode('module', code, processedChildren);

  return {
    rootNode,
    delete: vi.fn()
  };
}

// Mock Parser class
class MockParser implements MockTreeSitterParser {
  private language: MockTreeSitterLanguage | null = null;

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

// Mock Language class
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

// Export the mock Parser as default
export default MockParser;
export { MockParser as Parser, MockLanguage as Language };
