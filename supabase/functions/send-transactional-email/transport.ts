import nodemailer from "nodemailer";
import { connect, type TLSSocket } from "node:tls";
import type { RelaySmtpOptions, RelayTransport } from "./handler.ts";

/** A request owns exactly one non-pooled TLS connection. Nodemailer's regular
 * close() does not cancel an in-flight SMTP send; retain and destroy the socket
 * so deadline/client cancellation cannot leave a background send running.
 */
export function createCancellableSmtpTransport(options: RelaySmtpOptions): RelayTransport {
  let socket: TLSSocket | undefined;
  let closed = false;
  const transport = nodemailer.createTransport({
    ...options,
    getSocket(_options, callback) {
      if (closed) { callback(new Error("SMTP request closed")); return; }
      let returned = false;
      const fail = () => {
        if (returned) return;
        returned = true;
        callback(Object.assign(new Error("SMTP connection failed"), { code: "ECONNECTION", command: "CONN" }));
      };
      socket = connect({ host: options.host, port: options.port, ...options.tls }, () => {
        if (closed || !socket) { fail(); return; }
        returned = true;
        callback(null, { connection: socket, secured: true });
      });
      socket.once("error", fail);
      socket.once("close", fail);
    },
  });
  return {
    sendMail: (mail) => {
      if (closed) return Promise.reject(new Error("SMTP request closed"));
      return transport.sendMail(mail);
    },
    close: () => {
      if (closed) return;
      closed = true;
      socket?.destroy();
      transport.close();
    },
  };
}
