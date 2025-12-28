/**
 * Unit tests for Tree-sitter Python Parser
 * Tests Python-specific parsing capabilities including functions, classes, imports, and docstrings
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initTreeSitter,
  getParser,
  parseCode,
  clearParsers,
  isInitialized,
  type TreeSitterParser,
  type TreeSitterTree,
  type TreeSitterNode,
} from '../tree-sitter-parser';

describe('Tree-sitter Python Parser', () => {
  let parser: TreeSitterParser;

  // ============================================
  // Setup & Initialization
  // ============================================

  beforeAll(async () => {
    // Initialize tree-sitter WASM
    await initTreeSitter();
    // Get Python parser
    parser = await getParser('python');
  });

  afterAll(() => {
    // Clean up parsers
    clearParsers();
  });

  // ============================================
  // Initialization Tests
  // ============================================

  describe('initialization', () => {
    it('should initialize WASM correctly', () => {
      expect(isInitialized()).toBe(true);
    });

    it('should load Python grammar', async () => {
      const pythonParser = await getParser('python');
      expect(pythonParser).toBeDefined();
      expect(pythonParser.getLanguage()).toBeDefined();
    });

    it('should return cached parser on subsequent calls', async () => {
      const parser1 = await getParser('python');
      const parser2 = await getParser('python');
      expect(parser1).toBe(parser2);
    });
  });

  // ============================================
  // Function Parsing Tests
  // ============================================

  describe('function parsing', () => {
    it('should parse simple function', () => {
      const code = `
def hello(name):
    return f"Hello, {name}"
`;
      const tree = parseCode(parser, code);
      expect(tree).toBeDefined();
      expect(tree.rootNode).toBeDefined();

      // Find function definition
      const funcDef = findNodeByType(tree.rootNode, 'function_definition');
      expect(funcDef).toBeDefined();
      expect(funcDef?.childForFieldName('name')?.text).toBe('hello');

      // Clean up
      tree.delete();
    });

    it('should parse async function', () => {
      const code = `
async def fetch_data(url):
    async with aiohttp.ClientSession() as session:
        return await session.get(url)
`;
      const tree = parseCode(parser, code);
      expect(tree).toBeDefined();

      const funcDef = findNodeByType(tree.rootNode, 'function_definition');
      expect(funcDef).toBeDefined();
      expect(funcDef?.text).toContain('async def');
      expect(funcDef?.childForFieldName('name')?.text).toBe('fetch_data');

      tree.delete();
    });

    it('should extract function parameters', () => {
      const code = `
def process(data, threshold=0.5, *args, **kwargs):
    pass
`;
      const tree = parseCode(parser, code);

      const funcDef = findNodeByType(tree.rootNode, 'function_definition');
      expect(funcDef).toBeDefined();

      // Get parameters node
      const params = funcDef?.childForFieldName('parameters');
      expect(params).toBeDefined();
      expect(params?.text).toContain('data');
      expect(params?.text).toContain('threshold=0.5');
      expect(params?.text).toContain('*args');
      expect(params?.text).toContain('**kwargs');

      tree.delete();
    });

    it('should handle type hints', () => {
      const code = `
def add(a: int, b: int) -> int:
    return a + b
`;
      const tree = parseCode(parser, code);

      const funcDef = findNodeByType(tree.rootNode, 'function_definition');
      expect(funcDef).toBeDefined();

      // Check for type annotations
      const params = funcDef?.childForFieldName('parameters');
      expect(params?.text).toContain(': int');

      // Check return type
      const returnType = funcDef?.childForFieldName('return_type');
      expect(returnType).toBeDefined();
      expect(returnType?.text).toContain('int');

      tree.delete();
    });

    it('should parse decorator', () => {
      const code = `
@property
@lru_cache(maxsize=128)
def expensive_computation(self):
    return self._compute()
`;
      const tree = parseCode(parser, code);

      const decorated = findNodeByType(tree.rootNode, 'decorated_definition');
      expect(decorated).toBeDefined();

      // Count decorators
      const decorators = findAllNodesByType(decorated!, 'decorator');
      expect(decorators.length).toBe(2);
      expect(decorators[0].text).toContain('@property');
      expect(decorators[1].text).toContain('@lru_cache');

      tree.delete();
    });

    it('should parse lambda function', () => {
      const code = `
square = lambda x: x ** 2
`;
      const tree = parseCode(parser, code);

      const lambda = findNodeByType(tree.rootNode, 'lambda');
      expect(lambda).toBeDefined();
      expect(lambda?.text).toContain('lambda x: x ** 2');

      tree.delete();
    });
  });

  // ============================================
  // Class Parsing Tests
  // ============================================

  describe('class parsing', () => {
    it('should parse class definition', () => {
      const code = `
class MyClass:
    def __init__(self, value):
        self.value = value

    def get_value(self):
        return self.value
`;
      const tree = parseCode(parser, code);

      const classDef = findNodeByType(tree.rootNode, 'class_definition');
      expect(classDef).toBeDefined();
      expect(classDef?.childForFieldName('name')?.text).toBe('MyClass');

      tree.delete();
    });

    it('should extract class methods', () => {
      const code = `
class Calculator:
    def add(self, a, b):
        return a + b

    def subtract(self, a, b):
        return a - b

    @staticmethod
    def multiply(a, b):
        return a * b

    @classmethod
    def from_config(cls, config):
        return cls()
`;
      const tree = parseCode(parser, code);

      const classDef = findNodeByType(tree.rootNode, 'class_definition');
      expect(classDef).toBeDefined();

      // Find all methods (function definitions inside class)
      const classBody = classDef?.childForFieldName('body');
      const methods = findAllNodesByType(classBody!, 'function_definition');
      expect(methods.length).toBeGreaterThanOrEqual(2);

      // Check for decorated methods
      const decorated = findAllNodesByType(classBody!, 'decorated_definition');
      expect(decorated.length).toBeGreaterThanOrEqual(2);

      tree.delete();
    });

    it('should handle inheritance', () => {
      const code = `
class Dog(Animal, Trainable):
    def __init__(self, name):
        super().__init__(name)
`;
      const tree = parseCode(parser, code);

      const classDef = findNodeByType(tree.rootNode, 'class_definition');
      expect(classDef).toBeDefined();

      // Check superclasses
      const superclasses = classDef?.childForFieldName('superclasses');
      expect(superclasses).toBeDefined();
      expect(superclasses?.text).toContain('Animal');
      expect(superclasses?.text).toContain('Trainable');

      tree.delete();
    });

    it('should parse class with type parameters (Python 3.12+)', () => {
      const code = `
class GenericClass[T]:
    def process(self, item: T) -> T:
        return item
`;
      const tree = parseCode(parser, code);

      const classDef = findNodeByType(tree.rootNode, 'class_definition');
      expect(classDef).toBeDefined();
      expect(classDef?.childForFieldName('name')?.text).toBe('GenericClass');

      tree.delete();
    });

    it('should parse class attributes', () => {
      const code = `
class Config:
    DEBUG = True
    MAX_CONNECTIONS = 100
    ALLOWED_HOSTS = ["localhost", "127.0.0.1"]
`;
      const tree = parseCode(parser, code);

      const classDef = findNodeByType(tree.rootNode, 'class_definition');
      expect(classDef).toBeDefined();

      const classBody = classDef?.childForFieldName('body');
      const assignments = findAllNodesByType(classBody!, 'expression_statement');
      expect(assignments.length).toBeGreaterThanOrEqual(3);

      tree.delete();
    });
  });

  // ============================================
  // Import Parsing Tests
  // ============================================

  describe('import parsing', () => {
    it('should parse import statements', () => {
      const code = `
import os
import sys
import json
`;
      const tree = parseCode(parser, code);

      const imports = findAllNodesByType(tree.rootNode, 'import_statement');
      expect(imports.length).toBe(3);
      expect(imports[0].text).toContain('os');
      expect(imports[1].text).toContain('sys');
      expect(imports[2].text).toContain('json');

      tree.delete();
    });

    it('should parse from imports', () => {
      const code = `
from pathlib import Path
from typing import List, Dict, Optional
from collections.abc import Iterable
`;
      const tree = parseCode(parser, code);

      const imports = findAllNodesByType(tree.rootNode, 'import_from_statement');
      expect(imports.length).toBe(3);
      expect(imports[0].text).toContain('from pathlib import Path');
      expect(imports[1].text).toContain('List, Dict, Optional');

      tree.delete();
    });

    it('should handle relative imports', () => {
      const code = `
from . import utils
from .. import config
from ...core import engine
`;
      const tree = parseCode(parser, code);

      const imports = findAllNodesByType(tree.rootNode, 'import_from_statement');
      expect(imports.length).toBe(3);
      expect(imports[0].text).toContain('from . import');
      expect(imports[1].text).toContain('from .. import');
      expect(imports[2].text).toContain('from ...core import');

      tree.delete();
    });

    it('should parse import aliases', () => {
      const code = `
import numpy as np
from matplotlib import pyplot as plt
`;
      const tree = parseCode(parser, code);

      const importStmt = findNodeByType(tree.rootNode, 'import_statement');
      expect(importStmt).toBeDefined();
      expect(importStmt?.text).toContain('as np');

      const fromImport = findNodeByType(tree.rootNode, 'import_from_statement');
      expect(fromImport).toBeDefined();
      expect(fromImport?.text).toContain('as plt');

      tree.delete();
    });

    it('should parse wildcard imports', () => {
      const code = `
from os.path import *
`;
      const tree = parseCode(parser, code);

      const importStmt = findNodeByType(tree.rootNode, 'import_from_statement');
      expect(importStmt).toBeDefined();
      expect(importStmt?.text).toContain('*');

      tree.delete();
    });
  });

  // ============================================
  // Docstring Extraction Tests
  // ============================================

  describe('docstring extraction', () => {
    it('should extract function docstrings', () => {
      const code = `
def calculate(a, b):
    """
    Calculate the sum of two numbers.

    Args:
        a: First number
        b: Second number

    Returns:
        The sum of a and b
    """
    return a + b
`;
      const tree = parseCode(parser, code);

      const funcDef = findNodeByType(tree.rootNode, 'function_definition');
      expect(funcDef).toBeDefined();

      // Get function body
      const body = funcDef?.childForFieldName('body');
      expect(body).toBeDefined();

      // Find docstring (first string in body)
      const docstring = findNodeByType(body!, 'expression_statement');
      expect(docstring).toBeDefined();
      expect(docstring?.text).toContain('Calculate the sum');

      tree.delete();
    });

    it('should extract class docstrings', () => {
      const code = `
class DataProcessor:
    """
    A class for processing data.

    This class provides methods for cleaning and transforming data.
    """
    pass
`;
      const tree = parseCode(parser, code);

      const classDef = findNodeByType(tree.rootNode, 'class_definition');
      expect(classDef).toBeDefined();

      const body = classDef?.childForFieldName('body');
      const docstring = findNodeByType(body!, 'expression_statement');
      expect(docstring).toBeDefined();
      expect(docstring?.text).toContain('A class for processing data');

      tree.delete();
    });

    it('should extract module docstrings', () => {
      const code = `
"""
Module for utility functions.

This module provides common utility functions used across the project.
"""

import os
`;
      const tree = parseCode(parser, code);

      // Module docstring is the first expression statement
      const firstStatement = tree.rootNode.namedChildren[0];
      expect(firstStatement).toBeDefined();
      expect(firstStatement.type).toBe('expression_statement');
      expect(firstStatement.text).toContain('Module for utility functions');

      tree.delete();
    });

    it('should handle single-line docstrings', () => {
      const code = `
def simple():
    """Simple function."""
    pass
`;
      const tree = parseCode(parser, code);

      const funcDef = findNodeByType(tree.rootNode, 'function_definition');
      const body = funcDef?.childForFieldName('body');
      const docstring = findNodeByType(body!, 'expression_statement');
      expect(docstring).toBeDefined();
      expect(docstring?.text).toContain('Simple function.');

      tree.delete();
    });
  });

  // ============================================
  // Advanced Python Features
  // ============================================

  describe('advanced Python features', () => {
    it('should parse context managers', () => {
      const code = `
with open("file.txt") as f:
    content = f.read()
`;
      const tree = parseCode(parser, code);

      const withStmt = findNodeByType(tree.rootNode, 'with_statement');
      expect(withStmt).toBeDefined();
      expect(withStmt?.text).toContain('with open');
      expect(withStmt?.text).toContain('as f');

      tree.delete();
    });

    it('should parse try-except blocks', () => {
      const code = `
try:
    result = risky_operation()
except ValueError as e:
    print(f"Error: {e}")
except Exception:
    raise
finally:
    cleanup()
`;
      const tree = parseCode(parser, code);

      const tryStmt = findNodeByType(tree.rootNode, 'try_statement');
      expect(tryStmt).toBeDefined();

      const exceptClauses = findAllNodesByType(tryStmt!, 'except_clause');
      expect(exceptClauses.length).toBe(2);

      const finallyClause = findNodeByType(tryStmt!, 'finally_clause');
      expect(finallyClause).toBeDefined();

      tree.delete();
    });

    it('should parse list comprehensions', () => {
      const code = `
squares = [x**2 for x in range(10) if x % 2 == 0]
`;
      const tree = parseCode(parser, code);

      const listComp = findNodeByType(tree.rootNode, 'list_comprehension');
      expect(listComp).toBeDefined();
      expect(listComp?.text).toContain('for x in');
      expect(listComp?.text).toContain('if x % 2');

      tree.delete();
    });

    it('should parse dict comprehensions', () => {
      const code = `
mapping = {k: v**2 for k, v in items.items()}
`;
      const tree = parseCode(parser, code);

      const dictComp = findNodeByType(tree.rootNode, 'dictionary_comprehension');
      expect(dictComp).toBeDefined();

      tree.delete();
    });

    it('should parse f-strings', () => {
      const code = `
name = "Alice"
message = f"Hello, {name}! You are {age} years old."
`;
      const tree = parseCode(parser, code);

      const string = findNodeByType(tree.rootNode, 'string');
      expect(string).toBeDefined();
      expect(string?.text).toContain('f"');

      tree.delete();
    });

    it('should parse match statement (Python 3.10+)', () => {
      const code = `
match value:
    case 1:
        print("one")
    case 2:
        print("two")
    case _:
        print("other")
`;
      const tree = parseCode(parser, code);

      // Tree-sitter Python grammar may or may not support match yet
      // This test validates the parser doesn't crash
      expect(tree).toBeDefined();
      expect(tree.rootNode).toBeDefined();

      tree.delete();
    });

    it('should parse walrus operator (Python 3.8+)', () => {
      const code = `
if (n := len(data)) > 10:
    print(f"Length is {n}")
`;
      const tree = parseCode(parser, code);

      const ifStmt = findNodeByType(tree.rootNode, 'if_statement');
      expect(ifStmt).toBeDefined();
      expect(ifStmt?.text).toContain(':=');

      tree.delete();
    });
  });

  // ============================================
  // Error Handling
  // ============================================

  describe('error handling', () => {
    it('should parse syntactically invalid code without crashing', () => {
      const code = `
def broken(
    # Missing closing parenthesis
    return "incomplete"
`;
      // Tree-sitter is fault-tolerant and won't crash
      expect(() => {
        const tree = parseCode(parser, code);
        expect(tree).toBeDefined();
        tree.delete();
      }).not.toThrow();
    });

    it('should parse empty code', () => {
      const code = '';
      const tree = parseCode(parser, code);
      expect(tree).toBeDefined();
      expect(tree.rootNode.childCount).toBe(0);
      tree.delete();
    });

    it('should parse code with only comments', () => {
      const code = `
# Just a comment
# Another comment
`;
      const tree = parseCode(parser, code);
      expect(tree).toBeDefined();
      tree.delete();
    });

    it('should handle unicode characters', () => {
      const code = `
def 测试():
    """Unicode 文档字符串"""
    return "✓"
`;
      const tree = parseCode(parser, code);
      expect(tree).toBeDefined();
      tree.delete();
    });
  });

  // ============================================
  // Complex Real-World Examples
  // ============================================

  describe('complex real-world examples', () => {
    it('should parse dataclass definition', () => {
      const code = `
from dataclasses import dataclass

@dataclass
class Point:
    x: float
    y: float

    def distance(self, other: 'Point') -> float:
        return ((self.x - other.x)**2 + (self.y - other.y)**2)**0.5
`;
      const tree = parseCode(parser, code);

      const decorated = findNodeByType(tree.rootNode, 'decorated_definition');
      expect(decorated).toBeDefined();

      const classDef = findNodeByType(decorated!, 'class_definition');
      expect(classDef).toBeDefined();
      expect(classDef?.childForFieldName('name')?.text).toBe('Point');

      tree.delete();
    });

    it('should parse FastAPI route handler', () => {
      const code = `
from fastapi import FastAPI, HTTPException

app = FastAPI()

@app.get("/items/{item_id}")
async def read_item(item_id: int, q: str | None = None):
    """Get an item by ID."""
    if item_id not in items:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"item_id": item_id, "q": q}
`;
      const tree = parseCode(parser, code);

      const decorated = findNodeByType(tree.rootNode, 'decorated_definition');
      expect(decorated).toBeDefined();

      const funcDef = findNodeByType(decorated!, 'function_definition');
      expect(funcDef).toBeDefined();
      expect(funcDef?.text).toContain('async def');

      tree.delete();
    });

    it('should parse pytest test function', () => {
      const code = `
import pytest

@pytest.mark.parametrize("input,expected", [
    (1, 2),
    (2, 4),
    (3, 6),
])
def test_double(input, expected):
    """Test doubling function."""
    assert double(input) == expected
`;
      const tree = parseCode(parser, code);

      const decorated = findNodeByType(tree.rootNode, 'decorated_definition');
      expect(decorated).toBeDefined();

      const decorators = findAllNodesByType(decorated!, 'decorator');
      expect(decorators.length).toBeGreaterThanOrEqual(1);

      tree.delete();
    });
  });
});

// ============================================
// Helper Functions
// ============================================

/**
 * Find first node of given type in tree
 */
function findNodeByType(node: TreeSitterNode, type: string): TreeSitterNode | null {
  if (node.type === type) {
    return node;
  }

  for (const child of node.namedChildren) {
    const result = findNodeByType(child, type);
    if (result) {
      return result;
    }
  }

  return null;
}

/**
 * Find all nodes of given type in tree
 */
function findAllNodesByType(node: TreeSitterNode, type: string): TreeSitterNode[] {
  const results: TreeSitterNode[] = [];

  if (node.type === type) {
    results.push(node);
  }

  for (const child of node.namedChildren) {
    results.push(...findAllNodesByType(child, type));
  }

  return results;
}
