import type {
  Analysis,
  Idea,
  IdeaEdit,
  IdeaInput,
  IdeaRestore,
  IdeaStatus,
  IdeaVersion,
} from "./domain.ts";
import { ANALYSIS_LEASE_MS, titleFromContent } from "./domain.ts";

type Row = {
  id: string;
  owner_id: string;
  title: string;
  content: string;
  tags: string;
  created_at: string;
  updated_at: string;
  revision: number;
  restored_from_revision: number | null;
  bookmarked: number;
  status: IdeaStatus;
  analysis: string | null;
  analysis_stale: number;
  analysis_model: string | null;
  analyzed_at: string | null;
  analysis_started_at: string | null;
  error: string | null;
};

type VersionRow = {
  archived_at: string;
  snapshot: string;
};

// Capture values inside the write transaction, including an AI result that may
// have completed just before the edit. Never serialize the private job token.
const snapshotColumns = [
  "id",
  "title",
  "content",
  "tags",
  "created_at",
  "updated_at",
  "revision",
  "restored_from_revision",
  "bookmarked",
  "status",
  "analysis",
  "analysis_stale",
  "analysis_model",
  "analyzed_at",
  "analysis_started_at",
  "error",
];
const snapshotSQL = `json_object(${snapshotColumns.map((column) => `'${column}', ${column}`).join(", ")})`;

function fromRow(row: Row): Idea {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    tags: JSON.parse(row.tags),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
    restoredFromRevision: row.restored_from_revision ?? null,
    bookmarked: !!row.bookmarked,
    status: row.status,
    analysis: row.analysis ? JSON.parse(row.analysis) : null,
    analysisStale: !!row.analysis_stale,
    analysisModel: row.analysis_model,
    analyzedAt: row.analyzed_at,
    analysisStartedAt: row.analysis_started_at,
    error: row.error,
  };
}

function fromVersion(row: VersionRow): IdeaVersion {
  return {
    idea: fromRow(JSON.parse(row.snapshot)),
    archivedAt: row.archived_at,
  };
}

