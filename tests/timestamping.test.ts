import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novo-timestamp-test-"));
    const caFile = "/etc/ssl/certs/ca-certificates.crt";
    const caBundle = fs.readFileSync(caFile, "utf8");
    const rootPem = (caBundle.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [])
      .find((pem) => new X509Certificate(pem).subject.includes("DigiCert Trusted Root G4"));
    expect(rootPem).toBeTruthy();
    const rootCertificate = new X509Certificate(rootPem!);
    const rootSubject = rootCertificate.subject.split("\n").reverse().join(",");
    const runner = vi.fn(async (args: string[]) => {
      if (args[0] === "pkcs7") {
        fs.writeFileSync(args[args.indexOf("-out") + 1], `${rootPem}\n`);
      }
      if (args[0] === "x509") {
        return {
          stdout: "subject=CN = Example TSA\nsha256 Fingerprint=00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF\n",
          stderr: "",
        };
      }
      if (args[0] === "verify") {
        return {
          stdout: `/tmp/timestamp-signer.pem: OK\nChain:\ndepth=0: CN=Example TSA (untrusted)\ndepth=1: ${rootSubject}\n`,
          stderr: "",
        };
      }
      if (args[0] === "version") return { stdout: "OpenSSL test version\n", stderr: "" };
      return { stdout: "", stderr: "" };
    });

    const result = await verifyTimestampResponseFiles({
      requestPath: path.join(tempDir, "request.tsq"),
      responsePath: path.join(tempDir, "response.tsr"),
      tempDir,
      caFile,
    }, runner);

    expect(runner.mock.calls[0][0]).toEqual([
      "ts", "-verify", "-queryfile", path.join(tempDir, "request.tsq"), "-in", path.join(tempDir, "response.tsr"), "-CAfile", caFile,
    ]);
    expect(result.tsaSubject).toBe("CN = Example TSA");
    expect(result.tsaCertFingerprint).toBe("sha256:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff");
    expect(result.trustAnchor.sha256Fingerprint).toBe(`sha256:${rootCertificate.fingerprint256.replaceAll(":", "").toLowerCase()}`);
    expect(result.caBundleSha256).toMatch(/^[a-f0-9]{64}$/);
    fs.rmSync(tempDir, { recursive: true, force: true });
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
