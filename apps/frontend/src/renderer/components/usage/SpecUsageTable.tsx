/**
 * Spec Usage Table Component
 *
 * Sortable table displaying token usage per spec with search filtering,
 * pagination, and detailed breakdown on row click.
 */

import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Loader2,
  FileText,
  Search,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import {
  formatUSD,
  formatTokenCount,
  formatPercentage
} from '../../../shared/utils/format-currency';
import type { SpecUsageRecord } from '../../../shared/types/usage';

// ============================================
// Types
// ============================================

interface SpecUsageTableProps {
  /** Spec usage data to display */
  data: SpecUsageRecord[];
  /** Whether data is currently loading */
  isLoading?: boolean;
  /** Optional CSS class name */
  className?: string;
  /** Number of rows per page (default: 10) */
  pageSize?: number;
  /** Callback when a spec row is clicked */
  onSpecClick?: (specId: string) => void;
}

type SortField = 'specName' | 'sessions' | 'inputTokens' | 'outputTokens' | 'cost' | 'successRate';
type SortDirection = 'asc' | 'desc';

interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

interface ColumnConfig {
  field: SortField;
  labelKey: string;
  align: 'left' | 'center' | 'right';
  width?: string;
}

// ============================================
// Constants
// ============================================

const COLUMNS: ColumnConfig[] = [
  { field: 'specName', labelKey: 'specTable.columns.specName', align: 'left' },
  { field: 'sessions', labelKey: 'specTable.columns.sessions', align: 'center', width: '100px' },
  { field: 'inputTokens', labelKey: 'specTable.columns.inputTokens', align: 'right', width: '120px' },
  { field: 'outputTokens', labelKey: 'specTable.columns.outputTokens', align: 'right', width: '120px' },
  { field: 'cost', labelKey: 'specTable.columns.cost', align: 'right', width: '100px' },
  { field: 'successRate', labelKey: 'specTable.columns.outcome', align: 'center', width: '120px' }
];

const DEFAULT_PAGE_SIZE = 10;

// ============================================
// Helper Functions
// ============================================

/**
 * Extract display name from spec ID
 */
