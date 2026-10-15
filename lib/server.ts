import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { IdeaRepository } from "./ideas-repository";
import { ConnectionError, ConnectionService } from "./ai-connections";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function requestContext(request: Request) {
  const user = await getChatGPTUser();
  if (!user) throw new HttpError(401, "请先登录，再打开你的研究笔记。");
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin)
      throw new HttpError(403, "请求来源无效，请从当前网页重试。");
  }
  if (!env.DB) throw new HttpError(503, "数据库尚未配置，请完成数据库初始化。");
  return {
    user,
    repository: new IdeaRepository(env.DB),
    connections: new ConnectionService(env.DB, env),
  };
}

export async function readJSON(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new HttpError(415, "请提交 JSON 格式的数据。");
  // Bound the stream itself; Content-Length can be missing or untrusted.
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "提交内容不能为空。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65000) {
      await reader.cancel();
      throw new HttpError(413, "提交内容过长。");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "提交内容格式有误，请重试。");
  }
}

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function routeError(error: unknown) {
  if (error instanceof HttpError || error instanceof ConnectionError)
    return json({ error: error.message }, error.status);
  console.error(
    "Request failed:",
    error instanceof Error ? error.name : "UnknownError",
  );
  return json({ error: "暂时无法读取或保存，请稍后重试。" }, 500);
}
