/**
 * Application-wide constants.
 * Keep this file lean — only values used by multiple packages belong here.
 */

/** Brand name — always spelled with two a's at the end. */
export const BRAND_NAME = 'Holoraa' as const;

/** API version prefix used in all REST routes. */
export const API_VERSION = 'v1' as const;

/** Default pagination page size. */
export const DEFAULT_PAGE_SIZE = 25 as const;

/** Maximum pagination page size. */
export const MAX_PAGE_SIZE = 100 as const;

/** Supported conversation types. */
export const CONVERSATION_TYPES = ['dm', 'group', 'channel'] as const;

/** Supported channel types within a server. */
export const CHANNEL_TYPES = ['text', 'voice', 'announcement'] as const;

/** Supported message types. */
export const MESSAGE_TYPES = ['text', 'system', 'call'] as const;

/** Supported attachment types. */
export const ATTACHMENT_TYPES = ['image', 'video', 'audio', 'file'] as const;

/** Supported member roles in a server. */
export const DEFAULT_ROLES = ['owner', 'admin', 'moderator', 'member'] as const;

/** Maximum lengths for user-generated text. */
export const LIMITS = {
  USERNAME_MIN: 3,
  USERNAME_MAX: 32,
  DISPLAY_NAME_MAX: 64,
  BIO_MAX: 500,
  MESSAGE_MAX: 4000,
  SERVER_NAME_MAX: 100,
  CHANNEL_NAME_MAX: 100,
  GROUP_NAME_MAX: 100,
  GROUP_MAX_MEMBERS: 1024,
  REACTION_MAX_PER_MESSAGE: 20,
} as const;
