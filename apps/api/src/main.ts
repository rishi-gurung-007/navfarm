import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import express from 'express';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // Express 5 — which Nest 11 ships — defaults the query parser to 'simple',
  // where Express 4 defaulted to 'extended'. Simple parsing does not read
  // bracket syntax: 'filter[location_type]=PEN' arrives as one flat key
  // literally named 'filter[location_type]', which the whitelisting
  // ValidationPipe then rejects as an unknown property. The master list
  // contract (see common/master-list-query.ts) is built on filter[column],
  // so the parser is set back to the one that understands it.
  app.set('query parser', 'extended');
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  const uploadsDir = resolve(process.env.UPLOADS_DIR || 'apps/api/uploads');
  mkdirSync(uploadsDir, { recursive: true });
  app.use('/uploads', express.static(uploadsDir));

  const apiPrefix = (process.env.API_PREFIX || 'api/v1').replace(/^\/+|\/+$/g, '');
  const docsPath = (process.env.API_DOCS_PATH || 'api/docs').replace(/^\/+|\/+$/g, '');
  const corsOrigins = process.env.CORS_ORIGINS
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const isDevelopment = process.env.NODE_ENV !== 'production';
  // In dev, the API is also reached through the web app's same-origin proxy
  // (next.config.js rewrites) from other devices on the LAN — a tester's
  // browser at http://192.168.x.x:3000 forwards that Origin header straight
  // through. Loopback-only was too narrow for that, and there is no browser
  // enforcing this cross-origin anyway (the browser only ever talks to its
  // own origin; the proxy hop to the API is server-to-server) — so any
  // private-network origin is safe to allow here in development.
  const isDevAllowedOrigin = (origin: string) => {
    try {
      const url = new URL(origin);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      const host = url.hostname;
      return (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
        /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)
      );
    } catch {
      return false;
    }
  };

  // Set global API prefix
  app.setGlobalPrefix(apiPrefix);
  
  // Use global validation pipes
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  }));

  // Global exception filters
  app.useGlobalFilters(new HttpExceptionFilter());

  // Enable CORS for frontend integration
  app.enableCors({
    origin: (origin, callback) => {
      // Requests without an Origin header are not browser cross-origin requests.
      if (
        !origin ||
        corsOrigins?.includes(origin) ||
        (isDevelopment && isDevAllowedOrigin(origin))
      ) {
        callback(null, true);
        return;
      }

      // Passing an Error here (instead of `false`) makes the cors middleware
      // throw past Nest's exception filter as a raw unhandled exception —
      // every request from a disallowed origin 500'd instead of getting a
      // clean, silent CORS rejection.
      callback(null, false);
    },
    credentials: true,
  });

  // Configure Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('NAVFarm ERP API')
    .setDescription(
      `## Multi-Tenant Multi-Vertical Agricultural ERP Engine
      
      Welcome to the NAVFarm API documentation. This platform manages farm verticals from rearing to harvest/slaughter, automated double-entry bookkeeping, and SaaS tenant subscription isolation.
      
      ### Security & Headers
      * **Authentication**: Use the authorization token returned by \`/auth/login\` in the Authorization header: \`Bearer <token>\`.
      * **Multi-Tenancy**: All requests to operational endpoints must include the **\`x-tenant-id\`** header indicating the active tenant UUID context.`,
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
    
  const document = SwaggerModule.createDocument(app, config);
  
  const customOptions = {
    customSiteTitle: 'NAVFarm ERP API Documentation',
    customCss: `
      .swagger-ui {
        background-color: #0b0f19;
        color: #c9d1d9;
      }
      .swagger-ui .topbar {
        background-color: #111827;
        border-bottom: 2px solid #1F4E79;
      }
      .swagger-ui .info .title {
        color: #f9fafb;
      }
      .swagger-ui .info p, .swagger-ui .info li, .swagger-ui .info td, .swagger-ui .info a {
        color: #9ca3af;
      }
      .swagger-ui .scheme-container {
        background-color: #111827;
        box-shadow: none;
        border: 1px solid #1f2937;
      }
      .swagger-ui select {
        background-color: #1f2937;
        color: #f9fafb;
        border: 1px solid #374151;
      }
      .swagger-ui input[type=text] {
        background-color: #1f2937;
        color: #f9fafb;
        border: 1px solid #374151;
      }
      .swagger-ui .opblock.opblock-get {
        background: rgba(16, 185, 129, 0.05);
        border-color: #10b981;
      }
      .swagger-ui .opblock.opblock-post {
        background: rgba(59, 130, 246, 0.05);
        border-color: #3b82f6;
      }
      .swagger-ui .opblock.opblock-put {
        background: rgba(245, 158, 11, 0.05);
        border-color: #f59e0b;
      }
      .swagger-ui .opblock.opblock-delete {
        background: rgba(239, 68, 68, 0.05);
        border-color: #ef4444;
      }
      .swagger-ui .opblock .opblock-summary-operation-id, .swagger-ui .opblock .opblock-summary-path, .swagger-ui .opblock .opblock-summary-path__deprecated {
        color: #f3f4f6;
      }
      .swagger-ui .opblock-description-wrapper p, .swagger-ui .opblock-external-docs-wrapper p, .swagger-ui .opblock-title_normal p {
        color: #9ca3af;
      }
      .swagger-ui .tabli button {
        color: #9ca3af;
      }
      .swagger-ui .tabli.active button {
        color: #3b82f6;
      }
      .swagger-ui .response-col_status {
        color: #f9fafb;
      }
      .swagger-ui table thead tr td, .swagger-ui table thead tr th {
        color: #9ca3af;
      }
      .swagger-ui .dialog-ux .modal-ux {
        background-color: #111827;
        border: 1px solid #374151;
      }
      .swagger-ui .dialog-ux .modal-ux-header {
        border-bottom: 1px solid #374151;
      }
      .swagger-ui .dialog-ux .modal-ux-header h3 {
        color: #f9fafb;
      }
      .swagger-ui .dialog-ux .modal-ux-content {
        color: #9ca3af;
      }
      .swagger-ui .btn {
        background-color: #1f2937;
        color: #f9fafb;
        border: 1px solid #374151;
      }
      .swagger-ui .btn.authorize {
        background-color: #10b981;
        color: #fff;
        border-color: #10b981;
      }
    `,
  };

  SwaggerModule.setup(docsPath, app, document, customOptions);

  const host = process.env.NAVFARM_API_HOST || '0.0.0.0';
  const portValue = process.env.NAVFARM_API_PORT || process.env.PORT || '2877';
  const port = Number.parseInt(portValue, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid NAVFarm API port: ${portValue}`);
  }
  await app.listen(port, host);
  Logger.log(`NAVFarm API: http://${host}:${port}/${apiPrefix}`);
  Logger.log(`Swagger: http://${host}:${port}/${docsPath}`);
}
void bootstrap();
