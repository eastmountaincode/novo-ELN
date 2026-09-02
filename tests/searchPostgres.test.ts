import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  querySql: vi.fn(),
}));

vi.mock("../src/lib/sqlite", () => ({
  execSql: vi.fn(),
  isPostgresDatabase: () => true,
  queryOne: databaseMocks.queryOne,
  querySql: databaseMocks.querySql,
  sql: (value: unknown) => `'${String(value).replace(/'/g, "''")}'`,
}));

describe("Postgres search candidates", () => {
  beforeEach(() => {
    databaseMocks.queryOne.mockReset();
    databaseMocks.querySql.mockReset();
    databaseMocks.queryOne.mockReturnValue({ role: "admin" });
    databaseMocks.querySql.mockReturnValue([
      {
        page_id: "old-exact-page",
        notebook_id: "binders-ii",
        notebook_name: "Binders-II",
        title: "Adora2B-GFP expression/localization test",
        body: "Adora2B-GFP localization results",
        tags: "",
        attachments: "",
        updated_at: "2016-04-07 13:44:50",
      },
    ]);
  });

  it("filters by required token coverage before limiting and ranks exact phrases first", async () => {
    const { searchWorkspace } = await import("../src/lib/search");

    const results = searchWorkspace("admin-user", "Adora2B-GFP", 30, "full");
    const statement = String(databaseMocks.querySql.mock.calls[0]?.[0] ?? "");

    expect(results.map((result) => result.pageId)).toContain("old-exact-page");
    expect(statement).toContain("AS matched_token_count");
    expect(statement).toContain(") >= 2");
    expect(statement).toContain("regexp_replace");
    expect(statement).toContain("%adora2b gfp%");
    expect(statement).toMatch(/ORDER BY\s+exact_phrase_match DESC,\s+title_matched_token_count DESC,/);
  });
});
