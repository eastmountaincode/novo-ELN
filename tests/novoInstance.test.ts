import { describe, expect, it } from "vitest";
import { getNovoBrand, resolveNovoInstance } from "../src/lib/novoInstance";

describe("Novo instance identity", () => {
  it("defaults to production branding", () => {
    expect(resolveNovoInstance(undefined)).toBe("prod");
    expect(getNovoBrand("")).toEqual({ instance: "prod", wordmark: "Novo", deploymentLabel: null });
  });

  it.each(["dev", "development", "staging", " DEV "])("maps %s to development branding", (value) => {
    expect(getNovoBrand(value)).toEqual({ instance: "dev", wordmark: "Novo-dev", deploymentLabel: null });
  });

  it.each(["prod", "production", " PROD "])("maps %s to production branding", (value) => {
    expect(getNovoBrand(value)).toEqual({ instance: "prod", wordmark: "Novo", deploymentLabel: null });
  });

  it("trims and displays a deployment label on development instances", () => {
    expect(getNovoBrand("dev", " AORUS2 development ")).toEqual({
      instance: "dev",
      wordmark: "Novo-dev",
      deploymentLabel: "AORUS2 development",
    });
  });

  it("never displays a deployment label on production instances", () => {
    expect(getNovoBrand("prod", "CCIBWeb2 staging")).toEqual({
      instance: "prod",
      wordmark: "Novo",
      deploymentLabel: null,
    });
  });

  it("rejects ambiguous values instead of displaying the wrong identity", () => {
    expect(() => resolveNovoInstance("qa")).toThrow(/Invalid NOVO_INSTANCE/);
  });
});
