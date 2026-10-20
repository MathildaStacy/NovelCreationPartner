import { db, setDb } from '../../src/data/db';
import { foregroundSlots } from '../../src/ai/runtime/slots';
import * as provider from '../../src/ai/providers/httpProvider';
import * as entries from '../../src/features/entries';
import * as works from '../../src/features/works';
import * as models from '../../src/features/modelServices';
import * as completion from '../../src/features/entryCompletion';
import * as partner from '../../src/features/partner';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
import { freshDb, tickingClock } from '../helpers/db';

jest.mock('../../src/secure', () => ({
  getKey: jest.fn(async () => 'test-key'),
  setKey: jest.fn(async () => {}),
  removeKey: jest.fn(async () => {}),
}));

beforeEach(async () => {
  tickingClock();
  await freshDb();
});

afterEach(async () => {
  jest.restoreAllMocks();
  await db().close();
  setDb(null);
});

describe.each(['completion', 'partner'] as const)(
  '%s foreground queue',
  kind => {
    test.each(['changed', 'cancelled', 'unchanged'] as const)(
      'checks %s context before starting a paid request',
      async state => {
        const work = await works.create({ premise: '海上寻找钥匙' });
        const entry = await entries.create({
          workId: work.id,
          type: 'character',
          name: '林宇',
          facts: [{ field: 'goal', value: '回家' }],
        });
        await models.save(
          {
            name: 'Fixture',
            protocol: 'openai_responses',
            baseUrl: 'https://example.test/v1',
            model: 'test',
            options: { ...DEFAULT_OPTIONS, caps: {} },
          },
          'test-key',
        );
        const plan =
          kind === 'completion'
            ? await completion.prepare(entry.id, ['goal'])
            : await partner.prepareSend(null, '林宇下一步应该怎样行动？', {
                workId: work.id,
              });
        const generate = jest.fn(async function* () {
          const text =
            kind === 'completion'
              ? JSON.stringify({
                  facts: [
                    {
                      field: 'goal',
                      value: '寻找钥匙后回家',
                      reason: '遵循目标',
                    },
                  ],
                })
              : '他决定寻找钥匙后回家。';
          yield {
            type: 'done' as const,
            text,
            usage: null,
            stop: 'end' as const,
            model: 'fixture',
          };
        });
        jest.spyOn(provider, 'createProvider').mockReturnValue({
          generate,
          listModels: async () => [],
        });
        const release = await foregroundSlots.acquire(
          3,
          new AbortController().signal,
        );
        const controller = new AbortController();
        const options = {
          signal: controller.signal,
          confirmedHost: 'example.test',
        };
        const pending = (
          kind === 'completion'
            ? completion.complete(plan, options)
            : partner.send(plan, options)
        ).then(
          () => null,
          (error: unknown) => error,
        );
        try {
          for (let i = 0; i < 100 && foregroundSlots.waiting === 0; i++) {
            await new Promise<void>(resolve => setTimeout(resolve, 0));
          }
          expect(foregroundSlots.waiting).toBe(1);
          expect(generate).not.toHaveBeenCalled();
          if (state === 'changed') {
            await entries.update(entry.id, {
              facts: [{ field: 'goal', value: '留在海上' }],
            });
          } else if (state === 'cancelled') {
            controller.abort();
          }
          release();
          const error = await pending;
          if (state === 'unchanged') {
            expect(error).toBeNull();
            expect(generate).toHaveBeenCalledTimes(1);
            expect(await db().all('SELECT status FROM ai_attempts')).toEqual([
              { status: 'succeeded' },
            ]);
          } else {
            expect(error).toMatchObject({
              code: state === 'changed' ? 'AI_RESULT_STALE' : 'AI_CANCELLED',
            });
            expect(generate).not.toHaveBeenCalled();
            expect(await db().all('SELECT id FROM ai_requests')).toEqual([]);
            expect(await db().all('SELECT id FROM ai_attempts')).toEqual([]);
          }
          expect(foregroundSlots.active).toBe(0);
          expect(foregroundSlots.waiting).toBe(0);
        } finally {
          controller.abort();
          release();
          await pending;
        }
      },
    );
  },
);
