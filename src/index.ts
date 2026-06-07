import { RealPiClient } from "./pi/realPiClient";
import { createServer } from "./server";

const PROVIDER = process.env.PI_PROVIDER ?? "google";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("startup.pi_auth_invalid: GEMINI_API_KEY is required — set it in .env");
  process.exit(1);
}

const piClient = new RealPiClient(() => apiKey);

const PORT = Number(process.env.PORT ?? 3000);
createServer(piClient).listen(PORT, () => {
  console.log(`pi-sandbox-min listening on :${PORT} (provider=${PROVIDER})`);
});
