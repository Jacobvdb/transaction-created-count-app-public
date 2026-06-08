export interface CountableTransaction {
    createdAt: Date;
    trashed: boolean;
}

export interface PreviousMonthPeriod {
    year: number;
    month: number;
    label: string;
}

export interface BookTimeZone {
    timeZone?: string;
    offsetMinutes?: number;
}

export interface BookCountCsvRow {
    bookId: string;
    bookName: string;
    timeZone: string;
    periodLabel?: string;
    count?: number;
    status: string;
}

export interface CreatedAtOptimizedQueryPlan {
    startBoundaryQuery: string;
    coreQuery: string;
    endBoundaryQuery: string;
    boundaryQueries: string[];
}

export type TransactionCountValue = number | string | null | undefined;

export interface OptimizedCreatedAtCountInput {
    coreCount: TransactionCountValue;
    boundaryTransactions: CountableTransaction[];
    now: Date;
    timeZoneInput: TimeZoneInput;
}

export type TimeZoneInput = string | BookTimeZone;

interface IanaTimeZone {
    type: 'iana';
    timeZone: string;
    label: string;
}

interface FixedOffsetTimeZone {
    type: 'fixed-offset';
    offsetMinutes: number;
    label: string;
}

type ResolvedTimeZone = IanaTimeZone | FixedOffsetTimeZone;

export function getPreviousMonthPeriod(
    now: Date,
    timeZoneInput: TimeZoneInput,
): PreviousMonthPeriod {
    const resolvedTimeZone = resolveTimeZone(timeZoneInput);
    const nowParts = getDatePartsInTimeZone(now, resolvedTimeZone);
    const previousMonthDate = new Date(
        Date.UTC(nowParts.year, nowParts.month - 2, 1),
    );
    const previousMonthParts = getUtcDateParts(previousMonthDate);

    return {
        ...previousMonthParts,
        label: formatMonthLabel(
            previousMonthParts.year,
            previousMonthParts.month,
            resolvedTimeZone,
        ),
    };
}

export function countTransactionsCreatedInPreviousMonth(
    transactions: CountableTransaction[],
    now: Date,
    timeZoneInput: TimeZoneInput,
): number {
    return countTransactionsCreatedInPreviousMonthByPredicate(
        transactions,
        now,
        timeZoneInput,
        (transaction) => !transaction.trashed,
    );
}

export function countTrashedTransactionsCreatedInPreviousMonth(
    transactions: CountableTransaction[],
    now: Date,
    timeZoneInput: TimeZoneInput,
): number {
    return countTransactionsCreatedInPreviousMonthByPredicate(
        transactions,
        now,
        timeZoneInput,
        (transaction) => transaction.trashed,
    );
}

function countTransactionsCreatedInPreviousMonthByPredicate(
    transactions: CountableTransaction[],
    now: Date,
    timeZoneInput: TimeZoneInput,
    predicate: (transaction: CountableTransaction) => boolean,
): number {
    const resolvedTimeZone = resolveTimeZone(timeZoneInput);
    const period = getPreviousMonthPeriod(now, resolvedTimeZone);

    return transactions.filter((transaction) => {
        if (!predicate(transaction)) {
            return false;
        }

        const createdAtParts = getDatePartsInTimeZone(
            transaction.createdAt,
            resolvedTimeZone,
        );
        return (
            createdAtParts.year === period.year &&
            createdAtParts.month === period.month
        );
    }).length;
}

export function buildCreatedAtOptimizedQueryPlan(
    period: PreviousMonthPeriod,
): CreatedAtOptimizedQueryPlan {
    const utcMonthStart = new Date(Date.UTC(period.year, period.month - 1, 1));
    const utcNextMonthStart = new Date(Date.UTC(period.year, period.month, 1));
    const safeStart = addUtcDays(utcMonthStart, -2);
    const safeEnd = addUtcDays(utcNextMonthStart, 2);
    const coreStart = addUtcDays(utcMonthStart, 1);
    const coreEnd = addUtcDays(utcNextMonthStart, -1);
    const startBoundaryQuery = formatCreatedAtQuery(safeStart, coreStart);
    const coreQuery = formatCreatedAtQuery(coreStart, coreEnd);
    const endBoundaryQuery = formatCreatedAtQuery(coreEnd, safeEnd);

    return {
        startBoundaryQuery,
        coreQuery,
        endBoundaryQuery,
        boundaryQueries: [startBoundaryQuery, endBoundaryQuery],
    };
}

