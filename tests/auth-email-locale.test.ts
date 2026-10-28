import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

type Message = { to: string; subject: string; html: string; operation: string };

async function fixture() {
  const built = await build({
    stdin: { contents: "export {sendSignupVerificationEmail,sendPasswordResetEmail,sendWelcomeEmail} from './src/lib/email';export {messages} from 'locale-fixture';", resolveDir: process.cwd(), loader: "ts" },
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "locale-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(locale-fixture|@\/lib\/email-transport)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: path === "locale-fixture" ? "export const messages=[];" : "import {messages} from 'locale-fixture';export const sendTransactionalEmail=async input=>{messages.push(input);return {ok:true}};" }));
    } }],
  });
  const loaded = { exports: {} as Pick<typeof import("../src/lib/email"), "sendSignupVerificationEmail" | "sendPasswordResetEmail" | "sendWelcomeEmail"> & { messages: Message[] } };
  new Function("require", "module", "exports", built.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
  return loaded.exports;
}

test("auth emails follow the customer's UI language and stay Korean by default", async () => {
  const h = await fixture();
  const link = "https://app.example.invalid/en/confirm-email#token_hash=fixture";
  await h.sendSignupVerificationEmail({ email: "owner@example.invalid", link, english: true });
  await h.sendPasswordResetEmail({ email: "owner@example.invalid", link, english: true });
  await h.sendWelcomeEmail({ email: "owner@example.invalid", english: true });
  const english = h.messages.splice(0);
  assert.deepEqual(english.map(message => message.subject), [
    "[onside] Verify your email address", "[onside] Password reset", "[onside] Your Onside account is ready",
  ]);
  for (const message of english) {
    assert.doesNotMatch(message.html, /[가-힣]/, `${message.operation} must not mix Korean into an English message`);
    if (message.operation !== "welcome") assert.match(message.html, /app\.example\.invalid\/en\/confirm-email/);
  }
  await h.sendSignupVerificationEmail({ email: "owner@example.invalid", link });
  await h.sendPasswordResetEmail({ email: "owner@example.invalid", link });
  await h.sendWelcomeEmail({ email: "owner@example.invalid" });
  const korean = h.messages.splice(0);
  assert.deepEqual(korean.map(message => message.subject), [
    "[onside] 회원가입 이메일 인증", "[onside] 비밀번호 재설정 안내", "[onside] 회원가입이 완료되었습니다",
  ]);
  for (const message of korean) assert.match(message.html, /[가-힣]/);
  assert.equal((await h.sendSignupVerificationEmail({ email: "owner@example.invalid", link: "javascript:alert(1)", english: true })).ok, false, "unsafe links are rejected in every language");
});
