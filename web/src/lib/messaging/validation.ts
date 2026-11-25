/**
 * Input validation for messaging operations.
 * Validates shapes on the client and BFF before hitting the backend.
 * The Go API performs authoritative checks on all fields.
 */

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROHIBITED_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Validates that a string is a standard UUID format. */
export function validateUuid(val: string, fieldName = "ID"): string | null {
  const trimmed = val.trim();
  if (!trimmed || !UUID_SHAPE.test(trimmed)) {
    return `Invalid ${fieldName}: must be a valid UUID.`;
  }
  return null;
}

/**
 * Validates message text.
 * Must be 1 to 4,000 characters (trimmed) without prohibited control codes.
 */
export function validateMessageContent(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length < 1) {
    return "Message cannot be empty.";
  }
  if (trimmed.length > 4000) {
    return "Message must be 4,000 characters or fewer.";
  }
  if (PROHIBITED_CONTROL.test(trimmed)) {
    return "Message contains invalid control characters.";
  }
  return null;
}

/**
 * Validates pagination limit if provided.
 * Must be an integer between 1 and 100.
 */
export function validatePaginationLimit(limit?: number): string | null {
  if (limit === undefined) {
    return null;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return "Limit must be an integer between 1 and 100.";
  }
  return null;
}
