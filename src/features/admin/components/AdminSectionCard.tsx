import React from "react";

type Props = {
  title: string;
  children: React.ReactNode;
};

export default function AdminSectionCard({ title, children }: Props) {
  return (
    <section className="rounded-3xl border border-neutral-800 bg-neutral-950 p-6">
      <div className="text-sm font-semibold text-white">{title}</div>
      <div className="mt-5">{children}</div>
    </section>
  );
}