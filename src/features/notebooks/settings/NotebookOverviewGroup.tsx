import { NotebookOverviewRow } from "@/features/notebooks/settings/NotebookOverviewRow";

type NotebookOverviewGroupProps = {
  title: string;
  rows: Array<{ label: string; value: string }>;
};

export function NotebookOverviewGroup({ title, rows }: NotebookOverviewGroupProps) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      <dl className="mt-2 divide-y divide-slate-100 border-y border-slate-100 text-sm">
        {rows.map((row) => <NotebookOverviewRow key={row.label} label={row.label} value={row.value} />)}
      </dl>
    </section>
  );
}
