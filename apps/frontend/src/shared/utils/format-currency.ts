/**
 * Currency and Number Formatting Utilities
 *
 * Provides consistent formatting for USD currency, token counts, and percentages
 * throughout the application. Uses Intl.NumberFormat for locale-aware formatting.
 */

/**
 * Options for USD formatting.
 */
export interface FormatUSDOptions {
  /** Number of decimal places (default: 2 for values >= $1, 4 for smaller) */
  precision?: number;
  /** Whether to include the $ symbol (default: true) */
  includeSymbol?: boolean;
  /** Whether to abbreviate large values (e.g., $1.2K) (default: false) */
  abbreviate?: boolean;
  /** Show '+' for positive values (default: false) */
  showPositiveSign?: boolean;
}

/**
 * Options for token count formatting.
 */
export interface FormatTokenCountOptions {
  /** Whether to abbreviate (K, M, B) (default: true) */
  abbreviate?: boolean;
  /** Number of decimal places for abbreviated values (default: 1) */
  precision?: number;
  /** Whether to include thousands separator (default: true) */
  useGrouping?: boolean;
}

/**
 * Options for percentage formatting.
 */
export interface FormatPercentageOptions {
  /** Number of decimal places (default: 1) */
  precision?: number;
  /** Whether to include the % symbol (default: true) */
  includeSymbol?: boolean;
  /** Show '+' for positive values (default: false) */
  showPositiveSign?: boolean;
}

/**
 * Format a number as USD currency.
 *
 * Handles various precision needs:
 * - Large values (>= $1): 2 decimal places by default
 * - Small values (< $1): 4 decimal places for precision
 * - Very small values (< $0.01): Up to 6 decimal places
 *
 * @param value - The numeric value to format
 * @param options - Formatting options
 * @returns Formatted USD string (e.g., "$1,234.56", "$0.0234")
 *
 * @example
 * formatUSD(1234.56)                           // "$1,234.56"
 * formatUSD(0.0234)                            // "$0.0234"
 * formatUSD(1234567, { abbreviate: true })     // "$1.23M"
 * formatUSD(50.5, { includeSymbol: false })    // "50.50"
 */
export function formatUSD(
  value: number | null | undefined,
  options: FormatUSDOptions = {}
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return options.includeSymbol === false ? '0.00' : '$0.00';
  }

  const {
    includeSymbol = true,
    abbreviate = false,
    showPositiveSign = false,
  } = options;

  // Handle abbreviations for large values
  if (abbreviate) {
    const formatted = abbreviateNumber(Math.abs(value), {
      precision: 2,
      suffixes: ['', 'K', 'M', 'B', 'T'],
    });

    const sign = value < 0 ? '-' : showPositiveSign && value > 0 ? '+' : '';
    const symbol = includeSymbol ? '$' : '';
    return `${sign}${symbol}${formatted}`;
  }

  // Determine precision based on value magnitude
  let precision = options.precision;
  if (precision === undefined) {
    const absValue = Math.abs(value);
    if (absValue >= 1) {
      precision = 2;
    } else if (absValue >= 0.01) {
      precision = 4;
    } else if (absValue > 0) {
      precision = 6;
    } else {
      precision = 2;
    }
  }

  // Use Intl.NumberFormat for consistent formatting
  const formatter = new Intl.NumberFormat('en-US', {
    style: includeSymbol ? 'currency' : 'decimal',
    currency: 'USD',
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });

  let formatted = formatter.format(value);

  // Add positive sign if requested
  if (showPositiveSign && value > 0) {
    formatted = '+' + formatted;
  }

  return formatted;
}

/**
 * Format a token count with optional abbreviation.
 *
 * Large numbers are abbreviated by default:
 * - 1,000 → 1K
 * - 1,000,000 → 1M
 * - 1,000,000,000 → 1B
 *
 * @param count - The token count to format
 * @param options - Formatting options
 * @returns Formatted token count string (e.g., "1,234", "1.5M")
 *
 * @example
 * formatTokenCount(1234)                           // "1.2K"
 * formatTokenCount(1234, { abbreviate: false })    // "1,234"
 * formatTokenCount(1500000)                        // "1.5M"
 * formatTokenCount(1234567890)                     // "1.2B"
 */
export function formatTokenCount(
  count: number | null | undefined,
  options: FormatTokenCountOptions = {}
): string {
  if (count === null || count === undefined || isNaN(count)) {
    return '0';
  }

  const {
    abbreviate = true,
    precision = 1,
    useGrouping = true,
  } = options;

  if (abbreviate && Math.abs(count) >= 1000) {
    return abbreviateNumber(count, {
      precision,
      suffixes: ['', 'K', 'M', 'B', 'T'],
    });
  }

  // Use Intl.NumberFormat for consistent formatting
  const formatter = new Intl.NumberFormat('en-US', {
    useGrouping,
    maximumFractionDigits: 0,
  });

  return formatter.format(Math.round(count));
}

