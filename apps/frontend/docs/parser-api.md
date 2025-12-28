# Parser API Documentation

## Overview

The hybrid parser system provides high-performance source code parsing for JavaScript, TypeScript, and Python. It intelligently routes files to the optimal parser backend:

- **OXC Parser** - Rust-based high-performance parser for JavaScript/TypeScript
- **Tree-sitter** - Universal incremental parser for Python (with fallback support for JS/TS)

The parser system extracts symbols (classes, functions, variables), imports, and metadata from source files to build a knowledge graph of your codebase.

## Quick Start

```typescript
import { parseFiles, isParseableFile } from './explorer/parser-router';

// Check if a file can be parsed
if (isParseableFile('/path/to/file.ts')) {
  // Parse a single file
  const result = await parseFile('/path/to/file.ts');
  console.log(`Found ${result.symbols.length} symbols`);
}

// Parse multiple files in parallel
const results = await parseFiles([
  '/path/to/file.ts',
  '/path/to/file.py',
  '/path/to/file.js'
]);

console.log(`Parsed ${results.results.length} files`);
console.log(`OXC: ${results.stats.oxcCount}, Tree-sitter: ${results.stats.treeSitterCount}`);
```

## API Reference

### Parser Router (`parser-router.ts`)

The router provides intelligent file-to-parser mapping and high-level parsing functions.

#### `parseFile(filePath: string): Promise<UnifiedParseResult | null>`

Parse a single file using the appropriate parser backend.

**Parameters:**
- `filePath` - Absolute path to the file to parse

**Returns:**
- `UnifiedParseResult` - Parsed symbols, imports, and metadata
- `null` - If file type is not supported

**Throws:**
- `Error` - If parsing fails

**Example:**
```typescript
try {
  const result = await parseFile('/app/src/components/Button.tsx');
  console.log(`Parser: ${result.parser}`); // 'oxc'
  console.log(`Symbols: ${result.symbols.length}`);
  console.log(`Imports: ${result.imports.length}`);
  console.log(`LOC: ${result.loc}`);
} catch (error) {
  console.error('Parse failed:', error.message);
}
```

#### `parseFiles(filePaths: string[]): Promise<BatchParseResult>`

Parse multiple files in parallel with error handling and statistics.

**Parameters:**
- `filePaths` - Array of absolute file paths to parse

**Returns:**
- `BatchParseResult` - Object containing:
  - `results: UnifiedParseResult[]` - Successfully parsed files
  - `errors: Array<{filePath: string, error: string}>` - Failed files
  - `stats: BatchParseStats` - Parser usage statistics

**Example:**
```typescript
const files = [
  '/app/src/utils.ts',
  '/app/src/api.py',
  '/app/src/config.js'
];

const batchResult = await parseFiles(files);

console.log(`Success: ${batchResult.results.length}`);
console.log(`Failures: ${batchResult.errors.length}`);
console.log(`OXC files: ${batchResult.stats.oxcCount}`);
console.log(`Tree-sitter files: ${batchResult.stats.treeSitterCount}`);
console.log(`Total time: ${batchResult.stats.totalTimeMs}ms`);

// Handle errors
batchResult.errors.forEach(err => {
  console.error(`Failed to parse ${err.filePath}: ${err.error}`);
});
```

#### `initializeParsers(): Promise<void>`

Initialize all parser backends. This should be called once at application startup.

**Throws:**
- `Error` - If initialization fails

**Example:**
```typescript
try {
  await initializeParsers();
  console.log('Parsers ready');
} catch (error) {
  console.error('Parser initialization failed:', error.message);
}
```

#### `isParseableFile(filePath: string): boolean`

Check if a file can be parsed by any available parser.

**Parameters:**
- `filePath` - Path to check (absolute or relative)

**Returns:**
- `true` - If the file extension is supported
- `false` - Otherwise

**Example:**
```typescript
if (isParseableFile('app.ts')) {
  // Can be parsed
}

if (!isParseableFile('README.md')) {
  // Cannot be parsed
}
```

