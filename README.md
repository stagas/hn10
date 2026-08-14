# hn10

`hn10` watches the Hacker News front page and posts each story that newly enters
the top ten to [Textlog](https://textlog.cc/). It is a Bun/TypeScript service
using Cheerio for HTML parsing and Bun's native `bun:sqlite` driver for durable
state.

Posts have this shape:

```md
[Story title](example.com/story) [comments](news.ycombinator.com/item?id=123) #hn #hn10
```

## Behavior

- The first successful scrape is a silent baseline: its ten stories are saved
  but never posted.
- Every later story first observed in the top ten is saved and queued once.
- Published and baseline HN IDs remain in SQLite permanently, so restarts do
  not repost them.
- The default minimum interval between successful posts is 101 seconds. Since
  the bot polls every 60 seconds and emits at most one queued post per poll,
  this stays below Textlog's documented three-posts-per-five-minutes limit.
- An HTTP error from Textlog is safe to retry and uses `Retry-After` when
  supplied. A transport interruption is ambiguous: Textlog may already have
  accepted the post. Such a story is saved as `uncertain` and is not retried,
  preferring a possible missed post over a duplicate.
- If the process stops while a post is in flight, that story becomes
  `uncertain` on the next start for the same reason.

The SQLite database defaults to `data/hn10.sqlite` and uses WAL mode. The
official Bun SQLite API is documented at <https://bun.sh/docs/runtime/sqlite>.
Textlog's API and API-key instructions are at <https://textlog.cc/api>.

## Local use

Install [Bun 1.3.14](https://bun.sh/) or newer, then:

```sh
bun install --frozen-lockfile
cp .env.example .env
# Put a revocable Textlog API key in .env.
set -a; source .env; set +a
bun run start
```

Run verification with:

```sh
bun run check
```

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `TEXTLOG_TOKEN` | required | Revocable Textlog API key |
| `DB_PATH` | `./data/hn10.sqlite` | Persistent SQLite file |
| `POLL_INTERVAL_MS` | `60000` | Delay between front-page scrapes |
| `MIN_POST_INTERVAL_MS` | `101000` | Minimum delay after a successful post |
| `REQUEST_TIMEOUT_MS` | `15000` | HN and Textlog request timeout |
| `HN_URL` | `https://news.ycombinator.com/` | Scrape source; useful to override in tests |
| `TEXTLOG_API_URL` | `https://textlog.cc/api/v1` | Textlog API base URL |

Do not set `MIN_POST_INTERVAL_MS` below Textlog's posting limit unless you add
another rate limiter.

## Server setup

The deployment expects Bun at `~/.bun/bin/bun`, an app directory at
`~/apps/hn10`, and a user-level systemd service named `hn10`.

On the server, after the first upload:

```sh
cd ~/apps/hn10
cp .env.example .env
chmod 600 .env
# Edit .env and set TEXTLOG_TOKEN.

mkdir -p ~/.config/systemd/user
cp deploy/hn10.service ~/.config/systemd/user/hn10.service
systemctl --user daemon-reload
systemctl --user enable --now hn10
```

For a user service that must run while the account is logged out, an
administrator should enable lingering once:

```sh
sudo loginctl enable-linger YOUR_SERVER_USER
```

Inspect it with `systemctl --user status hn10` and
`journalctl --user -u hn10 -f`.

## GitHub deployment

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) typechecks and
tests every push and pull request. A successful push to `main` then rsyncs the
checkout to `apps/hn10` and restarts the `hn10` user service.

Configure exactly these repository secrets:

- `SSH_USER`: the full SSH destination, such as `deploy@example.com`
- `SSH_PRIVATE_KEY`: the matching private key

The first SSH connection uses `StrictHostKeyChecking=accept-new`. For stronger
host verification, pre-populate a known-host entry in the workflow or add a
dedicated known-host secret. Deployments intentionally preserve the remote
`.env`, `data/`, and `node_modules/` paths; in particular, rsync cannot delete
the SQLite history.
