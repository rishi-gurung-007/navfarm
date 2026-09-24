import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import * as masterSchema from './master-schema';
import { ConnectionManagerService } from './connection-manager.service';
import { UserDirectoryService } from './user-directory.service';
import { MASTER_CONNECTION, PG_CONNECTION } from './database.tokens';
import { DEFAULT_MASTER_DATABASE } from './database-names';

export { MASTER_CONNECTION, PG_CONNECTION };

@Global()
@Module({
  providers: [
    ConnectionManagerService,
    UserDirectoryService,
    {
      provide: MASTER_CONNECTION,
      useFactory: (config: ConfigService) => {
        const host = config.get<string>('database.host');
        const port = config.get<number>('database.port');
        const user = config.get<string>('database.username');
        const database = config.get<string>('database.database') || DEFAULT_MASTER_DATABASE;
        const ssl = config.get<boolean>('database.ssl');

        console.log(`[Master Database] Connecting to ${user}@${host}:${port}/${database}${ssl ? ' (TLS)' : ''}`);

        const pool = mysql.createPool({
          host,
          port,
          user,
          password: config.get<string>('database.password'),
          database,
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
          ...(ssl ? { ssl: { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true } } : {}),
        });

        return drizzle(pool, { schema: masterSchema, mode: 'default' });
      },
      inject: [ConfigService],
    },
  ],
  exports: [MASTER_CONNECTION, ConnectionManagerService, UserDirectoryService],
})
export class DatabaseModule {}
