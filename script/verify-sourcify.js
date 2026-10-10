// Publishes the deployed contracts' source through Sourcify, which Monad's
// block explorers read from.
//
// Usage: node script/verify-sourcify.js <chainId> <address> <ContractName> [<address> <ContractName> ...]
const fs = require("fs");
const path = require("path");

const API = "https://sourcify.dev/server/v2";
const HEADERS = { "content-type": "application/json", "user-agent": "legatum-verify/1.0" };

// The compiler input Hardhat recorded for `name`, exactly as it was built.
function buildInfo(name) {
  const dir = path.join(__dirname, "..", "artifacts", "build-info");
  for (const file of fs.readdirSync(dir)) {
    const info = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const source = Object.keys(info.output.contracts).find((s) => name in info.output.contracts[s]);
    if (source) return { input: info.input, version: info.solcLongVersion, identifier: `${source}:${name}` };
  }
  throw new Error(`No build info for ${name}. Run "npx hardhat compile --force" first.`);
}

async function verify(chainId, address, name) {
  const { input, version, identifier } = buildInfo(name);
  const res = await fetch(`${API}/verify/${chainId}/${address}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ stdJsonInput: input, compilerVersion: version, contractIdentifier: identifier }),
  });
  const body = await res.json();
  if (res.status === 409) return console.log(`${name} ${address}: already verified`);
  if (!res.ok) throw new Error(`${name}: ${res.status} ${JSON.stringify(body)}`);

  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const job = await (await fetch(`${API}/verify/${body.verificationId}`, { headers: HEADERS })).json();
    if (!job.isJobCompleted) continue;
    if (job.error) throw new Error(`${name}: ${JSON.stringify(job.error)}`);
    return console.log(`${name} ${address}: verified (${job.contract?.match ?? "match"})`);
  }
  throw new Error(`${name}: verification still pending, id ${body.verificationId}`);
}

async function main() {
  const [chainId, ...pairs] = process.argv.slice(2);
  for (let i = 0; i < pairs.length; i += 2) await verify(chainId, pairs[i], pairs[i + 1]);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
