import {
  authenticatedSupabase,
  allowedOrigin,
  jsonResponse,
  responseHeaders,
  type AuthenticatedSupabase,
} from "../_shared/http.ts";
import {
  declaredLengthTooLarge,
  displayFileName,
  DOCUMENT_MAX_NORMALIZED_BYTES,
  DOCUMENT_MAX_REQUEST_BYTES,
  normalizeDocumentFile,
  pathIsOwnerScoped,
  readBoundedBody,
  validateDocumentRecordData,
  validateNormalizedDocument,
  isHash,
  isUuid,
  type DocumentRecordData,
  type DocumentRecordPayload,
  type NormalizedDocument,
} from "../_shared/document.ts";

const BUCKET = "document-files";

function originFor(request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (origin && !allowedOrigin(origin)) return "__denied__";
  return origin ? allowedOrigin(origin) : null;
}

function parseJson(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function validTags(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 12 &&
    value.every(
      (tag) => typeof tag === "string" && tag.trim() === tag && tag.length > 0 && tag.length <= 48,
    ) &&
    new Set(value.map((tag) => tag.toLowerCase())).size === value.length
  );
}

function uploadRecordDataHasValidShape(value: unknown): value is DocumentRecordData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return validateDocumentRecordData({
    ...data,
    // These fields are authoritative only after the server normalizes the
    // selected file. Validate their shape as nullable placeholders here.
    originalFileName: null,
    mimeType: null,
    fileSizeBytes: null,
    pageCount: null,
    storagePath: null,
    extractedContentPath: null,
    contentHash: null,
  });
}

function parsePayload(value: unknown, hasFile: boolean): DocumentRecordPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => !["id", "recordType", "title", "summary", "tags", "recordData"].includes(key),
    )
  )
    return null;
  if (record.id !== undefined && !isUuid(record.id)) return null;
  if (
    record.recordType !== "document" ||
    typeof record.title !== "string" ||
    record.title.trim() === "" ||
    record.title.length > 240 ||
    typeof record.summary !== "string" ||
    record.summary.length > 2_000 ||
    !validTags(record.tags) ||
    (hasFile
      ? !uploadRecordDataHasValidShape(record.recordData)
      : !validateDocumentRecordData(record.recordData))
  )
    return null;
  return {
    ...(record.id ? { id: record.id } : {}),
    recordType: "document",
    title: record.title.trim(),
    summary: record.summary,
    tags: record.tags,
    recordData: record.recordData as DocumentRecordData,
  };
}

function parseTargetIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 75) return null;
  const ids = [...new Set(value)];
  return ids.every((id) => isUuid(id)) ? (ids as string[]) : null;
}

function generatedPaths(userId: string, recordId: string, operationId: string, fileName: string) {
  const safeName = displayFileName(fileName);
  return {
    original: `${userId}/documents/${recordId}/original/${operationId}-${safeName}`,
    extracted: `${userId}/documents/${recordId}/extracted/${operationId}-normalized.json`,
  };
}

function validGeneratedPath(path: string, userId: string, recordId: string): boolean {
  return (
    pathIsOwnerScoped(path, userId) &&
    path.startsWith(`${userId}/documents/${recordId}/`) &&
    path.split("/").length === 5
  );
}

function referencesMatchNormalized(data: DocumentRecordData, knownIds: Set<string>): boolean {
  if (!data.sourceReferences.every((reference) => knownIds.has(reference.id))) return false;
  return [data.highSignalFindings, data.keyClaims, data.contradictions, data.uncertainties]
    .flat()
    .every((insight) => insight.sourceReferenceIds.every((id) => knownIds.has(id)));
}

async function removeObjects(auth: AuthenticatedSupabase, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await auth.client.storage.from(BUCKET).remove(paths);
  if (error) {
    // Keep the internal report limited to owner-scoped object paths. Never
    // expose the upstream error payload or any file contents to the caller.
    console.error("Document Storage cleanup failed.", { paths });
  }
}

async function loadStoredNormalized(
  auth: AuthenticatedSupabase,
  path: string,
  expectedHash: string,
): Promise<NormalizedDocument | null> {
  const download = await auth.client.storage.from(BUCKET).download(path);
  if (download.error || download.data.size > DOCUMENT_MAX_NORMALIZED_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(await download.data.text());
  } catch {
    return null;
  }
  return validateNormalizedDocument(value) && value.contentHash === expectedHash ? value : null;
}

