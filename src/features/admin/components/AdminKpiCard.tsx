import React from "react";

type Props = {
  label: string;
  value: string | number;
  sublabel?: string;
};

export default function AdminKpiCard({ label, value, sublabel }: Props) {
  return (
    <div className="rounded-3xl border border-neutral-800 bg-neutral-950 p-5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-neutral-500">
        {label}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-white">
        {value}
      </div>
      {sublabel ? (
        <div className="mt-2 text-sm text-neutral-400">{sublabel}</div>
      ) : null}
    </div>
  );
}