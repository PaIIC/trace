import { env } from "cloudflare:workers";
import { getAIConfig } from "@/lib/ai";
import { json, requestContext, routeError } from "@/lib/server";

export async function GET(request: Request) {
  try {
    const { user } = await requestContext(request);
    const config = getAIConfig(env);
    return json({
      configured: !!config,
      model: config?.model ?? null,
      displayName: user.displayName,
    });
  } catch (error) {
    return routeError(error);
  }
}
