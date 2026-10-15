import { ideaInputSchema } from "@/lib/domain";
import { HttpError, json, readJSON, requestContext, routeError } from "@/lib/server";

export async function GET(request: Request) {
  try {
    const { user, repository } = await requestContext(request);
    return json({ ideas: await repository.list(user.userId) });
  } catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  try {
    const { user, repository } = await requestContext(request);
    const parsed = ideaInputSchema.safeParse(await readJSON(request));
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
    const idea = await repository.create(user.userId, parsed.data);
    if (!idea) throw new HttpError(409, "记录标识已被使用，请重新打开记录窗口。");
    return json({ idea }, 201);
  } catch (error) { return routeError(error); }
}