#### `getParserForFile(filePath: string): ParserBackend | null`

Get the parser backend that will be used for a file.

**Parameters:**
- `filePath` - Path to check

**Returns:**
- `'oxc'` - For .ts, .tsx, .js, .jsx, .mjs, .cjs
- `'tree-sitter'` - For .py, .pyi
- `null` - For unsupported files

**Example:**
```typescript
const parser = getParserForFile('utils.ts');
console.log(parser); // 'oxc'

const pythonParser = getParserForFile('main.py');
console.log(pythonParser); // 'tree-sitter'
```

#### `getSupportedExtensions(): string[]`

Get all supported file extensions across all parsers.

**Returns:**
- Array of extensions: `['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.pyi']`

**Example:**
```typescript
const extensions = getSupportedExtensions();
console.log(extensions);
// ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.pyi']
```

### Explorer Service (`explorer-service.ts`)

High-level service for parsing entire projects and building knowledge graphs.

#### `parseProject(projectId: string, projectPath: string, options?: ParseOptions): Promise<ParseProjectResult>`

Parse an entire project and build a knowledge graph.

**Parameters:**
- `projectId` - Unique identifier for the project
- `projectPath` - Absolute path to project root
- `options` - Optional configuration:
  - `force?: boolean` - Bypass cache and re-parse (default: false)
  - `includeSymbols?: boolean` - Include depth-5 symbols in graph (default: true)
  - `signal?: AbortSignal` - For cancellation support

**Returns:**
- `ParseProjectResult`:
  - `graph: GraphData` - Complete knowledge graph
  - `fromCache: boolean` - Whether result came from cache

**Events:**
- Emits `'status'` events with progress updates
- Emits `'parse-complete'` when finished
- Emits `'parse-error'` on failure

**Example:**
```typescript
import { explorerService } from './explorer/explorer-service';

// Listen for progress updates
explorerService.on('status', (projectId, status) => {
  console.log(`Phase: ${status.phase}`);
  console.log(`Progress: ${status.progress}%`);
  console.log(`Message: ${status.message}`);
});

// Parse project
const result = await explorerService.parseProject(
  'my-project',
  '/path/to/project',
  { force: false }
);

console.log(`Nodes: ${result.graph.nodes.length}`);
console.log(`Edges: ${result.graph.edges.length}`);
console.log(`From cache: ${result.fromCache}`);
```

#### `refreshGraph(projectId: string, projectPath: string): Promise<GraphData>`

Force refresh the graph for a project (bypasses cache).

**Example:**
```typescript
const graph = await explorerService.refreshGraph('my-project', '/path/to/project');
console.log(`Refreshed graph with ${graph.nodes.length} nodes`);
```

#### `cancelParse(projectId: string): void`

Cancel an ongoing parse operation.

**Example:**
```typescript
explorerService.cancelParse('my-project');
```

#### `clearCache(projectPath: string): Promise<void>`

Clear the cached graph for a project.

**Example:**
```typescript
await explorerService.clearCache('/path/to/project');
```

## Types

### `UnifiedParseResult`

Standardized output from both OXC and Tree-sitter parsers.

```typescript
interface UnifiedParseResult {
  /** Extracted symbols (classes, functions, variables, etc.) */
  symbols: ExtractedSymbol[];

  /** Import statements found in the file */
  imports: ExtractedImport[];

  /** Programming language of the parsed file */
  language: ParserLanguage; // 'javascript' | 'typescript' | 'python'

  /** Absolute file path that was parsed */
  filePath: string;

  /** Time taken to parse in milliseconds */
  parseTimeMs: number;

  /** Which parser was used */
  parser: ParserBackend; // 'oxc' | 'tree-sitter'

  /** Total lines of code in the file */
  loc: number;
}
```

### `ExtractedSymbol`

Represents a code symbol extracted during parsing.

