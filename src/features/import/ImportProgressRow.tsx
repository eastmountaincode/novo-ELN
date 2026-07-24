type ImportProgressRowProps = {
  label: string;
  value: string;
};

export function ImportProgressRow({ label, value }: ImportProgressRowProps) {
  return (
    <div className="grid grid-cols-[minmax(170px,1fr)_minmax(0,1fr)] gap-3">
      <span>{label}</span>
      <span className="truncate text-right font-medium text-slate-200" title={value}>{value}</span>
    </div>
  );
}
