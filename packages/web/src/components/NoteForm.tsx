import { useId, useState, type FormEvent } from "react";
import type { Annotation } from "@devgym/shared";
import { api, ApiError } from "../api/client";

/** "Add a note / I disagree" on one claim of the growth plan. */
export function NoteForm({ targetId, onSaved }: { targetId: string; onSaved: (note: Annotation) => void }) {
  const id = useId();
  const [note, setNote] = useState("");
  const [disagrees, setDisagrees] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "saved" | "error"; text: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!note.trim()) {
      setMessage({ kind: "error", text: "Write a note first." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const saved = await api.addAnnotation({ target_id: targetId, note, disagrees });
      onSaved(saved);
      setNote("");
      setDisagrees(false);
      setMessage({ kind: "saved", text: "Note saved." });
    } catch (error) {
      setMessage({
        kind: "error",
        text: `The note was not saved. ${error instanceof ApiError ? error.message : "Try again."}`,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="note-form" onSubmit={submit}>
      <label htmlFor={`${id}-note`}>Add a note</label>
      <textarea
        id={`${id}-note`}
        rows={3}
        maxLength={1000}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="What is missing, or what you see differently"
      />
      <div className="note-form__row">
        <label className="note-form__disagree">
          <input type="checkbox" checked={disagrees} onChange={(event) => setDisagrees(event.target.checked)} />
          I disagree with this claim
        </label>
        <button type="submit" className="button" disabled={saving}>
          {saving ? "Saving" : "Save note"}
        </button>
      </div>
      <p className={`note-form__message note-form__message--${message?.kind ?? "none"}`} role="status">
        {message?.text}
      </p>
    </form>
  );
}