```typescript
interface ExtractedSymbol {
  /** Symbol name (e.g., "MyClass", "myFunction") */
  name: string;

  /** Type of symbol */
  type: NodeType; // 'class' | 'function' | 'symbol'

  /** Starting line number (1-indexed) */
  startLine: number;

  /** Ending line number (1-indexed) */
  endLine: number;

  /** Documentation string (JSDoc, docstring, etc.) if present */
  docstring?: string;

  /** Function/method signature if applicable */
  signature?: string;

  /** Function parameter names if applicable */
  parameters?: string[];

  /** Return type annotation if available */
  returnType?: string;

  /** Parent class name for methods */
  parentClass?: string;

  /** Whether this symbol is exported from the module */
  exports: boolean;

  /** Nested symbols (e.g., methods in a class) */
  children: ExtractedSymbol[];
}
```

### `ExtractedImport`

Represents an import statement.

```typescript
interface ExtractedImport {
  /** Module/file being imported from (e.g., "react", "./utils") */
  source: string;

  /** Specific items imported (or ['*'] for star imports) */
  items: string[];

  /** Whether it's a default import (import X from 'y') */
  isDefault?: boolean;

  /** Whether it's a relative import (starts with . or /) */
  isRelative?: boolean;
}
```

### `BatchParseResult`

Result from batch parsing multiple files.

```typescript
interface BatchParseResult {
  /** Successfully parsed files */
  results: UnifiedParseResult[];

  /** Files that failed to parse */
  errors: Array<{
    filePath: string;
    error: string;
  }>;

  /** Parsing statistics */
  stats: BatchParseStats;
}
```

### `BatchParseStats`

Statistics from batch parsing operations.

```typescript
interface BatchParseStats {
  /** Number of files parsed with OXC */
  oxcCount: number;

  /** Number of files parsed with tree-sitter */
  treeSitterCount: number;

  /** Total parsing time in milliseconds */
  totalTimeMs: number;
}
```

### `ParserBackend`

Parser backend identifier.

```typescript
type ParserBackend = 'oxc' | 'tree-sitter';
```

### `ParserLanguage`

Programming language identifier.

```typescript
type ParserLanguage = 'javascript' | 'typescript' | 'python';
```

### `NodeType`

Type of code entity.

```typescript
type NodeType = 'directory' | 'file' | 'class' | 'function' | 'symbol';
```

## Parser Selection

The router automatically selects the optimal parser based on file extension:

### OXC Parser
**Extensions:** `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`

**Features:**
- Rust-based high-performance parsing
- Full TypeScript and JSX support
- Extracts classes, functions, interfaces, types
- Parses JSDoc comments
- Handles ES6 imports/exports

**Performance:**
- Fastest available parser for JS/TS
- Optimized for large codebases
- No WASM initialization overhead

### Tree-sitter Parser
**Extensions:** `.py`, `.pyi`

**Features:**
- Universal incremental parser
- Python support (classes, functions, decorators)
- Extracts docstrings
- Handles import statements
- Fallback for unsupported languages

**Initialization:**
- Requires WASM files at startup
- Loads language grammars on-demand
- One-time initialization cost

## Error Handling

### Parser Errors

All parser functions throw errors that can be caught and handled:

```typescript
try {
  const result = await parseFile('/path/to/file.ts');
} catch (error) {
  if (error.message.includes('Parse errors')) {
    // Syntax errors in the source file
    console.error('Syntax error:', error.message);
  } else if (error.message.includes('Unsupported file type')) {
    // File extension not supported
    console.error('Unsupported file:', error.message);
  } else {
    // Other errors (file not found, etc.)
    console.error('Parse failed:', error.message);
  }
}
```

### Batch Parsing Error Handling

Batch parsing continues even if some files fail:

