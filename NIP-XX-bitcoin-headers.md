# NIP-XX: Bitcoin Block Headers

`draft` `optional`

This NIP defines a standard for broadcasting Bitcoin block headers over Nostr.

## Motivation

Bitcoin block headers are small (80 bytes) and contain the essential proof-of-work chain data. Broadcasting them over Nostr provides:

- Decentralized, censorship-resistant header distribution
- Real-time new block notifications
- A bootstrap mechanism for SPV and light clients
- Redundancy independent of Electrum/Bitcoin Core infrastructure

## Event Format

A Bitcoin headers event uses kind `31021` (parameterized replaceable) and contains recent block headers.

```json
{
  "kind": 31021,
  "content": "<concatenated 80-byte headers in hex, oldest first>",
  "tags": [
    ["d", "latest"],
    ["n", "mainnet"],
    ["tip", "<tip height>"],
    ["start", "<start height>"],
    ["count", "<number of headers>"]
  ]
}
```

### Kind

`31021` - A parameterized replaceable event (NIP-33). The `d` tag serves as the identifier, allowing the event to be replaced on each new block rather than accumulating indefinitely.

### Tags

| Tag | Required | Description |
|-----|----------|-------------|
| `d` | Yes | Event identifier. Use `latest` for the most recent headers. |
| `n` | Yes | Network: `mainnet`, `testnet`, `signet`, or `regtest` |
| `tip` | Yes | Block height of the most recent header in content |
| `start` | Yes | Block height of the first (oldest) header in content |
| `count` | Yes | Number of headers in content |

### Content

The `content` field contains concatenated raw block headers encoded as lowercase hex. Headers are ordered oldest-first (ascending height), allowing recipients to verify the chain sequentially.

Each 80-byte header (160 hex characters) encodes:
- Version (4 bytes, little-endian)
- Previous block hash (32 bytes, internal byte order)
- Merkle root (32 bytes, internal byte order)
- Timestamp (4 bytes, little-endian, Unix epoch)
- Difficulty bits (4 bytes, little-endian)
- Nonce (4 bytes, little-endian)

## Recommended Parameters

| Parameter | Recommended | Rationale |
|-----------|-------------|-----------|
| Header count | 12 | ~2 hours of blocks, sufficient for confirmation verification |
| Content size | 1,920 chars | 12 headers × 160 hex chars, well under event limits |

## Example

An event containing the latest 12 headers (blocks 926028-926039):

```json
{
  "kind": 31021,
  "pubkey": "...",
  "created_at": 1733000000,
  "content": "00e0ff3f....<1920 hex chars total>",
  "tags": [
    ["d", "latest"],
    ["n", "mainnet"],
    ["tip", "926039"],
    ["start", "926028"],
    ["count", "12"]
  ],
  "id": "...",
  "sig": "..."
}
```

## Client Behavior

### Subscribing

```json
{
  "kinds": [31021],
  "#d": ["latest"],
  "#n": ["mainnet"]
}
```

### Verification

Recipients MUST:
1. Verify proof-of-work for each header (hash meets difficulty target)
2. Verify chain continuity (each header's prev_hash matches previous header's hash)

Recipients SHOULD:
- Track multiple publishers to detect potential forks or attacks
- Maintain local header cache for gap detection

### Parsing Headers

```javascript
function parseHeader(hex, offset = 0) {
  const buf = Buffer.from(hex.slice(offset * 160, (offset + 1) * 160), 'hex');
  return {
    version: buf.readUInt32LE(0),
    prevHash: buf.slice(4, 36).reverse().toString('hex'),
    merkleRoot: buf.slice(36, 68).reverse().toString('hex'),
    timestamp: buf.readUInt32LE(68),
    bits: buf.readUInt32LE(72),
    nonce: buf.readUInt32LE(76)
  };
}
```

## Security Considerations

- Recipients MUST verify proof-of-work before trusting headers
- Headers alone don't prove transaction inclusion; full SPV requires merkle proofs (see NIP-XX for transaction proofs)
- A malicious publisher could broadcast a valid but orphaned chain; tracking multiple publishers mitigates this
- The `created_at` timestamp is from the publisher, not the block; use the header's internal timestamp for block time

## References

- [Bitcoin Block Header Format](https://developer.bitcoin.org/reference/block_chain.html#block-headers)
- [NIP-01: Basic Protocol](https://github.com/nostr-protocol/nips/blob/master/01.md)
- [NIP-33: Parameterized Replaceable Events](https://github.com/nostr-protocol/nips/blob/master/33.md)
