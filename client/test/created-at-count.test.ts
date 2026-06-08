import { describe, expect, test } from 'bun:test';
import {
    buildBookCountCsv,
    buildCreatedAtOptimizedQueryPlan,
    countOptimizedCreatedTransactions,
    countTransactionsCreatedInPreviousMonth,
    countTrashedTransactionsCreatedInPreviousMonth,
    formatBooksCountedLabel,
    formatUnknownError,
    getPreviousMonthPeriod,
    mapWithConcurrency,
    normalizeTransactionCount,
} from '../src/created-at-count.js';

describe('createdAt previous-month counting', () => {
    test('uses the book timezone to decide the previous month', () => {
        const period = getPreviousMonthPeriod(
            new Date('2026-05-05T12:00:00.000Z'),
            'America/Sao_Paulo',
        );

        expect(period.year).toBe(2026);
        expect(period.month).toBe(4);
        expect(period.label).toBe('April 2026');
    });

    test('counts a UTC May 1 createdAt as April in an IANA GMT-3 book timezone', () => {
        const now = new Date('2026-05-05T12:00:00.000Z');
        const count = countTransactionsCreatedInPreviousMonth(
            [
                {
                    createdAt: new Date('2026-05-01T00:45:00.000Z'),
                    trashed: false,
                },
            ],
            now,
            'America/Sao_Paulo',
        );

        expect(count).toBe(1);
    });

    test('counts a UTC May 1 createdAt as April in a fixed GMT-3 book timezone', () => {
        const now = new Date('2026-05-05T12:00:00.000Z');
        const count = countTransactionsCreatedInPreviousMonth(
            [
                {
                    createdAt: new Date('2026-05-01T00:45:00.000Z'),
                    trashed: false,
                },
            ],
            now,
            'GMT-3',
        );

        expect(count).toBe(1);
    });

    test('falls back to a fixed offset when the book timezone name is invalid', () => {
        const period = getPreviousMonthPeriod(
            new Date('2026-05-01T01:00:00.000Z'),
            {
                timeZone: 'Invalid/Zone',
                offsetMinutes: -180,
            },
        );

        expect(period.year).toBe(2026);
        expect(period.month).toBe(3);
        expect(period.label).toBe('March 2026');
    });

    test('excludes trashed transactions', () => {
        const now = new Date('2026-05-05T12:00:00.000Z');
        const count = countTransactionsCreatedInPreviousMonth(
            [
                {
                    createdAt: new Date('2026-04-10T12:00:00.000Z'),
                    trashed: true,
                },
            ],
            now,
            'America/Sao_Paulo',
        );

        expect(count).toBe(0);
    });

    test('counts trashed transactions created in the previous month', () => {
        const now = new Date('2026-05-05T12:00:00.000Z');
        const count = countTrashedTransactionsCreatedInPreviousMonth(
            [
                {
                    createdAt: new Date('2026-04-10T12:00:00.000Z'),
                    trashed: true,
                },
                {
                    createdAt: new Date('2026-04-10T12:00:00.000Z'),
                    trashed: false,
                },
                {
                    createdAt: new Date('2026-05-10T12:00:00.000Z'),
                    trashed: true,
                },
            ],
            now,
            'America/Sao_Paulo',
        );

        expect(count).toBe(1);
    });

    test('splits createdAt queries into counted core and fetched boundaries', () => {
        const plan = buildCreatedAtOptimizedQueryPlan({
            year: 2026,
            month: 4,
            label: 'April 2026',
        });

        expect(plan.startBoundaryQuery).toBe(
            'after:2026-03-30 before:2026-04-02 using:createdAt',
        );
        expect(plan.coreQuery).toBe(
            'after:2026-04-02 before:2026-04-30 using:createdAt',
        );
        expect(plan.endBoundaryQuery).toBe(
            'after:2026-04-30 before:2026-05-03 using:createdAt',
        );
        expect(plan.boundaryQueries).toEqual([
            plan.startBoundaryQuery,
            plan.endBoundaryQuery,
        ]);
    });

    test('adds the API counted core to timezone-verified boundary transactions', () => {
        const count = countOptimizedCreatedTransactions({
            coreCount: 10,
            now: new Date('2026-05-05T12:00:00.000Z'),
            timeZoneInput: 'America/Sao_Paulo',
            boundaryTransactions: [
                {
                    createdAt: new Date('2026-05-01T00:45:00.000Z'),
                    trashed: false,
                },
                {
                    createdAt: new Date('2026-04-01T02:30:00.000Z'),
                    trashed: true,
                },
                {
                    createdAt: new Date('2026-03-31T23:30:00.000Z'),
                    trashed: false,
                },
            ],
        });

        expect(count).toBe(11);
    });

    test('normalizes string counts returned by the API before adding them', () => {
        expect(normalizeTransactionCount('223')).toBe(223);
        expect(
            countOptimizedCreatedTransactions({
                coreCount: '223',
                now: new Date('2026-05-05T12:00:00.000Z'),
                timeZoneInput: 'America/Sao_Paulo',
                boundaryTransactions: [
                    {
                        createdAt: new Date('2026-05-01T00:45:00.000Z'),
                        trashed: false,
                    },
                ],
            }),
        ).toBe(224);
    });

    test('formats the books counted label without referring to accessible books', () => {
        expect(formatBooksCountedLabel(3, 3)).toBe('3 books counted');
        expect(formatBooksCountedLabel(2, 3)).toBe('2 of 3 books counted');
    });

    test('formats unknown errors safely', () => {
        expect(formatUnknownError(new Error('Token expired'))).toBe(
            'Token expired',
        );
        expect(formatUnknownError('Plain failure')).toBe('Plain failure');
    });

    test('builds a CSV export with book ids and escaped values', () => {
        const csv = buildBookCountCsv([
            {
                bookId: 'book-1',
                bookName: 'Main Book',
                timeZone: 'America/Sao_Paulo',
                periodLabel: 'April 2026',
                count: 12,
                status: 'Counted',
            },
            {
                bookId: 'book-2',
                bookName: 'Book, with comma',
                timeZone: 'UTC',
                status: 'Permission "denied"',
            },
        ]);

        expect(csv).toBe(
            'Book ID,Book,Timezone,Period,Count,Status\r\n' +
                'book-1,Main Book,America/Sao_Paulo,April 2026,12,Counted\r\n' +
                'book-2,"Book, with comma",UTC,,,"Permission ""denied"""',
        );
    });

    test('neutralizes spreadsheet formulas in CSV text fields', () => {
        const csv = buildBookCountCsv([
            {
                bookId: '=book-id',
                bookName: '+Main Book',
                timeZone: 'UTC',
                periodLabel: '-April 2026',
                count: 12,
                status: '@Counted',
            },
        ]);

        expect(csv).toBe(
            'Book ID,Book,Timezone,Period,Count,Status\r\n' +
                "'=book-id,'+Main Book,UTC,'-April 2026,12,'@Counted",
        );
    });

    test('limits concurrent work and preserves result order', async () => {
        let active = 0;
        let maxActive = 0;

        const results = await mapWithConcurrency(
            [1, 2, 3, 4, 5],
            2,
            async (item) => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                await Promise.resolve();
                active -= 1;
                return item * 2;
            },
        );

        expect(maxActive).toBeLessThanOrEqual(2);
        expect(results).toEqual([2, 4, 6, 8, 10]);
    });
});
