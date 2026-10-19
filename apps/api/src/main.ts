/**
 * Holoraa API — Application entry point.
 *
 * Bootstraps the NestJS application with:
 * - Helmet for security headers
 * - CORS restricted to allowed origins
 * - Global validation pipe
 * - Global exception filter (RFC 9457 problem details)
 * - Rate limiting
 * - Structured JSON logging via Pino
 * - OpenAPI docs (non-production only)
 * - Graceful shutdown hooks
 */

import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { setupSwagger } from './config/swagger.config.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // ── Logging ─────────────────────────────────────────────
  app.useLogger(app.get(Logger));

  // ── Security ────────────────────────────────────────────
  app.use(helmet());
  app.enableCors({
    origin: process.env['API_CORS_ORIGINS']?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  });

  // ── Global prefix ───────────────────────────────────────
  app.setGlobalPrefix('v1');

  // ── OpenAPI (non-production only) ───────────────────────
  if (process.env['NODE_ENV'] !== 'production') {
    setupSwagger(app);
  }

  // ── Graceful shutdown ───────────────────────────────────
  app.enableShutdownHooks();

  const port = process.env['API_PORT'] ?? 4000;
  await app.listen(port);
}

void bootstrap();