/**
 * Format a number as a percentage.
 *
 * @param value - The numeric value (0.5 = 50%, or 50 = 50% based on context)
 * @param options - Formatting options
 * @param isDecimal - Whether the input is a decimal (0.5) or whole number (50)
 * @returns Formatted percentage string (e.g., "50.0%", "-10.5%")
 *
 * @example
 * formatPercentage(0.5)                                   // "50.0%"
 * formatPercentage(75.5, {}, false)                       // "75.5%"
 * formatPercentage(-0.125)                                // "-12.5%"
 * formatPercentage(0.95, { precision: 0 })                // "95%"
 * formatPercentage(0.05, { showPositiveSign: true })      // "+5.0%"
 */
export function formatPercentage(
  value: number | null | undefined,
  options: FormatPercentageOptions = {},
  isDecimal: boolean = true
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return options.includeSymbol === false ? '0' : '0%';
  }

  const {
    precision = 1,
    includeSymbol = true,
    showPositiveSign = false,
  } = options;

  // Convert decimal to percentage if needed
  const percentValue = isDecimal ? value * 100 : value;

  // Format the number
  const formatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });

  let formatted = formatter.format(percentValue);

  // Add positive sign if requested
  if (showPositiveSign && percentValue > 0) {
    formatted = '+' + formatted;
  }

  // Add percent symbol
  if (includeSymbol) {
    formatted += '%';
  }

  return formatted;
}

/**
 * Abbreviate a large number with K/M/B/T suffixes.
 *
 * Internal helper function used by formatUSD and formatTokenCount.
 *
 * @param value - The number to abbreviate
 * @param options - Abbreviation options
 * @returns Abbreviated string (e.g., "1.5K", "2.3M")
 */
function abbreviateNumber(
  value: number,
  options: {
    precision?: number;
    suffixes?: string[];
  } = {}
): string {
  const {
    precision = 1,
    suffixes = ['', 'K', 'M', 'B', 'T'],
  } = options;

  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  // Find the appropriate suffix
  let suffixIndex = 0;
  let scaledValue = absValue;

  while (scaledValue >= 1000 && suffixIndex < suffixes.length - 1) {
    scaledValue /= 1000;
    suffixIndex++;
  }

  // Format with appropriate precision
  const formatted = scaledValue.toFixed(precision);

  // Remove trailing zeros and unnecessary decimal point
  const cleanFormatted = formatted.replace(/\.?0+$/, '');

  return `${sign}${cleanFormatted}${suffixes[suffixIndex]}`;
}

/**
 * Format a compact currency amount for tight spaces (e.g., chart labels).
 *
 * Always abbreviates and uses minimal decimal places.
 *
 * @param value - The numeric value to format
 * @returns Compact formatted string (e.g., "$1.2K", "$0.02")
 */
export function formatCompactUSD(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '$0';
  }

  const absValue = Math.abs(value);

  if (absValue >= 1000) {
    return formatUSD(value, { abbreviate: true, precision: 1 });
  }

  if (absValue >= 1) {
    return formatUSD(value, { precision: 0 });
  }

  if (absValue >= 0.01) {
    return formatUSD(value, { precision: 2 });
  }

  return formatUSD(value, { precision: 3 });
}

/**
 * Format token count for compact display (chart labels, etc.).
 *
 * @param count - The token count
 * @returns Compact formatted string (e.g., "1.5K", "234M")
 */
export function formatCompactTokens(count: number | null | undefined): string {
  return formatTokenCount(count, { abbreviate: true, precision: 1 });
}

/**
 * Format a cost per unit (e.g., cost per token, cost per spec).
 *
 * Optimized for very small values typical of per-token costs.
 *
 * @param value - The cost value
 * @param unit - The unit name (for display purposes)
 * @returns Formatted string (e.g., "$0.000003/token")
 */
export function formatCostPerUnit(
  value: number | null | undefined,
  unit?: string
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return unit ? `$0.00/${unit}` : '$0.00';
  }

  const absValue = Math.abs(value);
  let precision: number;

  if (absValue >= 1) {
    precision = 2;
  } else if (absValue >= 0.001) {
    precision = 4;
  } else if (absValue >= 0.000001) {
    precision = 6;
  } else {
    precision = 8;
  }

  const formatted = formatUSD(value, { precision });
  return unit ? `${formatted}/${unit}` : formatted;
}

/**
 * Format a change value with appropriate sign and color hint.
 *
 * @param value - The change value
 * @param type - Type of value ('cost', 'percentage', 'tokens')
 * @returns Object with formatted value and direction
 */
export function formatChange(
  value: number | null | undefined,
  type: 'cost' | 'percentage' | 'tokens' = 'cost'
): { formatted: string; direction: 'up' | 'down' | 'neutral' } {
  if (value === null || value === undefined || isNaN(value) || value === 0) {
    return {
      formatted: type === 'percentage' ? '0%' : type === 'cost' ? '$0.00' : '0',
      direction: 'neutral',
    };
  }

  let formatted: string;
  switch (type) {
    case 'cost':
      formatted = formatUSD(value, { showPositiveSign: true });
      break;
    case 'percentage':
      formatted = formatPercentage(value, { showPositiveSign: true });
      break;
    case 'tokens':
      const sign = value > 0 ? '+' : '';
      formatted = sign + formatTokenCount(value, { abbreviate: true });
      break;
    default:
      formatted = String(value);
  }

  return {
    formatted,
    direction: value > 0 ? 'up' : 'down',
  };
}
