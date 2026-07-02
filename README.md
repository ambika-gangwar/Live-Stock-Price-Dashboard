# Live Stock Price Dashboard

A single-page dashboard that pulls a live quote and price history for any
ticker from the Alpha Vantage REST API, then computes and displays:

- Current price, change, and % change
- 52-week high/low, with a position marker showing where the current price sits
- A 10-day simple moving average (SMA), calculated from raw historical data
- Three distinct, human-readable error states: network failure, invalid ticker, and rate limit

Stack: vanilla JavaScript, the Fetch API, HTML5, CSS3. No frameworks, no build step.

## Setup

1. Get a free API key: https://www.alphavantage.co/support/#api-key
2. Open `config.js` and replace `YOUR_API_KEY_HERE` with your key.
3. Open `index.html` in a browser. That's it — no server, no npm install.

If you don't want to edit `config.js` (e.g. someone else is demoing it),
paste a key into the "Alpha Vantage API key" field on the page instead.
That value lives only in a JS variable for the session — it's never
written to localStorage or sent anywhere but Alpha Vantage.

**Free-tier limits:** Alpha Vantage's free keys are capped at a handful of
requests per minute and a daily quota. Each search uses 2 requests (one
for the live quote, one for price history), so you'll hit the limit
faster than it sounds like you should.

## How it's structured

```
index.html      structure + the loading/error/result states as hidden divs
style.css       dark "exchange board" theme, all in CSS variables
script.js       fetching, error typing, SMA/range math, rendering
config.js       your API key (gitignored)
config.example.js   the checked-in template for config.js
```

`script.js` is organized top to bottom as: networking → calculations →
rendering → the search handler that ties it together. Nothing is a
class or a framework component — at this scale that would be more
ceremony than the problem needs.

## The three error paths

Alpha Vantage doesn't use HTTP status codes the way you'd expect — an
invalid ticker or an exhausted quota both come back as a normal `200 OK`
with a JSON body that just looks different:

| Case | What Alpha Vantage sends | What the app does |
|---|---|---|
| No internet / DNS failure / CORS block | `fetch()` itself throws | Caught in `fetchJSON`'s try/catch → `NetworkError` |
| Bad ticker symbol | `200 OK` with an `"Error Message"` field | → `InvalidSymbolError` |
| Rate limit / quota exceeded | `200 OK` with a `"Note"` or `"Information"` field | → `RateLimitError` |

Each one is a custom `Error` subclass, so the `catch` block in
`handleSearch` can branch with a plain `instanceof` check and show a
message with the right next step, instead of one generic "request
failed, try again" that doesn't actually tell you what to do.

## How to explain this in an interview

A few questions this project tends to invite, and short answers that
hold up under a follow-up:

**"Walk me through what happens when I type in a bad ticker."**
The `fetch()` call still succeeds — Alpha Vantage returns `200 OK`. The
JSON body just contains an `"Error Message"` key instead of the
`"Global Quote"` data. `fetchJSON` checks for that key and throws an
`InvalidSymbolError`, which the UI catches and shows as "Symbol not
found" instead of a generic failure.

**"Why three separate error types instead of one catch-all?"**
Because they're not the same problem. A network failure means "try
again in a second." A bad ticker means "you typed the wrong thing." A
rate limit means "wait — retrying immediately will fail again." Lumping
them together would mean either a useless generic message or guessing
at the cause from a plain-text string.

**"Why calculate the SMA yourself instead of using Alpha Vantage's SMA endpoint?"**
Alpha Vantage does have a prebuilt `SMA` indicator function, but using it
would mean trusting a black box and burning a third API call per search
on an already-tight free-tier quota. Since `TIME_SERIES_DAILY` already
returns the closing prices, computing a 10-day average from the last 10
entries is a five-line reduce — simpler to explain and one fewer network
request.

**"Why `outputsize=full` instead of the default `compact`?"**
`compact` only returns the last ~100 trading days, which is roughly 20
weeks — not enough to compute an accurate 52-week high/low. `full`
returns the complete history, which the app then filters down to the
last year.

**"Why fire the quote and history requests with `Promise.all` instead of one after another?"**
They're independent — the history fetch doesn't need the quote to
finish first. Awaiting them sequentially would mean the second request
doesn't even start until the first one's round trip is done, roughly
doubling the wait for no reason.

**"Why not just store the API key in localStorage so I don't have to re-enter it?"**
localStorage is readable by any JavaScript that runs on the page,
including injected scripts from an XSS bug. For something as sensitive
as an API key, that's a real risk for a small convenience gain. The
key either lives in a gitignored config file, or in a page-session-only
JS variable that resets on reload.

**"What would you change if this had to run in production for real users?"**
The API key would move server-side — right now it's visible in any
browser's network tab, which is fine for a personal/portfolio project
hitting a free-tier key, but not for a real product. A backend proxy
would hold the key, add caching to avoid re-fetching the same ticker on
every request, and let the rate limit be shared/managed centrally
instead of per browser tab.

## Notes / things intentionally left simple

- No charting library — the range bar is plain CSS, which was enough to
  show "where does the price sit in its 52-week range" without pulling
  in a dependency for one visual.
- No caching layer. A real version would cache quotes for a minute or
  two to avoid burning the rate limit on repeat searches, but that adds
  a layer of "is this data stale" logic that wasn't worth it here.
