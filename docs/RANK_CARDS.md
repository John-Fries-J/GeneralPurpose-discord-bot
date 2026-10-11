# Rank Cards

Adriens Bot renders `/rank` as a ProBot-inspired PNG card while preserving the existing leveling XP, voice XP, leaderboard ranking, and migration tables.

## Commands

- `/rank user` renders your card or another user's card.
- `/rankcard set-background source:custom image:<file>` uploads a personal background.
- `/rankcard set-background source:server server_background:<name-or-id>` selects a server background.
- `/rankcard set-background source:default` returns to the server default.
- `/rankcard set-accent color:#60a5fa` saves a personal accent colour.
- `/rankcard reset` clears personal rank-card preferences.
- `/rankcard view` shows personal settings and available server backgrounds.
- `/rankcard server-add-background name:<name> image:<file>` adds or replaces a server background.
- `/rankcard server-remove-background name:<name-or-id>` removes a server background.
- `/rankcard server-set-default name:<name-or-id>` sets the server default background. Leave `name` empty to use the generated default.
- `/rankcard server-set-accent color:#60a5fa` sets the server default accent colour.

Server rank-card commands require `Manage Server` or `Administrator`.

## Storage

Uploaded images are validated as PNG, JPEG, or WebP and limited to 4 MB. They are resized to the card aspect ratio and saved as optimized WebP files under:

```text
data/rank-cards/backgrounds/
```

Generated PNG cards are cached under:

```text
data/rank-cards/cache/
```

In Docker this maps to the existing persistent volume at `/app/data`, so rank-card assets are not written into application source directories.

## Testing

Run the full local test suite:

```bash
npm test
```

The focused rank-card coverage is in:

```text
test/rankCard.test.js
test/rankCardPersistence.test.js
```

## Docker

Rebuild the image after pulling this change because the runtime image installs Noto fonts and `sharp` is installed during `npm ci`:

```bash
docker compose build
docker compose up -d
```

Confirm that the deployment still mounts the `data` directory to `/app/data`; this is where SQLite, processed backgrounds, and rank-card cache files are stored.
