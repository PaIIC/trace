import {
  connectionInputSchema,
  testDeepSeekConnection,
} from "@/lib/ai-connections";
import {
  HttpError,
  json,
  readJSON,
  requestContext,
  routeError,
} from "@/lib/server";

export async function POST(request: Request) {
  try {
    const { user, connections } = await requestContext(request);
    const parsed = connectionInputSchema.safeParse(await readJSON(request));
    if (!parsed.success)
      throw new HttpError(400, parsed.error.issues[0].message);
    const candidate = await connections.candidate(user.userId, parsed.data);
    return json(await testDeepSeekConnection(candidate));
  } catch (error) {
    return routeError(error);
  }
}
