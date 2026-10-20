import { HttpError, json, requestContext, routeError } from "@/lib/server";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user, repository } = await requestContext(request);
    const { id } = await context.params;
    const history = await repository.history(user.userId, id);
    if (!history) throw new HttpError(404, "这条灵感不存在或已经被删除。");
    return json(history);
  } catch (error) {
    return routeError(error);
  }
}
