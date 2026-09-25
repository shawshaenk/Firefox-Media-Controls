// Exact URL matching without persisting URLs (which can contain access tokens).
// The key stays local. This prevents plaintext retention; it is not protection
// against an attacker with complete access to the browser profile.
let keyPromise: Promise<CryptoKey> | undefined;
async function installationKey(): Promise<CryptoKey> {
  const stored = await browser.storage.local.get("orderKeySecret");
  let secret = stored.orderKeySecret;
  if (!Array.isArray(secret) || secret.length !== 32 ||
      !secret.every((n: unknown) => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 255)) {
    secret = Array.from(crypto.getRandomValues(new Uint8Array(32)));
    await browser.storage.local.set({ orderKeySecret: secret });
  }
  return crypto.subtle.importKey("raw", new Uint8Array(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
export async function orderKey(url: string): Promise<string> {
  keyPromise ??= installationKey().catch((error) => { keyPromise = undefined; throw error; });
  const signature = await crypto.subtle.sign("HMAC", await keyPromise, new TextEncoder().encode(url));
  return "hmac:" + Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