```typescript
const result = await parseFiles(filePaths);

// Check for errors
if (result.errors.length > 0) {
  console.log(`${result.errors.length} files failed to parse`);

  result.errors.forEach(({ filePath, error }) => {
    console.error(`${filePath}: ${error}`);
  });
}

// Process successful results
result.results.forEach(parsed => {
  console.log(`✓ ${parsed.filePath}`);
});
```

### Explorer Service Error Handling

The explorer service provides user-friendly error messages:

```typescript
import { ExplorerError } from './explorer/explorer-service';

try {
  await explorerService.parseProject('proj', '/path');
} catch (error) {
  if (error instanceof ExplorerError) {
    console.error('Title:', error.title);
    console.error('Description:', error.description);
    console.error('Suggestions:', error.suggestions);
    console.error('Type:', error.type);
  } else {
    console.error('Unexpected error:', error);
  }
}
```

**Error Types:**
- `'initialization'` - Parser failed to initialize
- `'file-access'` - Cannot read files (permissions, not found)
- `'parse'` - Syntax errors or unsupported files
- `'cache'` - Cache read/write failures
- `'cancelled'` - User cancelled operation
- `'unknown'` - Unexpected errors

## Performance

### Parser Benchmarks

Approximate performance on a modern system:

| Parser | Files/sec | Lines/sec | Typical File Time |
|--------|-----------|-----------|-------------------|
| OXC | 500-1000 | 100K-200K | 1-5ms |
| Tree-sitter | 100-300 | 20K-50K | 3-10ms |

### Optimization Tips

1. **Use batch parsing** - `parseFiles()` runs in parallel
2. **Enable caching** - Explorer service caches graphs to disk
3. **Filter early** - Use `isParseableFile()` before parsing
4. **Monitor progress** - Listen to status events for large projects
5. **Cancel when needed** - Use abort signals for user cancellations

### Large Project Handling

For projects with 1000+ files:

```typescript
import { explorerService } from './explorer/explorer-service';

// Listen for warnings
explorerService.on('warning', (projectId, message) => {
  console.warn(message); // "Large repository: 5000 files to parse"
});

// Parse with progress tracking
explorerService.on('status', (projectId, status) => {
  if (status.phase === 'parsing') {
    const percent = ((status.filesParsed ?? 0) / (status.totalFiles ?? 1)) * 100;
    console.log(`Parsing: ${percent.toFixed(1)}% (${status.message})`);
  }
});

const result = await explorerService.parseProject('large-proj', '/path');
```

## Caching

### Cache Location

The explorer service caches parsed graphs to:
```
<project-root>/.auto-claude/explorer/graph.json
```

### Cache Structure

```typescript
interface GraphCache {
  version: number;               // Cache format version
  graph: GraphData;              // Complete knowledge graph
  fileTimestamps: Record<string, number>; // File mtimes for validation
}
```

### Cache Validation

The cache is invalidated when:
- Any sampled file has been modified (checks 10 random files)
- A file has been deleted
- Cache version is outdated
- User forces refresh with `force: true`

### Cache Management

```typescript
// Use cache if available
const result1 = await explorerService.parseProject('proj', '/path');

// Force bypass cache
const result2 = await explorerService.parseProject('proj', '/path', { force: true });

// Clear cache manually
await explorerService.clearCache('/path');
```

## Advanced Usage

### Custom Parser Adapter

Implement the `IParser` interface to add new parser backends:

```typescript
import { IParser, ParserLanguage, ParserBackend, UnifiedParseResult } from './parser-interface';

class MyCustomParser implements IParser {
  readonly name: ParserBackend = 'custom';
  readonly supportedLanguages: ParserLanguage[] = ['rust'];

  async initialize(): Promise<void> {
    // Load parser
  }

  supports(language: ParserLanguage): boolean {
    return this.supportedLanguages.includes(language);
  }

  async parseFile(filePath: string): Promise<UnifiedParseResult> {
    // Parse implementation
  }

  async parseContent(content: string, language: ParserLanguage): Promise<UnifiedParseResult> {
    // Parse implementation
  }
}
```

### Filtering Symbols

