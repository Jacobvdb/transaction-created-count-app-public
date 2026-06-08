# Transaction Created Count

Transaction Created Count shows how many non-trashed transactions were created during the previous completed calendar month across all Bkper books the signed-in user can access.

The app is read-only. It reads book and transaction information to build the report, but it does not create, update, delete, check, uncheck, or trash anything in your books.

The count uses each book's timezone. For example, if a book timezone is GMT-3 and a transaction was created at `2026-05-01 00:45:00 UTC`, the app counts it as `2026-04-30 21:45:00` in that book timezone, so it belongs to April for that book.

## How to use

1. Install the app on a Bkper book.
2. Open the book.
3. Choose **Count created transactions** from the book menu.
4. The popup counts the previous completed calendar month across all books you can access.

## What you see

- A total count of non-trashed transactions created in the previous completed calendar month.
- How many books were counted. If a book cannot be counted, it is shown in the breakdown and excluded from the total.
- A per-book breakdown with book name, timezone, period, and count.
- A **Download CSV** button for the per-book breakdown.
- Expandable book details with total transactions, non-trashed transactions, trashed transactions, non-trashed created last month, and trashed created last month.

## What is counted

- Draft, unchecked, and checked transactions are included when they are not trashed.
- Trashed transactions are excluded from the main count.
- The transaction `createdAt` instant is converted to the relevant book timezone before deciding whether it belongs to the previous completed calendar month.

## Technical method

To avoid overloading accounts with many books and many transactions, the app counts the safe middle of the month with the Bkper API count endpoint and only fetches transactions near UTC month boundaries for timezone verification. Books are processed with limited concurrency.
