export const PAGE_SIGNATURE_MEANING = "Authorship";

export function signatureMeaningFromPayload(payload: string) {
  try {
    const meaning = (JSON.parse(payload) as { signatureMeaning?: unknown }).signatureMeaning;
    return typeof meaning === "string" && meaning.trim() ? meaning : "Unspecified";
  } catch {
    return "Unspecified";
  }
}
