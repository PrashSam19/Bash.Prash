// Public-key encryption for Ask Prash chat logs.
//
// The server holds only the public key, so it can lock a log entry but never
// unlock one; the private key stays on Prash's laptop. Each entry gets a
// fresh ephemeral P-256 key: ECDH with the recipient's public key, HKDF-SHA256
// to an AES-256-GCM key, then AES-GCM over the JSON. Only Web Crypto is used,
// so it runs the same in Node, Netlify Functions, and tests.

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const INFO = new TextEncoder().encode('ask-prash-log-v1');

export interface Sealed {
  v: 1;
  // Ephemeral public key, raw uncompressed point.
  epk: string;
  iv: string;
  ct: string;
}

const b64 = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const unb64 = (text: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

export async function generateLogKeys(): Promise<{ publicKey: string; privateJwk: JsonWebKey }> {
  const pair = (await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
  return {
    publicKey: b64(await crypto.subtle.exportKey('raw', pair.publicKey)),
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
  };
}

async function aesKey(shared: ArrayBuffer, epk: Uint8Array<ArrayBuffer>, usage: KeyUsage): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: epk, info: INFO },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

export async function seal(publicKey: string, data: unknown): Promise<Sealed> {
  const recipient = await crypto.subtle.importKey('raw', unb64(publicKey), ECDH, false, []);
  const ephemeral = (await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
  const epk = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: recipient }, ephemeral.privateKey, 256);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(shared, epk, 'encrypt');
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  return { v: 1, epk: b64(epk), iv: b64(iv), ct: b64(ct) };
}

export async function unseal<T = unknown>(privateJwk: JsonWebKey, sealed: Sealed): Promise<T> {
  if (sealed?.v !== 1) throw new Error('unknown log format');
  const own = await crypto.subtle.importKey('jwk', privateJwk, ECDH, false, ['deriveBits']);
  const epk = unb64(sealed.epk);
  const sender = await crypto.subtle.importKey('raw', epk, ECDH, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: sender }, own, 256);
  const key = await aesKey(shared, epk, 'decrypt');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) }, key, unb64(sealed.ct));
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
