type ImportMetricProps = {
  label: string;
  value: string;
};

export function ImportMetric({ label, value }: ImportMetricProps) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 font-medium text-white">{value}</p>
    </div>
  );
}
