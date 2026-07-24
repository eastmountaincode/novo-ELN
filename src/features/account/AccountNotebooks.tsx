import type { Notebook } from "@/lib/types";
import { formatDateTime } from "@/lib/dateTime";

export function AccountNotebooks({ notebooks }: { notebooks: Notebook[] }) {
  const owned = notebooks.filter((notebook) => notebook.accessRole === "owner");
  const editor = notebooks.filter((notebook) => notebook.accessRole === "editor");
  const viewer = notebooks.filter((notebook) => notebook.accessRole === "viewer");
  const rows = [
    { label: "Total associated", value: notebooks.length },
    { label: "Owner", value: owned.length },
    { label: "Shared with me", value: editor.length + viewer.length },
    { label: "Editor", value: editor.length },
    { label: "Viewer", value: viewer.length },
  ];

  return (
    <section className="max-w-4xl space-y-6">
      <div className="border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-950">Notebook access</h2>
        <dl className="mt-4 divide-y divide-slate-100 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[180px_minmax(0,1fr)] gap-4 py-2 first:pt-0 last:pb-0">
              <dt className="text-slate-500">{row.label}</dt>
              <dd className="font-medium text-slate-950">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-950">Notebooks</h2>
        {notebooks.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Notebook</th>
                  <th className="py-2 pr-4 font-medium">Access</th>
                  <th className="py-2 pr-4 font-medium">Pages</th>
                  <th className="py-2 pr-4 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {notebooks.map((notebook) => (
                  <tr key={notebook.id}>
                    <td className="py-2 pr-4">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: notebook.color }} />
                        <span className="min-w-0 truncate font-medium text-slate-950">{notebook.name}</span>
                      </div>
                    </td>
                    <td className="py-2 pr-4 capitalize text-slate-700">{notebook.accessRole}</td>
                    <td className="py-2 pr-4 text-slate-700">{notebook.pages.length}</td>
                    <td className="py-2 pr-4 text-slate-500">{formatDateTime(notebook.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No notebooks associated with this account.</p>
        )}
      </div>
    </section>
  );
}
