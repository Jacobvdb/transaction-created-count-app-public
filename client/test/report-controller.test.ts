import { describe, expect, test } from 'bun:test';
import { ReportController, type ReportView } from '../src/report-controller.js';
import type {
    BookCountResult,
    BookTransactionDetails,
    CreatedTransactionsBook,
} from '../src/created-at-count-service.js';

class FakeBook implements CreatedTransactionsBook {
    constructor(
        private readonly id: string,
        private readonly name: string,
    ) {}

    getId(): string {
        return this.id;
    }

    getName(): string {
        return this.name;
    }

    getTimeZone(): string {
        return 'UTC';
    }

    getTimeZoneOffset(): number {
        return 0;
    }

    getTotalTransactions(): number {
        return 0;
    }

    async countTransactions(): Promise<number> {
        return 0;
    }

    async listTransactions() {
        return {
            getItems: () => [],
            getCursor: () => undefined,
        };
    }
}

class FakeView implements ReportView {
    readonly loadingMessages: string[] = [];
    readonly errorMessages: string[] = [];
    readonly reportSnapshots: string[] = [];

    showLoading(message: string): void {
        this.loadingMessages.push(message);
    }

    showError(message: string): void {
        this.errorMessages.push(message);
    }

    showReport(_controller: ReportController): void {
        this.reportSnapshots.push(
            _controller.getDetailState('book-1')?.status ?? 'collapsed',
        );
    }
}

function createBookCountResult(): BookCountResult {
    return {
        status: 'ok',
        bookId: 'book-1',
        bookName: 'Main Book',
        timeZone: 'UTC',
        periodLabel: 'April 2026',
        count: 7,
        coreCount: 7,
        boundaryFetchedCount: 0,
        generatedAt: '2026-05-05 12:00:00',
        coreQuery: 'core',
        boundaryQueries: [],
    };
}

function createDetails(): BookTransactionDetails {
    return {
        totalTransactions: 10,
        nonTrashedTransactions: 8,
        totalTrashedTransactions: 2,
        nonTrashedCreatedLastMonth: 7,
        trashedCreatedLastMonth: 1,
    };
}

describe('report controller', () => {
    test('loads, expands, and collapses book details', async () => {
        const view = new FakeView();
        const controller = new ReportController({
            view,
            loadBooks: async () => [new FakeBook('book-1', 'Main Book')],
            countBooks: async () => [createBookCountResult()],
            countBookDetails: async () => createDetails(),
            getNow: () => new Date('2026-05-05T12:00:00.000Z'),
        });

        await controller.loadReport();
        await controller.toggleBookDetails('book-1');
        await controller.toggleBookDetails('book-1');

        expect(view.loadingMessages).toContain('Loading your books...');
        expect(controller.getReportData()?.totalCount).toBe(7);
        expect(view.reportSnapshots).toEqual([
            'collapsed',
            'loading',
            'loaded',
            'collapsed',
        ]);
    });
});
