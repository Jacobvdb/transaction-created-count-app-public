import {
    buildCreatedAtOptimizedQueryPlan,
    countOptimizedCreatedTransactions,
    countTrashedTransactionsCreatedInPreviousMonth,
    formatDateTimeInTimeZone,
    formatUnknownError,
    getPreviousMonthPeriod,
    getTimeZoneLabel,
    mapWithConcurrency,
    normalizeTransactionCount,
    type BookTimeZone,
    type CountableTransaction,
    type TransactionCountValue,
} from './created-at-count.js';

export const BOOK_COUNT_CONCURRENCY = 3;

export interface CreatedTransactionsBook {
    getId(): string;
    getName(): string | undefined;
    getTimeZone(): string | undefined;
    getTimeZoneOffset(): number | undefined;
    getTotalTransactions(): TransactionCountValue;
    countTransactions(query?: string): Promise<TransactionCountValue>;
    listTransactions(
        query?: string,
        limit?: number,
        cursor?: string,
    ): Promise<CreatedTransactionsPage>;
}

export interface CreatedTransactionsPage {
    getItems(): CreatedTransactionsTransaction[];
    getCursor(): string | undefined;
}

export interface CreatedTransactionsTransaction {
    getCreatedAt(): Date;
    isTrashed(): boolean | undefined;
}

export interface SuccessfulBookCountResult {
    status: 'ok';
    bookId: string;
    bookName: string;
    timeZone: string;
    periodLabel: string;
    count: number;
    coreCount: number;
    boundaryFetchedCount: number;
    generatedAt: string;
    coreQuery: string;
    boundaryQueries: string[];
}

export interface FailedBookCountResult {
    status: 'error';
    bookId: string;
    bookName: string;
    timeZone: string;
    error: string;
}

export type BookCountResult = SuccessfulBookCountResult | FailedBookCountResult;

export interface BookTransactionDetails {
    totalTransactions: number;
    nonTrashedTransactions: number;
    totalTrashedTransactions: number;
    totalUncheckedTransactions: number;
    nonTrashedCreatedLastMonth: number;
    trashedCreatedLastMonth: number;
}

export function isSuccessfulBookCountResult(
    result: BookCountResult,
): result is SuccessfulBookCountResult {
    return result.status === 'ok';
}

export function sortBookCountResults(
    results: BookCountResult[],
): BookCountResult[] {
    return [...results].sort((left, right) => {
        if (left.status === 'error' && right.status === 'error') {
            return compareBookNames(left, right);
        }

        if (left.status === 'error') {
            return 1;
        }

        if (right.status === 'error') {
            return -1;
        }

        return right.count - left.count || compareBookNames(left, right);
    });
}

function compareBookNames(
    left: BookCountResult,
    right: BookCountResult,
): number {
    return left.bookName.localeCompare(right.bookName, undefined, {
        sensitivity: 'base',
    });
}

export async function countCreatedTransactionsForBooks(
    books: CreatedTransactionsBook[],
    now: Date,
    onProgress?: (completed: number, total: number) => void,
): Promise<BookCountResult[]> {
    return mapWithConcurrency(
        books,
        BOOK_COUNT_CONCURRENCY,
        (book) => countCreatedTransactionsForBook(book, now),
        onProgress,
    );
}

