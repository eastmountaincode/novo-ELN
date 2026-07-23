"use client";

import { createContext, useContext, type ReactNode } from "react";

type NovoBrandContextValue = {
  wordmark: "Novo-dev" | "Novo";
  deploymentLabel: string | null;
};

const NovoBrandContext = createContext<NovoBrandContextValue>({
  wordmark: "Novo",
  deploymentLabel: null,
});

export function NovoInstanceProvider({
  children,
  wordmark,
  deploymentLabel,
}: {
  children: ReactNode;
  wordmark: "Novo-dev" | "Novo";
  deploymentLabel: string | null;
}) {
  return (
    <NovoBrandContext.Provider value={{ wordmark, deploymentLabel }}>
      {children}
    </NovoBrandContext.Provider>
  );
}

export function NovoWordmark() {
  return <>{useContext(NovoBrandContext).wordmark}</>;
}

export function NovoDeploymentLabel({ className }: { className?: string }) {
  const { deploymentLabel } = useContext(NovoBrandContext);

  if (!deploymentLabel) return null;

  return <p className={className}>{deploymentLabel}</p>;
}
