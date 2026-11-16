/** An error the caller can fix. Its message is safe to show to the model. */
export class StoreError extends Error {}

/** A write the privacy guard refused. The message says which field and which rule, never the blocked text. */
export class PrivacyError extends StoreError {
  constructor(
    readonly field: string,
    readonly rule: string,
    advice: string,
  ) {
    super(`Rejected by the privacy guard: field '${field}' ${advice} (rule: ${rule}). Nothing was saved.`);
  }
}
