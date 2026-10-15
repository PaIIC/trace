import { connectionInputSchema } from "@/lib/ai-connections";
import {
  HttpError,
  json,
  readJSON,
  requestContext,
  routeError,
} from "@/lib/server";

export async function GET(request: Request) {
  try {
    const { user, connections } = await requestContext(request);
    return json(await connections.summary(user.userId, user.displayName));
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, connections } = await requestContext(request);
    const parsed = connectionInputSchema.safeParse(await readJSON(request));
    if (!parsed.success)
      throw new HttpError(400, parsed.error.issues[0].message);
    await connections.save(user.userId, parsed.data);
    return json(await connections.summary(user.userId, user.displayName));
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { user, connections } = await requestContext(request);
    await connections.remove(user.userId);
    return json(await connections.summary(user.userId, user.displayName));
  } catch (error) {
    return routeError(error);
  }
}
