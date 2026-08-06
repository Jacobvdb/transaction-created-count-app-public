import {
    buildBookCountCsv,
    formatUnknownError,
    type BookCountCsvRow,
} from './created-at-count.js';
import {
    countCreatedTransactionBookDetails,
    countCreatedTransactionsForBooks,
    isSuccessfulBookCountResult,
    sortBookCountResults,
    type BookCountResult,
    type BookTransactionDetails,
    type CreatedTransactionsBook,
} from './created-at-count-service.js';
import type {
    AggregateReportData,
    BookDetailState,
    BookDetailStates,
} from './report-renderer.js';

export interface ReportView {
    showLoading(message: string): void;
    showError(message: string): void;
    showReport(controller: ReportController): void;
}

export interface CountBooksProgress {
    completed: number;
    total: number;
}

export interface ReportControllerOptions {
    view: ReportView;
    loadBooks: () => Promise<CreatedTransactionsBook[]>;
    countBooks?: (
        books: CreatedTransactionsBook[],
        now: Date,
        onProgress?: (completed: number, total: number) => void,
    ) => Promise<BookCountResult[]>;
    countBookDetails?: (
        book: CreatedTransactionsBook,
        now: Date,
    ) => Promise<BookTransactionDetails>;
    getNow?: () => Date;
}

export class ReportController {
    private readonly view: ReportView;
    private readonly loadBooks: () => Promise<CreatedTransactionsBook[]>;
    private readonly countBooks: NonNullable<
        ReportControllerOptions['countBooks']
    >;
    private readonly countBookDetails: NonNullable<
        ReportControllerOptions['countBookDetails']
    >;
    private readonly getNow: () => Date;
    private readonly booksById = new Map<string, CreatedTransactionsBook>();
    private readonly detailStates = new Map<string, BookDetailState>();
    private reportData: AggregateReportData | undefined;
    private reportNow: Date | undefined;

    constructor(options: ReportControllerOptions) {
        this.view = options.view;
        this.loadBooks = options.loadBooks;
        this.countBooks =
            options.countBooks ?? countCreatedTransactionsForBooks;
        this.countBookDetails =
            options.countBookDetails ?? countCreatedTransactionBookDetails;
        this.getNow = options.getNow ?? (() => new Date());
    }

    getReportData(): AggregateReportData | undefined {
        return this.reportData;
    }

    getDetailStates(): BookDetailStates {
        return this.detailStates;
    }

    getDetailState(bookId: string): BookDetailState | undefined {
        return this.detailStates.get(bookId);
    }

    buildCsv(): string {
        return buildBookCountCsv(this.getCsvRows());
    }

    async loadReport(): Promise<void> {
        this.view.showLoading('Loading your books...');

        try {
            const books = await this.loadBooks();
            const now = this.getNow();
            this.booksById.clear();
            this.detailStates.clear();
            for (const book of books) {
                this.booksById.set(book.getId(), book);
            }

            if (books.length === 0) {
                this.setReportData(
                    {
                        totalCount: 0,
                        booksTotal: 0,
                        booksCounted: 0,
                        generatedAt: now.toISOString(),
                        results: [],
                    },
                    now,
                );
                return;
            }

            this.view.showLoading(
                `Counting transactions created last month across ${books.length} books...`,
            );

            const results = await this.countBooks(
                books,
                now,
                (completed, total) => {
                    this.view.showLoading(
                        `Counting transactions created last month... ${completed}/${total} books`,
                    );
                },
            );
            const sortedResults = sortBookCountResults(results);
            const successfulResults = sortedResults.filter(
                isSuccessfulBookCountResult,
            );
            const totalCount = successfulResults.reduce(
                (sum, result) => sum + result.count,
                0,
            );

            this.setReportData(
                {
                    totalCount,
                    booksTotal: books.length,
                    booksCounted: successfulResults.length,
                    generatedAt: now.toISOString(),
                    results: sortedResults,
                },
                now,
            );
        } catch (error) {
            this.view.showError(formatUnknownError(error));
        }
    }

    async toggleBookDetails(bookId: string): Promise<void> {
        const existingState = this.detailStates.get(bookId);
        if (existingState) {
            this.detailStates.delete(bookId);
            this.renderReport();
            return;
        }

        const book = this.booksById.get(bookId);
        const report = this.reportData;
        const now = this.reportNow;
        const result = report?.results.find(
            (candidate) => candidate.bookId === bookId,
        );

        if (!book || !report || !now || !result || result.status !== 'ok') {
            return;
        }

        this.detailStates.set(bookId, { status: 'loading' });
        this.renderReport();

        try {
            const details = await this.countBookDetails(book, now);

            if (this.detailStates.get(bookId)?.status === 'loading') {
                this.detailStates.set(bookId, { status: 'loaded', details });
                this.renderReport();
            }
        } catch (error) {
            if (this.detailStates.get(bookId)?.status === 'loading') {
                this.detailStates.set(bookId, {
                    status: 'error',
                    error: formatUnknownError(error),
                });
                this.renderReport();
            }
        }
    }

    private setReportData(data: AggregateReportData, now: Date): void {
        this.reportData = data;
        this.reportNow = now;
        this.renderReport();
    }

    private renderReport(): void {
        if (this.reportData) {
            this.view.showReport(this);
        }
    }

    private getCsvRows(): BookCountCsvRow[] {
        return (this.reportData?.results ?? []).map((result) => {
            if (result.status === 'error') {
                return {
                    bookId: result.bookId,
                    bookName: result.bookName,
                    timeZone: result.timeZone,
                    status: result.error,
                };
            }

            return {
                bookId: result.bookId,
                bookName: result.bookName,
                timeZone: result.timeZone,
                periodLabel: result.periodLabel,
                count: result.count,
                status: 'Counted',
            };
        });
    }
}
