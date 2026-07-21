import { describe, expect, it } from "vitest";
import { getNovoBrand, resolveNovoInstance } from "../src/lib/novoInstance";

describe("Novo instance identity", () => {
  it("defaults to production branding", () => {
    expect(resolveNovoInstance(undefined)).toBe("prod");
    expect(getNovoBrand("")).toEqual({ instance: "prod", wordmark: "Novo" });
  });

  it.each(["dev", "development", "staging", " DEV "])("maps %s to development branding", (value) => {
    expect(getNovoBrand(value)).toEqual({ instance: "dev", wordmark: "Novo-dev" });
  });

  it.each(["prod", "production", " PROD "])("maps %s to production branding", (value) => {
    expect(getNovoBrand(value)).toEqual({ instance: "prod", wordmark: "Novo" });
  });

  it("rejects ambiguous values instead of displaying the wrong identity", () => {
    expect(() => resolveNovoInstance("qa")).toThrow(/Invalid NOVO_INSTANCE/);
  });
});
