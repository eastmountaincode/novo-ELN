import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  login: vi.fn(), getLoginRateLimit: vi.fn(), recordFailedLogin: vi.fn(), clearFailedLogins: vi.fn(),
}));
vi.mock("../src/lib/auth", () => ({ login: mocks.login }));
vi.mock("../src/lib/store", () => ({
  getLoginRateLimit: mocks.getLoginRateLimit,
  recordFailedLogin: mocks.recordFailedLogin,
  clearFailedLogins: mocks.clearFailedLogins,
}));
vi.mock("../src/lib/novoIntegrationConfig", () => ({ validateNovoLoginReturnPath: () => "/" }));
import { POST } from "../src/app/api/auth/login/route";

function request(body: unknown) {
  return new Request("http://staging.test/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getLoginRateLimit.mockReturnValue({ limited: false, retryAfterSeconds: 0 });
  mocks.login.mockResolvedValue(null);
});

describe("login request validation", () => {
  it("rejects missing, non-text and null-byte credentials before querying the database", async () => {
    for (const body of [null, {}, { email: [], password: "secret" }, { email: {}, password: "secret" }, { email: 42, password: "secret" }, { email: "person@example.test", password: [] }, { email: "person@example.test", password: "" }, { email: "person\0@example.test", password: "secret" }, { email: "person@example.test", password: "secret\0" }]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(mocks.getLoginRateLimit).not.toHaveBeenCalled();
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it("passes literal text through to credential verification and records failure", async () => {
    const email = "') OR 1=1 --";
    expect((await POST(request({ email, password: "wrong" }))).status).toBe(401);
    expect(mocks.login).toHaveBeenCalledWith(email, "wrong", false);
    expect(mocks.recordFailedLogin).toHaveBeenCalledWith(email, "unknown");
  });

  it("preserves successful login and clears failed attempts", async () => {
    const user = { id: "fixture", email: "o'brien@example.test" };
    mocks.login.mockResolvedValue(user);
    const response = await POST(request({ email: user.email, password: "correct", rememberDevice: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user, returnTo: "/" });
    expect(mocks.login).toHaveBeenCalledWith(user.email, "correct", true);
    expect(mocks.clearFailedLogins).toHaveBeenCalledWith(user.email, "unknown");
    expect(mocks.recordFailedLogin).not.toHaveBeenCalled();
  });

  it("preserves rate-limit responses without attempting login", async () => {
    mocks.getLoginRateLimit.mockReturnValue({ limited: true, retryAfterSeconds: 123 });
    const response = await POST(request({ email: "person@example.test", password: "secret" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("123");
    expect(mocks.login).not.toHaveBeenCalled();
  });
});
