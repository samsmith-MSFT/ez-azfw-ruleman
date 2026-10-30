/** A row of mutually exclusive options (an accessible radio group styled as buttons). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  activeClass = () => 'bg-azure text-ink-950',
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
  label: string;
  /** Classes for the selected option, e.g. to color an action. */
  activeClass?: (v: T) => string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded border border-line p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`h-7 rounded-sm px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-30 ${
            value === o.value
              ? activeClass(o.value)
              : 'text-fg-muted hover:bg-ink-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
