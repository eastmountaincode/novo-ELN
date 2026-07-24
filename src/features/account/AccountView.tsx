import { Database, History, KeyRound, Notebook as NotebookIcon, Settings, Tag, UserCircle, Users } from "lucide-react";
import { useState } from "react";
import type { AppUser, Notebook } from "@/lib/types";
import { AccountNotebooks } from "@/features/account/AccountNotebooks";
import { AccountProfile } from "@/features/account/AccountProfile";
import { PasswordPanel } from "@/features/account/PasswordPanel";
import { AdminActivityPanel } from "@/features/account/admin/AdminActivityPanel";
import { AppSettingsPanel } from "@/features/account/admin/AppSettingsPanel";
import { DataAdminPanel } from "@/features/account/admin/DataAdminPanel";
import { TagsAdminPanel } from "@/features/account/admin/TagsAdminPanel";
import { UsersAdminPanel } from "@/features/account/admin/UsersAdminPanel";

type AccountTab = "profile" | "notebooks" | "security" | "app" | "users" | "activity" | "data" | "tags";

export function AccountView({ user, notebooks, onChanged }: { user: AppUser; notebooks: Notebook[]; onChanged: () => Promise<void> }) {
  const [activeTab, setActiveTab] = useState<AccountTab>("profile");
  const tabs: Array<{ id: AccountTab; label: string; icon: typeof UserCircle }> = [
    { id: "profile", label: "Profile", icon: UserCircle },
    { id: "notebooks", label: "Notebooks", icon: NotebookIcon },
    { id: "security", label: "Security", icon: KeyRound },
    ...(user.role === "admin" ? [{ id: "users" as AccountTab, label: "Users", icon: Users }] : []),
    ...(user.role === "admin" ? [{ id: "activity" as AccountTab, label: "Activity", icon: History }] : []),
    ...(user.role === "admin" ? [{ id: "data" as AccountTab, label: "Data", icon: Database }] : []),
    ...(user.role === "admin" ? [{ id: "tags" as AccountTab, label: "Tags", icon: Tag }] : []),
    ...(user.role === "admin" ? [{ id: "app" as AccountTab, label: "App Settings", icon: Settings }] : []),
  ];

  return (
    <section className="min-h-screen overflow-y-auto scroll-contained bg-white p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-slate-950">Account Settings</h1>
        </div>

        <div className="mb-6 flex flex-wrap gap-2 border-b border-slate-200">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium ${selected ? "border-slate-950 text-slate-950" : "border-transparent text-slate-500 hover:text-slate-900"}`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === "profile" ? <AccountProfile user={user} onChanged={onChanged} /> : null}
        {activeTab === "notebooks" ? <AccountNotebooks notebooks={notebooks} /> : null}
        {activeTab === "security" ? <PasswordPanel /> : null}
        {activeTab === "app" && user.role === "admin" ? <AppSettingsPanel onChanged={onChanged} /> : null}
        {activeTab === "users" && user.role === "admin" ? <UsersAdminPanel currentUserId={user.id} /> : null}
        {activeTab === "activity" && user.role === "admin" ? <AdminActivityPanel /> : null}
        {activeTab === "data" && user.role === "admin" ? <DataAdminPanel /> : null}
        {activeTab === "tags" && user.role === "admin" ? <TagsAdminPanel onChanged={onChanged} /> : null}
      </div>
    </section>
  );
}
