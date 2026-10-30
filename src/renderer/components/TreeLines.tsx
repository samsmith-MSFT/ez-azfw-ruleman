/**
 * Tree connector lines for rows nested under a group heading (like a file tree). Render inside a
 * `relative` table cell; each level draws a vertical guide, and the row's own level adds a branch.
 * By default the first level lines up under a heading's expand arrow.
 */
export function TreeLines({
  depth,
  last,
  ancestorsContinue = [],
  left = 30,
  branchAt,
}: {
  /** 1 for rows directly under a heading, 2 for rows nested one level further. */
  depth: number;
  /** Last row at its level: its vertical line stops at the branch. */
  last: boolean;
  /** For each outer level, whether more rows follow there (so its line continues past this row). */
  ancestorsContinue?: boolean[];
  /** Horizontal position of the first level's line within the cell. */
  left?: number;
  /** Distance of the branch from the top of the row; defaults to the middle (for one-line rows). */
  branchAt?: number;
}) {
  const x = (level: number) => left + (level - 1) * 20;
  const at = branchAt === undefined ? '50%' : branchAt;
  return (
    <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0">
      {ancestorsContinue.map(
        (continues, i) =>
          continues && (
            <span
              key={i}
              className="absolute inset-y-0 w-px bg-line"
              style={{ left: x(i + 1) }}
            />
          ),
      )}
      <span
        className="absolute top-0 w-px bg-line"
        style={{ left: x(depth), height: last ? at : '100%' }}
      />
      <span
        className="absolute h-px w-3 bg-line"
        style={{ left: x(depth), top: at }}
      />
    </span>
  );
}

/** Left padding for a name cell at `depth`, leaving room for its tree lines. */
export const treeIndent = (depth: number) => 48 + (depth - 1) * 20;
