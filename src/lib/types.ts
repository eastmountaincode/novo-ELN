export type UserRole = "admin" | "member" | "viewer";
export type AccessRole = "owner" | "editor" | "viewer";
export type PageStatus = "Draft" | "Final";
export type BlockType = "image" | "sheet" | "pdf" | "slides" | "sequence" | "file";
export type TagSelectionMode = "single" | "multi";

export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
};

export type AdminUser = AppUser & {
  createdAt: string;
  projectCount: number;
};

export type ShareMember = {
  userId: string;
  email: string;
  name: string;
  role: AccessRole;
};

export type Attachment = {
  id: string;
  pageId: string;
  originalName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  blockType: BlockType;
  previewText: string;
  createdAt: string;
  updatedAt: string;
};

export type TagValue = {
  id: string;
  groupId: string;
  label: string;
  color: string;
  position: number;
  archivedAt: string | null;
};

export type TagGroup = {
  id: string;
  projectId: string;
  name: string;
  mode: TagSelectionMode;
  createdAt: string;
  updatedAt: string;
  values: TagValue[];
};

export type PageTagAssignment = {
  groupId: string;
  groupName: string;
  mode: TagSelectionMode;
  valueId: string;
  label: string;
  color: string;
};

export type PageEntry = {
  id: string;
  notebookId: string;
  title: string;
  body: string;
  status: PageStatus;
  ownerId: string;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  tagAssignments: PageTagAssignment[];
  attachments: Attachment[];
  versions: string[];
};

export type Notebook = {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  accessRole: AccessRole;
  members: ShareMember[];
  pages: PageEntry[];
};

export type Project = {
  id: string;
  name: string;
  description: string;
  color: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  accessScope: "project" | "notebook";
  accessRole: AccessRole | null;
  members: ShareMember[];
  tagGroups: TagGroup[];
  notebooks: Notebook[];
};

export type Workspace = {
  user: AppUser;
  projects: Project[];
};

export type SearchMatchType = "title" | "content" | "attachment" | "fuzzy";

export type SearchResult = {
  pageId: string;
  projectId: string;
  notebookId: string;
  title: string;
  projectName: string;
  notebookName: string;
  snippet: string;
  updatedAt: string;
  matchType: SearchMatchType;
  score: number;
};
