import { describe, expect, it } from "vitest";

describe("RFC3161 timestamp metadata", () => {
  it("parses OpenSSL timestamp reply text", async () => {
    const { parseTimestampReplyText } = await import("../src/lib/timestamping");
    const parsed = parseTimestampReplyText(`
Status info:
Status: Granted.
Status description: unspecified
Failure info: unspecified

TST info:
Version: 1
Policy OID: 2.16.840.1.114412.7.1
Hash Algorithm: sha256
Serial number: 0xA48A4AF49DFA8708D792ED5AA84162D2
Time stamp: Aug  5 17:25:33 2026 GMT
TSA: unspecified
`);

    expect(parsed.status).toBe("granted");
    expect(parsed.statusMessage).toBe("unspecified");
    expect(parsed.policyOid).toBe("2.16.840.1.114412.7.1");
    expect(parsed.serialNumber).toBe("0xA48A4AF49DFA8708D792ED5AA84162D2");
    expect(parsed.tsaTime).toBe("Aug  5 17:25:33 2026 GMT");
  });
});
