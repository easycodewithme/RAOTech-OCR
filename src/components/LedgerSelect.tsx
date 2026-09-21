"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Check, ChevronsUpDown, Plus, Loader2, AlertTriangle } from "lucide-react";
import type { LedgerGroup, LedgerType } from "@/lib/accounting/types";

export interface LedgerOption {
  id: string;
  name: string;
  group?: string;
  ledgerType?: string;
}

export type LedgerSelectHandle = {
  focusOpen: () => void;
};

/**
 * The groups this control will file a new ledger under, with the name Tally
 * itself shows for each — mirroring TALLY_GROUP in lib/tally/exportXml.ts,
 * which is what the export actually writes into <PARENT>. The Tally spelling is
 * what appears on screen because that is the word the accountant will look for
 * when they open the client's own books to check.
 *
 * `ledgerType` is derived from the group here instead of being a second thing
 * to choose. The two are not independent — a ledger under Sundry Creditors is a
 * party, one under Sales Accounts is a sale — and asking twice only creates the
 * chance of an answer that contradicts itself.
 *
 * Duties & Taxes is deliberately absent. Its ledgers come seeded, and the one
 * thing that distinguishes them, input versus output, cannot be inferred from a
 * name typed mid-review; guessing would put purchase GST on the output side and
 * quietly misstate a return. A firm that genuinely needs another tax ledger
 * creates it in Ledgers & Rules, where the choice is explicit.
 */
const NEW_LEDGER_GROUPS: ReadonlyArray<{
  group: LedgerGroup;
  tallyName: string;
  ledgerType: LedgerType;
}> = [
  { group: "SUNDRY_CREDITORS", tallyName: "Sundry Creditors", ledgerType: "PARTY" },
  { group: "SUNDRY_DEBTORS", tallyName: "Sundry Debtors", ledgerType: "PARTY" },
  { group: "INDIRECT_EXPENSES", tallyName: "Indirect Expenses", ledgerType: "EXPENSE" },
  { group: "DIRECT_EXPENSES", tallyName: "Direct Expenses", ledgerType: "EXPENSE" },
  { group: "PURCHASE_ACCOUNTS", tallyName: "Purchase Accounts", ledgerType: "PURCHASE" },
  { group: "SALES_ACCOUNTS", tallyName: "Sales Accounts", ledgerType: "SALE" },
  { group: "INDIRECT_INCOME", tallyName: "Indirect Incomes", ledgerType: "INCOME" },
  { group: "BANK_ACCOUNTS", tallyName: "Bank Accounts", ledgerType: "BANK" },
  { group: "CASH_IN_HAND", tallyName: "Cash-in-Hand", ledgerType: "CASH" },
  { group: "FIXED_ASSETS", tallyName: "Fixed Assets", ledgerType: "OTHER" },
  { group: "CURRENT_ASSETS", tallyName: "Current Assets", ledgerType: "OTHER" },
  { group: "CURRENT_LIABILITIES", tallyName: "Current Liabilities", ledgerType: "OTHER" },
];

/**
 * Searchable ledger picker with inline "create ledger". Calls POST /api/ledgers
 * to create on the fly and reports the new ledger back to the parent.
 *
 * Inline creation used to hardcode Indirect Expenses / EXPENSE for every ledger
 * it made. The commonest reason to create one here is a party the OCR found on
 * an invoice, so the commonest outcome was a Sundry Creditor filed under
 * Indirect Expenses — wrong in this app's ledger list, wrong in the export, and
 * wrong in the client's own Tally where the firm's staff would eventually find
 * it. The group is now chosen, and `defaultGroup` lets a caller preselect the
 * one its context implies (a party line on a purchase → Sundry Creditors; on a
 * sale → Sundry Debtors; a bank picker → Bank Accounts) so the fast path stays
 * one keystroke: type the name, press Enter.
 */
export const LedgerSelect = forwardRef<
  LedgerSelectHandle,
  {
    ledgers: LedgerOption[];
    value: string | null;
    onChange: (ledgerId: string) => void;
    onCreated?: (ledger: LedgerOption) => void;
    placeholder?: string;
    /** Preselected group for an inline creation. See the comment above. */
    defaultGroup?: LedgerGroup;
    /** Accessible name, for the many call sites whose <label> has no htmlFor. */
    ariaLabel?: string;
  }
