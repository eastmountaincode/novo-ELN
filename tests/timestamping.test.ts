import { describe, expect, it, vi } from "vitest";

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

  it("extracts normalized signer identity and fingerprint", async () => {
    const { parseTsaSignerCertificateText } = await import("../src/lib/timestamping");
    const parsed = parseTsaSignerCertificateText(`
subject=C = US, O = "DigiCert, Inc.", CN = DigiCert SHA256 RSA4096 Timestamp Responder 2025 1
sha256 Fingerprint=4A:A0:3F:A2:2C:D7:5C:84:C5:5C:93:8F:82:8E:67:6B:9C:AE:CA:B3:3F:E3:6D:26:9A:A3:34:F1:46:11:0A:33
`);

    expect(parsed.tsaSubject).toContain("DigiCert SHA256 RSA4096 Timestamp Responder 2025 1");
    expect(parsed.tsaCertFingerprint).toBe("sha256:4aa03fa22cd75c84c55c938f828e676b9caecab33fe36d269aa334f146110a33");
  });

  it("verifies the response against the original request and trusted CA file", async () => {
    const { verifyTimestampResponseFiles } = await import("../src/lib/timestamping");
    const runner = vi.fn(async (args: string[]) => {
      if (args[0] === "x509") {
        return {
          stdout: "subject=CN = Example TSA\nsha256 Fingerprint=00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF\n",
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    });

    const result = await verifyTimestampResponseFiles({
      requestPath: "/tmp/request.tsq",
      responsePath: "/tmp/response.tsr",
      tempDir: "/tmp",
      caFile: "/etc/ssl/certs/ca-certificates.crt",
    }, runner);

    expect(runner.mock.calls[0][0]).toEqual([
      "ts", "-verify", "-queryfile", "/tmp/request.tsq", "-in", "/tmp/response.tsr", "-CAfile", "/etc/ssl/certs/ca-certificates.crt",
    ]);
    expect(result.tsaSubject).toBe("CN = Example TSA");
    expect(result.tsaCertFingerprint).toBe("sha256:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff");
  });

  it("rejects a response that fails OpenSSL verification", async () => {
    const { verifyTimestampResponseFiles } = await import("../src/lib/timestamping");
    const runner = vi.fn(async () => {
      throw Object.assign(new Error("verification failed"), { stderr: "Verification: FAILED\n" });
    });

    await expect(verifyTimestampResponseFiles({
      requestPath: "/tmp/request.tsq",
      responsePath: "/tmp/response.tsr",
      tempDir: "/tmp",
      caFile: "/etc/ssl/certs/ca-certificates.crt",
    }, runner)).rejects.toThrow("Timestamp authority response verification failed: Verification: FAILED.");
  });
});
