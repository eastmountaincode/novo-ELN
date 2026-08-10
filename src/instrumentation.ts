export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const databaseClient = (process.env.ELN_DATABASE_CLIENT ?? "").trim().toLowerCase();
  if (databaseClient !== "postgres" && databaseClient !== "postgresql" && !process.env.DATABASE_URL) return;

  const { ensurePostgresDatabase } = await import("./lib/postgresSchema");
  ensurePostgresDatabase();
}
