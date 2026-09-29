import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(), buildPageRecordPackage: vi.fn(),
  createPageRecordSignature: vi.fn(), createPageSignatureTimestamp: vi.fn(),
  getPage: vi.fn(), getPageCommentThreads: vi.fn(), getPageNotebook: vi.fn(),
  listPageRecordAuditEvents: vi.fn(), listPageRecordSignatures: vi.fn(),
  rollbackPageRecordFinalization: vi.fn(), setPageLocked: vi.fn(),
  storePageFinalizationPackage: vi.fn(), requestTimestampForProofHash: vi.fn(),
}));
vi.mock("../src/lib/auth", () => ({ currentUser: mocks.currentUser }));
vi.mock("../src/lib/pageRecordPackage", () => ({ buildPageRecordPackage: mocks.buildPageRecordPackage }));
vi.mock("../src/lib/store", () => mocks);
vi.mock("../src/lib/timestamping", () => ({ requestTimestampForProofHash: mocks.requestTimestampForProofHash }));

import { POST } from "../src/app/api/pages/[pageId]/proof/sign/route";
import { PAGE_SIGNATURE_MEANINGS } from "../src/lib/pageSignatureMeaning";

function request(body: unknown) {
  return POST(new Request("http://localhost/api/pages/page/proof/sign", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ pageId: "page" }) });
}

describe("page signing route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.currentUser.mockResolvedValue({ id: "user" });
    mocks.buildPageRecordPackage.mockResolvedValue({ recordHash: "record-hash", manifest: {}, archive: new Uint8Array() });
    mocks.createPageRecordSignature.mockReturnValue({ id: "signature", proofHash: "proof-hash" });
    mocks.storePageFinalizationPackage.mockReturnValue({ id: "signature" });
  });

  it.each([undefined, "", "Unknown", {}, 1])("rejects invalid meaning %j before building or signing a record", async (signatureMeaning) => {
    const response = await request({ signingPassphrase: "test passphrase", signatureMeaning });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Select a valid signature meaning." });
    expect(mocks.buildPageRecordPackage).not.toHaveBeenCalled();
    expect(mocks.createPageRecordSignature).not.toHaveBeenCalled();
    expect(mocks.requestTimestampForProofHash).not.toHaveBeenCalled();
    expect(mocks.setPageLocked).not.toHaveBeenCalled();
  });

  it.each(PAGE_SIGNATURE_MEANINGS)("passes $value to signing without trusting a client-supplied statement", async ({ value }) => {
    const response = await request({ signingPassphrase: "test passphrase", signatureMeaning: value, signatureMeaningStatement: "A different claim" });
    expect(response.status).toBe(201);
    expect(mocks.createPageRecordSignature).toHaveBeenCalledWith("user", {
      pageId: "page", recordHash: "record-hash", recordManifest: {}, recordArchive: new Uint8Array(),
      signingPassphrase: "test passphrase", signatureMeaning: value,
    });
    expect(mocks.requestTimestampForProofHash).toHaveBeenCalledWith("proof-hash");
    expect(mocks.setPageLocked).toHaveBeenCalledWith("user", "page", true);
  });

  it("rejects a non-string passphrase before signing", async () => {
    expect((await request({ signingPassphrase: {}, signatureMeaning: "Approval" })).status).toBe(400);
    expect(mocks.createPageRecordSignature).not.toHaveBeenCalled();
  });

  it("rolls back when timestamping fails and leaves the page unlocked", async () => {
    mocks.requestTimestampForProofHash.mockRejectedValueOnce(new Error("Timestamp authority unavailable"));
    const response = await request({ signingPassphrase: "test passphrase", signatureMeaning: "Disapproval" });
    expect(response.status).toBe(502);
    expect(mocks.rollbackPageRecordFinalization).toHaveBeenCalledWith("user", "signature");
    expect(mocks.storePageFinalizationPackage).not.toHaveBeenCalled();
    expect(mocks.setPageLocked).not.toHaveBeenCalled();
  });
});