>(function LedgerSelect(
  {
    ledgers,
    value,
    onChange,
    onCreated,
    placeholder = "Select ledger…",
    // Sundry Creditors, because a supplier the chart of accounts has never seen
    // is what this control is asked to create more than everything else put
    // together. It is also what /api/ledgers falls back to on its own.
    defaultGroup = "SUNDRY_CREDITORS",
    ariaLabel,
  },
  ref
) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [group, setGroup] = useState<LedgerGroup>(defaultGroup);
  const [activeIndex, setActiveIndex] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (index: number) => `${baseId}-opt-${index}`;

  useImperativeHandle(ref, () => ({
    focusOpen: () => {
      // The button first so the row scrolls into view, then the popup's search
      // input takes focus from it as it mounts.
      buttonRef.current?.focus();
      openPopup();
    },
  }));

  const selected = ledgers.find((l) => l.id === value) || null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ledgers.slice(0, 50);
    return ledgers.filter((l) => l.name.toLowerCase().includes(q)).slice(0, 50);
  }, [ledgers, query]);

  const exactExists = ledgers.some(
    (l) => l.name.toLowerCase() === query.trim().toLowerCase()
  );
  const canCreate = Boolean(query.trim()) && !exactExists;

  // The create row is the last option in the same listbox rather than a control
  // beside it, so Down-arrow reaches it and Enter fires it without the hand
  // leaving the keyboard. The group <select> stays outside the listbox — a
  // select is not an option, and nesting one would break the semantics.
  const optionCount = filtered.length + (canCreate ? 1 : 0);
  const createIndex = canCreate ? filtered.length : -1;
  // The list can shrink under the highlight — the parent refreshing `ledgers`
  // is enough — so what is rendered as active is always clamped to what exists.
  const activeOption = optionCount > 0 ? Math.min(activeIndex, optionCount - 1) : -1;

  const chosenGroup = NEW_LEDGER_GROUPS.find((g) => g.group === group) ?? NEW_LEDGER_GROUPS[0];

  /**
   * Closing has to say where focus goes. Letting the search input unmount on
   * its own drops focus onto <body>, which loses the keyboard position and
   * breaks the app-level shortcut layer that reads the focused element.
   */
  function close(restoreFocus: boolean) {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
    setCreateError(null);
    if (restoreFocus) buttonRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const box = boxRef.current;
      if (!box || box.contains(e.target as Node)) return;
      const hadFocusInside = box.contains(document.activeElement);
      setOpen(false);
      setQuery("");
      setActiveIndex(0);
      setCreateError(null);
      // Only reclaim focus if the click is not itself heading somewhere
      // focusable — stealing it back would fight the user's own click.
      if (hadFocusInside) {
        const target = e.target as HTMLElement | null;
        const takesFocus = target?.closest(
          "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])"
        );
        if (!takesFocus) buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Arrow keys move a highlight the list does not scroll to on its own, so the
  // active option is pulled into view. `block: "nearest"` and no `behavior`
  // keep it a jump rather than an animation — this fires on every keypress.
  useEffect(() => {
    if (!open) return;
    document.getElementById(optionId(activeOption))?.scrollIntoView({ block: "nearest" });
    // optionId is derived from a stable useId, so it does not need to be a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOption, open, baseId]);

  /** Opening resets the picker: a group chosen for one ledger is not a default
   *  for the next, and a stale query would filter the list before it is seen. */
  function openPopup() {
    setGroup(defaultGroup);
    setQuery("");
    setActiveIndex(0);
    setCreateError(null);
    setOpen(true);
  }

  function choose(ledgerId: string) {
    onChange(ledgerId);
    close(true);
  }

  async function handleCreate() {
    const name = query.trim();
    if (!name || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/ledgers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          group: chosenGroup.group,
          ledgerType: chosenGroup.ledgerType,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ledger) {
        onCreated?.(data.ledger);
        onChange(data.ledger.id);
        close(true);
        return;
      }
      // Previously this branch did nothing at all: the spinner stopped and the
      // ledger silently did not exist, so the next thing the user did was
      // assign a voucher line to a ledger that was never created.
      setCreateError(
        (typeof data?.error === "string" && data.error) ||
          `Could not create that ledger (${res.status}). Try a different name.`
      );
    } catch {
      setCreateError("Could not reach the server. Check the connection and try again.");
    } finally {
      setCreating(false);
    }
  }

  function onListKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === "Tab") {
      // Forward-tab is allowed to fall through to the group picker below the
      // list, which is otherwise unreachable from the keyboard — it is not an
      // option in the listbox, so arrow keys never visit it.
      if (!e.shiftKey && canCreate) return;
      // Otherwise Tab means "leave this alone", not "pick the highlighted row".
      // The default is deliberately not prevented: focus moves to the trigger
      // synchronously, so the browser's own Tab carries on from a real element
      // instead of stranding focus on a node that is about to unmount.
      close(true);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (optionCount === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => (i + step + optionCount) % optionCount);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(Math.max(0, optionCount - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (activeOption === createIndex) {
        void handleCreate();
      } else if (filtered[activeOption]) {
        choose(filtered[activeOption].id);
      }
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        // Marks an unmapped line for assistive tech the same way the red border
        // marks it for everyone else.
        aria-invalid={!selected || undefined}
        onClick={() => (open ? close(false) : openPopup())}
        onKeyDown={(e) => {
          // ArrowDown from the closed trigger opens the list, which is what the
          // combobox pattern trains people to expect.
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            openPopup();
          }
        }}
        className={`flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] motion-reduce:transition-none ${
          selected
            ? "border-[var(--spx-border)] text-[var(--spx-text)]"
            : "border-red-500/60 text-[var(--spx-text-secondary)]"
        }`}
      >
        <span className="truncate">{selected ? selected.name : placeholder}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-[var(--spx-muted)]" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-[var(--spx-border)] bg-[var(--spx-card)] shadow-lg">
          <div className="border-b border-[var(--spx-border)] p-2">
            <input
              autoFocus
              type="text"
              role="combobox"
              aria-label={ariaLabel ? `${ariaLabel} — search or create` : "Search or create a ledger"}
              aria-expanded="true"
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={activeOption >= 0 ? optionId(activeOption) : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                // The result set changes under the highlight, so it goes back
                // to the top rather than pointing at a row that just left.
                setActiveIndex(0);
                setCreateError(null);
              }}
              onKeyDown={onListKeyDown}
              placeholder="Search or create…"
              className="min-h-11 w-full rounded border border-[var(--spx-border)] bg-[var(--spx-input-bg)] px-2 py-1.5 text-sm text-[var(--spx-text)] outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--spx-active-border)]"
            />
          </div>

          <div
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel ?? "Ledgers"}
            className="max-h-60 overflow-y-auto"
          >
            {filtered.map((l, index) => (
              <div
                key={l.id}
                id={optionId(index)}
                role="option"
                aria-selected={value === l.id}
                onClick={() => choose(l.id)}
                onMouseMove={() => setActiveIndex(index)}
                className={`flex min-h-11 cursor-pointer items-center justify-between px-3 py-2 text-left text-sm text-[var(--spx-text)] ${
                  index === activeOption ? "bg-[var(--spx-card-hover)]" : ""
                }`}
              >
                <span className="truncate">{l.name}</span>
                {value === l.id && (
                  <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                )}
              </div>
            ))}

            {canCreate && (
              <div
                id={optionId(createIndex)}
                role="option"
                aria-selected={false}
                onClick={() => void handleCreate()}
                onMouseMove={() => setActiveIndex(createIndex)}
                className={`flex min-h-11 cursor-pointer items-center gap-2 border-t border-[var(--spx-border)] px-3 py-2 text-sm text-[var(--spx-text)] ${
                  createIndex === activeOption ? "bg-[var(--spx-card-hover)]" : ""
                } ${creating ? "opacity-60" : ""}`}
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <span className="truncate">
                  Create &ldquo;{query.trim()}&rdquo; under {chosenGroup.tallyName}
                </span>
              </div>
            )}

            {filtered.length === 0 && !canCreate && (
              <div className="px-3 py-2 text-xs text-[var(--spx-muted)]">No matches</div>
            )}
          </div>

          {canCreate && (
            <div className="space-y-1.5 border-t border-[var(--spx-border)] p-2">
              <label
                htmlFor={`${baseId}-group`}
                className="block text-[11px] uppercase tracking-wide text-[var(--spx-muted)]"
              >
                Tally group for the new ledger
              </label>
              <select
                id={`${baseId}-group`}
                value={group}
                onChange={(e) => setGroup(e.target.value as LedgerGroup)}
                onKeyDown={(e) => {
                  // Escape inside a native select closes the select itself in
                  // some browsers; stop it before it also closes the popup.
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    return;
                  }
                  // This is the last stop inside the popup. Shift+Tab is left
                  // alone so it falls back to the search input above.
                  if (e.key === "Tab" && !e.shiftKey) close(true);
                }}
                className="min-h-11 w-full cursor-pointer rounded border border-[var(--spx-border)] bg-[var(--spx-input-bg)] px-2 text-sm text-[var(--spx-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--spx-active-border)]"
              >
                {NEW_LEDGER_GROUPS.map((g) => (
                  <option key={g.group} value={g.group}>
                    {g.tallyName}
                  </option>
                ))}
              </select>
              <p className="text-[11px] leading-snug text-[var(--spx-muted)]">
                This is the parent the ledger is created under in the client&apos;s Tally.
              </p>
            </div>
          )}

          {createError && (
            <p
              role="alert"
              className="flex items-start gap-1.5 border-t border-[var(--spx-border)] px-3 py-2 text-xs text-[var(--spx-text)]"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden="true" />
              {createError}
            </p>
          )}
        </div>
      )}
    </div>
  );
});

LedgerSelect.displayName = "LedgerSelect";
