import { useState, type FormEvent } from "react";
import {
  removeProviderKey,
  saveProviderKey,
  setModelPreference,
  useInvalidateProviderSettings,
  useModelPreference,
  useProviderKeyStatus,
} from "@/lib/provider-key";
import {
  isOpenAiModelId,
  MODEL_TONE_LABEL,
  OPENAI_MODELS,
  openAiModelTier,
} from "@/lib/openai-models";

// Functional controls for bring-your-own OpenAI key and Custodian model choice.
// The archive itself never needs a key; only provider-backed Custodian work does.
export function ProviderSection({
  setToast,
  setError,
}: {
  setToast: (m: string) => void;
  setError: (m: string | null) => void;
}) {
  const status = useProviderKeyStatus();
  const model = useModelPreference();
  const invalidate = useInvalidateProviderSettings();

  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [savingModel, setSavingModel] = useState(false);

  const configured = status.data?.configured === true;
  const last4 = status.data?.configured ? status.data.last4 : null;

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const value = draft.trim();
    if (value.length === 0) return;
    setSaving(true);
    try {
      await saveProviderKey(value);
      setToast(configured ? "API key replaced" : "API key saved");
      invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The key could not be saved.");
    } finally {
      // The key never outlives this handler in component state.
      setDraft("");
      setSaving(false);
    }
  }

  async function onRemove() {
    setError(null);
    setRemoving(true);
    try {
      await removeProviderKey();
      setToast("API key removed");
      setConfirmRemove(false);
      invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The key could not be removed.");
    } finally {
      setRemoving(false);
    }
  }

  async function onModelChange(value: string) {
    if (!isOpenAiModelId(value)) return;
    setError(null);
    setSavingModel(true);
    try {
      await setModelPreference(value);
      setToast("Model choice saved");
      invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The model choice could not be saved.");
    } finally {
      setSavingModel(false);
    }
  }

  const selected = model.data ?? "";
  const selectedTier = selected ? openAiModelTier(selected) : null;

  return (
    <section className="rounded-lg border border-border bg-card p-4 md:p-6">
      <h2 className="mb-3 font-serif text-lg text-foreground">Custodian provider (OpenAI)</h2>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          The archive is free to use without a key. Provider-backed Custodian work runs on your own
          OpenAI API key. The key is encrypted on the server the moment you save it, is used only
          for work you authorize, and can never be shown again. Saving a key does not contact
          OpenAI.
        </p>

        <div className="text-sm" role="status">
          {status.isLoading ? (
            <span className="text-muted-foreground">Checking key status…</span>
          ) : status.isError ? (
            <span className="text-destructive">Key status could not be loaded.</span>
          ) : configured ? (
            <span className="text-foreground">
              Key configured <span className="font-mono text-muted-foreground">sk-…{last4}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">
              No key configured. Provider-backed Custodian work is unavailable.
            </span>
          )}
        </div>

        <form onSubmit={onSave} className="space-y-3" autoComplete="off">
          <div>
            <label htmlFor="openai-key" className="block text-sm text-foreground">
              {configured ? "Replace OpenAI API key" : "OpenAI API key"}
            </label>
            <input
              id="openai-key"
              name="openai-secret"
              type="password"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="mt-2 w-full min-h-11 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-ring"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving || draft.trim().length === 0}
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {saving ? "Saving…" : configured ? "Replace key" : "Save key"}
            </button>
            {configured && !confirmRemove ? (
              <button
                type="button"
                onClick={() => setConfirmRemove(true)}
                className="inline-flex min-h-11 items-center rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-[color:var(--record-hover)]"
              >
                Remove key
              </button>
            ) : null}
          </div>
        </form>

        {configured && confirmRemove ? (
          <div className="rounded-md border border-destructive/55 p-3 text-sm">
            <p className="text-foreground">
              Remove the stored key? Provider-backed Custodian work stops until you add a key again.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void onRemove()}
                disabled={removing}
                className="inline-flex min-h-11 items-center rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-60"
              >
                {removing ? "Removing…" : "Remove key"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                className="inline-flex min-h-11 items-center rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div>
          <label htmlFor="openai-model" className="block text-sm text-foreground">
            Custodian model
          </label>
          <select
            id="openai-model"
            value={selected}
            disabled={savingModel || model.isLoading}
            onChange={(e) => void onModelChange(e.target.value)}
            className="mt-2 w-full min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
          >
            <option value="" disabled>
              Choose a model
            </option>
            {OPENAI_MODELS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.id} — {MODEL_TONE_LABEL[entry.tone]}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-muted-foreground">
            {selectedTier
              ? `Policy tier for this model: ${selectedTier}. A run's tier must match it. `
              : "No model chosen yet; provider-backed work will not start without one. "}
            Choosing a model does not confirm your OpenAI project can use it. If OpenAI refuses the
            request, the run stops and no other model is substituted.
          </p>
        </div>
      </div>
    </section>
  );
}
