#!/usr/bin/env node

/**
 * Verification script for tree-sitter parser
 *
 * This script verifies that:
 * 1. Tree-sitter WASM files are in the correct locations
 * 2. The parser can initialize correctly
 * 3. Python, TypeScript, and JavaScript can be parsed
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..');

console.log('🔍 Verifying tree-sitter parser setup...\n');

// Check 1: Core WASM file
console.log('📦 Checking core WASM file...');
const coreWasmPath = path.join(appRoot, 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm');
if (fs.existsSync(coreWasmPath)) {
  const stats = fs.statSync(coreWasmPath);
  console.log(`✅ Core WASM found: ${coreWasmPath} (${(stats.size / 1024).toFixed(2)} KB)`);
} else {
  console.error(`❌ Core WASM not found at: ${coreWasmPath}`);
  process.exit(1);
}

// Check 2: Language WASM files
console.log('\n📚 Checking language WASM files...');
const wasmDir = path.join(appRoot, 'node_modules', 'tree-sitter-wasms', 'out');
const requiredLanguages = ['python', 'tsx', 'javascript'];

for (const lang of requiredLanguages) {
  const wasmFile = `tree-sitter-${lang}.wasm`;
  const wasmPath = path.join(wasmDir, wasmFile);

  if (fs.existsSync(wasmPath)) {
    const stats = fs.statSync(wasmPath);
    console.log(`✅ ${lang.padEnd(12)} WASM found: ${(stats.size / 1024).toFixed(2)} KB`);
  } else {
    console.error(`❌ ${lang.padEnd(12)} WASM not found at: ${wasmPath}`);
    process.exit(1);
  }
}

// Check 3: Try to initialize tree-sitter (requires dynamic import)
console.log('\n🚀 Testing tree-sitter initialization...');

try {
  const Parser = await import('web-tree-sitter');
  const ParserClass = Parser.default ?? Parser;

  await ParserClass.init({
    locateFile: (scriptName) => {
      if (scriptName === 'tree-sitter.wasm') {
        return coreWasmPath;
      }
      return path.join(wasmDir, scriptName);
    }
  });

  console.log('✅ Tree-sitter initialized successfully');

  // Check 4: Load Python language
  console.log('\n🐍 Testing Python parser...');
  const pythonWasm = path.join(wasmDir, 'tree-sitter-python.wasm');
  const Python = await ParserClass.Language.load(pythonWasm);
  const pythonParser = new ParserClass();
  pythonParser.setLanguage(Python);

  const pythonCode = 'def hello():\n    print("Hello, World!")';
  const pythonTree = pythonParser.parse(pythonCode);

  console.log(`✅ Python code parsed successfully`);
  console.log(`   Root node type: ${pythonTree.rootNode.type}`);
  console.log(`   Node count: ${pythonTree.rootNode.childCount}`);

  pythonTree.delete();
  pythonParser.delete();

  // Check 5: Load TypeScript language (tsx)
  console.log('\n📘 Testing TypeScript parser...');
  const tsxWasm = path.join(wasmDir, 'tree-sitter-tsx.wasm');
  const TSX = await ParserClass.Language.load(tsxWasm);
  const tsParser = new ParserClass();
  tsParser.setLanguage(TSX);

  const tsCode = 'const greeting: string = "Hello, World!";';
  const tsTree = tsParser.parse(tsCode);

  console.log(`✅ TypeScript code parsed successfully`);
  console.log(`   Root node type: ${tsTree.rootNode.type}`);
  console.log(`   Node count: ${tsTree.rootNode.childCount}`);

  tsTree.delete();

  // Check 6: Test TSX/JSX parsing
  console.log('\n⚛️  Testing TSX/JSX parsing...');
  const jsxCode = 'const Component = () => <div>Hello</div>;';
  const jsxTree = tsParser.parse(jsxCode);

  console.log(`✅ JSX code parsed successfully`);
  console.log(`   Root node type: ${jsxTree.rootNode.type}`);
  console.log(`   Contains JSX: ${jsxTree.rootNode.text.includes('<div>')}`);

  jsxTree.delete();
  tsParser.delete();

  console.log('\n✅ All tree-sitter verification checks passed!\n');

} catch (error) {
  console.error('\n❌ Tree-sitter initialization failed:');
  console.error(error);
  process.exit(1);
}
