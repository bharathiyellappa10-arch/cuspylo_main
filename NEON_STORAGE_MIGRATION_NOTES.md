# CUSPYLO — Neon PostgreSQL storage migration

## Storage architecture

Neon PostgreSQL is the only persistent application data store. The backend no longer reads or writes `data.json` or `data.backup.json`.

## Routes moved to Neon

- `POST /api/orders`: creates an `orders` row, one `order_items` row per selected FDI tooth, and the initial `order_status_history` row in one transaction.
- `GET /api/my/orders`: reads the signed-in student's orders, line items, and tracking history from Neon.
- `PATCH /api/admin/v2/orders/:invoice/status`: updates the order, appends status history, and records the audit event in one transaction.
- `PATCH /api/admin/v2/orders/:invoice/undo`: removes the latest history event, restores the previous status, and records the audit event in one transaction.
- `GET /api/admin/v2/orders`: filters and reads orders from Neon.
- `POST /api/requests`: writes product requests and image metadata to `product_requests.request_data` (JSONB in PostgreSQL).
- `POST /api/feedback`: writes feedback to `feedback`.
- `GET /api/admin/data`: reads users, orders, requests, and feedback from Neon.
- `GET /api/admin/v2/summary`: calculates order count and revenue from Neon.
- `DELETE /api/admin/v2/users/:id`: anonymizes associated orders, requests, and feedback in Neon and soft-deletes the account transactionally.

JSONB columns are PostgreSQL columns; they are not file-based JSON storage.

## Environment

Keep the existing `.env` outside source control. Required variables include `DATABASE_URL`, `SECRET`, `ADMIN_ID`, and `ADMIN_PASS`. The backend must be deployed with the Neon connection string and the same environment variables already used by the application.

## Important compatibility note

New student login tokens include the PostgreSQL `userId`. Existing tokens issued before this change do not contain that ID; users must sign in again after deployment.

## Validation status

JavaScript syntax checks pass for the modified backend files. A live Neon integration test has not been run from this workspace because no database credentials are included in the uploaded project. Run the app against your configured Neon database and complete the order-flow checks before deploying.
