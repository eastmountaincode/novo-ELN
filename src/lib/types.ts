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
  lastLoginAt: string;
  lastActivityAt: string;
  notebookCount: number;
};

export type UserSigningKey = {
  id: string;
  userId: string;
  algorithm: string;
  publicKey: string;
  publicKeyFingerprint: string;
  createdAt: string;
  revokedAt: string;
  revocationReason: string;
  active: boolean;
};

export type PageSignatureTimestamp = {
  id: string;
  pageSignatureId: string;
  provider: string;
  tsaUrl: string;
  hashAlgorithm: string;
  messageImprint: string;
  requestDerBase64: string;
  responseDerBase64: string;
  status: string;
  statusMessage: string;
  policyOid: string;
  serialNumber: string;
  tsaTime: string;
  tsaSubject: string;
  tsaCertFingerprint: string;
  verifiedAt: string;
  errorMessage: string;
  createdAt: string;
};

export type PageSignature = {
  id: string;
  pageId: string;
  notebookId: string;
  signerUserId: string;
  signerEmail: string;
  signerFirstName: string;
  signerLastName: string;
  signingKeyId: string;
  signingKeyAlgorithm: string;
  signingPublicKey: string;
  signingPublicKeyFingerprint: string;
  recordHashAlgorithm: string;
  recordHash: string;
  signatureAlgorithm: string;
  signaturePayload: string;
  signature: string;
  recordManifestJson: string;
  recordPackageStorageKey: string;
  recordPackageBytes: number;
  recordPackageSha256: string;
  finalizationPackageStorageKey: string;
  finalizationPackageBytes: number;
  finalizationPackageSha256: string;
  proofHashAlgorithm: string;
  proofHash: string;
  proofPackageJson: string;
  timestamps: PageSignatureTimestamp[];
  createdAt: string;
};

export type AdminTag = {
  id: string;
  label: string;
  pageCount: number;
  notebookCount: number;
  updatedAt: string;
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
};

export type DatabaseSchemaColumn = {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string;
  primaryKey: boolean;
};

export type DatabaseSchemaIndex = {
  name: string;
  unique: boolean;
  columns: string[];
};

export type DatabaseSchemaRelationship = {
  id: number;
  sequence: number;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  onUpdate: string;
  onDelete: string;
};

export type DatabaseSchemaTable = {
  name: string;
  type: string;
  sql: string;
  internal: boolean;
  columns: DatabaseSchemaColumn[];
  foreignKeys: DatabaseSchemaRelationship[];
  indexes: DatabaseSchemaIndex[];
};

export type DatabaseSchemaOverview = {
  generatedAt: string;
  databasePath: string;
  tables: DatabaseSchemaTable[];
  relationships: DatabaseSchemaRelationship[];
  tableCount: number;
  columnCount: number;
  relationshipCount: number;
  internalTableCount: number;
};

export type ErflowAdminStatus = {
  configured: boolean;
  viewUrl: string;
};

export type ErflowSyncResult = {
  syncedAt: string;
  dryRun: boolean;
  tableCount: number;
  relationshipCount: number;
  operationCount: number;
  responseText: string;
};

export type ShareMember = {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: AccessRole;
  appRole: UserRole;
  implicitAdmin: boolean;
};

export type Attachment = {
  id: string;
  pageId: string;
  originalName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  blockType: BlockType;
  evernoteHash: string;
  createdAt: string;
  updatedAt: string;
  annotation?: AttachmentAnnotation | null;
};

export type AttachmentAnnotation = {
  dataJson: string;
  updatedAt: string;
  updatedBy: string;
};

export type PageComment = {
  id: string;
  threadId: string;
  userId: string;
  userFirstName: string;
  userLastName: string;
  userEmail: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type PageCommentThread = {
  id: string;
  pageId: string;
  createdBy: string;
  createdByFirstName: string;
  createdByLastName: string;
  createdByEmail: string;
  selectedText: string;
  resolvedAt: string;
  createdAt: string;
  updatedAt: string;
  comments: PageComment[];
};

export type AuditEvent = {
  id: string;
  entityType: "page" | "notebook" | "attachment" | "tag";
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
  pageTitle?: string;
  notebookName?: string;
};

export type AdminActivityOverview = {
  events: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type AdminAppSettings = {
  prependDateToNewPages: boolean;
  suggestTagsGlobally: boolean;
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
  finalizedAt?: string;
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
  pageTitleTemplate: string;
  pageTitleTemplateEnabled: boolean;
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
  appSettings: AdminAppSettings;
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
