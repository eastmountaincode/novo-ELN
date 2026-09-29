import { describe, expect, it } from "vitest";
import { PAGE_SIGNATURE_MEANINGS, pageSignatureMeaningOption, signatureMeaningDisplayFromPayload, signatureMeaningFromPayload, signatureMeaningStatementFromPayload } from "../src/lib/pageSignatureMeaning";

describe("page signature meanings", () => {
  it("offers the six supported meaning labels with explicit statements", () => {
    expect(PAGE_SIGNATURE_MEANINGS.map((meaning) => meaning.value)).toEqual([
      "Authorship", "Review", "Approval", "Disapproval", "Responsibility", "Safety",
    ]);
    expect(PAGE_SIGNATURE_MEANINGS.every((meaning) => meaning.statement.length > 0)).toBe(true);
    expect(pageSignatureMeaningOption("Approval")?.statement).toBe("I reviewed and approve this record.");
    expect(pageSignatureMeaningOption("Unknown")).toBeNull();
    expect(pageSignatureMeaningOption(null)).toBeNull();
  });

  it("reads both new and older stored payloads without changing their claims", () => {
    const newPayload = JSON.stringify({ signatureMeaning: "Review", signatureMeaningStatement: "I reviewed this record." });
    expect(signatureMeaningFromPayload(newPayload)).toBe("Review");
    expect(signatureMeaningStatementFromPayload(newPayload)).toBe("I reviewed this record.");
    expect(signatureMeaningDisplayFromPayload(newPayload)).toBe("Review: I reviewed this record.");
    expect(signatureMeaningFromPayload('{"signatureMeaning":"Authorship"}')).toBe("Authorship");
    expect(signatureMeaningStatementFromPayload('{"signatureMeaning":"Authorship"}')).toBe("");
    expect(signatureMeaningDisplayFromPayload('{"signatureMeaning":"Authorship"}')).toBe("Authorship");
    expect(signatureMeaningDisplayFromPayload('{"signatureMeaning":"I attest to this record."}')).toBe("I attest to this record.");
    expect(signatureMeaningFromPayload("not JSON")).toBe("Unspecified");
  });
});
