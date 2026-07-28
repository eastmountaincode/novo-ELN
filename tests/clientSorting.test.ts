import { describe, expect, it } from "vitest";
import { timestampForSort } from "../src/lib/clientSorting";

describe("client sorting timestamps", () => {
  it("treats SQLite and ISO timestamps as the same UTC moment", () => {
    expect(timestampForSort("2026-07-28 14:30:00")).toBe(
      timestampForSort("2026-07-28T14:30:00.000Z"),
    );
  });
});
