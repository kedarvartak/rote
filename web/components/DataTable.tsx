import { Fragment } from "react";

/**
 * One column of a {@link DataTable}.
 *
 * @param card - where this column lands in the phone layout. `title` and
 *   `badge` move into the card's header and drop their label (the value is
 *   self-describing there); `hide` omits the column entirely, for a value that
 *   only earns its keep next to its neighbours. Anything else becomes a
 *   labelled line in the card body.
 */
export type Column<T> = {
  header: string;
  cell: (row: T) => React.ReactNode;
  /** applied to the `<td>` and to the card's value — keep it layout-free */
  className?: string;
  /** desktop-only width hint, e.g. `"w-56"` */
  width?: string;
  card?: "title" | "badge" | "hide";
};

/**
 * A table that becomes a list of cards on a phone.
 *
 * A five-column table in a 390px viewport degrades to a horizontal scroller
 * whose row label leaves the screen before its last cell arrives — the reader
 * loses track of which row they are in. Below `sm` each row is re-laid as a
 * card with the values labelled in place, so no scrolling is needed and the
 * row's identity stays on screen. From `sm` up it is an ordinary table.
 *
 * Both layouts render the same `rows`, so there is one source of truth; the
 * duplication is markup, not data.
 */
export function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  className = "",
}: {
  /** describes the table for screen readers on the card layout */
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  className?: string;
}) {
  const title = columns.find((c) => c.card === "title");
  const badge = columns.find((c) => c.card === "badge");
  const body = columns.filter(
    (c) => c.card !== "title" && c.card !== "badge" && c.card !== "hide",
  );

  return (
    <div className={className}>
      {/* phone: one card per row */}
      <ul className="sm:hidden space-y-3" aria-label={label}>
        {rows.map((r) => (
          <li
            key={rowKey(r)}
            className="rounded-sm border hairline bg-surface p-4"
          >
            {(title || badge) && (
              <div className="flex items-baseline justify-between gap-3 pb-3 mb-3 border-b hairline">
                {title && (
                  <span className={`font-medium text-ink ${title.className ?? ""}`}>
                    {title.cell(r)}
                  </span>
                )}
                {badge && (
                  <span className={`shrink-0 text-right ${badge.className ?? ""}`}>
                    {badge.cell(r)}
                  </span>
                )}
              </div>
            )}
            <dl className="space-y-2.5">
              {body.map((c) => (
                <Fragment key={c.header}>
                  <dt className="font-mono text-[0.6rem] uppercase tracking-widest text-muted">
                    {c.header}
                  </dt>
                  <dd className={`mt-0.5 text-[0.87rem] leading-relaxed text-ink-2 ${c.className ?? ""}`}>
                    {c.cell(r)}
                  </dd>
                </Fragment>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      {/* sm and up: the table proper */}
      <div className="hidden sm:block overflow-x-auto rounded-sm border hairline">
        <table className="w-full text-[0.87rem]">
          <thead className="bg-surface border-b hairline text-left">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.header}
                  scope="col"
                  className={`px-4 py-3 font-mono text-[0.62rem] uppercase tracking-widest text-muted font-normal whitespace-nowrap ${c.width ?? ""}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y hairline">
            {rows.map((r) => (
              <tr
                key={rowKey(r)}
                className="align-top hover:bg-surface/70 transition-colors"
              >
                {columns.map((c) => (
                  <td
                    key={c.header}
                    className={`px-4 py-4 leading-relaxed text-ink-2 ${c.className ?? ""}`}
                  >
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
