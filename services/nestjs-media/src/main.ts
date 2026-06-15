import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  
  // Enable CORS for frontend API gateways
  app.enableCors();
  
  const port = process.env.PORT || 8082;
  logger.log(`NeXaVerSe NestJS Media service starting on port ${port}...`);
  
  await app.listen(port);
}
bootstrap();
