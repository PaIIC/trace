export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_MODELS = ["deepseek-flash", "deepseek-v4-pro"] as const;
export const DEFAULT_DEEPSEEK_MODEL = DEEPSEEK_MODELS[0];

// Public metadata only. Never add the API key or its ciphertext to this type.
export interface Connection {
  configured: boolean;
  model: string | null;
  displayName: string;
  provider: "deepseek" | "compatible" | null;
  source: "saved" | "environment" | null;
  keyHint: string | null;
}
