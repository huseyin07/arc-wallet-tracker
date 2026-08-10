# ARC Wallet Tracker

A production-oriented, read-only Telegram bot that watches ARC Mainnet blocks, finds bidirectional token flows involving configured wallets, and reports conservatively classified buys, sells, and swaps. It requires **no private keys** and contains no invented DEX router allow-list.

## Setup

Requires Node.js 20+.

```bash
npm install
cp .env.example .env
npm run dev
```

Create a bot by messaging **@BotFather** in Telegram, running `/newbot`, and copying the token into `TELEGRAM_BOT_TOKEN`. To find your chat ID, message your new bot, then visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`; use the numeric `message.chat.id` as `TELEGRAM_CHAT_ID`. Keep `.env` secret—it is git-ignored.

## Commands

- `/start` — help
- `/add <address> [label]` — add or re-enable a wallet
- `/remove <address>` — remove it
- `/wallets` — list wallets
- `/pause <address>` and `/resume <address>` — toggle monitoring
- `/status` — connection, block checkpoint, and enabled-wallet count

Only the configured chat ID may operate the bot. Addresses are validated and normalized before storage.

## Detection and reliability

The bot scans full blocks and receipts, decodes ERC-20 `Transfer` logs, and only identifies a trade when a contract call initiated by a tracked wallet has both an outgoing and incoming, distinct asset flow. USDC out plus token in is a BUY; token out plus USDC in is a SELL; two non-USDC assets form a SWAP. One-way transfers, approvals, gas costs, incoming wallet transfers, and ambiguous or malformed data remain `UNKNOWN` and are not notified. ARC's explicitly transferred native USDC (`transaction.value`) may be considered, but gas fields never enter flow analysis. `MIN_USDC_VALUE` applies when a classified flow has a USDC leg.

SQLite persists wallets, cached metadata, the latest completed block, and processed transaction hashes. With an empty `ARC_WS_URL` (the default), the bot continuously polls the HTTP RPC tip and processes every block between its persisted checkpoint and that tip in strict order. Failed blocks retain the checkpoint and are retried. If a separately verified WebSocket endpoint is configured, the reconnecting WebSocket transport supplies block notifications and the same ordered catch-up path prevents gaps. On first launch, monitoring begins after the current tip (no historical replay). Known DEX integrations can later be added as separate analyzers without changing the generic flow classifier.

## Production

```bash
npm test
npm run build
npm start
```

Run under a supervisor such as systemd or a container restart policy. Persist `data/`, restrict `.env` permissions, and use a dedicated Telegram bot. Logs are structured JSON for ingestion.

## Network configuration

- Network: ARC Mainnet only
- Chain ID: `5042`
- Native gas token: USDC
- HTTP RPC: `https://arc-mainnet.infura.io/v3/b6bf7d3508c941499b10025c0776eaf8`
- Explorer: `https://arc-scan.io`
- WebSocket: optional; leave `ARC_WS_URL` empty to use reliable HTTP polling
- Default HTTP polling interval: 1,000 ms (`ARC_POLL_INTERVAL_MS=1000`)

Startup rejects any `ARC_CHAIN_ID` other than `5042`. The HTTP URL is never converted to or assumed to be a WebSocket URL.
