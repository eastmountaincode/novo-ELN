type NotebookOverviewRowProps = {
  label: string;
  value: string;
};

export function NotebookOverviewRow({ label, value }: NotebookOverviewRowProps) {
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-4 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="select-text break-words text-left font-medium tabular-nums text-slate-950">{value}</dd>
    </div>
  );
}
