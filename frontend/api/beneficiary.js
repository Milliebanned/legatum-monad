// Turns an email address into the wallet address a vault can name or a
// payment can go to, making the account and wallet if that person has never
// signed in. Only signed-in users may call it, so it can't be used to mint
// accounts anonymously.
//
// Environment (Vercel project settings): VITE_PRIVY_APP_ID, PRIVY_APP_SECRET.
import { verifyCaller, walletForEmail } from "../lib/privy.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    await verifyCaller(req);
  } catch {
    return res.status(401).json({ error: "Sign in to name someone by email." });
  }

  const email = String(req.body?.email ?? "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return res.status(400).json({ error: "Not a valid email address." });

  try {
    return res.status(200).json({ email, ...(await walletForEmail(email)) });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: err.message });
  }
}
