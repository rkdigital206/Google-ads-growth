/**
 * Typed error hierarchy so tool handlers can distinguish "expected, tell the
 * model/user what happened" errors from genuine bugs, and so the MCP layer
 * can decide what's safe to surface versus what to log-and-mask.
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpLikeStatus = 500,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Input failed validation before we even attempted a Google Ads call. */
export class ValidationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, "VALIDATION_ERROR", 400, cause);
  }
}

/** Google Ads API itself rejected the request (auth, quota, GAQL error, policy violation, etc.) */
export class GoogleAdsApiError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, "GOOGLE_ADS_API_ERROR", 502, cause);
  }
}

/** A mutation was blocked by the safety layer because it requires human approval. */
export class ApprovalRequiredError extends AppError {
  constructor(
    message: string,
    public readonly approvalRequestId: string
  ) {
    super(message, "APPROVAL_REQUIRED", 202);
  }
}

/** A mutation was blocked outright — it violates a hard safety rule and cannot proceed even with approval bypass. */
export class SafetyViolationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, "SAFETY_VIOLATION", 403, cause);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, "NOT_FOUND", 404);
  }
}

/** Convert any thrown value into a safe, user-facing message for MCP tool results. */
export function toToolErrorMessage(err: unknown): string {
  if (err instanceof AppError) {
    return `[${err.code}] ${err.message}`;
  }
  if (err instanceof Error) {
    return `[UNEXPECTED_ERROR] ${err.message}`;
  }
  return `[UNEXPECTED_ERROR] ${String(err)}`;
}
