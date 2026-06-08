# Development

## Setup

1. Install dependencies:

    ```bash
    bun install
    ```

2. Create a local app config:

    ```bash
    cp bkper.yaml.example bkper.yaml
    ```

3. Edit `bkper.yaml` with your Bkper app id, URLs, developer username, and allowed users.

4. Log in with the Bkper CLI for local development:

    ```bash
    bkper auth login
    ```

## Run locally

```bash
bun run dev
```

This starts the Vite client and the Bkper app Worker development server.

## Check and build

```bash
bun run check
bun run build
```

## Notes

- The app is read-only and should not write to Bkper books.
- Keep `bkper.yaml` local; it is ignored by git because it contains deployment-specific metadata.
- Timezone-sensitive counting logic lives in `client/src/created-at-count.ts`.
- Bkper API reads are isolated in `client/src/created-at-count-service.ts`.
