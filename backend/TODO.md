# Database Integration To-Do

The database schema, API, and migration scripts are in this `backend/` folder. This list tracks the remaining work to complete the database integration.

## Database-backed workflows

- [ ] Move System Owner announcements and flyer/image management from `localStorage` to authenticated API endpoints and the announcements table.
- [ ] Move custom roles, permission assignments, and user-role management to API endpoints with server-enforced authorization.
- [ ] Move support ticket creation, replies, status changes, and deletion to API endpoints and the support-ticket tables.
- [ ] Connect system reports, payment workflows, audit logs, and departmental account management to their database tables and authorized APIs.
- [ ] Replace the compatibility `school_records` JSONB workflow with normalized school and academic data APIs where appropriate.

## Migration and validation

- [ ] If XAMPP/MariaDB is the deployment target, migrate the Node API from PostgreSQL to MariaDB, replace PostgreSQL-specific SQL/security behavior, and test the full application against `KIMS_db`.
- [ ] Define and test a safe import path for existing browser-stored data; never import plaintext passwords.
- [ ] Run migrations against a fresh PostgreSQL instance and verify the runtime database role has only the required privileges.
- [ ] Test tenant isolation and System Owner access for each database-backed workflow.
- [ ] Add and run API integration tests for registration, authentication, credential changes, school records, announcements, roles, tickets, reports, and payments.
- [ ] Document and verify backup restoration and production deployment procedures.
