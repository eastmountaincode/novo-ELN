import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensureDatabase } = vi.hoisted(() => ({ ensureDatabase: vi.fn() }));

vi.mock("../src/lib/store", () => ({ ensureDatabase }));

import { GET } from "../src/app/api/health/database/route";

describe("database health route", () => {
  beforeEach(() => {
    ensureDatabase.mockReset();
  });

  it("initializes the database before reporting readiness", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(ensureDatabase).toHaveBeenCalledOnce();
  });

  it("reports an unavailable database without exposing the error", async () => {
    ensureDatabase.mockImplementationOnce(() => {
      throw new Error("sensitive database detail");
    });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false });
  });
});
