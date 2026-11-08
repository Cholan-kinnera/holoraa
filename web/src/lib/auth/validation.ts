/**
 * Input checks for forms. These only give quick feedback before a request is
 * sent. The API validates every field again and is the authority; nothing here
 * replaces that.
 */

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE = /^[0-9]{6}$/;
const USERNAME = /^[A-Za-z][A-Za-z0-9_]{2,31}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export function validateEmail(raw: string): string | null {
  const email = raw.trim();
  if (email.length < 3 || email.length > 254 || !EMAIL_SHAPE.test(email)) {
    return "Enter an email address, such as name@example.com.";
  }
  return null;
}

export function validateCode(raw: string): string | null {
  return CODE.test(raw.trim()) ? null : "Enter the six-digit code from the email.";
}

export function validateUsername(raw: string): string | null {
  return USERNAME.test(raw.trim())
    ? null
    : "Use 3 to 32 characters: a letter first, then letters, digits, or underscores.";
}

export function validateDisplayName(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 1 || name.length > 50 || CONTROL_CHARACTER.test(name)) {
    return "Enter a display name of up to 50 characters.";
  }
  return null;
}

export function validateBio(raw: string): string | null {
  const bio = raw.trim();
  if (bio.length > 160 || CONTROL_CHARACTER.test(bio)) {
    return "Keep the bio to 160 characters or fewer.";
  }
  return null;
}

/** An empty value is allowed and means "no avatar". Otherwise only https URLs without credentials. */
export function validateAvatarUrl(raw: string): string | null {
  const value = raw.trim();
  if (value === "") {
    return null;
  }
  if (value.length > 2048) {
    return "The avatar link is too long.";
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
      return "Use an https link without a username or password.";
    }
  } catch {
    return "Enter a valid https link.";
  }
  return null;
}
