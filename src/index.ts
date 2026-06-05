// Entrypoint: wire the layers together and start the server.
//   sandbox (manager singleton) ← sdk (RealPiClient) ← server (HTTP)
import { RealPiClient } from "./pi/realPiClient";
import { createServer } from "./server";

const PROVIDER = process.env.PI_PROVIDER ?? "google";

// Resolve the provider credential (Bun auto-loads .env). Using Gemini by
// default — for another provider, read its key here instead.
const apiKey = process.env.GEMINI_API_KEY;

// Fail fast if no credential is available (assignment requirement).
if (!apiKey) {
  console.error("startup.pi_auth_invalid: GEMINI_API_KEY is required — set it in .env");
  process.exit(1);
}

const piClient = new RealPiClient(() => apiKey);

const PORT = Number(process.env.PORT ?? 3000);
createServer(piClient).listen(PORT, () => {
  console.log(`pi-sandbox-min listening on :${PORT} (provider=${PROVIDER})`);
});
