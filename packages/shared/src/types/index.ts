/**
 * Inferred TypeScript types from Zod schemas.
 * Import these instead of manually defining interfaces.
 */

import { type z } from 'zod';
import {
  type UserSchema,
  type ConversationSchema,
  type ServerSchema,
  type ChannelSchema,
  type MessageSchema,
  type AttachmentSchema,
  type ReactionSchema,
  type MemberSchema,
  type RoleSchema,
  type ReadReceiptSchema,
  type CursorPaginationSchema,
  type ProblemDetailSchema,
} from '../schemas/index.js';

// ── Entity Types ────────────────────────────────────────────

export type User = z.infer<typeof UserSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
export type Server = z.infer<typeof ServerSchema>;
export type Channel = z.infer<typeof ChannelSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type Reaction = z.infer<typeof ReactionSchema>;
export type Member = z.infer<typeof MemberSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type ReadReceipt = z.infer<typeof ReadReceiptSchema>;

// ── Request / Response Types ────────────────────────────────

export type CursorPagination = z.infer<typeof CursorPaginationSchema>;
export type ProblemDetail = z.infer<typeof ProblemDetailSchema>;

export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ── Health check response ───────────────────────────────────

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  version: string;
}

export interface ReadyResponse extends HealthResponse {
  checks: {
    database: 'ok' | 'error';
    redis: 'ok' | 'error';
  };
}
