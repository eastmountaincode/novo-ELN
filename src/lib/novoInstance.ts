export type NovoInstance = "dev" | "prod";

export type NovoBrand = {
  instance: NovoInstance;
  wordmark: "Novo-dev" | "Novo";
  deploymentLabel: string | null;
};

export function resolveNovoInstance(value: string | undefined): NovoInstance {
  const normalized = value?.trim().toLowerCase();

  if (!normalized || normalized === "prod" || normalized === "production") {
    return "prod";
  }

  if (normalized === "dev" || normalized === "development" || normalized === "staging") {
    return "dev";
  }

  throw new Error(`Invalid NOVO_INSTANCE value "${value}". Expected "dev" or "prod".`);
}

export function getNovoBrand(
  value = process.env.NOVO_INSTANCE,
  deploymentLabelValue = process.env.NOVO_DEPLOYMENT_LABEL,
): NovoBrand {
  const instance = resolveNovoInstance(value);
  const deploymentLabel = deploymentLabelValue?.trim() || null;

  return {
    instance,
    wordmark: instance === "dev" ? "Novo-dev" : "Novo",
    deploymentLabel: instance === "dev" ? deploymentLabel : null,
  };
}
