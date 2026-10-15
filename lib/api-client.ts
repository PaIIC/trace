export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error("网络暂时不可用，请检查连接后重试。");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("服务暂时没有响应，请稍后重试。");
  }
  if (!response.ok)
    throw new ApiError(
      typeof data === "object" &&
        data &&
        "error" in data &&
        typeof data.error === "string"
        ? data.error
        : "操作失败，请稍后重试。",
      response.status,
    );
  return data as T;
}
