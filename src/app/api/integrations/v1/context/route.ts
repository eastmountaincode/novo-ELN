import { appBuildId, appVersion } from "@/generated/app-version";
import { getIntegrationContext, novoIntegrationApiVersion } from "@/lib/novoIntegration";
import { authenticateIntegrationRequest, integrationJson } from "@/lib/novoIntegrationHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authentication = await authenticateIntegrationRequest(request);
  if (!authentication.authorized) return authentication.response;

  const context = getIntegrationContext(authentication.user.id);
  return integrationJson({
    apiVersion: novoIntegrationApiVersion,
    novoVersion: appBuildId && appBuildId !== "unknown" ? appBuildId : appVersion,
    user: context.user,
    notebooks: context.notebooks,
  });
}
