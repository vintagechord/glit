import addressparser from "nodemailer/lib/addressparser";
import { createEmailRelayHandler } from "./handler.ts";
import { createCancellableSmtpTransport } from "./transport.ts";

// Server-to-server only. verify_jwt=false is paired with a separate 256-bit
// EMAIL_RELAY_SECRET check in the handler, before reading the body or SMTP.
Deno.serve(createEmailRelayHandler({
  env: (name) => Deno.env.get(name),
  parseAddress: addressparser,
  createTransport: createCancellableSmtpTransport,
}));
