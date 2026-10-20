import { z } from "zod";

export const MAX_CONTENT_LENGTH = 12000;
export const ANALYSIS_LEASE_MS = 90_000;

export const ideaInputSchema = z.object({
  id: z.string().uuid(),
  content: z
    .string()
    .trim()
    .min(1, "写下一点想法再保存吧")
    .max(MAX_CONTENT_LENGTH, "每条灵感最多 12,000 字"),
  tags: z.array(z.string().trim().min(1).max(24)).max(8).default([]),
});

export const ideaEditSchema = ideaInputSchema
  .pick({ content: true, tags: true })
  .extend({ revision: z.number().int().min(1) })
  .strict();

export const analysisSchema = z.object({
  title: z.string().trim().min(1).max(100),
  summary: z.string().trim().min(1).max(2000),
  question: z.string().trim().min(1).max(1500),
  value: z.string().trim().min(1).max(2000),
  approach: z.string().trim().min(1).max(3000),
  nextSteps: z.array(z.string().trim().min(1).max(600)).min(1).max(5),
  keywords: z.array(z.string().trim().min(1).max(24)).min(1).max(6),
});

export type Analysis = z.infer<typeof analysisSchema>;
export type IdeaInput = z.infer<typeof ideaInputSchema>;
export type IdeaEdit = z.infer<typeof ideaEditSchema>;
export type IdeaStatus = "pending" | "processing" | "completed" | "failed";
export interface Idea {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  revision: number;
  bookmarked: boolean;
  status: IdeaStatus;
  analysis: Analysis | null;
  analysisStale: boolean;
  analysisModel: string | null;
  analyzedAt: string | null;
  analysisStartedAt: string | null;
  error: string | null;
}

export function ideaTitle(idea: Idea): string {
  return (!idea.analysisStale && idea.analysis?.title) || idea.title;
}

// A delayed poll or analysis response must not roll back a saved edit.
export function newerIdea(current: Idea | undefined, incoming: Idea): Idea {
  if (
    current &&
    (current.revision > incoming.revision ||
      (current.revision === incoming.revision &&
        current.updatedAt > incoming.updatedAt))
  )
    return current;
  return incoming;
}

export function titleFromContent(content: string): string {
  const firstLine = content
    .trim()
    .split(/\n/)[0]
    .replace(/^#+\s*/, "");
  return firstLine.length > 42 ? `${firstLine.slice(0, 42)}…` : firstLine;
}

export function parseAnalysis(content: string): Analysis {
  if (content.length > 22000) throw new Error("模型返回内容过长，请重试。");
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = analysisSchema.safeParse(JSON.parse(cleaned));
  if (!parsed.success) throw new Error("模型返回的分析格式不完整，请重试。");
  return parsed.data;
}

export function isAnalysisRunning(
  idea: Pick<Idea, "status" | "analysisStartedAt">,
  now = Date.now(),
) {
  return (
    idea.status === "processing" &&
    !!idea.analysisStartedAt &&
    now - Date.parse(idea.analysisStartedAt) < ANALYSIS_LEASE_MS
  );
}
