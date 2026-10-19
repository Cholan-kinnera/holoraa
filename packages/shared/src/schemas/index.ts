/**
 * Zod schemas for core domain entities.
 * These schemas are the single source of truth for data validation
 * used by both the API and the web client.
 */

import { z } from 'zod';
import {
  LIMITS,
  CONVERSATION_TYPES,
  CHANNEL_TYPES,
  MESSAGE_TYPES,
  ATTACHMENT_TYPES,
} from '../constants.js';

// ── Primitives ──────────────────────────────────────────────

export const IdSchema = z.string().uuid();
export const TimestampSchema = z.coerce.date();

// ── User & Profile ──────────────────────────────────────────

export const UserSchema = z.object({
  id: IdSchema,
  email: z.string().email(),
  username: z
    .string()
    .min(LIMITS.USERNAME_MIN)
    .max(LIMITS.USERNAME_MAX)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Username may only contain letters, numbers, underscores, dots and hyphens'),
  displayName: z.string().max(LIMITS.DISPLAY_NAME_MAX).optional(),
  avatarUrl: z.string().url().optional(),
  bio: z.string().max(LIMITS.BIO_MAX).optional(),
  isOnline: z.boolean().default(false),
  lastSeenAt: TimestampSchema.optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

// ── Conversation ────────────────────────────────────────────

export const ConversationSchema = z.object({
  id: IdSchema,
  type: z.enum(CONVERSATION_TYPES),
  name: z.string().max(LIMITS.GROUP_NAME_MAX).optional(),
  avatarUrl: z.string().url().optional(),
  createdBy: IdSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

// ── Server (community) ─────────────────────────────────────

export const ServerSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(LIMITS.SERVER_NAME_MAX),
  description: z.string().max(LIMITS.BIO_MAX).optional(),
  iconUrl: z.string().url().optional(),
  bannerUrl: z.string().url().optional(),
  ownerId: IdSchema,
  isPublic: z.boolean().default(false),
  inviteCode: z.string().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

// ── Channel ─────────────────────────────────────────────────

export const ChannelSchema = z.object({
  id: IdSchema,
  serverId: IdSchema,
  name: z.string().min(1).max(LIMITS.CHANNEL_NAME_MAX),
  type: z.enum(CHANNEL_TYPES),
  topic: z.string().max(LIMITS.BIO_MAX).optional(),
  position: z.number().int().min(0),
  isArchived: z.boolean().default(false),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

// ── Message ─────────────────────────────────────────────────

export const MessageSchema = z.object({
  id: IdSchema,
  conversationId: IdSchema,
  channelId: IdSchema.optional(),
  senderId: IdSchema,
  type: z.enum(MESSAGE_TYPES),
  content: z.string().max(LIMITS.MESSAGE_MAX),
  replyToId: IdSchema.optional(),
  threadId: IdSchema.optional(),
  isEdited: z.boolean().default(false),
  isPinned: z.boolean().default(false),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

// ── Attachment ──────────────────────────────────────────────

export const AttachmentSchema = z.object({
  id: IdSchema,
  messageId: IdSchema,
  type: z.enum(ATTACHMENT_TYPES),
  url: z.string().url(),
  filename: z.string(),
  sizeBytes: z.number().int().positive(),
  mimeType: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  createdAt: TimestampSchema,
});

// ── Reaction ────────────────────────────────────────────────

export const ReactionSchema = z.object({
  id: IdSchema,
  messageId: IdSchema,
  userId: IdSchema,
  emoji: z.string().min(1).max(32),
  createdAt: TimestampSchema,
});

// ── Member (server membership) ──────────────────────────────

export const MemberSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  serverId: IdSchema,
  nickname: z.string().max(LIMITS.DISPLAY_NAME_MAX).optional(),
  joinedAt: TimestampSchema,
});

// ── Role ────────────────────────────────────────────────────

export const RoleSchema = z.object({
  id: IdSchema,
  serverId: IdSchema,
  name: z.string().min(1).max(64),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  position: z.number().int().min(0),
  permissions: z.number().int(),
  isDefault: z.boolean().default(false),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

// ── Read Receipt ────────────────────────────────────────────

export const ReadReceiptSchema = z.object({
  userId: IdSchema,
  conversationId: IdSchema,
  lastReadMessageId: IdSchema,
  readAt: TimestampSchema,
});

// ── Pagination ──────────────────────────────────────────────

export const CursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

export const PaginatedResponseSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });

// ── API Error (RFC 9457 Problem Details) ────────────────────

export const ProblemDetailSchema = z.object({
  type: z.string().url(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
});
