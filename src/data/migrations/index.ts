import type { Db } from '../db';
import { m0001 } from './0001_init';
import { m0002 } from './0002_model_services';
import { m0003 } from './0003_archive';
import { m0004 } from './0004_ai_requests';
import { m0005 } from './0005_partner';
import { m0006 } from './0006_finalization';
import { m0007 } from './0007_attempt_metadata';
import { m0008 } from './0008_proposal_evidence';
import { m0009 } from './0009_finalization_plans';
import { m0010 } from './0010_relation_proposals';
import { m0011 } from './0011_usage_buckets';
import { m0012 } from './0012_covers';
import { m0014 } from './0014_review_decisions';
import { m0013 } from './0013_finalization_batches';

/** Ordered list; index + 1 is the schema version stored in PRAGMA user_version. */
export const migrations: string[][] = [m0001, m0002, m0003, m0004, m0005, m0006, m0007, m0008, m0009, m0010, m0011, m0012, m0013, m0014];

export const SCHEMA_VERSION = migrations.length;

/**
 * Brings the database up to SCHEMA_VERSION (G02 §10 step 1). Each migration runs
 * in its own transaction together with the version bump, so a failure leaves the
 * database at the previous version.
 */
export async function migrate(db: Db): Promise<{ from: number; to: number }> {
  await db.run('PRAGMA foreign_keys = ON');
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  const from = Number(row?.user_version ?? 0);
  if (from > SCHEMA_VERSION) {
    throw new Error(
      `Database version ${from} is newer than this app supports (${SCHEMA_VERSION})`,
    );
  }
  for (let v = from; v < SCHEMA_VERSION; v++) {
    await db.transaction(async tx => {
      for (const sql of migrations[v]) {
        await tx.run(sql);
      }
      await tx.run(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return { from, to: SCHEMA_VERSION };
}