Process symbols after parsing:

```typescript
const result = await parseFile('/path/to/file.ts');

// Get only exported classes
const exportedClasses = result.symbols.filter(s =>
  s.type === 'class' && s.exports
);

// Get functions with documentation
const documentedFunctions = result.symbols.filter(s =>
  s.type === 'function' && s.docstring
);

// Find symbols by name pattern
const testFunctions = result.symbols.filter(s =>
  s.name.startsWith('test')
);
```

### Import Analysis

Analyze import relationships:

```typescript
const result = await parseFile('/path/to/file.ts');

// Get external dependencies
const externalDeps = result.imports
  .filter(imp => !imp.isRelative)
  .map(imp => imp.source);

console.log('External dependencies:', [...new Set(externalDeps)]);

// Get local imports
const localImports = result.imports
  .filter(imp => imp.isRelative)
  .map(imp => imp.source);

console.log('Local imports:', localImports);
```

### Progress Tracking

Implement custom progress UI:

```typescript
import { explorerService } from './explorer/explorer-service';

const progressBar = new ProgressBar();

explorerService.on('status', (projectId, status) => {
  switch (status.phase) {
    case 'loading-cache':
      progressBar.update(0, 'Checking cache...');
      break;
    case 'scanning-files':
      progressBar.update(10, 'Scanning files...');
      break;
    case 'parsing':
      progressBar.update(status.progress, status.message);
      break;
    case 'building-graph':
      progressBar.update(90, 'Building graph...');
      break;
    case 'complete':
      progressBar.complete(status.message);
      break;
    case 'error':
      progressBar.error(status.error);
      break;
  }
});

await explorerService.parseProject('proj', '/path');
```

## Troubleshooting

### Parser Initialization Fails

**Symptom:** Error "Tree-sitter core WASM not found"

**Cause:** WASM files missing from resources directory

**Solution:**
1. Check `resources/wasm/tree-sitter.wasm` exists
2. Verify `tree-sitter-python.wasm` is present
3. Rebuild application if running in development

### No Files Found

**Symptom:** "No parseable files found" with 0 nodes

**Cause:** Project contains no supported file types

**Solution:**
1. Verify project path is correct
2. Check for .ts/.tsx/.js/.jsx/.py files
3. Ensure files aren't in excluded directories (node_modules, .git, etc.)

### Slow Parsing Performance

**Symptom:** Parsing takes longer than expected

**Solutions:**
1. Check if cache is being used (fromCache flag)
2. Verify parsers are initialized only once
3. Use batch parsing instead of sequential
4. Exclude large generated files if possible

### Syntax Errors

**Symptom:** "Parse errors in <file>"

**Cause:** Source file has invalid syntax

**Solution:**
1. Fix syntax errors in the source file
2. Errors are non-fatal in batch parsing
3. Check error messages for specific issues

### Cache Not Working

**Symptom:** Always re-parsing despite cache

**Cause:** Files being modified or cache validation failing

**Solutions:**
1. Check file timestamps aren't changing
2. Verify `.auto-claude/explorer/` directory is writable
3. Review cache validation logic in logs

## Best Practices

1. **Initialize once** - Call `initializeParsers()` at startup, not per-parse
2. **Batch operations** - Use `parseFiles()` for multiple files
3. **Handle errors gracefully** - Use batch parsing's error handling
4. **Enable caching** - Let the explorer service cache graphs
5. **Monitor progress** - Listen to events for long operations
6. **Cancel when needed** - Provide abort signals for user cancellations
7. **Filter files early** - Use `isParseableFile()` to skip unsupported files
8. **Clean up resources** - Call `explorerService.cleanup()` on shutdown

## Further Reading

- [OXC Parser Documentation](https://oxc.rs/)
- [Tree-sitter Documentation](https://tree-sitter.github.io/tree-sitter/)
- [Graph Builder API](./graph-builder-api.md)
- [Explorer Integration Guide](./explorer-integration.md)
