// Deterministic paginated archive reader + React Query hooks.
// All reads go through RLS via the publishable-key client. All writes go
// through the approved RPC functions.

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { supabase } from "./supabase";
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

function toRecord(row: RecordRow): ArchiveRecord {
  const base: BaseArchiveRecord = {
    id: row.id,
    recordType: row.record_type,
    title: row.title,
    summary: row.summary ?? "",
    tags: row.tags ?? [],
    isExample: row.is_example,
    seedKey: row.seed_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  switch (row.record_type) {
    case "tool":
      return { ...base, recordType: "tool", recordData: row.record_data as unknown as ToolData };
    case "repository":
      return { ...base, recordType: "repository", recordData: row.record_data as unknown as RepositoryData };
    case "conversation":
      return { ...base, recordType: "conversation", recordData: row.record_data as unknown as ConversationData };
    case "decision":
      return { ...base, recordType: "decision", recordData: row.record_data as unknown as DecisionData };
  }
}

function toLink(row: LinkRow): ArchiveLink {
  return {
    id: row.id,
    sourceId: row.source_record_id,
    targetId: row.target_record_id,
    seedKey: row.seed_key,
    createdAt: row.created_at,
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
      .select(
        "id,user_id,source_record_id,target_record_id,seed_key,created_at",
      )
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

export function useArchive(enabled: boolean) {
  return useQuery<ArchiveSnapshot>({
    queryKey: ["archive"],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const [records, links] = await Promise.all([
        fetchAllRecords(),
        fetchAllLinks(),
      ]);
      const byId = new Map<string, ArchiveRecord>();
      for (const r of records) byId.set(r.id, r);
      return { records, links, byId };
    },
  });
}

export function useAppMetadata(enabled: boolean) {
  return useQuery({
    queryKey: ["app_metadata"],
    enabled,
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

export type SaveRecordInput = {
  id: string | null;
  recordType: RecordType;
  title: string;
  summary: string;
  tags: string[];
  recordData: Record<string, unknown>;
  selectedTargetIds: string[];
};

export function useSaveRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveRecordInput) => {
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["archive"] }),
  });
}

export function useDeleteRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (recordId: string) => {
      const { data, error } = await supabase.rpc("delete_record_safely", {
        record_id: recordId,
      });
      if (error) throw new Error(error.message);
      return data as { removedLinkCount?: number };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["archive"] }),
  });
}

export function useInitializeArchive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("initialize_user_archive", {
        local_date: todayLocal(),
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["archive"] });
      qc.invalidateQueries({ queryKey: ["app_metadata"] });
    },
  });
}

export function useRemoveExamples() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("remove_example_data");
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["archive"] }),
  });
}

export function useRestoreExamples() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("restore_missing_examples", {
        local_date: todayLocal(),
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["archive"] }),
  });
}

export function useResetArchive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("reset_user_archive");
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["archive"] });
      qc.invalidateQueries({ queryKey: ["app_metadata"] });
    },
  });
}

export function useRestoreArchive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ArchiveExport) => {
      const { data, error } = await supabase.rpc("restore_user_archive", {
        archive_payload: payload as unknown as Record<string, unknown>,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["archive"] });
      qc.invalidateQueries({ queryKey: ["app_metadata"] });
    },
  });
}
