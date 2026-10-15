import { env } from "cloudflare:workers";
import { analyzeIdea, AnalysisError, getAIConfig } from "@/lib/ai";
import { HttpError, json, requestContext, routeError } from "@/lib/server";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, repository } = await requestContext(request);
    const { id } = await context.params;
    const idea = await repository.find(user.userId, id);
    if (!idea) throw new HttpError(404, "这条灵感不存在或已经被删除。");
    const config = getAIConfig(env);
    if (!config) throw new HttpError(503, "尚未连接 AI 服务。配置完成后，可以随时为已保存的灵感生成分析。");
    const job = crypto.randomUUID();
    if (!await repository.claimAnalysis(user.userId, id, job)) throw new HttpError(409, "这条灵感正在分析，请稍等片刻。");
    try {
      const analysis = await analyzeIdea(idea.content, config);
      await repository.completeAnalysis(user.userId, id, job, analysis, config.model);
    } catch (error) {
      const message = error instanceof AnalysisError ? error.message : "分析暂时中断，灵感已保存，请重试。";
      await repository.failAnalysis(user.userId, id, job, message);
      return json({ idea: await repository.find(user.userId, id), error: message }, 502);
    }
    return json({ idea: await repository.find(user.userId, id) });
  } catch (error) { return routeError(error); }
}
