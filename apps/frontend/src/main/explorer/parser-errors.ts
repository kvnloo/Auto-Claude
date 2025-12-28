import type { ParserBackend, ParserLanguage } from './types';

/**
 * Base error class for all parser-related errors
 */
export class ParserError extends Error {
  constructor(
    message: string,
    public readonly filePath?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ParserError';

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error thrown when parser initialization fails
 */
export class ParserInitializationError extends ParserError {
  constructor(
    public readonly parser: ParserBackend,
    message: string,
    cause?: Error
  ) {
    super(`Failed to initialize ${parser} parser: ${message}`, undefined, cause);
    this.name = 'ParserInitializationError';
  }
}

/**
 * Error thrown when parsing a specific file fails
 */
export class ParseError extends ParserError {
  constructor(
    filePath: string,
    public readonly parser: ParserBackend,
    public readonly language: ParserLanguage,
    message: string,
    cause?: Error
  ) {
    super(`Failed to parse ${filePath} with ${parser}: ${message}`, filePath, cause);
    this.name = 'ParseError';
  }
}

/**
 * Error thrown when file type is not supported by any parser
 */
export class UnsupportedLanguageError extends ParserError {
  constructor(
    filePath: string,
    public readonly extension: string
  ) {
    super(`Unsupported file type: ${extension}`, filePath);
    this.name = 'UnsupportedLanguageError';
  }
}

/**
 * Error thrown when WASM loading fails
 */
export class WasmLoadError extends ParserInitializationError {
  constructor(
    parser: ParserBackend,
    public readonly wasmPath: string,
    cause?: Error
  ) {
    super(parser, `Failed to load WASM from ${wasmPath}`, cause);
    this.name = 'WasmLoadError';
  }
}

/**
 * Helper function to wrap unknown errors into ParserError instances
 */
export function wrapError(error: unknown, context: string): ParserError {
  if (error instanceof ParserError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error : undefined;

  return new ParserError(`${context}: ${message}`, undefined, cause);
}
