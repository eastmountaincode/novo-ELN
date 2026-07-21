"use client";

import { createContext, useContext, type ReactNode } from "react";

const NovoWordmarkContext = createContext<"Novo-dev" | "Novo">("Novo");

export function NovoInstanceProvider({
  children,
  wordmark,
}: {
  children: ReactNode;
  wordmark: "Novo-dev" | "Novo";
}) {
  return <NovoWordmarkContext.Provider value={wordmark}>{children}</NovoWordmarkContext.Provider>;
}

export function NovoWordmark() {
  return <>{useContext(NovoWordmarkContext)}</>;
}
