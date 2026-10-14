# Coolify templates

Two ready-to-use [Coolify](https://coolify.io) service templates:

| Template | What it deploys | Deploy |
|---|---|---|
| [`backup-console.coolify.yaml`](../backup-console.coolify.yaml) | The **Convex Backup Console** — one per company/agency | once |
| [`convex-instance.coolify.yaml`](../convex-instance.coolify.yaml) | A **self-hosted Convex** instance: backend, dashboard, Postgres, RustFS (S3) | once per project |

## Use them today (no PR needed)

1. Coolify → your project → **+ New → Docker Compose Empty**.
2. Paste the template's YAML and **Save**.
3. Fill in the variables Coolify shows (it generates `SERVICE_URL_*` and `SERVICE_PASSWORD_*` itself):

**Convex Backup Console**

| Variable | Required | Notes |
|---|---|---|
| `SETUP_CODE` | | First-run setup code. Leave empty and the console prints one in its **Logs**; open the URL and the wizard creates the admin, 2FA, first workspace and invites. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | | Headless alternative to the wizard: seeds the first admin (12+ characters) while no user exists. Not in the template; add them only if you need them. |
| `CONSOLE_VERSION` | | Image tag, default `latest`. Pin e.g. `sha-1a2b3c4` in production. |
| `GOOGLE_CLIENT_ID` / `_SECRET` | | Enables "Continue with Google". Callback: `https://<console>/api/auth/callback/google` |
| `GITHUB_CLIENT_ID` / `_SECRET` | | Enables GitHub sign-in. Callback: `…/api/auth/callback/github` |
| `MICROSOFT_CLIENT_ID` / `_SECRET`, `MICROSOFT_TENANT_ID` | | Enables Microsoft (Entra ID). Tenant `common` (default), `organizations`, or your tenant ID. Callback: `…/api/auth/callback/microsoft` |

> After the first deploy, **copy `SERVICE_PASSWORD_64_MASTERKEY` into your password manager.** It
> encrypts every stored admin key, deploy key, S3 secret and age key.

**Convex instance**: nothing to fill in. After deploying, open the backend's terminal, run
`./generate_admin_key.sh`, and add the instance to the console with its API URL (`SERVICE_URL_BACKEND`).

4. **Deploy.**

### Sign-in providers: where to create the OAuth apps

- **Google:** [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → Create credentials → OAuth client ID → *Web application* → add the callback URL.
- **GitHub:** Settings → Developer settings → [OAuth Apps](https://github.com/settings/developers) → New OAuth App → *Authorization callback URL*.
- **Microsoft:** [Entra admin center](https://entra.microsoft.com) → App registrations → New registration → *Web* redirect URI → then *Certificates & secrets* → New client secret.

Sign-in is invite-only: a social login can only create an account for an email with a pending
invitation. Existing users can link providers in **Account**. Everyone still needs a second factor
(authenticator app or passkey).

## Submit them to Coolify's built-in template list

Coolify's one-click templates live in [`coollabsio/coolify`](https://github.com/coollabsio/coolify):

1. Fork the repo.
2. Copy `backup-console.coolify.yaml` → `templates/compose/convex-backup-console.yaml`
   (and `convex-instance.coolify.yaml` → `templates/compose/convex-self-hosted.yaml` if you want).
3. Copy `docs/images/logo.svg` → `public/svgs/convex-backup-console.svg`.
4. Open a PR against the `next` branch following their contribution guide.

The image must be public on GHCR (repo → Packages → `convex-backup-console` → Package settings → Change visibility → Public).
