import { json, requestContext, routeError } from "@/lib/server";

export async function GET(request: Request) {
  try {
    const { user, repository } = await requestContext(request);
    return json({
      app: "研迹 Trace",
      version: 2,
      exportedAt: new Date().toISOString(),
      ...(await repository.export(user.userId)),
    });
  } catch (error) {
    return routeError(error);
  }
}
