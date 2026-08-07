import {
    buildCreatedAtOptimizedQueryPlan,
    countOptimizedCreatedTransactions,
    countTransactionsCreatedInPreviousMonthByStatus,
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
    isPosted?(): boolean | undefined;
    isChecked?(): boolean | undefined;
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
    totalCreatedLastMonth: number;
    activeCreatedLastMonth: number;
    trashedCreatedLastMonth: number;
    draftCreatedLastMonth: number;
    checkedCreatedLastMonth: number;
    uncheckedCreatedLastMonth: number;
    totalBookTransactions: number;
    activeBookTransactions: number;
    trashedBookTransactions: number;
    draftBookTransactions: number;
    checkedBookTransactions: number;
    uncheckedBookTransactions: number;
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
): Promise<BookTransactionDetails> {
    const bookTimeZone: BookTimeZone = {
        timeZone: book.getTimeZone(),
        offsetMinutes: book.getTimeZoneOffset(),
    };
    const period = getPreviousMonthPeriod(now, bookTimeZone);
    const queryPlan = buildCreatedAtOptimizedQueryPlan(period);

    const draftCoreQuery = formatStatusQuery('is:draft', queryPlan.coreQuery);
    const checkedCoreQuery = formatStatusQuery(
        'is:checked',
        queryPlan.coreQuery,
    );
    const uncheckedCoreQuery = formatStatusQuery(
        'is:unchecked',
        queryPlan.coreQuery,
    );
    const trashedCoreQuery = formatStatusQuery(
        'is:trashed',
        queryPlan.coreQuery,
    );
    const trashedBoundaryQueries = queryPlan.boundaryQueries.map((query) =>
        formatStatusQuery('is:trashed', query),
    );

    const [
        draftCoreCount,
        checkedCoreCount,
        uncheckedCoreCount,
        trashedCoreCount,
        activeBookCount,
        trashedBookCount,
        draftBookCount,
        checkedBookCount,
        uncheckedBookCount,
    ] = await Promise.all([
        book.countTransactions(draftCoreQuery),
        book.countTransactions(checkedCoreQuery),
        book.countTransactions(uncheckedCoreQuery),
        book.countTransactions(trashedCoreQuery),
        book.countTransactions(''),
        book.countTransactions('is:trashed'),
        book.countTransactions('is:draft'),
        book.countTransactions('is:checked'),
        book.countTransactions('is:unchecked'),
    ]);

    const [boundaryTransactions, trashedBoundaryTransactions] =
        await Promise.all([
            listBoundaryTransactions(book, queryPlan.boundaryQueries),
            listBoundaryTransactions(book, trashedBoundaryQueries),
        ]);

    const countableBoundaryTransactions =
        boundaryTransactions.map(toCountableTransaction);
    const countableTrashedBoundaryTransactions =
        trashedBoundaryTransactions.map(toCountableTransaction);

    const draftBoundaryCount = countTransactionsCreatedInPreviousMonthByStatus(
        countableBoundaryTransactions,
        now,
        bookTimeZone,
        'draft',
    );
    const checkedBoundaryCount =
        countTransactionsCreatedInPreviousMonthByStatus(
            countableBoundaryTransactions,
            now,
            bookTimeZone,
            'checked',
        );
    const uncheckedBoundaryCount =
        countTransactionsCreatedInPreviousMonthByStatus(
            countableBoundaryTransactions,
            now,
            bookTimeZone,
            'unchecked',
        );
    const trashedBoundaryCount =
        countTransactionsCreatedInPreviousMonthByStatus(
            countableTrashedBoundaryTransactions,
            now,
            bookTimeZone,
            'trashed',
        );

    const draftCreatedLastMonth =
        normalizeTransactionCount(draftCoreCount) + draftBoundaryCount;
    const checkedCreatedLastMonth =
        normalizeTransactionCount(checkedCoreCount) + checkedBoundaryCount;
    const uncheckedCreatedLastMonth =
        normalizeTransactionCount(uncheckedCoreCount) + uncheckedBoundaryCount;
    const activeCreatedLastMonth =
        draftCreatedLastMonth +
        checkedCreatedLastMonth +
        uncheckedCreatedLastMonth;
    const trashedCreatedLastMonth =
        normalizeTransactionCount(trashedCoreCount) + trashedBoundaryCount;
    const totalCreatedLastMonth =
        activeCreatedLastMonth + trashedCreatedLastMonth;

    const activeBookTransactions = normalizeTransactionCount(activeBookCount);
    const trashedBookTransactions = normalizeTransactionCount(trashedBookCount);
    const totalBookTransactions =
        activeBookTransactions + trashedBookTransactions;
    const draftBookTransactions = normalizeTransactionCount(draftBookCount);
    const checkedBookTransactions = normalizeTransactionCount(checkedBookCount);
    const uncheckedBookTransactions =
        normalizeTransactionCount(uncheckedBookCount);

    return {
        totalCreatedLastMonth,
        activeCreatedLastMonth,
        trashedCreatedLastMonth,
        draftCreatedLastMonth,
        checkedCreatedLastMonth,
        uncheckedCreatedLastMonth,
        totalBookTransactions,
        activeBookTransactions,
        trashedBookTransactions,
        draftBookTransactions,
        checkedBookTransactions,
        uncheckedBookTransactions,
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

function formatStatusQuery(status: string, query: string): string {
    return `${status} ${query}`;
}

function toCountableTransaction(
    transaction: CreatedTransactionsTransaction,
): CountableTransaction {
    return {
        createdAt: transaction.getCreatedAt(),
        trashed: transaction.isTrashed() ?? false,
        posted: transaction.isPosted?.() ?? true,
        checked: transaction.isChecked?.() ?? false,
    };
}
