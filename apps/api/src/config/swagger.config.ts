import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { BRAND_NAME, API_VERSION } from '@holoraa/shared';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle(`${BRAND_NAME} API`)
    .setDescription(
      `${BRAND_NAME} REST API & WebSocket specifications. Minimal social space combining messaging, communities, and calls.`,
    )
    .setVersion(API_VERSION)
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
}