export function countOptimizedCreatedTransactions(
    input: OptimizedCreatedAtCountInput,
): number {
    return (
        normalizeTransactionCount(input.coreCount) +
        countTransactionsCreatedInPreviousMonth(
            input.boundaryTransactions,
            input.now,
            input.timeZoneInput,
        )
    );
}

export function normalizeTransactionCount(
    value: TransactionCountValue,
): number {
    if (value === null || value === undefined) {
        return 0;
    }

    const parsedValue = typeof value === 'number' ? value : Number(value);

    if (!Number.isFinite(parsedValue)) {
        throw new Error(`Invalid transaction count: ${value}`);
    }

    return parsedValue;
}

export function formatBooksCountedLabel(
    booksCounted: number,
    booksTotal: number,
): string {
    if (booksCounted === booksTotal) {
        return `${booksCounted.toLocaleString()} ${booksCounted === 1 ? 'book' : 'books'} counted`;
    }

    return `${booksCounted.toLocaleString()} of ${booksTotal.toLocaleString()} books counted`;
}

export function buildBookCountCsv(rows: BookCountCsvRow[]): string {
    const header = ['Book ID', 'Book', 'Timezone', 'Period', 'Count', 'Status'];
    const csvRows = rows.map((row) => [
        row.bookId,
        row.bookName,
        row.timeZone,
        row.periodLabel ?? '',
        row.count === undefined ? '' : row.count.toString(),
        row.status,
    ]);

    return [header, ...csvRows]
        .map((row) => row.map(formatCsvValue).join(','))
        .join('\r\n');
}

export async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>,
    onProgress?: (completed: number, total: number) => void,
): Promise<R[]> {
    if (items.length === 0) {
        return [];
    }

    const normalizedConcurrency = Number.isFinite(concurrency)
        ? Math.max(1, Math.floor(concurrency))
        : 1;
    const workerCount = Math.min(normalizedConcurrency, items.length);
    const results: R[] = new Array<R>(items.length);
    let nextIndex = 0;
    let completed = 0;

    async function runWorker(): Promise<void> {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await worker(
                items[currentIndex],
                currentIndex,
            );
            completed += 1;
            onProgress?.(completed, items.length);
        }
    }

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    return results;
}

export function formatDateTimeInTimeZone(
    date: Date,
    timeZoneInput: TimeZoneInput,
): string {
    const resolvedTimeZone = resolveTimeZone(timeZoneInput);

    if (resolvedTimeZone.type === 'fixed-offset') {
        const shiftedDate = shiftUtcDateByOffset(
            date,
            resolvedTimeZone.offsetMinutes,
        );
        return `${shiftedDate.getUTCFullYear()}-${pad2(shiftedDate.getUTCMonth() + 1)}-${pad2(shiftedDate.getUTCDate())} ${pad2(shiftedDate.getUTCHours())}:${pad2(shiftedDate.getUTCMinutes())}:${pad2(shiftedDate.getUTCSeconds())}`;
    }

    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: resolvedTimeZone.timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(date);

    const partMap = buildPartMap(parts);
    return `${partMap.year}-${partMap.month}-${partMap.day} ${partMap.hour}:${partMap.minute}:${partMap.second}`;
}

export function getTimeZoneLabel(timeZoneInput: TimeZoneInput): string {
    return resolveTimeZone(timeZoneInput).label;
}

export function formatUnknownError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

interface DateParts {
    year: number;
    month: number;
    day: number;
}

function resolveTimeZone(timeZoneInput: TimeZoneInput): ResolvedTimeZone {
    if (typeof timeZoneInput === 'string') {
        return resolveTimeZoneFromParts(timeZoneInput, undefined);
    }

    return resolveTimeZoneFromParts(
        timeZoneInput.timeZone,
        timeZoneInput.offsetMinutes,
    );
}

