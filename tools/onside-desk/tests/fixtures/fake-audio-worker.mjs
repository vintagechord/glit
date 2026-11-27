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
  if (msg.cmd === 'env') {
    send({ id: msg.id, ok: true, result: { HF_HUB_OFFLINE: process.env.HF_HUB_OFFLINE ?? null } });
    return;
  }
  if (msg.cmd === 'garbage') {
    // Python의 json.dumps(allow_nan=True)가 쓰던 표준 밖 JSON(NaN) 한 줄
    process.stdout.write(`{"id": ${msg.id}, "ok": true, "result": {"residualDb": NaN}}\n`);
    return;
  }
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
