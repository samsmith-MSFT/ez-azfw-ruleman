import { MultiFilter } from './MultiFilter';
import {
  FILTER_LABELS,
  filterOptions,
  type FilterKey,
  type FilterValues,
  type Filters,
} from '../filters';

/** The row of standard filters (name, subscription, resource group, location, tag). */
export function FilterBar<T>({
  items,
  values,
  filters,
  onChange,
  onClear,
  active,
  summary,
}: {
  items: T[];
  values: FilterValues<T>;
  filters: Filters;
  onChange: (key: FilterKey, values: string[]) => void;
  onClear: () => void;
  active: boolean;
  /** Shown at the right, e.g. "Showing 4 of 30". */
  summary?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-6 py-2.5">
      {FILTER_LABELS.map(([key, label]) => (
        <MultiFilter
          key={key}
          label={label}
          options={filterOptions(key, items, filters, values)}
          selected={filters[key]}
          onChange={(v) => onChange(key, v)}
        />
      ))}
      {active && (
        <button
          className="ml-1 text-sm text-azure hover:underline"
          onClick={onClear}
        >
          Clear filters
        </button>
      )}
      {summary && (
        <span className="ml-auto text-xs text-fg-faint">{summary}</span>
      )}
    </div>
  );
}
