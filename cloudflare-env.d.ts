declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    AI_API_KEY?: string;
    AI_BASE_URL?: string;
    AI_MODEL?: string;
  }
}
