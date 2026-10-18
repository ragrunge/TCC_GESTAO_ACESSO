import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { SaudeController } from './saude/saude.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [SaudeController],
})
export class AppModule {}
