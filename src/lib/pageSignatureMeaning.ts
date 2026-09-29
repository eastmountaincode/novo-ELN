export const PAGE_SIGNATURE_MEANINGS = [
  { value: "Authorship", statement: "I contributed to the content of this record." },
  { value: "Review", statement: "I reviewed this record." },
  { value: "Approval", statement: "I reviewed and approve this record." },
  { value: "Disapproval", statement: "I reviewed and do not approve this record." },
  { value: "Responsibility", statement: "I accept responsibility for this record." },
  { value: "Safety", statement: "I reviewed this record for safety considerations." },
] as const;

export type PageSignatureMeaning = (typeof PAGE_SIGNATURE_MEANINGS)[number]["value"];

export function pageSignatureMeaningOption(value: unknown) {
  return PAGE_SIGNATURE_MEANINGS.find((option) => option.value === value) ?? null;
}

export function signatureMeaningFromPayload(payload: string) {
  try {
    const meaning = (JSON.parse(payload) as { signatureMeaning?: unknown }).signatureMeaning;
    return typeof meaning === "string" && meaning.trim() ? meaning : "Unspecified";
  } catch {
    return "Unspecified";
  }
}

export function signatureMeaningStatementFromPayload(payload: string) {
  try {
    const statement = (JSON.parse(payload) as { signatureMeaningStatement?: unknown }).signatureMeaningStatement;
    return typeof statement === "string" && statement.trim() ? statement : "";
  } catch {
    return "";
  }
}

export function signatureMeaningDisplayFromPayload(payload: string) {
  const meaning = signatureMeaningFromPayload(payload);
  const statement = signatureMeaningStatementFromPayload(payload);
  return statement ? `${meaning}: ${statement}` : meaning;
}
