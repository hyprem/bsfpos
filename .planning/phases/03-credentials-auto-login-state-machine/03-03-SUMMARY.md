# Plan 03-03 — credentialsStore module — SUMMARY

## Outcome

`src/main/credentialsStore.js` + `test/credentialsStore.test.js` landed.
safeStorage round-trip module with dependency injection — `safeStorage` and
`store` are passed in, so nothing in this file imports `electron` at module
scope and everything is unit-testable with mocks.

## Exported surface

```js
exports.buildCiphertext            // (safeStorage, {user, pass}) => base64 string — PURE, no store
exports.saveCredentials            // (store, safeStorage, {user, pass}) => void     — thin wrapper
exports.loadCredentials            // (store, safeStorage) => {user, pass} | null | 'DECRYPT_FAILED'
exports.isStoreAvailable           // (safeStorage) => boolean
exports.clearCredentials           // (store) => void
exports.DECRYPT_FAILED             // sentinel string
exports.EncryptionUnavailableError // thrown by buildCiphertext/saveCredentials
exports._STORE_KEY                 // 'credentialsCiphertext'
```

`buildCiphertext` is the mandatory pure split for **Plan 03-04**: returns the
base64 ciphertext without touching the store so 03-04's first-run path can
compose `{adminPin, credentialsCiphertext}` into a single atomic
`store.set({...})` call per CONTEXT D-11 and RESEARCH §electron-store Atomicity.

## Round-trip shape (research §safeStorage Round-Trip Pattern)

**Write path:**
```
{user, pass}
  -> JSON.stringify                       (handles quotes, backslashes, unicode)
  -> safeStorage.encryptString(plaintext) -> Buffer
  -> Buffer.toString('base64')            -> string
  -> store.set('credentialsCiphertext', string)
```

**Read path:**
```
store.get('credentialsCiphertext')        -> string
  -> Buffer.from(b64, 'base64')           -> Buffer
  -> safeStorage.decryptString(buf)       -> string
  -> JSON.parse                           -> {user, pass}
```

The ciphertext is stored as a **base64 string**, not as `{type: 'Buffer', data: [...]}`
(research Pitfall #3 — that shape is a known decrypt-fail trap when electron-store
serializes Buffer instances).

## DECRYPT_FAILED sentinel contract (for Plan 03-04 authFlow consumption)

`loadCredentials()` return values — authFlow.js state machine must handle all three:

| Return              | Meaning                                           | authFlow response                                   |
|---------------------|---------------------------------------------------|-----------------------------------------------------|
| `null`              | First run — no credentials ever stored           | → `NEEDS_CREDENTIALS` (show credentials overlay)    |
| `{user, pass}`      | Happy path — credentials loaded successfully     | → `LOGIN_SUBMITTED` (inject into Magicline)         |
| `'DECRYPT_FAILED'`  | safeStorage unavailable OR decryptString threw   | → `CREDENTIALS_UNAVAILABLE` (PIN recovery required) |

`DECRYPT_FAILED` is triggered by:
- Pitfall #1: DPAPI master key rotation (Windows user password changed → old
  ciphertext is no longer decryptable)
- Pitfall #3: base64 corruption or Buffer-shape mismatch
- `isEncryptionAvailable()` returning false at load time (Pitfall #2 transient
  false → treated as non-recoverable here; authFlow decides whether to retry)
- JSON parse failure on the decrypted plaintext
- Any unexpected exception wrapped in the outer try/catch

**`saveCredentials` is strict:** it throws `EncryptionUnavailableError` (code
`safestorage-unavailable`) rather than falling back to plaintext, per PROJECT.md
hard constraint "Magicline credentials must never be stored plaintext on disk."

## Tests

`node --test test/credentialsStore.test.js` → **14 / 14 passing**:

- `buildCiphertext returns base64 string without touching store`
- `buildCiphertext throws EncryptionUnavailableError when isEncryptionAvailable=false`
- `buildCiphertext rejects missing/empty fields`
- `round-trip: save then load returns same credentials`
- `load returns null when store is empty`
- `load returns DECRYPT_FAILED when decryptString throws`
- `load returns DECRYPT_FAILED when isEncryptionAvailable is false`
- `save throws safestorage-unavailable when isEncryptionAvailable is false`
- `no plaintext user or pass in stored blob (AUTH-01 invariant)` — uses canary
  strings `bsk-audit-USER-*` / `bsk-audit-PASS-*` and greps the stringified store
- `credentials with quotes, backslashes, unicode round-trip correctly`
- `save rejects missing fields`
- `clearCredentials deletes the store key`
- `isStoreAvailable returns true/false from mock`
- `saveCredentials composes buildCiphertext output into store.set`

The mock safeStorage is a deterministic XOR-with-0xFF bit-flip prefixed with a
`MOCK` magic header — not real encryption, but sufficient to (a) produce
non-plaintext output for the AUTH-01 leak assertion and (b) simulate decrypt
failures by turning off the decrypt path. The test stubs `src/main/logger.js`
via `require.cache` to stay hermetic in a pure Node context.

## Files

- `src/main/credentialsStore.js` (new, ~140 lines)
- `test/credentialsStore.test.js` (new, ~175 lines)
- `.planning/phases/03-credentials-auto-login-state-machine/03-03-SUMMARY.md` (this file)

## Follow-ups owned elsewhere

- **03-04** consumes `buildCiphertext` for atomic first-run persist (adminPin + credentialsCiphertext)
- **03-04** consumes the `DECRYPT_FAILED` sentinel to route into `CREDENTIALS_UNAVAILABLE`
- **03-08** plaintext audit script will grep `config.json` for any staff credentials at rest