Deno.serve(async (request) => {
  const origin = originFor(request);
  if (origin === "__denied__") return jsonResponse({ error: "Origin is not allowed." }, 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders(origin) });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405, origin);
  if (declaredLengthTooLarge(request.headers.get("content-length"), DOCUMENT_MAX_REQUEST_BYTES))
    return jsonResponse({ error: "Request is too large." }, 413, origin);

  const auth = await authenticatedSupabase(request);
  if (!auth) return jsonResponse({ error: "Sign in is required." }, 401, origin);
  const createdPaths: string[] = [];
  try {
    const bytes = await readBoundedBody(request, DOCUMENT_MAX_REQUEST_BYTES);
    const replay = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: bytes,
    });
    const form = await replay.formData();
    const fileValue = form.get("file");
    const file = fileValue instanceof File ? fileValue : null;
    const payload = parsePayload(parseJson(form.get("record")), file !== null);
    const targetIds = parseTargetIds(parseJson(form.get("selectedTargetIds")));
    const removeFile = form.get("removeFile") === "true";
    if (!payload || !targetIds || (!file && !removeFile && payload.recordData.storagePath === null))
      return jsonResponse({ error: "Document save input is invalid." }, 400, origin);

    const recordId = payload.id?.toLowerCase() ?? crypto.randomUUID();
    let existingData: DocumentRecordData | null = null;
    if (payload.id) {
      const { data, error } = await auth.client
        .from("records")
        .select("id,record_type,record_data")
        .eq("id", recordId)
        .maybeSingle();
      if (error)
        return jsonResponse({ error: "The existing document could not be verified." }, 403, origin);
      if (data) {
        if (data.record_type !== "document" || !validateDocumentRecordData(data.record_data))
          return jsonResponse({ error: "The existing document is invalid." }, 409, origin);
        existingData = data.record_data;
      }
    }

    const previousPaths = existingData
      ? [existingData.storagePath, existingData.extractedContentPath].filter(
          (path): path is string =>
            typeof path === "string" && validGeneratedPath(path, auth.user.id, recordId),
        )
      : [];
    let nextData: DocumentRecordData = { ...payload.recordData };
    let newPaths: { original: string; extracted: string } | null = null;

    if (file) {
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const expectedHashValue = form.get("contentHash");
      if (
        expectedHashValue !== null &&
        (typeof expectedHashValue !== "string" || !isHash(expectedHashValue))
      ) {
        return jsonResponse({ error: "The file fingerprint is invalid." }, 400, origin);
      }
      const expectedHash = typeof expectedHashValue === "string" ? expectedHashValue : undefined;
      const normalized = await normalizeDocumentFile(fileBytes, file.name, file.type, expectedHash);
      if (
        !referencesMatchNormalized(
          payload.recordData,
          new Set(normalized.units.map((unit) => unit.id)),
        )
      ) {
        return jsonResponse(
          { error: "Document source references do not match the selected file." },
          400,
          origin,
        );
      }
      const sameExistingFile =
        existingData?.contentHash === normalized.contentHash &&
        typeof existingData.storagePath === "string" &&
        typeof existingData.extractedContentPath === "string" &&
        validGeneratedPath(existingData.storagePath, auth.user.id, recordId) &&
        validGeneratedPath(existingData.extractedContentPath, auth.user.id, recordId);
      const existingNormalized = sameExistingFile
        ? await loadStoredNormalized(
            auth,
            existingData.extractedContentPath,
            normalized.contentHash,
          )
        : null;
      if (sameExistingFile && existingNormalized) {
        nextData = {
          ...nextData,
          ...existingData,
          highSignalFindings: payload.recordData.highSignalFindings,
          keyClaims: payload.recordData.keyClaims,
          contradictions: payload.recordData.contradictions,
          uncertainties: payload.recordData.uncertainties,
          sourceReferences: payload.recordData.sourceReferences,
          documentDate: payload.recordData.documentDate,
          pageCount: existingNormalized.pageCount,
          projectRoute: payload.recordData.projectRoute,
        };
      } else {
        newPaths = generatedPaths(auth.user.id, recordId, crypto.randomUUID(), file.name);
        const canonicalMime =
          normalized.kind === "pdf"
            ? "application/pdf"
            : normalized.kind === "markdown"
              ? "text/markdown"
              : "text/plain";
        const originalUpload = await auth.client.storage
          .from(BUCKET)
          .upload(newPaths.original, fileBytes, { contentType: canonicalMime, upsert: false });
        if (originalUpload.error)
          return jsonResponse(
            { error: "The original file could not be stored. No archive record was created." },
            502,
            origin,
          );
        createdPaths.push(newPaths.original);
        const normalizedBytes = new TextEncoder().encode(JSON.stringify(normalized));
        const extractedUpload = await auth.client.storage
          .from(BUCKET)
          .upload(newPaths.extracted, normalizedBytes, {
            contentType: "application/json",
            metadata: {
              document_version: "1",
              document_content_hash: normalized.contentHash,
              document_source_reference_ids: JSON.stringify(
                normalized.units.map((unit) => unit.id),
              ),
            },
            upsert: false,
          });
        if (extractedUpload.error) {
          await removeObjects(auth, createdPaths);
          createdPaths.length = 0;
          return jsonResponse(
            {
              error:
                "The extracted representation could not be stored. No archive record was created.",
            },
            502,
            origin,
          );
        }
        createdPaths.push(newPaths.extracted);
        nextData = {
          ...payload.recordData,
          originalFileName: displayFileName(file.name),
          mimeType: canonicalMime,
          fileSizeBytes: fileBytes.byteLength,
          pageCount: normalized.pageCount,
          storagePath: newPaths.original,
          extractedContentPath: newPaths.extracted,
          contentHash: normalized.contentHash,
        };
      }
    } else if (removeFile) {
      nextData = {
        ...payload.recordData,
        originalFileName: null,
        mimeType: null,
        fileSizeBytes: null,
        pageCount: null,
        storagePath: null,
        extractedContentPath: null,
        contentHash: null,
      };
    } else {
      if (
        !existingData ||
        existingData.storagePath === null ||
        existingData.extractedContentPath === null ||
        existingData.contentHash === null ||
        !validGeneratedPath(existingData.storagePath, auth.user.id, recordId) ||
        !validGeneratedPath(existingData.extractedContentPath, auth.user.id, recordId) ||
        payload.recordData.storagePath !== existingData.storagePath ||
        payload.recordData.extractedContentPath !== existingData.extractedContentPath ||
        payload.recordData.contentHash !== existingData.contentHash
      ) {
        return jsonResponse(
          { error: "The existing document file could not be verified." },
          409,
          origin,
        );
      }
      const normalizedValue = await loadStoredNormalized(
        auth,
        existingData.extractedContentPath,
        existingData.contentHash,
      );
      if (
        !normalizedValue ||
        !referencesMatchNormalized(
          payload.recordData,
          new Set(normalizedValue.units.map((unit) => unit.id)),
        )
      ) {
        return jsonResponse(
          { error: "The existing document provenance could not be verified." },
          409,
          origin,
        );
      }
      nextData = {
        ...payload.recordData,
        originalFileName: existingData.originalFileName,
        mimeType: existingData.mimeType,
        fileSizeBytes: existingData.fileSizeBytes,
        pageCount: normalizedValue.pageCount,
        storagePath: existingData.storagePath,
        extractedContentPath: existingData.extractedContentPath,
        contentHash: normalizedValue.contentHash,
      };
    }
    if (!validateDocumentRecordData(nextData))
      return jsonResponse({ error: "Document data is malformed." }, 400, origin);
    if (nextData.storagePath && !validGeneratedPath(nextData.storagePath, auth.user.id, recordId))
      return jsonResponse({ error: "Document storage path is invalid." }, 400, origin);
    if (
      nextData.extractedContentPath &&
      !validGeneratedPath(nextData.extractedContentPath, auth.user.id, recordId)
    )
      return jsonResponse({ error: "Document extracted path is invalid." }, 400, origin);

    const { data: saveResult, error: saveError } = await auth.client.rpc("save_record_with_links", {
      record_payload: {
        id: recordId,
        recordType: "document",
        title: payload.title,
        summary: payload.summary,
        tags: payload.tags,
        recordData: nextData,
      },
      selected_target_ids: targetIds,
    });
    if (saveError || !saveResult || typeof saveResult !== "object") {
      await removeObjects(auth, createdPaths);
      return jsonResponse(
        {
          error:
            "The archive record could not be saved. Newly uploaded files were discarded where possible.",
        },
        502,
        origin,
      );
    }
    const result = saveResult as { id?: unknown; isNew?: unknown };
    if (typeof result.id !== "string") {
      await removeObjects(auth, createdPaths);
      return jsonResponse({ error: "The archive save returned an invalid result." }, 502, origin);
    }
    const pathsToRemove = previousPaths.filter(
      (path) => ![nextData.storagePath, nextData.extractedContentPath].includes(path),
    );
    await removeObjects(auth, pathsToRemove);
    return jsonResponse({ id: result.id, isNew: result.isNew === true }, 200, origin);
  } catch (error) {
    await removeObjects(auth, createdPaths);
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
    ) {
      const input = error as { message?: unknown; status: number };
      return jsonResponse(
        { error: typeof input.message === "string" ? input.message : "Document input is invalid." },
        input.status,
        origin,
      );
    }
    return jsonResponse(
      { error: "Document files could not be saved. Existing data was not changed." },
      502,
      origin,
    );
  }
});
