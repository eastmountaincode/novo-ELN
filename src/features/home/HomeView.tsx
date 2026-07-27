"use client";

import { Users } from "lucide-react";
import { PageCard } from "@/features/pages/PageCard";
import type { AppUser, Notebook, PageEntry, Project } from "@/lib/types";
import { userDisplayName, userInitials } from "@/lib/workspaceDisplay";

type RecentPage = {
  page: PageEntry;
  project: Project;
  notebook: Notebook;
};

type HomeViewProps = {
  recentPages: RecentPage[];
  members: AppUser[];
  selectPage: (project: Project, notebook: Notebook, page: PageEntry) => void;
};

export function HomeView({ recentPages, members, selectPage }: HomeViewProps) {
  return (
    <section className="min-h-screen overflow-y-auto scroll-contained bg-white p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold text-slate-950">Overview</h1>
          <div className="flex shrink-0 items-center gap-2 text-sm">
            <span className="font-medium text-slate-500">Group:</span>
            <span className="font-semibold text-slate-950">CCIB Therapeutics</span>
          </div>
        </div>

        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0 border border-slate-200 bg-white p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Recently edited pages</h2>
              </div>
            </div>
            <div className="grid min-w-0 gap-2">
              {recentPages.slice(0, 3).map(({ page, project, notebook }) => (
                <PageCard
                  key={page.id}
                  page={page}
                  accentColor={notebook.color}
                  contextLabel={notebook.name}
                  tinted
                  onClick={() => selectPage(project, notebook, page)}
                />
              ))}
              {recentPages.length === 0 ? <p className="p-3 text-sm text-slate-500">No recent pages yet.</p> : null}
            </div>
          </section>

          <aside className="min-w-0 space-y-6">
            <section className="border border-slate-200 bg-white p-4">
              <div className="mb-4 flex items-center gap-2">
                <Users size={17} className="text-slate-500" />
                <h2 className="text-base font-semibold text-slate-950">Group members</h2>
              </div>
              <div className="space-y-2">
                {members.map((member) => (
                  <div key={member.id} className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-3 border border-slate-100 px-3 py-2">
                    <div className="grid size-8 place-items-center rounded-full bg-slate-950 text-xs font-semibold text-white">{userInitials(member)}</div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-950">{userDisplayName(member)}</div>
                      <div className="mt-1 truncate text-xs text-slate-500">{member.email}</div>
                    </div>
                  </div>
                ))}
                {members.length === 0 ? <p className="text-sm text-slate-500">No group members yet.</p> : null}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}
