import React from "react";

type Props = {
  title: string;
  children: React.ReactNode;
};

export default function AdminSectionCard({ title, children }: Props) {
  return (
    <section className="min-w-0 overflow-hidden rounded-[22px] border border-white/8 bg-[#11100f]/92 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] sm:p-5">
      <div className="text-[12px] font-bold uppercase tracking-[0.22em] text-white/42">
        {title}
      </div>
      <div className="mt-4 min-w-0">{children}</div>
    </section>
  );
}
