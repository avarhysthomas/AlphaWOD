import React from "react";

type Props = {
  title: string;
  children: React.ReactNode;
};

export default function AdminSectionCard({ title, children }: Props) {
  return (
    <section className="min-w-0 overflow-hidden rounded-[1.75rem] border border-white/10 bg-neutral-950 p-4 sm:rounded-3xl sm:p-6">
      <div className="text-sm font-semibold text-white sm:text-[15px]">
        {title}
      </div>
      <div className="mt-4 min-w-0 sm:mt-5">{children}</div>
    </section>
  );
}