export async function countCreatedTransactionsForBook(
    book: CreatedTransactionsBook,
    now: Date,
): Promise<BookCountResult> {
    const bookId = book.getId();
    const bookName = book.getName() ?? 'Untitled book';
    const bookTimeZone: BookTimeZone = {
        timeZone: book.getTimeZone(),
        offsetMinutes: book.getTimeZoneOffset(),
    };
    const timeZone = getTimeZoneLabel(bookTimeZone);

    try {
        const period = getPreviousMonthPeriod(now, bookTimeZone);
        const queryPlan = buildCreatedAtOptimizedQueryPlan(period);
        const coreCount = normalizeTransactionCount(
            await book.countTransactions(queryPlan.coreQuery),
        );
        const boundaryTransactions = await listBoundaryTransactions(
            book,
            queryPlan.boundaryQueries,
        );
        const count = countOptimizedCreatedTransactions({
            coreCount,
            boundaryTransactions: boundaryTransactions.map(
                toCountableTransaction,
            ),
            now,
            timeZoneInput: bookTimeZone,
        });

        return {
            status: 'ok',
            bookId,
            bookName,
            timeZone,
            periodLabel: period.label,
            count,
            coreCount,
            boundaryFetchedCount: boundaryTransactions.length,
            generatedAt: formatDateTimeInTimeZone(now, bookTimeZone),
            coreQuery: queryPlan.coreQuery,
            boundaryQueries: queryPlan.boundaryQueries,
        };
    } catch (err) {
        return {
            status: 'error',
            bookId,
            bookName,
            timeZone,
            error: formatUnknownError(err),
        };
    }
}

export async function countCreatedTransactionBookDetails(
    book: CreatedTransactionsBook,
    now: Date,
    nonTrashedCreatedLastMonth: number,
): Promise<BookTransactionDetails> {
    const bookTimeZone: BookTimeZone = {
        timeZone: book.getTimeZone(),
        offsetMinutes: book.getTimeZoneOffset(),
    };
    const period = getPreviousMonthPeriod(now, bookTimeZone);
    const queryPlan = buildCreatedAtOptimizedQueryPlan(period);
    const trashedCoreQuery = formatTrashedQuery(queryPlan.coreQuery);
    const trashedBoundaryQueries =
        queryPlan.boundaryQueries.map(formatTrashedQuery);
    const [
        nonTrashedTransactions,
        totalTrashedTransactions,
        totalUncheckedTransactions,
        trashedCoreCount,
    ] = await Promise.all([
        book.countTransactions(''),
        book.countTransactions('is:trashed'),
        book.countTransactions('is:unchecked'),
        book.countTransactions(trashedCoreQuery),
    ]);
    const trashedBoundaryTransactions = await listBoundaryTransactions(
        book,
        trashedBoundaryQueries,
    );

    return {
        totalTransactions: normalizeTransactionCount(
            book.getTotalTransactions(),
        ),
        nonTrashedTransactions: normalizeTransactionCount(
            nonTrashedTransactions,
        ),
        totalTrashedTransactions: normalizeTransactionCount(
            totalTrashedTransactions,
        ),
        totalUncheckedTransactions: normalizeTransactionCount(
            totalUncheckedTransactions,
        ),
        nonTrashedCreatedLastMonth,
        trashedCreatedLastMonth:
            normalizeTransactionCount(trashedCoreCount) +
            countTrashedTransactionsCreatedInPreviousMonth(
                trashedBoundaryTransactions.map(toCountableTransaction),
                now,
                bookTimeZone,
            ),
    };
}

async function listBoundaryTransactions(
    book: CreatedTransactionsBook,
    queries: string[],
): Promise<CreatedTransactionsTransaction[]> {
    const transactions: CreatedTransactionsTransaction[] = [];

    for (const query of queries) {
        transactions.push(...(await listAllTransactions(book, query)));
    }

    return transactions;
}

async function listAllTransactions(
    book: CreatedTransactionsBook,
    query: string,
): Promise<CreatedTransactionsTransaction[]> {
    const transactions: CreatedTransactionsTransaction[] = [];
    let cursor: string | undefined;

    do {
        const transactionList = await book.listTransactions(
            query,
            1000,
            cursor,
        );
        transactions.push(...transactionList.getItems());
        cursor = transactionList.getCursor();
    } while (cursor);

    return transactions;
}

function formatTrashedQuery(query: string): string {
    return `is:trashed ${query}`;
}

function toCountableTransaction(
    transaction: CreatedTransactionsTransaction,
): CountableTransaction {
    return {
        createdAt: transaction.getCreatedAt(),
        trashed: transaction.isTrashed() ?? false,
    };
}