function getSpecDisplayName(spec: SpecUsageRecord): string {
  if (spec.specName) {
    return spec.specName;
  }
  // Extract name from spec ID (e.g., "025-token-usage" -> "Token Usage")
  const parts = spec.specId.split('-');
  if (parts.length > 1) {
    // Remove numeric prefix if present
    const nameParts = /^\d+$/.test(parts[0]) ? parts.slice(1) : parts;
    return nameParts
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  return spec.specId;
}

/**
 * Get outcome badge variant and icon based on success rate
 */
function getOutcomeDisplay(spec: SpecUsageRecord): {
  variant: 'success' | 'destructive' | 'warning' | 'muted';
  icon: typeof CheckCircle2;
  label: string;
} {
  const successRate = spec.successRate ?? 0;
  const totalSessions = spec.sessionCount;

  if (totalSessions === 0) {
    return { variant: 'muted', icon: Clock, label: 'none' };
  }

  if (successRate >= 80) {
    return { variant: 'success', icon: CheckCircle2, label: 'success' };
  } else if (successRate >= 50) {
    return { variant: 'warning', icon: Clock, label: 'partial' };
  } else {
    return { variant: 'destructive', icon: XCircle, label: 'failed' };
  }
}

/**
 * Sort specs based on sort configuration
 */
function sortSpecs(specs: SpecUsageRecord[], sortConfig: SortConfig): SpecUsageRecord[] {
  return [...specs].sort((a, b) => {
    let valueA: number | string;
    let valueB: number | string;

    switch (sortConfig.field) {
      case 'specName':
        valueA = getSpecDisplayName(a).toLowerCase();
        valueB = getSpecDisplayName(b).toLowerCase();
        break;
      case 'sessions':
        valueA = a.sessionCount;
        valueB = b.sessionCount;
        break;
      case 'inputTokens':
        valueA = a.inputTokens || a.totalTokens * 0.4; // Estimate if not available
        valueB = b.inputTokens || b.totalTokens * 0.4;
        break;
      case 'outputTokens':
        valueA = a.outputTokens || a.totalTokens * 0.6; // Estimate if not available
        valueB = b.outputTokens || b.totalTokens * 0.6;
        break;
      case 'cost':
        valueA = a.totalCost;
        valueB = b.totalCost;
        break;
      case 'successRate':
        valueA = a.successRate ?? 0;
        valueB = b.successRate ?? 0;
        break;
      default:
        return 0;
    }

    if (typeof valueA === 'string' && typeof valueB === 'string') {
      return sortConfig.direction === 'asc'
        ? valueA.localeCompare(valueB)
        : valueB.localeCompare(valueA);
    }

    const numA = valueA as number;
    const numB = valueB as number;
    return sortConfig.direction === 'asc' ? numA - numB : numB - numA;
  });
}

/**
 * Filter specs by search query
 */
function filterSpecs(specs: SpecUsageRecord[], query: string): SpecUsageRecord[] {
  if (!query.trim()) {
    return specs;
  }

  const lowerQuery = query.toLowerCase().trim();
  return specs.filter((spec) => {
    const displayName = getSpecDisplayName(spec).toLowerCase();
    const specId = spec.specId.toLowerCase();
    return displayName.includes(lowerQuery) || specId.includes(lowerQuery);
  });
}

// ============================================
// Sub-Components
// ============================================

/**
 * Sort indicator for column headers
 */
function SortIndicator({
  field,
  sortConfig
}: {
  field: SortField;
  sortConfig: SortConfig;
}) {
  if (sortConfig.field !== field) {
    return <ChevronsUpDown className="ml-1 h-4 w-4 text-muted-foreground/50" />;
  }

  return sortConfig.direction === 'asc' ? (
    <ChevronUp className="ml-1 h-4 w-4 text-foreground" />
  ) : (
    <ChevronDown className="ml-1 h-4 w-4 text-foreground" />
  );
}

/**
 * Table header cell with sorting
 */
function TableHeaderCell({
  column,
  sortConfig,
  onSort,
  t
}: {
  column: ColumnConfig;
  sortConfig: SortConfig;
  onSort: (field: SortField) => void;
  t: (key: string) => string;
}) {
  const isActive = sortConfig.field === column.field;

  return (
    <th
      className={cn(
        'h-10 px-4 font-medium text-muted-foreground',
        column.align === 'left' && 'text-left',
        column.align === 'center' && 'text-center',
        column.align === 'right' && 'text-right'
      )}
      style={{ width: column.width }}
    >
      <button
        className={cn(
          'inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors hover:bg-muted',
          isActive && 'bg-muted text-foreground'
        )}
        onClick={() => onSort(column.field)}
      >
        {t(column.labelKey)}
        <SortIndicator field={column.field} sortConfig={sortConfig} />
      </button>
    </th>
  );
}

/**
 * Table row for a spec
 */
function SpecRow({
  spec,
  onClick,
  t
}: {
  spec: SpecUsageRecord;
  onClick?: (specId: string) => void;
  t: (key: string) => string;
}) {
  const outcomeDisplay = getOutcomeDisplay(spec);
  const OutcomeIcon = outcomeDisplay.icon;

  // Estimate input/output tokens if not available separately
  const inputTokens = spec.inputTokens || Math.round(spec.totalTokens * 0.4);
  const outputTokens = spec.outputTokens || Math.round(spec.totalTokens * 0.6);

  return (
    <tr
      className={cn(
        'border-b border-border transition-colors hover:bg-muted/50',
        onClick && 'cursor-pointer'
      )}
      onClick={() => onClick?.(spec.specId)}
    >
      {/* Spec Name */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <FileText className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-foreground">
              {getSpecDisplayName(spec)}
            </div>
            <div className="truncate text-xs text-muted-foreground">{spec.specId}</div>
          </div>
        </div>
      </td>

      {/* Sessions */}
      <td className="px-4 py-3 text-center">
        <span className="font-medium text-foreground">{spec.sessionCount}</span>
      </td>

      {/* Input Tokens */}
      <td className="px-4 py-3 text-right">
        <span className="font-medium text-foreground">{formatTokenCount(inputTokens)}</span>
      </td>

      {/* Output Tokens */}
      <td className="px-4 py-3 text-right">
        <span className="font-medium text-foreground">{formatTokenCount(outputTokens)}</span>
      </td>

      {/* Cost */}
      <td className="px-4 py-3 text-right">
        <span className="font-medium text-foreground">{formatUSD(spec.totalCost)}</span>
      </td>

      {/* Outcome */}
      <td className="px-4 py-3 text-center">
        <Badge variant={outcomeDisplay.variant} className="gap-1">
          <OutcomeIcon className="h-3 w-3" />
          <span className="text-xs">
            {formatPercentage((spec.successRate ?? 0) / 100, { precision: 0 })}
          </span>
        </Badge>
      </td>
    </tr>
  );
}

/**
 * Pagination controls
 */
function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  t
}: {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  t: (key: string) => string;
}) {
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-3">
      <div className="text-sm text-muted-foreground">
        {t('specTable.pagination.showing', {
          start: startItem,
          end: endItem,
          total: totalItems
        })}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="h-8 w-8 p-0"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="sr-only">{t('specTable.pagination.previous')}</span>
        </Button>
        <div className="flex items-center gap-1 text-sm">
          <span className="font-medium">{currentPage}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground">{totalPages}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="h-8 w-8 p-0"
        >
          <ChevronRight className="h-4 w-4" />
          <span className="sr-only">{t('specTable.pagination.next')}</span>
        </Button>
      </div>
    </div>
  );
}