function resolveTimeZoneFromParts(
    timeZone: string | undefined,
    offsetMinutes: number | undefined,
): ResolvedTimeZone {
    if (timeZone) {
        if (isValidIanaTimeZone(timeZone)) {
            return {
                type: 'iana',
                timeZone,
                label: timeZone,
            };
        }

        const parsedOffsetMinutes = parseFixedOffsetMinutes(timeZone);
        if (parsedOffsetMinutes !== undefined) {
            return {
                type: 'fixed-offset',
                offsetMinutes: parsedOffsetMinutes,
                label: formatOffsetLabel(parsedOffsetMinutes),
            };
        }
    }

    if (offsetMinutes !== undefined) {
        return {
            type: 'fixed-offset',
            offsetMinutes,
            label: formatOffsetLabel(offsetMinutes),
        };
    }

    return {
        type: 'iana',
        timeZone: 'UTC',
        label: 'UTC',
    };
}

function isValidIanaTimeZone(timeZone: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
        return true;
    } catch (_error) {
        return false;
    }
}

function parseFixedOffsetMinutes(timeZone: string): number | undefined {
    const normalizedTimeZone = timeZone.trim().toUpperCase();

    if (normalizedTimeZone === 'UTC' || normalizedTimeZone === 'GMT') {
        return 0;
    }

    const match = normalizedTimeZone.match(
        /^(?:UTC|GMT)([+-])(\d{1,2})(?::?(\d{2}))?$/,
    );
    if (!match) {
        return undefined;
    }

    const [, sign, hoursText, minutesText] = match;
    const hours = Number(hoursText);
    const minutes = minutesText ? Number(minutesText) : 0;

    if (hours > 23 || minutes > 59) {
        return undefined;
    }

    const offsetMinutes = hours * 60 + minutes;
    return sign === '-' ? -offsetMinutes : offsetMinutes;
}

function getDatePartsInTimeZone(
    date: Date,
    timeZone: ResolvedTimeZone,
): DateParts {
    if (timeZone.type === 'fixed-offset') {
        return getUtcDateParts(
            shiftUtcDateByOffset(date, timeZone.offsetMinutes),
        );
    }

    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timeZone.timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const partMap = buildPartMap(parts);

    return {
        year: Number(partMap.year),
        month: Number(partMap.month),
        day: Number(partMap.day),
    };
}

function getUtcDateParts(date: Date): DateParts {
    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
    };
}

function formatMonthLabel(
    year: number,
    month: number,
    timeZone: ResolvedTimeZone,
): string {
    const date = new Date(Date.UTC(year, month - 1, 15));
    const formatterTimeZone =
        timeZone.type === 'iana' ? timeZone.timeZone : 'UTC';

    return new Intl.DateTimeFormat('en-US', {
        timeZone: formatterTimeZone,
        year: 'numeric',
        month: 'long',
    }).format(date);
}

function shiftUtcDateByOffset(date: Date, offsetMinutes: number): Date {
    return new Date(date.getTime() + offsetMinutes * 60_000);
}

function addUtcDays(date: Date, days: number): Date {
    const nextDate = new Date(date.getTime());
    nextDate.setUTCDate(nextDate.getUTCDate() + days);
    return nextDate;
}

function formatIsoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function formatCreatedAtQuery(start: Date, end: Date): string {
    return `after:${formatIsoDate(start)} before:${formatIsoDate(end)} using:createdAt`;
}

function formatCsvValue(value: string): string {
    if (!/[",\r\n]/.test(value)) {
        return value;
    }

    return `"${value.replaceAll('"', '""')}"`;
}

function formatOffsetLabel(offsetMinutes: number): string {
    if (offsetMinutes === 0) {
        return 'UTC';
    }

    const sign = offsetMinutes < 0 ? '-' : '+';
    const absoluteOffsetMinutes = Math.abs(offsetMinutes);
    const hours = Math.floor(absoluteOffsetMinutes / 60);
    const minutes = absoluteOffsetMinutes % 60;
    return `UTC${sign}${pad2(hours)}:${pad2(minutes)}`;
}

function pad2(value: number): string {
    return value.toString().padStart(2, '0');
}

function buildPartMap(
    parts: Intl.DateTimeFormatPart[],
): Record<string, string> {
    return parts.reduce<Record<string, string>>((partMap, part) => {
        if (part.type !== 'literal') {
            partMap[part.type] = part.value;
        }
        return partMap;
    }, {});
}
