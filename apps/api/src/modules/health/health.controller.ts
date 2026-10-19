import { Controller, Get, Res, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { type Response } from 'express';
import { HealthService } from './health.service.js';
import { type HealthResponse, type ReadyResponse } from '@holoraa/shared';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  getHealth(): HealthResponse {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  @ApiResponse({ status: 200, description: 'Dependencies are healthy' })
  @ApiResponse({ status: 503, description: 'One or more dependencies are degraded' })
  async getReady(@Res({ passthrough: true }) res: Response): Promise<ReadyResponse> {
    const ready = await this.healthService.getReadiness();
    if (ready.status === 'degraded' || ready.status === 'error') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return ready;
  }
}
