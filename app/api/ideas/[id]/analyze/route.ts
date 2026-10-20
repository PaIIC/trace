import { analyzeIdea, AnalysisError } from "@/lib/ai";
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
    const { user, repository, connections } = await requestContext(request);
    const { id } = await context.params;
    const idea = await repository.find(user.userId, id);
    if (!idea) throw new HttpError(404, "这条灵感不存在或已经被删除。");
    if (request.body !== null) {
      const input = await readJSON(request);
      if (!Number.isInteger(input?.revision) || input.revision < 1)
        throw new HttpError(400, "请提供有效的灵感版本。");
      if (input.revision !== idea.revision)
        throw new HttpError(409, "灵感已更新，请基于最新内容重新分析。");
    }
    const config = await connections.resolve(user.userId);
    if (!config)
      throw new HttpError(
        503,
        "尚未连接 AI 服务。配置完成后，可以随时为已保存的灵感生成分析。",
      );
    const job = crypto.randomUUID();
    if (!(await repository.claimAnalysis(user.userId, id, job, idea.revision)))
      throw new HttpError(409, "灵感已更新或正在分析，请刷新后重试。");
    let committed = false;
    try {
      const analysis = await analyzeIdea(idea.content, config);
      committed = await repository.completeAnalysis(
        user.userId,
        id,
        job,
        analysis,
        config.model,
      );
    } catch (error) {
      const message =
        error instanceof AnalysisError
          ? error.message
          : "分析暂时中断，灵感已保存，请重试。";
      const failed = await repository.failAnalysis(
        user.userId,
        id,
        job,
        message,
      );
      if (!failed)
        throw new HttpError(409, "灵感已更新或删除，本次分析已取消。");
      return json(
        { idea: await repository.find(user.userId, id), error: message },
        502,
      );
    }
    if (!committed)
      throw new HttpError(409, "灵感已更新或删除，本次分析已取消。");
    return json({ idea: await repository.find(user.userId, id) });
  } catch (error) {
    return routeError(error);
  }
}
