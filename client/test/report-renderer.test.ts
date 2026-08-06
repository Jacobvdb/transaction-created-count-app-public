import { describe, expect, test } from 'bun:test';
import {
    renderReport,
    type AggregateReportData,
} from '../src/report-renderer.js';

function createReportData(): AggregateReportData {
    return {
        totalCount: 12,
        booksTotal: 1,
        booksCounted: 1,
        generatedAt: '2026-05-05T12:00:00.000Z',
        results: [
            {
                status: 'ok',
                bookId: 'book-1',
                bookName: 'Main <Book>',
                timeZone: 'UTC',
                periodLabel: 'April 2026',
                count: 12,
                coreCount: 10,
                boundaryFetchedCount: 2,
                generatedAt: '2026-05-05 12:00:00',
                coreQuery: 'core',
                boundaryQueries: [],
            },
        ],
    };
}

describe('report renderer', () => {
    test('escapes dynamic values and renders collapsed book rows', () => {
        const html = renderReport(createReportData(), new Map());

        expect(html).toContain('Main &lt;Book&gt;');
        expect(html).toContain('Show details');
        expect(html).toContain('data-book-id="book-1"');
        expect(html).not.toContain('Main <Book>');
    });

    test('renders loaded inline book details', () => {
        const html = renderReport(
            createReportData(),
            new Map([
                [
                    'book-1',
                    {
                        status: 'loaded',
                        details: {
                            totalTransactions: 30,
                            nonTrashedTransactions: 25,
                            totalTrashedTransactions: 5,
                            totalUncheckedTransactions: 10,
                            nonTrashedCreatedLastMonth: 12,
                            trashedCreatedLastMonth: 4,
                        },
                    },
                ],
            ]),
        );

        expect(html).toContain('Hide details');
        expect(html).toContain('Total transactions');
        expect(html).toContain('30');
        expect(html).toContain('Total unchecked transactions');
        expect(html).toContain('10');
        expect(html).toContain('Trashed created last month');
        expect(html).toContain('4');
    });
});
