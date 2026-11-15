/** Errors the MCP tools report back to Claude as a readable message. */
export class FtcError extends Error {
  constructor(
    readonly code: "not_found" | "invalid_reference" | "privacy_rejected" | "invalid_ticket",
    message: string,
  ) {
    super(message);
    this.name = "FtcError";
  }
}

export class NotFoundError extends FtcError {
  constructor(message: string) {
    super("not_found", message);
    this.name = "NotFoundError";
  }
}

export class InvalidReferenceError extends FtcError {
  constructor(message: string) {
    super("invalid_reference", message);
    this.name = "InvalidReferenceError";
  }
}

export class PrivacyRejection extends FtcError {
  constructor(
    readonly rule: string,
    readonly field: string,
    reason: string,
  ) {
    super("privacy_rejected", `Rejected by the privacy guard (${rule}, field "${field}"): ${reason}`);
    this.name = "PrivacyRejection";
  }
}
