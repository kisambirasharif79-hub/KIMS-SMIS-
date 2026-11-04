# KIMS SMIS

KIMS now has a PostgreSQL-backed Node.js service for authentication, school registration, and the school registry. The browser app must be served by that service; opening the HTML files directly or using a static-only web server will not provide database access.

## Local setup

Requirements: Node.js 20+, npm, and Docker Desktop with Docker Compose.

1. Copy `.env.example` to `.env`.
2. Set unique, strong values for `POSTGRES_PASSWORD`, `KIMS_APP_PASSWORD`, and `OWNER_PASSWORD`. Use the same values in the matching database URLs.
3. Start PostgreSQL:

   ```powershell
   docker compose up -d --wait db
   ```

4. Install dependencies and initialize the schema:

   ```powershell
   npm install
   npm run db:migrate
   ```

5. Create the first System Owner using the username and password from `.env`:

   ```powershell
   npm run owner:create
   ```

   Owner creation refuses to add another owner if one already exists.

6. Start the app and open `http://localhost:3000`:

   ```powershell
   npm start
   ```

The app and `/api` endpoints share the same origin. Do not expose PostgreSQL's port to the public internet.

Schools without a KIMS account can choose **Register Your School** on the login page, enter their school details and choose their initial school login username and password. Registration is public and does not require a System Owner to create the account first. Usernames must be unique across KIMS. The first time the school signs in with those registration credentials, it is prompted to create the School Administrator username and password. The administrator is then signed in automatically and taken to the dashboard. Other department logins remain suspended until credentials are set by the System Owner.

## System Owner school and login management

In the owner dashboard, open **School Management** and choose **Manage Logins** for a school. The owner can set a new username and password for its registered School Account / Admin login or a department login. The reset form asks for the selected account's current username, a new username, and a new password with confirmation; it does not ask for a current password. Newly created department logins are suspended until the owner sets their credentials; saving a reset activates the account and revokes its existing sessions. Users then sign in through the regular login page with the new credentials. The account updates are saved by the authenticated API; the password is stored as a bcrypt hash, never in the browser's school record.

The **Users & Roles** and **School Administrators** pages also provide the login reset action for listed school users. Keep the owner session connected to the API while making changes.

School accounts and department administrators with the **Manage department logins** permission can reset a department account's password from the school dashboard. The reset asks for that account's current username, a new password, and confirmation; it does not ask for a current password or change the username. Resets are checked and saved by the API, stored as bcrypt hashes, and revoke the target account's other sessions.

After updating the project, run `npm run db:migrate` before using School Management. The migration applies the restricted database permissions required for owner-managed school deletion.

## Importing the XAMPP/MariaDB schema

For an XAMPP/phpMyAdmin database, import [`backend/KIMS_db.sql`](./backend/KIMS_db.sql). The script creates and selects the database `KIMS_db` and defines the project tables. In phpMyAdmin, select **Import**, choose this SQL file, and run it.

This is a MariaDB-compatible schema for database setup and inspection. The current Node.js API still uses PostgreSQL (`pg`), PostgreSQL connection URLs, and PostgreSQL-specific security/query features. Importing `KIMS_db.sql` does **not** connect the running application to MariaDB; the backend must be migrated and tested separately before the app can use XAMPP's database.

## Database accounts and deployment

- Database schema, migrations, and server-side database code are in [`backend/`](./backend/). The remaining integration work is tracked in [`backend/TODO.md`](./backend/TODO.md).
- `DATABASE_URL` is the migration/administration connection. It is not used by the web server.
- `APP_DATABASE_URL` is the restricted runtime connection. The Compose initialization script creates `kims_runtime`; the migration grants it table access and applies tenant row-level security policies.
- For an existing PostgreSQL server, create a non-superuser runtime role yourself, grant the runtime table/sequence permissions, and apply `backend/schema.sql` using a separate migration account.
- In production, set `DATABASE_SSL=true`, `COOKIE_SECURE=true`, and serve the app only over HTTPS. Store `.env` in a secrets manager or protected deployment configuration.
- The server refuses to start in production mode if secure cookies or database TLS are disabled.
- Keep database backups encrypted and test restores. The Compose volume is persistence, not a backup.

## Data and security notes

- User passwords are hashed with bcrypt; the browser receives only an HttpOnly, SameSite=Strict session cookie. Session tokens are stored hashed and can be revoked.
- Sessions have a one-hour idle limit, renewed during active use, and other sessions are revoked when credentials change.
- Authentication endpoints are rate-limited; SQL uses parameterized queries; school-owned tables have row-level security policies.
- Successful sign-ins do not count toward the sign-in attempt limit, so users can sign in repeatedly. Failed attempts remain rate-limited to protect accounts.
- `school_records` currently provides a compatibility JSONB store for the dashboard's legacy school record shape. Password-like fields are removed before writes. The normalized tables are present for academic records, staff-linked users, marks, reports, payments, announcements, and tickets.
- Legacy dashboard settings, custom role configuration, and announcement/ticket workflows still contain localStorage-based paths. They are **not all migrated to database-backed APIs yet**, so this release is not a complete multi-user production migration. Do not put real student or payment data into production until those remaining screens use server-enforced authorization and the normalized tables.
- Existing localStorage records are not automatically imported. Export/back up any demo data before a later migration; never import plaintext passwords.
- Flyer/logo uploads are currently stored as validated image data in the school record/profile. For production scale, use private object storage with authorization-checked downloads.
