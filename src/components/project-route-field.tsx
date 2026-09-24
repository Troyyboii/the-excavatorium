import { useId, useMemo } from "react";
import { Field, TextInput } from "./form-parts";
import { useArchive } from "@/lib/archive";
import { ownerProjectRoutes, PROJECT_ROUTE_MAX_LENGTH } from "@/lib/project-route";

/**
 * Optional, owner-defined project route. Suggestions are only routes the
 * signed-in owner has already used (the archive query is owner-scoped); a new
 * owner sees none. Blank input is stored as null (normalized at save).
 */
export function ProjectRouteField({
  label = "Project route",
  value,
  onChange,
}: {
  label?: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const listId = useId();
  const inputId = useId();
  const archive = useArchive(true);
  const suggestions = useMemo(
    () => ownerProjectRoutes(archive.data?.records ?? []),
    [archive.data?.records],
  );
  return (
    <Field
      label={label}
      htmlFor={inputId}
      hint="Optional. A project, workspace, or route of your own."
    >
      <TextInput
        id={inputId}
        value={value ?? ""}
        maxLength={PROJECT_ROUTE_MAX_LENGTH}
        placeholder="Optional project, workspace, or route"
        list={suggestions.length ? listId : undefined}
        // Keep what was typed (including inner spaces); trimming happens at save.
        onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
      />
      {suggestions.length ? (
        <datalist id={listId}>
          {suggestions.map((route) => (
            <option key={route} value={route} />
          ))}
        </datalist>
      ) : null}
    </Field>
  );
}
