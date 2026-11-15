export class HttpError extends Error {
  constructor(
    readonly status: 400 | 402 | 403 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
