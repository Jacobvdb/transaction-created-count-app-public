import { describe, expect, test } from 'bun:test';
import {
    countCreatedTransactionBookDetails,
    countCreatedTransactionsForBook,
    sortBookCountResults,
    type CreatedTransactionsBook,
    type CreatedTransactionsPage,
    type CreatedTransactionsTransaction,
} from '../src/created-at-count-service.js';
import type { TransactionCountValue } from '../src/created-at-count.js';

function createSuccessfulResult(
    bookId: string,
    bookName: string,
    count: number,
) {
    return {
        status: 'ok' as const,
        bookId,
        bookName,
        timeZone: 'UTC',
        periodLabel: 'April 2026',
        count,
        coreCount: count,
        boundaryFetchedCount: 0,
        generatedAt: '2026-05-05 12:00:00',
        coreQuery: `core-${bookId}`,
        boundaryQueries: [],
    };
}

function createErrorResult(bookId: string, bookName: string) {
    return {
        status: 'error' as const,
        bookId,
        bookName,
        timeZone: 'UTC',
        error: 'Permission denied',
    };
}

class FakeTransaction implements CreatedTransactionsTransaction {
    constructor(
        private readonly createdAt: Date,
        private readonly trashed: boolean = false,
    ) {}

    getCreatedAt(): Date {
        return this.createdAt;
    }

    isTrashed(): boolean {
        return this.trashed;
    }
}

class FakeTransactionPage implements CreatedTransactionsPage {
    constructor(
        private readonly items: CreatedTransactionsTransaction[],
        private readonly cursor?: string,
    ) {}

    getItems(): CreatedTransactionsTransaction[] {
        return this.items;
    }

    getCursor(): string | undefined {
        return this.cursor;
    }
}

interface ListCall {
    query?: string;
    limit?: number;
    cursor?: string;
}

class FakeBook implements CreatedTransactionsBook {
    readonly countQueries: (string | undefined)[] = [];
    readonly listCalls: ListCall[] = [];

    constructor(
        private readonly countByQuery: Map<string, TransactionCountValue>,
        private readonly pagesByQueryAndCursor: Map<
            string,
            CreatedTransactionsPage
        >,
        private readonly totalTransactions: TransactionCountValue = 0,
    ) {}

    getId(): string {
        return 'book-1';
    }

    getName(): string {
        return 'Main Book';
    }

    getTimeZone(): string {
        return 'America/Sao_Paulo';
    }

    getTimeZoneOffset(): number {
        return -180;
    }

    getTotalTransactions(): TransactionCountValue {
        return this.totalTransactions;
    }

    async countTransactions(query?: string): Promise<TransactionCountValue> {
        this.countQueries.push(query);
        return this.countByQuery.get(query ?? '') ?? 0;
    }

    async listTransactions(
        query?: string,
        limit?: number,
        cursor?: string,
    ): Promise<CreatedTransactionsPage> {
        this.listCalls.push({ query, limit, cursor });
        return (
            this.pagesByQueryAndCursor.get(`${query ?? ''}|${cursor ?? ''}`) ??
            new FakeTransactionPage([])
        );
    }
}

