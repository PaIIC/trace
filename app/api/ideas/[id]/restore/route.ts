import { ideaRestoreSchema } from "@/lib/domain";
import {
  HttpError,
  json,
  readJSON,
  requestContext,
  routeError,
} from "@/lib/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user, repository } = await requestContext(request);
    const { id } = await context.params;
    const parsed = ideaRestoreSchema.safeParse(await readJSON(request));
    if (!parsed.success)
      throw new HttpError(400, "恢复请求无效，请重新打开历史版本后重试。");
    const result = await repository.restore(user.userId, id, parsed.data);
    if (!result.idea) throw new HttpError(404, "这条灵感不存在或已经被删除。");
    if (result.missingVersion) throw new HttpError(404, "找不到这个历史版本。");
    if (result.conflict)
      throw new HttpError(
        409,
        "当前灵感已更新，请刷新历史记录、查看最新内容后再恢复。",
      );
    return json({ idea: result.idea });
  } catch (error) {
    return routeError(error);
  }
}
