export default { randomBytes: (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)) };
