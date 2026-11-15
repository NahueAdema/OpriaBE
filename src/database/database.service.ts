import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import {
  drizzle,
  type PostgresJsDatabase,
} from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Env } from '../config/env.js';
import * as schema from './schema/index.js';

export type Database = PostgresJsDatabase<typeof schema>;

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private client?: ReturnType<typeof postgres>;
  private database?: Database;

  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * Lazily creates the connection pool on first use. postgres.js does not open
   * sockets until a query runs, so booting the app does not require a reachable
   * database (readiness reports that separately).
   */
  get db(): Database {
    if (!this.database) {
      const url = this.config.get('DATABASE_URL', { infer: true });
      const isPooled = url.includes('-pooler');

      this.client = postgres(url, {
        max: this.config.get('DATABASE_POOL_MAX', { infer: true }),
        idle_timeout: 20,
        connect_timeout: 10,
        // PgBouncer in transaction mode (Neon's pooled endpoint) cannot use
        // session-level prepared statements.
        prepare: !isPooled,
        onnotice: () => {},
      });
      this.database = drizzle(this.client, { schema });
    }

    return this.database;
  }

  async ping(timeoutMs = 2_000): Promise<void> {
    let timer: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        this.db.execute(sql`select 1`),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Database ping timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.end({ timeout: 5 });
  }
}