describe('createdAt count service', () => {
    test('counts one book through the API boundary and paginates boundary windows', async () => {
        const startBoundaryQuery =
            'after:2026-03-30 before:2026-04-02 using:createdAt';
        const coreQuery = 'after:2026-04-02 before:2026-04-30 using:createdAt';
        const endBoundaryQuery =
            'after:2026-04-30 before:2026-05-03 using:createdAt';
        const book = new FakeBook(
            new Map([[coreQuery, '10']]),
            new Map([
                [
                    `${startBoundaryQuery}|`,
                    new FakeTransactionPage(
                        [
                            new FakeTransaction(
                                new Date('2026-03-31T23:30:00.000Z'),
                            ),
                        ],
                        'next',
                    ),
                ],
                [
                    `${startBoundaryQuery}|next`,
                    new FakeTransactionPage([
                        new FakeTransaction(
                            new Date('2026-04-01T03:30:00.000Z'),
                        ),
                    ]),
                ],
                [
                    `${endBoundaryQuery}|`,
                    new FakeTransactionPage([
                        new FakeTransaction(
                            new Date('2026-05-01T00:45:00.000Z'),
                        ),
                        new FakeTransaction(
                            new Date('2026-05-01T00:45:00.000Z'),
                            true,
                        ),
                    ]),
                ],
            ]),
        );

        const result = await countCreatedTransactionsForBook(
            book,
            new Date('2026-05-05T12:00:00.000Z'),
        );

        expect(result.status).toBe('ok');
        if (result.status !== 'ok') {
            throw new Error('Expected successful book count');
        }
        expect(result.count).toBe(12);
        expect(result.coreCount).toBe(10);
        expect(result.boundaryFetchedCount).toBe(4);
        expect(book.countQueries).toEqual([coreQuery]);
        expect(book.listCalls).toEqual([
            { query: startBoundaryQuery, limit: 1000, cursor: undefined },
            { query: startBoundaryQuery, limit: 1000, cursor: 'next' },
            { query: endBoundaryQuery, limit: 1000, cursor: undefined },
        ]);
    });

    test('returns a per-book error result instead of failing the whole report', async () => {
        const failingBook: CreatedTransactionsBook = {
            getId: () => 'book-2',
            getName: () => 'Broken Book',
            getTimeZone: () => 'UTC',
            getTimeZoneOffset: () => 0,
            getTotalTransactions: () => 0,
            countTransactions: async () => {
                throw new Error('Permission denied');
            },
            listTransactions: async () => new FakeTransactionPage([]),
        };

        const result = await countCreatedTransactionsForBook(
            failingBook,
            new Date('2026-05-05T12:00:00.000Z'),
        );

        expect(result).toEqual({
            status: 'error',
            bookId: 'book-2',
            bookName: 'Broken Book',
            timeZone: 'UTC',
            error: 'Permission denied',
        });
    });

    test('sorts successful book counts descending with alphabetic ties and errors last', () => {
        const results = sortBookCountResults([
            createSuccessfulResult('low-z', 'Zulu Book', 3),
            createErrorResult('error-z', 'Zulu Error Book'),
            createSuccessfulResult('high', 'High Book', 20),
            createSuccessfulResult('low-a', 'Alpha Book', 3),
            createErrorResult('error-a', 'Alpha Error Book'),
        ]);

        expect(results.map((result) => result.bookId)).toEqual([
            'high',
            'low-a',
            'low-z',
            'error-a',
            'error-z',
        ]);
    });

    test('loads book details with trashed transaction counts', async () => {
        const startBoundaryQuery =
            'after:2026-03-30 before:2026-04-02 using:createdAt';
        const coreQuery = 'after:2026-04-02 before:2026-04-30 using:createdAt';
        const endBoundaryQuery =
            'after:2026-04-30 before:2026-05-03 using:createdAt';
        const trashedCoreQuery = `is:trashed ${coreQuery}`;
        const trashedStartBoundaryQuery = `is:trashed ${startBoundaryQuery}`;
        const trashedEndBoundaryQuery = `is:trashed ${endBoundaryQuery}`;
        const book = new FakeBook(
            new Map([
                ['', '25'],
                ['is:trashed', '5'],
                ['is:unchecked', '10'],
                [trashedCoreQuery, '2'],
            ]),
            new Map([
                [
                    `${trashedStartBoundaryQuery}|`,
                    new FakeTransactionPage([
                        new FakeTransaction(
                            new Date('2026-04-01T03:30:00.000Z'),
                            true,
                        ),
                    ]),
                ],
                [
                    `${trashedEndBoundaryQuery}|`,
                    new FakeTransactionPage([
                        new FakeTransaction(
                            new Date('2026-05-01T00:45:00.000Z'),
                            true,
                        ),
                        new FakeTransaction(
                            new Date('2026-05-02T12:00:00.000Z'),
                            true,
                        ),
                    ]),
                ],
            ]),
            '30',
        );

        const details = await countCreatedTransactionBookDetails(
            book,
            new Date('2026-05-05T12:00:00.000Z'),
            12,
        );

        expect(details).toEqual({
            totalTransactions: 30,
            nonTrashedTransactions: 25,
            totalTrashedTransactions: 5,
            totalUncheckedTransactions: 10,
            nonTrashedCreatedLastMonth: 12,
            trashedCreatedLastMonth: 4,
        });
        expect(book.countQueries).toEqual([
            '',
            'is:trashed',
            'is:unchecked',
            trashedCoreQuery,
        ]);
        expect(book.listCalls).toEqual([
            {
                query: trashedStartBoundaryQuery,
                limit: 1000,
                cursor: undefined,
            },
            { query: trashedEndBoundaryQuery, limit: 1000, cursor: undefined },
        ]);
    });
});
