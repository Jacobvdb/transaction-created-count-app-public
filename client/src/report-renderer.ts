import { formatBooksCountedLabel } from './created-at-count.js';
import {
    BOOK_COUNT_CONCURRENCY,
    type BookCountResult,
    type BookTransactionDetails,
} from './created-at-count-service.js';

export interface AggregateReportData {
    totalCount: number;
    booksTotal: number;
    booksCounted: number;
    generatedAt: string;
    results: BookCountResult[];
}

export interface LoadedBookDetailState {
    status: 'loaded';
    details: BookTransactionDetails;
}

export interface LoadingBookDetailState {
    status: 'loading';
}

export interface FailedBookDetailState {
    status: 'error';
    error: string;
}

export type BookDetailState =
    | LoadedBookDetailState
    | LoadingBookDetailState
    | FailedBookDetailState;

export type BookDetailStates = ReadonlyMap<string, BookDetailState>;

export function renderLoadingHtml(message = 'Loading...'): string {
    return `
        <section class="card centered">
            <div class="spinner" aria-hidden="true"></div>
            <p>${escapeHtml(message)}</p>
        </section>
    `;
}

export function renderErrorHtml(message: string): string {
    return `
        <section class="card error">
            <h1>Unable to count transactions</h1>
            <p>${escapeHtml(message)}</p>
        </section>
    `;
}

export function renderReport(
    data: AggregateReportData,
    detailStates: BookDetailStates,
): string {
    return `
        <section class="card report-card">
            <p class="eyebrow">${escapeHtml(formatBooksCountedLabel(data.booksCounted, data.booksTotal))}</p>
            <h1>${data.totalCount.toLocaleString()}</h1>
            <p class="subtitle">non-trashed transactions created last month</p>

            <dl class="details summary-grid">
                <div>
                    <dt>Generated at</dt>
                    <dd>${escapeHtml(data.generatedAt)}</dd>
                </div>
            </dl>

            ${renderBookBreakdown(data.results, detailStates)}

            <details>
                <summary>Technical method</summary>
                <p>
                    Each book is counted in its own timezone. The safe middle of the month is
                    counted with the API count endpoint. Only the UTC boundary windows are fetched
                    and verified transaction-by-transaction by converting createdAt into the book timezone.
                </p>
                <p>Book processing is limited to ${BOOK_COUNT_CONCURRENCY} concurrent books.</p>
            </details>
        </section>
    `;
}

function renderBookBreakdown(
    results: BookCountResult[],
    detailStates: BookDetailStates,
): string {
    if (results.length === 0) {
        return '';
    }

    return `
        <section class="breakdown">
            <div class="breakdown-header">
                <h2>Book breakdown</h2>
                <button id="download-csv-btn" class="secondary" type="button">Download CSV</button>
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Book</th>
                            <th>Timezone</th>
                            <th>Period</th>
                            <th class="number">Count</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${results.map((result) => renderBookRow(result, detailStates)).join('')}
                    </tbody>
                </table>
            </div>
        </section>
    `;
}

function renderBookRow(
    result: BookCountResult,
    detailStates: BookDetailStates,
): string {
    if (result.status === 'error') {
        return `
            <tr class="row-error">
                <td>${escapeHtml(result.bookName)}</td>
                <td>${escapeHtml(result.timeZone)}</td>
                <td title="${escapeHtml(result.error)}">—</td>
                <td class="number">—</td>
            </tr>
        `;
    }

    const detailState = detailStates.get(result.bookId);
    const expanded = detailState !== undefined;
    const toggleLabel = expanded ? 'Hide details' : 'Show details';

    return `
        <tr>
            <td>
                <button class="link-button book-detail-toggle" type="button" data-book-id="${escapeHtml(result.bookId)}" aria-expanded="${expanded}">
                    ${escapeHtml(result.bookName)}
                </button>
                <span class="row-action">${toggleLabel}</span>
            </td>
            <td>${escapeHtml(result.timeZone)}</td>
            <td>${escapeHtml(result.periodLabel)}</td>
            <td class="number">${result.count.toLocaleString()}</td>
        </tr>
        ${expanded ? renderBookDetailRow(detailState) : ''}
    `;
}

function renderBookDetailRow(detailState: BookDetailState): string {
    if (detailState.status === 'loading') {
        return `
            <tr class="detail-row">
                <td colspan="4">Loading book details...</td>
            </tr>
        `;
    }

    if (detailState.status === 'error') {
        return `
            <tr class="detail-row row-error">
                <td colspan="4">${escapeHtml(detailState.error)}</td>
            </tr>
        `;
    }

    return `
        <tr class="detail-row">
            <td colspan="4">
                <dl class="detail-grid">
                    ${renderDetailMetric('Total transactions', detailState.details.totalTransactions, 'Includes trashed transactions')}
                    ${renderDetailMetric('Non-trashed transactions', detailState.details.nonTrashedTransactions)}
                    ${renderDetailMetric('Total unchecked transactions', detailState.details.totalUncheckedTransactions)}
                    ${renderDetailMetric('Total trashed transactions', detailState.details.totalTrashedTransactions)}
                    ${renderDetailMetric('Non-trashed created last month', detailState.details.nonTrashedCreatedLastMonth)}
                    ${renderDetailMetric('Trashed created last month', detailState.details.trashedCreatedLastMonth)}
                </dl>
            </td>
        </tr>
    `;
}

function renderDetailMetric(
    label: string,
    value: number,
    note?: string,
): string {
    return `
        <div class="detail-metric">
            <dt>${escapeHtml(label)}</dt>
            <dd>${value.toLocaleString()}</dd>
            ${note ? `<p>${escapeHtml(note)}</p>` : ''}
        </div>
    `;
}

function escapeHtml(text: string): string {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
