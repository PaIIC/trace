import {
  HttpError,
  json,
  readJSON,
  requestContext,
  routeError,
} from "@/lib/server";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { user, repository } = await requestContext(request);
    const { id } = await context.params;
    const idea = await repository.find(user.userId, id);
    if (!idea) throw new HttpError(404, "这条灵感不存在或已经被删除。");
    return json({ idea });
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { user, repository } = await requestContext(request);
    const { id } = await context.params;
    const input = await readJSON(request);
    if (typeof input?.bookmarked !== "boolean")
      throw new HttpError(400, "收藏状态无效。");
    const idea = await repository.bookmark(user.userId, id, input.bookmarked);
    if (!idea) throw new HttpError(404, "这条灵感不存在或已经被删除。");
    return json({ idea });
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { user, repository } = await requestContext(request);
    const { id } = await context.params;
    if (!(await repository.remove(user.userId, id)))
      throw new HttpError(404, "这条灵感不存在或已经被删除。");
    return json({ deleted: true });
  } catch (error) {
    return routeError(error);
  }
}
