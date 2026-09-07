"use client";

import { useCallback, useRef, useState } from "react";
import type { CellValue } from "@/lib/excel/types";

/** Maximum rows rendered in the grid. */
const MAX_DISPLAY_ROWS = 100;

interface SheetDataGridProps {
  headers: string[];
  /** All data rows from the upload preview. */
  rows: CellValue[][];
  totalRows: number;
  /** Sparse map of row index → edited cells. */
  editedRows: Map<number, CellValue[]>;
  onCellEdit: (rowIndex: number, colIndex: number, value: CellValue) => void;
  /** Mapped column indices — highlighted so the user sees which columns matter. */
  mappedColumns?: Set<number>;
}

/**
 * An inline-editable spreadsheet grid.
 *
 * Click any cell to edit. Modified cells get an amber left-border indicator.
 * The first column is a sticky row number for cross-referencing with issues.
 */
export default function SheetDataGrid({
  headers,
  rows,
  totalRows,
  editedRows,
  onCellEdit,
  mappedColumns,
}: SheetDataGridProps) {
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayRows = rows.slice(0, MAX_DISPLAY_ROWS);

  const getCellValue = useCallback(
    (rowIdx: number, colIdx: number): CellValue => {
      const edited = editedRows.get(rowIdx);
      if (edited && colIdx < edited.length) return edited[colIdx];
      const row = rows[rowIdx];
      return row && colIdx < row.length ? row[colIdx] : null;
    },
    [rows, editedRows]
  );

  const isCellDirty = useCallback(
    (rowIdx: number, colIdx: number): boolean => {
      const edited = editedRows.get(rowIdx);
      if (!edited) return false;
      const orig = rows[rowIdx];
      if (!orig) return true;
      return String(edited[colIdx] ?? "") !== String(orig[colIdx] ?? "");
    },
    [rows, editedRows]
  );

  const formatCell = (v: CellValue): string => {
    if (v == null) return "";
    if (v instanceof Date) return v.toLocaleDateString("en-IN");
    return String(v);
  };

  const handleCellClick = (rowIdx: number, colIdx: number) => {
    setEditingCell({ row: rowIdx, col: colIdx });
    // Focus the input on next tick
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleInputBlur = () => {
    setEditingCell(null);
  };

  const handleInputChange = (rowIdx: number, colIdx: number, rawValue: string) => {
    // Try to preserve number types
    let value: CellValue = rawValue;
    if (rawValue === "") {
      value = null;
    } else {
      const num = Number(rawValue);
      if (!isNaN(num) && rawValue.trim() !== "") {
        value = num;
      }
    }
    onCellEdit(rowIdx, colIdx, value);
  };

  const handleKeyDown = (e: React.KeyboardEvent, rowIdx: number, colIdx: number) => {
    if (e.key === "Escape") {
      setEditingCell(null);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const nextCol = e.shiftKey ? colIdx - 1 : colIdx + 1;
      if (nextCol >= 0 && nextCol < headers.length) {
        setEditingCell({ row: rowIdx, col: nextCol });
      } else if (!e.shiftKey && rowIdx + 1 < displayRows.length) {
        setEditingCell({ row: rowIdx + 1, col: 0 });
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rowIdx + 1 < displayRows.length) {
        setEditingCell({ row: rowIdx + 1, col: colIdx });
      } else {
        setEditingCell(null);
      }
    }
  };

  return (
    <div className="space-y-2">
      <div className="max-h-[480px] overflow-auto rounded-lg border border-border shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-muted/80 backdrop-blur-sm">
              <th className="sticky left-0 z-20 bg-muted/90 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-r border-border w-12">
                #
              </th>
              {headers.map((h, i) => (
                <th
                  key={i}
                  className={`px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider border-b border-border whitespace-nowrap ${
                    mappedColumns?.has(i)
                      ? "text-primary bg-primary/5"
                      : "text-muted-foreground"
                  }`}
                >
                  {h || `Col ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((_, rowIdx) => (
              <tr
                key={rowIdx}
                className={`transition-colors ${
                  editedRows.has(rowIdx)
                    ? "bg-amber-500/5"
                    : rowIdx % 2 === 0
                      ? "bg-card"
                      : "bg-muted/20"
                }`}
              >
                <td className="sticky left-0 z-10 bg-muted/60 px-3 py-1.5 text-[11px] tabular-nums text-muted-foreground border-r border-border font-medium">
                  {rowIdx + 1}
                </td>
                {headers.map((_, colIdx) => {
                  const isEditing =
                    editingCell?.row === rowIdx && editingCell?.col === colIdx;
                  const value = getCellValue(rowIdx, colIdx);
                  const dirty = isCellDirty(rowIdx, colIdx);

                  return (
                    <td
                      key={colIdx}
                      className={`px-0.5 py-0 border-b border-border/50 relative ${
                        dirty ? "border-l-2 border-l-amber-500" : ""
                      } ${
                        mappedColumns?.has(colIdx) ? "bg-primary/[0.02]" : ""
                      }`}
                      onClick={() => !isEditing && handleCellClick(rowIdx, colIdx)}
                    >
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          type="text"
                          className="w-full bg-background px-2.5 py-1.5 text-sm text-foreground outline-none ring-1 ring-primary/50 rounded-sm"
                          defaultValue={formatCell(value)}
                          onBlur={(e) => {
                            handleInputChange(rowIdx, colIdx, e.target.value);
                            handleInputBlur();
                          }}
                          onKeyDown={(e) => handleKeyDown(e, rowIdx, colIdx)}
                        />
                      ) : (
                        <div
                          className="cursor-text px-2.5 py-1.5 text-sm text-foreground min-h-[32px] hover:bg-primary/5 rounded-sm transition-colors truncate max-w-[200px]"
                          title={formatCell(value)}
                        >
                          {formatCell(value) || (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalRows > MAX_DISPLAY_ROWS && (
        <p className="text-xs text-muted-foreground">
          Showing first {MAX_DISPLAY_ROWS} of {totalRows} rows. To fix rows beyond
          this range, edit the source spreadsheet and re-upload.
        </p>
      )}

      {editedRows.size > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {editedRows.size} row{editedRows.size === 1 ? "" : "s"} modified —
          changes are highlighted with an amber border.
        </p>
      )}
    </div>
  );
}
