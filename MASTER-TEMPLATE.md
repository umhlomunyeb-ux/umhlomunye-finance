# LMS Master Template

This branch is the canonical source-code template for all LMS client deployments.

## Architecture

- Source database: Umhlomunye Finance (immutable source/reference database).
- Client databases: isolated per client and never shared.
- Canonical application code: this `master-template` branch.
- Client deployment: every push to `master-template` builds the same frontend source and deploys it to each configured client Worker.
- Tenant configuration: supplied by GitHub Actions secrets for each client, so client URLs, publishable Supabase keys and public application URLs remain isolated.

## Current clients

- Umhlomunye Finance -> Worker `umhlomunye-finance2`
- Umthaniya Finance -> Worker `umthaniya-finance`

## Change model

Application code changes are made once on `master-template`. The deployment workflow then publishes that same codebase to all configured LMS clients. Database data, company settings, branding and other tenant-specific records remain in each client's own Supabase project.

Do not use the client database as a source template, and do not modify the Umhlomunye source database when provisioning or updating a client.
