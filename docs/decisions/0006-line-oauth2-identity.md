# ADR 0006: Use LINE Custom OAuth2 for Web Login

- Status: Proposed pending end-to-end smoke verification
- Date: 2026-08-27

## Context

The previous Supabase Custom OIDC setup (`custom:line`) was incompatible with
the token/signing behavior encountered during verification. The existing
provider must remain available while the replacement is verified.

## Decision

Use Supabase Custom OAuth2 provider `custom:line-oauth` for LINE Web Login.
Supabase Auth exchanges the authorization code and obtains LINE user info on
the server. The application trusts only the authenticated row in
`auth.identities`, and `public.link_line_identity_v1()` maps its
`provider_id` to `public.users.line_user_id` and the current `auth.uid()`.

The client cannot submit or override a LINE subject/provider id. The existing
`custom:line` OIDC provider is retained until local and end-to-end smoke tests
pass and the product owner approves any production configuration change.

## Consequences

- The application no longer depends on client-provided LINE identity data.
- Users without a LINE email remain eligible because the OAuth2 flow requests
  only `openid profile`.
- Production migration/configuration changes are explicitly deferred until
  the local verification gate is complete.
