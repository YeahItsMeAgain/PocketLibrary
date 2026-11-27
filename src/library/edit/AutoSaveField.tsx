import { useCallback, useEffect, useRef, useState } from "react";

import { errorMessage } from "./errors";

type FieldStatus = "idle" | "saving" | "saved" | "error";

export interface AutoSaveFieldProps {
  id: string;
  name: string;
  label: string;
  initial: string;
  multiline?: boolean;
  inputMode?: "text" | "numeric";
  maxLength?: number;
  hint?: string;
  save: (raw: string) => Promise<void>;
  validate?: (raw: string) => string | null;
}

/**
 * A single autosaving field. Text waits 600 ms after the last keystroke and
 * flushes immediately on blur. A failed save keeps the typed value on screen
 * and shows the error inline; the next edit retries.
 */
export function AutoSaveField({
  id,
  name,
  label,
  initial,
  multiline = false,
  inputMode,
  maxLength,
  hint,
  save,
  validate,
}: AutoSaveFieldProps) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<FieldStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const savedRef = useRef(initial);
  const timerRef = useRef(0);
  const saveRef = useRef(save);
  saveRef.current = save;
  const validateRef = useRef(validate);
  validateRef.current = validate;

  const commit = useCallback(async (raw: string) => {
    if (raw === savedRef.current) return;
    const invalid = validateRef.current?.(raw) ?? null;
    if (invalid) {
      setStatus("error");
      setError(invalid);
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      await saveRef.current(raw);
      savedRef.current = raw;
      setStatus("saved");
    } catch (nextError) {
      setStatus("error");
      setError(
        errorMessage(nextError, "That change could not be saved. Try again."),
      );
    }
  }, []);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const change = (next: string) => {
    setValue(next);
    setStatus("idle");
    setError(null);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void commit(next);
    }, 600);
  };

  const blur = () => {
    window.clearTimeout(timerRef.current);
    void commit(value);
  };

  const statusText =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "✓ Saved"
        : status === "error"
          ? "Not saved"
          : "";

  return (
    <div className="edit-field" data-field={name}>
      <div className="edit-field-head">
        <label htmlFor={id}>{label}</label>
        <span
          className="edit-save-state"
          data-status={status}
          data-testid={`edit-${name}-status`}
          role="status"
          aria-live="polite"
        >
          {statusText}
        </span>
      </div>
      {multiline ? (
        <textarea
          id={id}
          data-testid={`edit-${name}`}
          value={value}
          rows={5}
          maxLength={maxLength}
          aria-invalid={status === "error"}
          aria-describedby={
            error ? `edit-${name}-error` : hint ? `edit-${name}-hint` : undefined
          }
          onChange={(event) => change(event.target.value)}
          onBlur={blur}
        />
      ) : (
        <input
          id={id}
          data-testid={`edit-${name}`}
          type="text"
          inputMode={inputMode}
          maxLength={maxLength}
          value={value}
          aria-invalid={status === "error"}
          aria-describedby={
            error ? `edit-${name}-error` : hint ? `edit-${name}-hint` : undefined
          }
          onChange={(event) => change(event.target.value)}
          onBlur={blur}
        />
      )}
      {hint && !error ? (
        <p className="edit-field-hint" id={`edit-${name}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          className="edit-field-error"
          id={`edit-${name}-error`}
          data-testid={`edit-${name}-error`}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
