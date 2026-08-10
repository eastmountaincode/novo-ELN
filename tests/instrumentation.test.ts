import { beforeEach, describe, expect, it, vi } from "vitest";

const ensurePostgresDatabase = vi.fn();

vi.mock("../src/lib/postgresSchema", () => ({ ensurePostgresDatabase }));

import { register } from "../src/instrumentation";

describe("server instrumentation", () => {
  beforeEach(() => {
    ensurePostgresDatabase.mockClear();
    delete process.env.ELN_DATABASE_CLIENT;
    delete process.env.DATABASE_URL;
    process.env.NEXT_RUNTIME = "nodejs";
  });

  it("initializes Postgres before the server accepts requests", async () => {
    process.env.ELN_DATABASE_CLIENT = "postgres";

    await register();

    expect(ensurePostgresDatabase).toHaveBeenCalledOnce();
  });

  it("leaves the default SQLite startup unchanged", async () => {
    process.env.ELN_DATABASE_CLIENT = "sqlite";

    await register();

    expect(ensurePostgresDatabase).not.toHaveBeenCalled();
  });
});
