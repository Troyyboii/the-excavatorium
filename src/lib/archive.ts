// Deterministic paginated archive reader + React Query hooks.
// All reads go through RLS via the publishable-key client. All writes go
// through the approved RPC functions.
//
// Every query key is scoped by the authenticated user id so that data
// belonging to one user is never rendered from cache to another. When the
// signed-in user changes (including sign-out) the AuthGate clears the whole
// React Query cache before rendering.

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useCurrentUserId } from "./session";
import { fingerprintFile, validateDocumentData, validateSelectedDocumentFile } from "./document";
import type {
  ArchiveExport,
  ArchiveLink,
  ArchiveRecord,
  BaseArchiveRecord,
  ConversationData,
  DecisionData,
  RecordType,
  RepositoryData,
  ToolData,
} from "./types";

const PAGE_SIZE = 500;

type RecordRow = {
  id: string;
  user_id: string;
  record_type: RecordType;
  title: string;
  summary: string;
  tags: string[] | null;
  record_data: Record<string, unknown>;
  is_example: boolean;
  seed_key: string | null;
  created_at: string;
  updated_at: string;
};

type LinkRow = {
  id: string;
  user_id: string;
  source_record_id: string;
  target_record_id: string;
  seed_key: string | null;
  created_at: string;
};

function normalizeTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid database timestamp: ${value}`);
  }
  return parsed.toISOString();
}

function toRecord(row: RecordRow): ArchiveRecord {
  const base: BaseArchiveRecord = {
    id: row.id,
    recordType: row.record_type,
    title: row.title,
    summary: row.summary ?? "",
    tags: row.tags ?? [],
    isExample: row.is_example,
    seedKey: row.seed_key,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
  switch (row.record_type) {
    case "tool":
      return { ...base, recordType: "tool", recordData: row.record_data as unknown as ToolData };
    case "repository":
      return {
        ...base,
        recordType: "repository",
        recordData: row.record_data as unknown as RepositoryData,
      };
    case "conversation":
      return {
        ...base,
        recordType: "conversation",
        recordData: row.record_data as unknown as ConversationData,
      };
    case "decision":
      return {
        ...base,
        recordType: "decision",
        recordData: row.record_data as unknown as DecisionData,
      };
    case "document":
      return {
        ...base,
        recordType: "document",
        recordData: validateDocumentData(row.record_data),
      };
  }
}

function toLink(row: LinkRow): ArchiveLink {
  return {
    id: row.id,
    sourceId: row.source_record_id,
    targetId: row.target_record_id,
    seedKey: row.seed_key,
    createdAt: normalizeTimestamp(row.created_at),
  };
}

async function fetchAllRecords(): Promise<ArchiveRecord[]> {
  const out: ArchiveRecord[] = [];
  let from = 0;
  for (;;) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("records")
      .select(
        "id,user_id,record_type,title,summary,tags,record_data,is_example,seed_key,created_at,updated_at",
      )
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw new Error(error.message);
    if (!data) throw new Error("records read returned no data");
    for (const row of data as RecordRow[]) out.push(toRecord(row));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

async function fetchAllLinks(): Promise<ArchiveLink[]> {
  const out: ArchiveLink[] = [];
  let from = 0;
  for (;;) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("record_links")
      .select("id,user_id,source_record_id,target_record_id,seed_key,created_at")
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw new Error(error.message);
    if (!data) throw new Error("record_links read returned no data");
    for (const row of data as LinkRow[]) out.push(toLink(row));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

export type ArchiveSnapshot = {
  records: ArchiveRecord[];
  links: ArchiveLink[];
  byId: Map<string, ArchiveRecord>;
};

export type ArchiveLoadState = {
  recordsPending: boolean;
  linksPending: boolean;
  recordsError: Error | null;
  linksError: Error | null;
  isFetching: boolean;
  lastSuccessfulSync: number | null;
};

// User-scoped query keys. Passing a null user id yields a sentinel key that
// is never enabled, keeping the pre-signed-in state from colliding.
export function archiveKey(userId: string | null): QueryKey {
  return ["archive", userId ?? "__anonymous__"];
}
export function recordsKey(userId: string | null): QueryKey {
  return ["archive-records", userId ?? "__anonymous__"];
}
export function linksKey(userId: string | null): QueryKey {
  return ["archive-links", userId ?? "__anonymous__"];
}
export function appMetadataKey(userId: string | null): QueryKey {
  return ["app_metadata", userId ?? "__anonymous__"];
}

export function useRecords(enabled: boolean) {
  const userId = useCurrentUserId();
  return useQuery<ArchiveRecord[]>({
    queryKey: recordsKey(userId),
    enabled: enabled && userId !== null,
    staleTime: 30_000,
    queryFn: fetchAllRecords,
  });
}

export function useLinks(enabled: boolean) {
  const userId = useCurrentUserId();
  return useQuery<ArchiveLink[]>({
    queryKey: linksKey(userId),
    enabled: enabled && userId !== null,
    staleTime: 30_000,
    queryFn: fetchAllLinks,
  });
}

// Records are the render-blocking resource. Links are independently optional,
// so a transient graph failure never blanks otherwise usable archive content.
export function useArchive(enabled: boolean) {
  const recordsQuery = useRecords(enabled);
  const linksQuery = useLinks(enabled);
  const data = useMemo<ArchiveSnapshot | undefined>(() => {
    if (!recordsQuery.data) return undefined;
    const byId = new Map<string, ArchiveRecord>();
    for (const record of recordsQuery.data) byId.set(record.id, record);
    return { records: recordsQuery.data, links: linksQuery.data ?? [], byId };
  }, [linksQuery.data, recordsQuery.data]);

  const state: ArchiveLoadState = {
    recordsPending: recordsQuery.isPending,
    linksPending: linksQuery.isPending,
    recordsError: recordsQuery.error,
    linksError: linksQuery.error,
    isFetching: recordsQuery.isFetching || linksQuery.isFetching,
    lastSuccessfulSync: Math.max(recordsQuery.dataUpdatedAt, linksQuery.dataUpdatedAt) || null,
  };

  return {
    data,
    isPending: recordsQuery.isPending,
    // Full-snapshot consumers such as Backup must not treat a records-only
    // response as export-ready. Rendering consumers can still use `data` and
    // the split error fields below.
    isSuccess: recordsQuery.isSuccess && linksQuery.isSuccess,
    isError: recordsQuery.isError || linksQuery.isError,
    error: recordsQuery.error ?? linksQuery.error,
    isFetching: state.isFetching,
    recordsError: recordsQuery.error,
    linksError: linksQuery.error,
    state,
    refetch: () => Promise.all([recordsQuery.refetch(), linksQuery.refetch()]),
  };
}

export function useAppMetadata(enabled: boolean) {
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: appMetadataKey(userId),
    enabled: enabled && userId !== null,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_metadata")
        .select("user_id,schema_version,seed_lifecycle_initialized,created_at,updated_at")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as null | {
        user_id: string;
        schema_version: number;
        seed_lifecycle_initialized: boolean;
        created_at: string;
        updated_at: string;
      };
    },
  });
}

// -------- Mutations --------

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function invalidateArchive(qc: ReturnType<typeof useQueryClient>, userId: string | null) {
  qc.invalidateQueries({ queryKey: recordsKey(userId) });
  qc.invalidateQueries({ queryKey: linksKey(userId) });
  qc.invalidateQueries({ queryKey: archiveKey(userId) });
}
function invalidateArchiveAndMeta(qc: ReturnType<typeof useQueryClient>, userId: string | null) {
  invalidateArchive(qc, userId);
  qc.invalidateQueries({ queryKey: appMetadataKey(userId) });
}

export type SaveRecordInput = {
  id: string | null;
  recordType: RecordType;
  title: string;
  summary: string;
  tags: string[];
  recordData: Record<string, unknown>;
  selectedTargetIds: string[];
  documentFile?: File;
  documentFileRemoved?: boolean;
};

export function useSaveRecord() {
  const qc = useQueryClient();
  const userId = useCurrentUserId();
  return useMutation({
    mutationFn: async (input: SaveRecordInput) => {
      if (input.recordType === "document") {
        const documentData = validateDocumentData(input.recordData);
        const hasStoredDocumentFile =
          documentData.storagePath !== null || documentData.extractedContentPath !== null;
        if (input.documentFile || input.documentFileRemoved || hasStoredDocumentFile) {
          const fileError = input.documentFile
            ? validateSelectedDocumentFile(input.documentFile)
            : null;
          if (input.documentFile && fileError) throw new Error(fileError);
          const body = new FormData();
          body.append(
            "record",
            JSON.stringify({
              ...(input.id ? { id: input.id } : {}),
              recordType: "document",
              title: input.title,
              summary: input.summary,
              tags: input.tags,
              recordData: documentData,
            }),
          );
          body.append("selectedTargetIds", JSON.stringify(input.selectedTargetIds));
          body.append("removeFile", input.documentFileRemoved ? "true" : "false");
          if (input.documentFile) {
            const contentHash = await fingerprintFile(input.documentFile);
            body.append("contentHash", contentHash);
            body.append("file", input.documentFile, input.documentFile.name);
          }
          const { data, error } = await supabase.functions.invoke("document-save", {
            body,
          });
          if (error)
            throw new Error("Document files could not be saved. Existing data was not changed.");
          if (
            !data ||
            typeof data !== "object" ||
            typeof (data as { id?: unknown }).id !== "string"
          ) {
            throw new Error("Document save returned an invalid result.");
          }
          return data as { id: string; isNew: boolean };
        }
      }
      const payload: Record<string, unknown> = {
        recordType: input.recordType,
        title: input.title,
        summary: input.summary,
        tags: input.tags,
        recordData: input.recordData,
      };
      if (input.id) payload.id = input.id;
      const { data, error } = await supabase.rpc("save_record_with_links", {
        record_payload: payload,
        selected_target_ids: input.selectedTargetIds,
      });
      if (error) throw new Error(error.message);
      return data as { id: string; isNew: boolean };
    },
    onSuccess: () => invalidateArchive(qc, userId),
  });
}

export function useDeleteRecord() {
  const qc = useQueryClient();
  const userId = useCurrentUserId();
  return useMutation({
    mutationFn: async (recordId: string) => {
      const { data, error } = await supabase.rpc("delete_record_safely", {
        record_id: recordId,
      });
      if (error) throw new Error(error.message);
      return data as { removedLinkCount?: number };
    },
    onSuccess: () => invalidateArchive(qc, userId),
  });
}

export function useInitializeArchive() {
  const qc = useQueryClient();
  const userId = useCurrentUserId();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("initialize_user_archive", {
        local_date: todayLocal(),
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => invalidateArchiveAndMeta(qc, userId),
  });
}

export function useRemoveExamples() {
  const qc = useQueryClient();
  const userId = useCurrentUserId();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("remove_example_data");
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => invalidateArchive(qc, userId),
  });
}

export function useRestoreExamples() {
  const qc = useQueryClient();
  const userId = useCurrentUserId();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("restore_missing_examples", {
        local_date: todayLocal(),
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => invalidateArchive(qc, userId),
  });
}

export function useResetArchive() {
  const qc = useQueryClient();
  const userId = useCurrentUserId();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("reset_user_archive");
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => invalidateArchiveAndMeta(qc, userId),
  });
}

export function useRestoreArchive() {
  const qc = useQueryClient();
  const userId = useCurrentUserId();
  return useMutation({
    mutationFn: async (payload: ArchiveExport) => {
      const { data, error } = await supabase.rpc("restore_user_archive", {
        archive_payload: payload as unknown as Record<string, unknown>,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => invalidateArchiveAndMeta(qc, userId),
  });
}
