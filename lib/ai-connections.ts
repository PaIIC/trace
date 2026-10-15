import { z } from "zod";
import { getAIConfig } from "./ai.ts";
import type { AIConfig, AIEnvironment } from "./ai.ts";
import { DEEPSEEK_BASE_URL } from "./connection-types.ts";
import type { Connection } from "./connection-types.ts";

export const connectionInputSchema = z
  .object({
    provider: z.literal("deepseek"),
    model: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/, "请填写有效的模型名称。"),
    apiKey: z
      .string()
      .trim()
      .max(512, "API Key 过长。")
      .refine(
        (value) =>
          !value || (value.length >= 10 && /^[\x21-\x7e]+$/.test(value)),
        "请填写完整的 API Key，不要包含空格或换行。",
      )
      .optional()
      .default(""),
  })
  .strict();
export type ConnectionInput = z.infer<typeof connectionInputSchema>;

export class ConnectionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface ConnectionEnvironment extends AIEnvironment {
  AI_SETTINGS_ENCRYPTION_KEY?: string;
}
interface SavedConnection {
  owner_id: string;
  model: string;
  encrypted_key: string;
  key_hint: string;
  updated_at: string;
}

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function wrappingKey(secret?: string) {
  if (!secret || !/^[0-9a-f]{64}$/i.test(secret))
    throw new ConnectionError(503, "密钥存储尚未就绪，请重新启动应用后重试。");
  const bytes = Uint8Array.from(secret.match(/../g)!, (pair) =>
    parseInt(pair, 16),
  );
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export class ConnectionService {
  constructor(
    private db: D1Database,
    private env: ConnectionEnvironment,
  ) {}

  private async find(owner: string) {
    return this.db
      .prepare("SELECT * FROM ai_connections WHERE owner_id = ?")
      .bind(owner)
      .first<SavedConnection>();
  }

  async summary(owner: string, displayName: string): Promise<Connection> {
    const saved = await this.find(owner);
    const fallback = getAIConfig(this.env);
    return {
      configured: !!saved || !!fallback,
      model: saved?.model ?? fallback?.model ?? null,
      displayName,
      provider: saved ? "deepseek" : fallback ? "compatible" : null,
      source: saved ? "saved" : fallback ? "environment" : null,
      keyHint: saved?.key_hint ?? null,
    };
  }

  private async decrypt(saved: SavedConnection) {
    const key = await wrappingKey(this.env.AI_SETTINGS_ENCRYPTION_KEY);
    try {
      const [version, iv, ciphertext] = saved.encrypted_key.split(".");
      if (version !== "v1" || !iv || !ciphertext) throw new Error();
      const plain = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: decode(iv),
          additionalData: new TextEncoder().encode(saved.owner_id),
        },
        key,
        decode(ciphertext),
      );
      return new TextDecoder().decode(plain);
    } catch {
      throw new ConnectionError(
        503,
        "无法读取已保存的密钥，请在 AI 连接设置中重新填写并保存。",
      );
    }
  }

  async resolve(owner: string): Promise<AIConfig | null> {
    const saved = await this.find(owner);
    return saved
      ? {
          key: await this.decrypt(saved),
          baseURL: DEEPSEEK_BASE_URL,
          model: saved.model,
          provider: "deepseek",
        }
      : getAIConfig(this.env);
  }

  async candidate(owner: string, input: ConnectionInput): Promise<AIConfig> {
    let key = input.apiKey;
    if (!key) {
      const saved = await this.find(owner);
      if (!saved) throw new ConnectionError(400, "请先填写 DeepSeek API Key。");
      key = await this.decrypt(saved);
    }
    return {
      key,
      baseURL: DEEPSEEK_BASE_URL,
      model: input.model,
      provider: "deepseek",
    };
  }

  async save(owner: string, input: ConnectionInput) {
    const config = await this.candidate(owner, input);
    const key = await wrappingKey(this.env.AI_SETTINGS_ENCRYPTION_KEY);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(owner),
      },
      key,
      new TextEncoder().encode(config.key),
    );
    const encrypted = `v1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
    await this.db
      .prepare(
        `INSERT INTO ai_connections
      (owner_id, model, encrypted_key, key_hint, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET model = excluded.model,
      encrypted_key = excluded.encrypted_key, key_hint = excluded.key_hint,
      updated_at = excluded.updated_at`,
      )
      .bind(
        owner,
        config.model,
        encrypted,
        config.key.slice(-4),
        new Date().toISOString(),
      )
      .run();
  }

  async remove(owner: string) {
    await this.db
      .prepare("DELETE FROM ai_connections WHERE owner_id = ?")
      .bind(owner)
      .run();
  }
}

// Probe only the authenticated model catalog. No research notes or paid generation.
export async function testDeepSeekConnection(
  config: AIConfig,
  fetcher: typeof fetch = fetch,
) {
  let response: Response;
  try {
    response = await fetcher(`${DEEPSEEK_BASE_URL}/models`, {
      headers: {
        Authorization: `Bearer ${config.key}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
  } catch {
    throw new ConnectionError(502, "暂时无法连接 DeepSeek，请检查网络后重试。");
  }
  if ([401, 403].includes(response.status))
    throw new ConnectionError(
      422,
      "DeepSeek 验证失败，请检查 API Key 是否正确或已失效。",
    );
  if (response.status === 429)
    throw new ConnectionError(429, "DeepSeek 请求过于频繁，请稍后重试。");
  if (!response.ok)
    throw new ConnectionError(502, "DeepSeek 暂时无法响应，请稍后重试。");
  let models: string[];
  try {
    const data = z
      .object({ data: z.array(z.object({ id: z.string() })) })
      .parse(await response.json());
    models = data.data.map((item) => item.id);
  } catch {
    throw new ConnectionError(
      502,
      "DeepSeek 返回的模型列表无法读取，请稍后重试。",
    );
  }
  if (!models.includes(config.model))
    throw new ConnectionError(
      422,
      "此密钥暂时无法使用所选模型，请检查模型名称或选择其他模型。",
    );
  return {
    ok: true,
    message: "密钥验证通过，所选模型可用。实际分析仍取决于账户额度。",
  };
}
