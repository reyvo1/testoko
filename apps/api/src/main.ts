import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  app.useBodyParser('json', { limit: config.get<string>('API_JSON_BODY_LIMIT') ?? '12mb' });
  const origins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const environment = (config.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  const production = environment === 'production';
  const protectedEnvironment = production || environment === 'staging';
  if (protectedEnvironment && !origins.length) throw new Error('CORS_ORIGINS wajib dikonfigurasi pada staging/production.');
  if (protectedEnvironment && origins.includes('*')) throw new Error('CORS_ORIGINS staging/production tidak boleh wildcard (*).');

  app.use((req: any, res: any, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: origins.length ? origins : !protectedEnvironment, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Toko360 API')
    .setDescription('API toko online, kasir, gudang, supplier, pembayaran, pengguna, dan keuangan.')
    .setVersion(process.env.APP_VERSION ?? '0.5.3')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const port = Number(config.get<string>('API_PORT') ?? 4000);
  await app.listen(port);
  console.log(`Toko360 API berjalan di http://localhost:${port}/api/v1`);
  console.log(`Swagger tersedia di http://localhost:${port}/docs`);
}

void bootstrap();