// ============================================
// Main Component
// ============================================

export function SpecUsageTable({
  data,
  isLoading = false,
  className,
  pageSize = DEFAULT_PAGE_SIZE,
  onSpecClick
}: SpecUsageTableProps) {
  const { t } = useTranslation('usage');

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    field: 'cost',
    direction: 'desc'
  });
  const [currentPage, setCurrentPage] = useState(1);

  // Handle sort toggle
  const handleSort = useCallback((field: SortField) => {
    setSortConfig((current) => ({
      field,
      direction: current.field === field && current.direction === 'desc' ? 'asc' : 'desc'
    }));
    setCurrentPage(1); // Reset to first page on sort change
  }, []);

  // Handle search change
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setCurrentPage(1); // Reset to first page on search change
  }, []);

  // Process data: filter, sort, paginate
  const processedData = useMemo(() => {
    const filtered = filterSpecs(data, searchQuery);
    const sorted = sortSpecs(filtered, sortConfig);
    return sorted;
  }, [data, searchQuery, sortConfig]);

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(processedData.length / pageSize));
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return processedData.slice(startIndex, startIndex + pageSize);
  }, [processedData, currentPage, pageSize]);

  // Empty state
  if (!isLoading && data.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <FileText className="h-4 w-4 text-muted-foreground" />
            {t('specTable.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-48 flex-col items-center justify-center text-center">
            <FileText className="mb-2 h-12 w-12 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t('specTable.noData')}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <FileText className="h-4 w-4 text-muted-foreground" />
            {t('specTable.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <FileText className="h-4 w-4 text-muted-foreground" />
          {t('specTable.title')}
        </CardTitle>
        <div className="text-xs text-muted-foreground">
          {t('specTable.specCount', { count: data.length })}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {/* Search */}
        <div className="border-b border-border px-4 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t('specTable.search.placeholder')}
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="h-9 pl-9"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                {COLUMNS.map((column) => (
                  <TableHeaderCell
                    key={column.field}
                    column={column}
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    t={t}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {paginatedData.length > 0 ? (
                paginatedData.map((spec) => (
                  <SpecRow key={spec.specId} spec={spec} onClick={onSpecClick} t={t} />
                ))
              ) : (
                <tr>
                  <td colSpan={COLUMNS.length} className="py-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      {t('specTable.search.noResults')}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {processedData.length > pageSize && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={processedData.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            t={t}
          />
        )}
      </CardContent>
    </Card>
  );
}

export default SpecUsageTable;
