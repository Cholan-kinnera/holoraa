/**
 * Unit tests for shared Zod schemas.
 * Validates that schemas correctly accept valid data and reject invalid data.
 */

import { describe, it, expect } from 'vitest';
import {
  UserSchema,
  MessageSchema,
  CursorPaginationSchema,
  ProblemDetailSchema,
  ServerSchema,
} from '../schemas/index.js';

describe('UserSchema', () => {
  const validUser = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    email: 'test@holoraa.app',
    username: 'testuser',
    displayName: 'Test User',
    isOnline: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('accepts a valid user', () => {
    const result = UserSchema.safeParse(validUser);
    expect(result.success).toBe(true);
  });

  it('rejects a user with invalid email', () => {
    const result = UserSchema.safeParse({ ...validUser, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects a username that is too short', () => {
    const result = UserSchema.safeParse({ ...validUser, username: 'ab' });
    expect(result.success).toBe(false);
  });

  it('rejects a username with invalid characters', () => {
    const result = UserSchema.safeParse({ ...validUser, username: 'user name!' });
    expect(result.success).toBe(false);
  });
});

describe('ServerSchema', () => {
  const validServer = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'My Server',
    ownerId: '550e8400-e29b-41d4-a716-446655440001',
    isPublic: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('accepts a valid server', () => {
    const result = ServerSchema.safeParse(validServer);
    expect(result.success).toBe(true);
  });

  it('rejects an empty server name', () => {
    const result = ServerSchema.safeParse({ ...validServer, name: '' });
    expect(result.success).toBe(false);
  });
});

describe('MessageSchema', () => {
  const validMessage = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    conversationId: '550e8400-e29b-41d4-a716-446655440001',
    senderId: '550e8400-e29b-41d4-a716-446655440002',
    type: 'text',
    content: 'Hello world',
    isEdited: false,
    isPinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('accepts a valid message', () => {
    const result = MessageSchema.safeParse(validMessage);
    expect(result.success).toBe(true);
  });

  it('rejects an invalid message type', () => {
    const result = MessageSchema.safeParse({ ...validMessage, type: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('rejects content exceeding max length', () => {
    const result = MessageSchema.safeParse({
      ...validMessage,
      content: 'a'.repeat(4001),
    });
    expect(result.success).toBe(false);
  });
});

describe('CursorPaginationSchema', () => {
  it('applies defaults', () => {
    const result = CursorPaginationSchema.parse({});
    expect(result.limit).toBe(25);
    expect(result.cursor).toBeUndefined();
  });

  it('rejects limit over 100', () => {
    const result = CursorPaginationSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });
});

describe('ProblemDetailSchema', () => {
  it('accepts a valid problem detail', () => {
    const result = ProblemDetailSchema.safeParse({
      type: 'https://holoraa.app/errors/not-found',
      title: 'Not Found',
      status: 404,
    });
    expect(result.success).toBe(true);
  });
});
