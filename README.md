# bitcoin.cc

Block header infrastructure for SPV. Finishing what Section 8 started.

## About

The Bitcoin whitepaper described Simplified Payment Verification (SPV) in 2008. Sixteen years later, true SPV infrastructure remains incomplete. Most light wallets today trust servers rather than verify headers themselves.

bitcoin.cc provides the foundational infrastructure for real SPV: block headers organized by difficulty epoch, freely accessible, independently verifiable.

> "A user only needs to keep a copy of the block headers of the longest proof-of-work chain..."
> — Satoshi Nakamoto, Bitcoin Whitepaper, Section 8

## API

All endpoints return JSON. No authentication required.

| Endpoint | Description |
|----------|-------------|
| `GET /headers/latest.json` | Chain tip and epoch summary |
| `GET /headers/current.json` | Current incomplete epoch (updates with new blocks) |
| `GET /headers/epoch/{n}.json` | Archived epoch n (2016 headers, immutable) |

### Example

```bash
# Get current chain tip
curl https://bitcoin.cc/headers/latest.json

# Get genesis epoch
curl https://bitcoin.cc/headers/epoch/0.json

# Get current epoch
curl https://bitcoin.cc/headers/current.json
```

### Response Format

**latest.json**
```json
{
  "tip": {
    "height": 925833,
    "hash": "000000000000000000...",
    "time": 1764493703
  },
  "current_epoch": {
    "epoch": 459,
    "start_height": 925344,
    "count": 490,
    "complete": false
  },
  "archived_epochs": {
    "count": 459,
    "last": 458,
    "blocks": 925343
  }
}
```

**epoch/{n}.json**
```json
{
  "epoch": 0,
  "start_height": 0,
  "end_height": 2015,
  "start_time": 1231006505,
  "end_time": 1233061996,
  "count": 2016,
  "headers": [
    {
      "height": 0,
      "hash": "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f",
      "version": 1,
      "prev_block": "0000000000000000000000000000000000000000000000000000000000000000",
      "merkle_root": "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
      "timestamp": 1231006505,
      "bits": "1d00ffff",
      "nonce": 2083236893
    }
  ]
}
```

## Epochs

Headers are grouped into epochs of 2016 blocks — the Bitcoin difficulty adjustment period. Each epoch represents approximately two weeks of blocks.

- **Archived epochs** (0–458): Complete, immutable, 2016 headers each
- **Current epoch** (459): Incomplete, updates with new blocks

## Scripts

### watch-mempool.js

Watch for new blocks via mempool.space API:

```bash
node watch-mempool.js
```

Environment variables:
- `POLL_INTERVAL` — Polling interval in ms (default: 60000)
- `OUTPUT_DIR` — Headers output directory (default: ./headers)
- `API_BASE` — API base URL (default: https://mempool.space/api)

### watch.js

Watch for new blocks via local Bitcoin node:

```bash
BITCOIN_DATADIR=/path/to/.bitcoin node watch.js
```

Environment variables:
- `BITCOIN_CLI` — Path to bitcoin-cli (default: bitcoin-cli)
- `BITCOIN_DATADIR` — Bitcoin data directory
- `POLL_INTERVAL` — Polling interval in ms (default: 30000)
- `OUTPUT_DIR` — Headers output directory (default: ./headers)

### extract-headers.js

Extract all headers from Bitcoin Core LevelDB (requires stopped node):

```bash
BITCOIN_DIR=/path/to/.bitcoin OUTPUT_DIR=./headers/epoch node extract-headers.js
```

## Verification

All header data can be independently verified against any Bitcoin full node:

```bash
# Verify genesis block hash
bitcoin-cli getblockhash 0
# Should return: 000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f
```

## License

Public domain. Use freely.

## Links

- Website: https://bitcoin.cc
- GitHub: https://github.com/bitcoincc/headers
- Whitepaper: https://bitcoin.org/bitcoin.pdf
