import { randomBytes } from "node:crypto";
import { connect } from "node:tls";

export type Smtp = { host: string; port: number; user: string; pass: string };

// ponytail: implicit TLS (port 465) + AUTH LOGIN only, enough for Gmail and most providers. Add STARTTLS (587) if a provider needs it.
export async function sendMail(smtp: Smtp, to: string, subject: string, text: string) {
  const socket = connect({ host: smtp.host, port: smtp.port, servername: smtp.host });
  socket.setEncoding("utf8");
  socket.setTimeout(15_000, () => socket.destroy(new Error("SMTP server timed out")));

  let buffer = "";
  let failure: Error | null = null;
  let wake = () => {};
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    wake();
  });
  socket.on("error", (error) => {
    failure = error;
    wake();
  });
  socket.on("close", () => {
    failure ??= new Error("SMTP connection closed");
    wake();
  });

  // A reply is any "250-..." continuation lines followed by one final "250 ..." line.
  async function expect(code: number) {
    for (;;) {
      const reply = buffer.match(/^(?:\d{3}-[^\r\n]*\r\n)*(\d{3})(?: [^\r\n]*)?\r\n/);
      if (reply) {
        buffer = buffer.slice(reply[0].length);
        if (Number(reply[1]) !== code) throw new Error(`SMTP: ${reply[0].trim()}`);
        return;
      }
      if (failure) throw failure;
      await new Promise<void>((resolve) => (wake = resolve));
    }
  }
  const command = (line: string, code: number) => {
    socket.write(`${line}\r\n`);
    return expect(code);
  };
  const b64 = (value: string) => Buffer.from(value).toString("base64");

  // The body is our own text, so no line starts with "." and no dot-stuffing is needed.
  const message = [
    `From: DeskWarden <${smtp.user}>`,
    `To: <${to}>`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(12).toString("hex")}@deskwarden.local>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    text,
    ".",
  ].join("\r\n");

  try {
    await expect(220);
    await command("EHLO deskwarden.local", 250);
    await command("AUTH LOGIN", 334);
    await command(b64(smtp.user), 334);
    await command(b64(smtp.pass), 235);
    await command(`MAIL FROM:<${smtp.user}>`, 250);
    await command(`RCPT TO:<${to}>`, 250);
    await command("DATA", 354);
    await command(message, 250);
    socket.write("QUIT\r\n");
  } finally {
    socket.end();
  }
}
