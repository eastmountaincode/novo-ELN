import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];

function makeTemporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "novo-chat-compose-"));
  temporaryDirectories.push(directory);
  return directory;
}

function configureCompose(serviceEnvironment: string, hostSecretFile?: string) {
  const directory = makeTemporaryDirectory();
  const envFile = path.join(directory, "service.env");
  fs.writeFileSync(envFile, serviceEnvironment);
  const result = spawnSync("bash", ["-c", [
    "set -euo pipefail",
    `source ${JSON.stringify(path.join(projectRoot, "scripts/lib/novo-chat-compose.sh"))}`,
    `novo_configure_compose_args ${JSON.stringify(envFile)} ${JSON.stringify(projectRoot)}`,
    "printf '%s\\n' \"${NOVO_COMPOSE_ARGS[@]}\"",
    "printf 'container=%s\\n' \"${NOVO_INTEGRATION_SECRET_FILE:-}\"",
  ].join("\n")], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      NOVO_INTEGRATION_SECRET_HOST_FILE: hostSecretFile ?? "",
    },
  });
  return result;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("optional Novo Chat Compose secret", () => {
  it("uses only the base Compose file when Chat is unconfigured", () => {
    const result = configureCompose("NOVO_INSTANCE=dev\n");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${projectRoot}/docker-compose.yml`);
    expect(result.stdout).not.toContain("docker-compose.chat.yml");
    expect(result.stdout).toContain("container=\n");
  });

  it("adds the override for a valid host file and container path", () => {
    const directory = makeTemporaryDirectory();
    const secretFile = path.join(directory, "integration.secret");
    fs.writeFileSync(secretFile, "a-valid-integration-secret-with-more-than-32-characters\n", { mode: 0o600 });

    const result = configureCompose([
      "NOVO_INSTANCE=dev",
      "NOVO_INTEGRATION_SECRET_FILE=/run/secrets/novo-integration",
      "NOVO_CHAT_URL=/chat/",
      "",
    ].join("\n"), secretFile);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${projectRoot}/docker-compose.chat.yml`);
    expect(result.stdout).toContain("container=/run/secrets/novo-integration");
    expect(result.stdout).not.toContain("a-valid-integration-secret");
  });

  it("fails closed for an invalid host or container path", () => {
    const relativeHost = configureCompose(
      "NOVO_INTEGRATION_SECRET_FILE=/run/secrets/novo-integration\n",
      "relative.secret",
    );
    expect(relativeHost.status).not.toBe(0);
    expect(relativeHost.stderr).toContain("absolute host path");

    const directory = makeTemporaryDirectory();
    const secretFile = path.join(directory, "integration.secret");
    fs.writeFileSync(secretFile, "a-valid-integration-secret-with-more-than-32-characters\n");
    const invalidContainer = configureCompose(
      "NOVO_INTEGRATION_SECRET_FILE=/tmp/novo-integration\n",
      secretFile,
    );
    expect(invalidContainer.status).not.toBe(0);
    expect(invalidContainer.stderr).toContain("must be exactly /run/secrets/novo-integration");

    const mismatchedSecretName = configureCompose(
      "NOVO_INTEGRATION_SECRET_FILE=/run/secrets/alternate-integration\n",
      secretFile,
    );
    expect(mismatchedSecretName.status).not.toBe(0);
    expect(mismatchedSecretName.stderr).toContain("must be exactly /run/secrets/novo-integration");
  });

  it("rejects a Chat route without a secret mount", () => {
    const result = configureCompose("NOVO_CHAT_URL=/chat/\n");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("sets NOVO_CHAT_URL but does not set NOVO_INTEGRATION_SECRET_FILE");
  });

  it("rejects a host path placed in the container environment file", () => {
    const result = configureCompose([
      "NOVO_INTEGRATION_SECRET_FILE=/run/secrets/novo-integration",
      "NOVO_INTEGRATION_SECRET_HOST_FILE=/tmp/integration.secret",
      "",
    ].join("\n"));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("belongs in the invoking shell");
  });
});
