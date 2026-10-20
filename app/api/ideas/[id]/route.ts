import {
  HttpError,
  json,
  readJSON,
  requestContext,
  routeError,
} from "@/lib/server";
import { ideaEditSchema } from "@/lib/domain";
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
    if (input && "bookmarked" in Object(input)) {
      if (
        typeof input.bookmarked !== "boolean" ||
        Object.keys(input).length !== 1
      )
        throw new HttpError(400, "收藏状态无效，请单独修改收藏状态。");
      const idea = await repository.bookmark(user.userId, id, input.bookmarked);
      if (!idea) throw new HttpError(404, "这条灵感不存在或已经被删除。");
      return json({ idea });
    }
    const parsed = ideaEditSchema.safeParse(input);
    if (!parsed.success)
      throw new HttpError(
        400,
        "请填写 1–12,000 字的想法，最多 8 个标签，每个不超过 24 字，并提供有效版本。",
      );
    const { idea, conflict } = await repository.edit(
      user.userId,
      id,
      parsed.data,
    );
    if (!idea) throw new HttpError(404, "这条灵感不存在或已经被删除。");
    if (conflict)
      throw new HttpError(
        409,
        "这条灵感已在其他页面修改。你的草稿仍保留，请查看最新内容后再保存。",
      );
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
