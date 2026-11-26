import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });
const send = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.cmd === 'crash') {
    process.stderr.write('fake worker boom\n');
    process.exit(1);
  }
  if (msg.cmd === 'hang') return;
  if (msg.cmd === 'fail') {
    send({ id: msg.id, ok: false, error: 'ValueError: bad input' });
    return;
  }
  if (msg.cmd === 'analyze') {
    send({ event: 'progress', id: msg.id, stage: 'separate' });
    send({ event: 'progress', id: msg.id, stage: 'transcribe' });
    send({ id: msg.id, ok: true, result: { echoed: msg.file || null } });
    return;
  }
  send({ id: msg.id, ok: true, result: { cmd: msg.cmd } });
});
rl.on('close', () => process.exit(0));