export class IdeaRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }

  async list(ownerId: string): Promise<Idea[]> {
    const result = await this.db
      .prepare(
        "SELECT * FROM ideas WHERE owner_id = ? ORDER BY created_at DESC, id DESC",
      )
      .bind(ownerId)
      .all<Row>();
    return result.results.map(fromRow);
  }

  async find(ownerId: string, id: string): Promise<Idea | null> {
    const row = await this.db
      .prepare("SELECT * FROM ideas WHERE id = ? AND owner_id = ?")
      .bind(id, ownerId)
      .first<Row>();
    return row ? fromRow(row) : null;
  }

  async history(ownerId: string, id: string) {
    const [current, versions] = await this.db.batch([
      this.db
        .prepare("SELECT * FROM ideas WHERE id = ? AND owner_id = ?")
        .bind(id, ownerId),
      this.db
        .prepare(
          "SELECT archived_at, snapshot FROM idea_versions WHERE idea_id = ? AND owner_id = ? ORDER BY revision DESC",
        )
        .bind(id, ownerId),
    ]);
    const row = current.results[0] as Row | undefined;
    return row
      ? {
          idea: fromRow(row),
          versions: (versions.results as VersionRow[]).map(fromVersion),
        }
      : null;
  }

  async export(ownerId: string) {
    const [ideas, versions] = await this.db.batch([
      this.db
        .prepare(
          "SELECT * FROM ideas WHERE owner_id = ? ORDER BY created_at DESC, id DESC",
        )
        .bind(ownerId),
      this.db
        .prepare(
          "SELECT archived_at, snapshot FROM idea_versions WHERE owner_id = ? ORDER BY idea_id, revision DESC",
        )
        .bind(ownerId),
    ]);
    return {
      ideas: (ideas.results as Row[]).map(fromRow),
      history: (versions.results as VersionRow[]).map(fromVersion),
    };
  }

  async create(ownerId: string, input: IdeaInput): Promise<Idea | null> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        "INSERT INTO ideas (id, owner_id, title, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
      )
      .bind(
        input.id,
        ownerId,
        titleFromContent(input.content),
        input.content,
        JSON.stringify([...new Set(input.tags)]),
        now,
        now,
      )
      .run();
    return this.find(ownerId, input.id);
  }

  async bookmark(ownerId: string, id: string, bookmarked: boolean) {
    await this.db
      .prepare(
        "UPDATE ideas SET bookmarked = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
      )
      .bind(Number(bookmarked), new Date().toISOString(), id, ownerId)
      .run();
    return this.find(ownerId, id);
  }

  async edit(ownerId: string, id: string, input: IdeaEdit) {
    const tags = JSON.stringify([...new Set(input.tags)]);
    const now = new Date().toISOString();
    // Compare-and-swap protects edits from other tabs. Clearing the job also
    // prevents an analysis of the previous text from being written back later.
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO idea_versions (idea_id, owner_id, revision, archived_at, snapshot) SELECT id, owner_id, revision, ?, ${snapshotSQL} FROM ideas WHERE id = ? AND owner_id = ? AND revision = ? AND (content != ? OR tags != ?)`,
        )
        .bind(now, id, ownerId, input.revision, input.content, tags),
      this.db
        .prepare(
          "UPDATE ideas SET title = ?, content = ?, tags = ?, revision = revision + 1, restored_from_revision = NULL, restore_request_id = NULL, updated_at = ?, status = 'pending', analysis_stale = CASE WHEN analysis IS NOT NULL THEN 1 ELSE 0 END, analysis_job = NULL, analysis_started_at = NULL, error = NULL WHERE id = ? AND owner_id = ? AND revision = ? AND (content != ? OR tags != ?)",
        )
        .bind(
          titleFromContent(input.content),
          input.content,
          tags,
          now,
          id,
          ownerId,
          input.revision,
          input.content,
          tags,
        ),
    ]);
    const idea = await this.find(ownerId, id);
    // Retrying an identical save after losing its response is safe.
    const conflict =
      !!idea &&
      (idea.content !== input.content || JSON.stringify(idea.tags) !== tags);
    return { idea, conflict };
  }

  async restore(ownerId: string, id: string, input: IdeaRestore) {
    const version = await this.db
      .prepare(
        "SELECT archived_at, snapshot FROM idea_versions WHERE idea_id = ? AND owner_id = ? AND revision = ?",
      )
      .bind(id, ownerId, input.versionRevision)
      .first<VersionRow>();
    if (!version)
      return {
        idea: await this.find(ownerId, id),
        conflict: false,
        missingVersion: true,
      };
    const saved = fromVersion(version).idea;
    // Historical processing jobs cannot be resumed. Restore their saved output,
    // if any, and allow a new analysis to be requested on the restored text.
    const status =
      saved.status === "processing"
        ? saved.analysis && !saved.analysisStale
          ? "completed"
          : "pending"
        : saved.status;
    const now = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO idea_versions (idea_id, owner_id, revision, archived_at, snapshot) SELECT id, owner_id, revision, ?, ${snapshotSQL} FROM ideas WHERE id = ? AND owner_id = ? AND revision = ?`,
        )
        .bind(now, id, ownerId, input.revision),
      this.db
        .prepare(
          "UPDATE ideas SET title = ?, content = ?, tags = ?, revision = revision + 1, restored_from_revision = ?, restore_request_id = ?, updated_at = ?, status = ?, analysis = ?, analysis_stale = ?, analysis_model = ?, analyzed_at = ?, error = ?, analysis_job = NULL, analysis_started_at = NULL WHERE id = ? AND owner_id = ? AND revision = ?",
        )
        .bind(
          saved.title,
          saved.content,
          JSON.stringify(saved.tags),
          input.versionRevision,
          input.requestId,
          now,
          status,
          saved.analysis ? JSON.stringify(saved.analysis) : null,
          Number(saved.analysisStale),
          saved.analysisModel,
          saved.analyzedAt,
          saved.status === "processing" ? null : saved.error,
          id,
          ownerId,
          input.revision,
        ),
    ]);
    const current = await this.db
      .prepare("SELECT * FROM ideas WHERE id = ? AND owner_id = ?")
      .bind(id, ownerId)
      .first<Row & { restore_request_id: string | null }>();
    return {
      idea: current ? fromRow(current) : null,
      conflict:
        !!current &&
        !(
          current.restore_request_id === input.requestId &&
          current.restored_from_revision === input.versionRevision &&
          current.revision === input.revision + 1
        ),
      missingVersion: false,
    };
  }

  async remove(ownerId: string, id: string) {
    const result = await this.db
      .prepare("DELETE FROM ideas WHERE id = ? AND owner_id = ?")
      .bind(id, ownerId)
      .run();
    return result.meta.changes > 0;
  }

  async claimAnalysis(
    ownerId: string,
    id: string,
    job: string,
    revision: number,
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const cutoff = new Date(Date.now() - ANALYSIS_LEASE_MS).toISOString();
    const result = await this.db
      .prepare(
        "UPDATE ideas SET status = 'processing', analysis_job = ?, analysis_started_at = ?, error = NULL, updated_at = ? WHERE id = ? AND owner_id = ? AND revision = ? AND (status != 'processing' OR analysis_started_at IS NULL OR analysis_started_at <= ?)",
      )
      .bind(job, now, now, id, ownerId, revision, cutoff)
      .run();
    return result.meta.changes > 0;
  }

  async completeAnalysis(
    ownerId: string,
    id: string,
    job: string,
    analysis: Analysis,
    model: string,
  ) {
    const now = new Date().toISOString();
    const result = await this.db
      .prepare(
        "UPDATE ideas SET status = 'completed', analysis = ?, analysis_stale = 0, analysis_model = ?, analyzed_at = ?, updated_at = ?, analysis_job = NULL, analysis_started_at = NULL, error = NULL WHERE id = ? AND owner_id = ? AND analysis_job = ?",
      )
      .bind(JSON.stringify(analysis), model, now, now, id, ownerId, job)
      .run();
    return result.meta.changes > 0;
  }

  async failAnalysis(
    ownerId: string,
    id: string,
    job: string,
    message: string,
  ) {
    const result = await this.db
      .prepare(
        "UPDATE ideas SET status = 'failed', error = ?, updated_at = ?, analysis_job = NULL, analysis_started_at = NULL WHERE id = ? AND owner_id = ? AND analysis_job = ?",
      )
      .bind(message, new Date().toISOString(), id, ownerId, job)
      .run();
    return result.meta.changes > 0;
  }
}
