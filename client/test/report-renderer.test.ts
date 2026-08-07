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
                            totalCreatedLastMonth: 16,
                            activeCreatedLastMonth: 12,
                            trashedCreatedLastMonth: 4,
                            draftCreatedLastMonth: 1,
                            checkedCreatedLastMonth: 9,
                            uncheckedCreatedLastMonth: 2,
                            totalBookTransactions: 120,
                            activeBookTransactions: 100,
                            trashedBookTransactions: 20,
                            draftBookTransactions: 10,
                            checkedBookTransactions: 70,
                            uncheckedBookTransactions: 20,
                        },
                    },
                ],
            ]),
        );

        expect(html).toContain('Hide details');
        expect(html).toContain('Total created last month');
        expect(html).toContain('16');
        expect(html).toContain('Active created last month');
        expect(html).toContain('12');
        expect(html).toContain('Active transactions breakdown');
        expect(html).toContain('Draft created last month');
        expect(html).toContain('1');
        expect(html).toContain('Checked created last month');
        expect(html).toContain('9');
        expect(html).toContain('Unchecked created last month');
        expect(html).toContain('2');
        expect(html).toContain('All-time book totals');
        expect(html).toContain('Total book transactions');
        expect(html).toContain('120');
        expect(html).toContain('Active book transactions');
        expect(html).toContain('100');
        expect(html).toContain('Draft book transactions');
        expect(html).toContain('10');
    });
});
