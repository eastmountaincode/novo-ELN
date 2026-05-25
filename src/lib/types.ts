export type UserRole = "admin" | "member" | "viewer";
export type AccessRole = "owner" | "editor" | "viewer";
export type PageStatus = "" | "Working" | "Needs review" | "Completed" | "Failed";
export type BlockType = "image" | "sheet" | "pdf" | "slides" | "sequence" | "file";

export type AppUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
};

export type AdminUser = AppUser & {
  createdAt: string;
  notebookCount: number;
};

export type AdminDataFile = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  blockType: BlockType;
  storageKey: string;
  createdAt: string;
  notebookName: string;
  pageTitle: string;
  ownerEmail: string;
};

export type AdminDataOverview = {
  counts: {
    users: number;
    notebooks: number;
    pages: number;
    attachments: number;
  };
  storage: {
    attachmentBytes: number;
    uploadFileCount: number;
    uploadBytes: number;
    orphanUploadCount: number;
    orphanUploadBytes: number;
    missingUploadCount: number;
  };
  filePage: {
    total: number;
    limit: number;
    offset: number;
  };
  files: AdminDataFile[];
};

export type ShareMember = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
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
  createdAt: string;
  updatedAt: string;
};

export type AuditEvent = {
  id: string;
  entityType: "page" | "notebook" | "attachment";
  entityId: string;
  pageId: string;
  notebookId: string;
  actorUserId: string;
  actorFirstName: string;
  actorLastName: string;
  actorEmail: string;
  action: string;
  summary: string;
  metadata: Record<string, unknown>;
  eventCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PageEntry = {
  id: string;
  notebookId: string;
  title: string;
  body: string;
  bodyPreview?: string;
  bodyLoaded?: boolean;
  status: PageStatus;
  ownerId: string;
  ownerFirstName: string;
  ownerLastName: string;
  lockedAt: string;
  lockedBy: string;
  lockedByFirstName: string;
  lockedByLastName: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  attachments: Attachment[];
  attachmentCount?: number;
  attachmentBytes?: number;
};

export type Notebook = {
  id: string;
  name: string;
  color: string;
  ownerId: string;
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
  notebooks: Notebook[];
};

export type Workspace = {
  user: AppUser;
  members: AppUser[];
  notebooks: Notebook[];
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
