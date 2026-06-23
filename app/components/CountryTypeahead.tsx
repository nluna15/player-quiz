"use client";

import { useMemo, useRef, useState } from "react";
import type { Country } from "@/lib/quiz";

type Props = {
  countries: Country[];
  onSelect: (country: Country) => void;
  disabled?: boolean;
};

export default function CountryTypeahead({ countries, onSelect, disabled }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [selected, setSelected] = useState<Country | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter((c) => c.name.toLowerCase().includes(q));
  }, [countries, query]);

  // Picking from the list only fills in the choice — it does not submit.
  // The player must press "Go" (or Enter) to confirm the pick.
  function choose(country: Country) {
    setSelected(country);
    setQuery(country.name);
    setOpen(false);
    setHighlight(0);
  }

  // The "Go" button submits the country the player has selected.
  function submit() {
    if (disabled || !selected) return;
    onSelect(selected);
    setSelected(null);
    setQuery("");
    setOpen(false);
    setHighlight(0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // First Enter confirms the highlighted match into the input; a second
      // Enter (list now closed) submits the confirmed pick.
      if (open && matches.length) choose(matches[highlight] ?? matches[0]);
      else submit();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative w-full">
      <div className="flex gap-2.5">
        <input
          type="text"
          value={query}
          disabled={disabled}
          placeholder="Type a country…"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-2xl border-[2.5px] border-ink bg-surface px-4 py-3.5 text-[15px] font-semibold text-ink outline-none placeholder:text-[#a89a7d] focus:shadow-[3px_3px_0_#1b1813] disabled:opacity-50"
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay so a click on an option registers before the list closes.
            blurTimer.current = setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          disabled={disabled || !selected}
          onMouseDown={(e) => {
            // Submit before the input blur closes the list.
            e.preventDefault();
            if (blurTimer.current) clearTimeout(blurTimer.current);
            submit();
          }}
          className="grid shrink-0 place-items-center rounded-2xl border-[2.5px] border-ink bg-correct px-6 font-display text-[15px] font-bold text-white shadow-[3px_3px_0_#1b1813] transition active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:opacity-50"
        >
          Go
        </button>
      </div>

      {/* Reserve a fixed-height region for the list so opening it fills the
          existing space instead of growing the card. */}
      <div className="relative mt-2 h-52">
        {open && !disabled && matches.length > 0 && (
          <ul className="absolute inset-x-0 top-0 max-h-52 w-full overflow-auto rounded-2xl border-[2.5px] border-ink bg-surface py-1 shadow-[5px_5px_0_#1b1813]">
            {matches.map((c, i) => (
              <li key={c.code}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    // Prevent input blur from firing before the click.
                    e.preventDefault();
                    if (blurTimer.current) clearTimeout(blurTimer.current);
                    choose(c);
                  }}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] font-bold text-ink ${
                    i === highlight ? "bg-hint" : ""
                  }`}
                >
                  <span className="text-xl leading-none">{c.flag}</span>
                  <span>{c.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
