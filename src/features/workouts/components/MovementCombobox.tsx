import React, { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { MovementLibraryItem } from "../types";

type MovementComboboxProps = {
  items: MovementLibraryItem[];
  valueId?: string;
  placeholder?: string;
  onSelect: (movementId: string) => void;
};

function matchesQuery(item: MovementLibraryItem, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  return (
    item.name.toLowerCase().includes(normalized) ||
    item.aliases.some((alias) => alias.toLowerCase().includes(normalized)) ||
    item.tags.some((tag) => tag.toLowerCase().includes(normalized)) ||
    item.equipment.some((equipment) => equipment.toLowerCase().includes(normalized))
  );
}

export default function MovementCombobox({
  items,
  valueId,
  placeholder = "Search movements",
  onSelect,
}: MovementComboboxProps) {
  const selectedItem = useMemo(
    () => items.find((item) => item.id === valueId) ?? null,
    [items, valueId]
  );
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const filteredItems = useMemo(() => {
    return items.filter((item) => matchesQuery(item, query)).slice(0, 12);
  }, [items, query]);

  function handleSelect(movementId: string) {
    onSelect(movementId);
    setQuery("");
    setIsOpen(false);
  }

  return (
    <div className="space-y-2">
      {selectedItem && !isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex w-full items-center justify-between rounded-[18px] border border-white/10 bg-black/85 px-4 py-3 text-left transition hover:border-white/20 hover:bg-neutral-950"
        >
          <div>
            <div className="text-sm font-medium text-white">{selectedItem.name}</div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/36">
              {selectedItem.category}
            </div>
          </div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/42">
            Change
          </div>
        </button>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/28" />
          <input
            value={query}
            onFocus={() => setIsOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setIsOpen(true);
            }}
            placeholder={placeholder}
            className="w-full rounded-[18px] border border-white/10 bg-black/85 py-3 pl-11 pr-10 text-sm text-white outline-none transition placeholder:text-white/22 focus:border-white/20 focus:bg-neutral-950"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-white/[0.04] p-1.5 text-white/55 transition hover:border-white/20 hover:text-white"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      )}

      {isOpen || !selectedItem ? (
        <div className="max-h-36 overflow-y-auto rounded-[18px] border border-white/10 bg-black/30 p-1.5">
          {filteredItems.length ? (
            filteredItems.map((item) => {
              const active = item.id === valueId;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelect(item.id)}
                  className={[
                    "w-full rounded-[14px] px-3 py-2 text-left text-sm transition",
                    active
                      ? "bg-amber-400/[0.08] text-amber-100"
                      : "text-white/74 hover:bg-white/[0.05] hover:text-white",
                  ].join(" ")}
                >
                  <div className="font-medium">{item.name}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/36">
                    {item.category}
                  </div>
                </button>
              );
            })
          ) : (
            <div className="px-3 py-3 text-sm text-white/46">
              No movements found.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
