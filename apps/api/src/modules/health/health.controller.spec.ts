import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { type Response } from 'express';

describe('HealthController', () => {
  let controller: HealthController;
  let service: HealthService;

  beforeEach(() => {
    service = {
      getLiveness: vi.fn().mockReturnValue({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '0.0.0',
      }),
      getReadiness: vi.fn().mockResolvedValue({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '0.0.0',
        checks: {
          database: 'ok',
          redis: 'ok',
        },
      }),
    } as unknown as HealthService;

    controller = new HealthController(service);
  });

  describe('getHealth (liveness)', () => {
    it('returns status ok', () => {
      const result = controller.getHealth();
      expect(result.status).toBe('ok');
      expect(result.version).toBe('0.0.0');
    });
  });

  describe('getReady (readiness)', () => {
    it('returns status ok when all systems healthy', async () => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
      } as unknown as Response;

      const result = await controller.getReady(mockRes);
      expect(result.status).toBe('ok');
      expect(result.checks.database).toBe('ok');
      expect(result.checks.redis).toBe('ok');
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('sets 503 HTTP status when degraded', async () => {
      vi.mocked(service.getReadiness).mockResolvedValueOnce({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        version: '0.0.0',
        checks: {
          database: 'error',
          redis: 'ok',
        },
      });

      const mockRes = {
        status: vi.fn().mockReturnThis(),
      } as unknown as Response;

      const result = await controller.getReady(mockRes);
      expect(result.status).toBe('degraded');
      expect(mockRes.status).toHaveBeenCalledWith(503);
    });
  });
});
