// Server-side Privy helpers for the API functions. Needs the app secret, so
// nothing here may be imported by the browser bundle.
import { createRemoteJWKSet, jwtVerify } from "jose";

const AUTH_API = "https://auth.privy.io/api/v1";
const WALLET_API = "https://api.privy.io/v1";

function credentials() {
  const appId = process.env.VITE_PRIVY_APP_ID || process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) throw new Error("Privy is not configured on the server.");
  return { appId, appSecret };
}

let jwks;

// The signed-in user behind a request, from the access token the app sends
// as a bearer token. Throws if there isn't a valid one.
export async function verifyCaller(req) {
  const { appId } = credentials();
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) throw new Error("Not signed in.");
  jwks ??= createRemoteJWKSet(new URL(`${AUTH_API}/apps/${appId}/jwks.json`));
  const { payload } = await jwtVerify(header.slice(7), jwks, { issuer: "privy.io", audience: appId });
  return payload.sub;
}

async function privy(url, body) {
  const { appId, appSecret } = credentials();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
      "privy-app-id": appId,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// Privy's own record of the wallet it made for this account: { id, address },
// or null. The id is what Privy's wallet API addresses a wallet by.
export async function walletRecordOfUser(userId) {
  const { appId, appSecret } = credentials();
  const res = await fetch(`${AUTH_API}/users/${encodeURIComponent(userId)}`, {
    headers: {
      authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
      "privy-app-id": appId,
    },
  });
  if (!res.ok) return null;
  const account = (await res.json()).linked_accounts?.find(
    (a) => a.type === "wallet" && a.chain_type === "ethereum" && a.wallet_client_type === "privy"
  );
  return account ? { id: account.id, address: account.address } : null;
}

// Calls Privy's wallet API for one wallet. `signature` is the wallet owner's
// authorization over this exact request, needed for anything that moves funds.
export async function walletApi(walletId, path, { body, signature } = {}) {
  const { appId, appSecret } = credentials();
  const res = await fetch(`${WALLET_API}/wallets/${encodeURIComponent(walletId)}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
      "privy-app-id": appId,
      "content-type": "application/json",
      ...(signature ? { "privy-authorization-signature": signature } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

// The wallet Privy made for the account with this ID, or null.
export async function walletOfUser(userId) {
  const { appId, appSecret } = credentials();
  const res = await fetch(`${AUTH_API}/users/${encodeURIComponent(userId)}`, {
    headers: {
      authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
      "privy-app-id": appId,
    },
  });
  return res.ok ? embeddedWallet(await res.json()) : null;
}

// The wallet Privy made for this account, if it has one.
const embeddedWallet = (user) =>
  user?.linked_accounts?.find(
    (a) => a.type === "wallet" && a.chain_type === "ethereum" && a.wallet_client_type === "privy"
  )?.address ?? null;

// The wallet address that belongs to an email address. Someone who has never
// signed in gets an account and a wallet made for them now; it is theirs the
// first time they sign in with that email, with whatever has been sent to it.
// Returns { address, isNew }.
export async function walletForEmail(email) {
  const found = await privy(`${AUTH_API}/users/email/address`, { address: email });
  if (found.status === 200) {
    const address = embeddedWallet(found.data);
    if (address) return { address, isNew: false };
    // An account that signed in with its own wallet only: give it one of ours.
    const added = await privy(`${WALLET_API}/wallets`, {
      chain_type: "ethereum",
      owner: { user_id: found.data.id },
    });
    if (added.data?.address) return { address: added.data.address, isNew: true };
    throw new Error(added.data?.error ?? "Couldn't make a wallet for that email.");
  }
  if (found.status !== 404) throw new Error(found.data?.error ?? "Couldn't look up that email.");

  const created = await privy(`${AUTH_API}/users`, {
    linked_accounts: [{ type: "email", address: email }],
    wallets: [{ chain_type: "ethereum" }],
  });
  const address = embeddedWallet(created.data);
  if (!address) throw new Error(created.data?.error ?? "Couldn't make a wallet for that email.");
  return { address, isNew: true };
}
