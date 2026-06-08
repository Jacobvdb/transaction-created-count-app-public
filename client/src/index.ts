import { BkperAuth } from '@bkper/web-auth';
import { Bkper } from 'bkper-js';
import { formatUnknownError } from './created-at-count.js';
import { ReportController, type ReportView } from './report-controller.js';
import {
    renderErrorHtml,
    renderLoadingHtml,
    renderReport,
} from './report-renderer.js';

const isLocalDev =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

let controller: ReportController;

class BrowserReportView implements ReportView {
    constructor(private readonly getController: () => ReportController) {}

    showLoading(message: string): void {
        renderPage(renderLoadingHtml(message));
    }

    showError(message: string): void {
        renderPage(renderErrorHtml(message));
    }

    showReport(controller: ReportController): void {
        const data = controller.getReportData();
        if (!data) {
            return;
        }

        renderPage(renderReport(data, controller.getDetailStates()));
        this.bindReportActions();
    }

    private bindReportActions(): void {
        document
            .getElementById('download-csv-btn')
            ?.addEventListener('click', () => this.downloadBookBreakdownCsv());
        document
            .querySelectorAll<HTMLButtonElement>('.book-detail-toggle')
            .forEach((button) => {
                button.addEventListener('click', () => {
                    const bookId = button.dataset.bookId;
                    if (bookId) {
                        void this.getController().toggleBookDetails(bookId);
                    }
                });
            });
    }

    private downloadBookBreakdownCsv(): void {
        const csv = this.getController().buildCsv();
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'transaction-created-count-book-breakdown.csv';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
    }
}

const browserView = new BrowserReportView(() => controller);

const auth = new BkperAuth({
    baseUrl: isLocalDev ? window.location.origin : undefined,
    onLoginSuccess: () => controller.loadReport(),
    onLoginRequired: () => auth.login(),
    onError: (error) =>
        browserView.showError(`Auth error: ${formatUnknownError(error)}`),
});

controller = new ReportController({
    view: browserView,
    loadBooks: async () => {
        const bkper = new Bkper({
            oauthTokenProvider: async () => auth.getAccessToken(),
        });
        return bkper.getBooks();
    },
});

void auth.init();

function renderPage(content: string): void {
    document.body.innerHTML = `
        <main>
            ${content}
        </main>
    `;
}
