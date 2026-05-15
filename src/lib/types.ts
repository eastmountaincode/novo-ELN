export type UserRole = "admin" | "member" | "viewer";
export type AccessRole = "owner" | "editor" | "viewer";
export type PageStatus = "Draft" | "Final";
export type BlockType = "image" | "sheet" | "pdf" | "slides" | "sequence" | "file";

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

export type AdminDataFile = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  blockType: BlockType;
  storageKey: string;
  createdAt: string;
  projectName: string;
  notebookName: string;
  pageTitle: string;
  ownerEmail: string;
};

export type AdminDataOverview = {
  counts: {
    users: number;
    projects: number;
    notebooks: number;
    pages: number;
    attachments: number;
    pageVersions: number;
    importJobs: number;
  };
  storage: {
    attachmentBytes: number;
    uploadFileCount: number;
    uploadBytes: number;
    orphanUploadCount: number;
    orphanUploadBytes: number;
    missingUploadCount: number;
  };
  files: AdminDataFile[];
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
