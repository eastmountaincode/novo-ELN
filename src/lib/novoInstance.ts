export type NovoInstance = "dev" | "prod";

export type NovoBrand = {
  instance: NovoInstance;
  wordmark: "Novo-dev" | "Novo";
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

export function getNovoBrand(value = process.env.NOVO_INSTANCE): NovoBrand {
  const instance = resolveNovoInstance(value);

  return {
    instance,
    wordmark: instance === "dev" ? "Novo-dev" : "Novo",
  };
}
