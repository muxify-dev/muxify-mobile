#!/usr/bin/env node
/**
 * Measures how tmux answers the guarded Batch line of the input Outbox.
 *
 *   bash e2e/sandbox.sh node e2e/probe-input-guard.mjs
 *
 * It prints, for each line it writes down a control mode client, the reply
 * blocks that came back and what the Pane shows. `src/tmux/commands.ts` and
 * `runChain` in `src/tmux/control-connection.ts` encode what this printed on
 * tmux 3.8. Run it again on another tmux before you trust them there.
 */
import { execFileSync, spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';

if (!process.env.MUXIFY_E2E_ROOT || process.env.TMUX) {
  console.error('run this through e2e/sandbox.sh');
  process.exit(1);
}

const tmux = (...args) => execFileSync('tmux', args, { encoding: 'utf8' }).trim();
const socket = tmux('display', '-p', '#{socket_path}');
if (!socket.startsWith(`${realpathSync(process.env.MUXIFY_E2E_ROOT)}/`)) {
  console.error(`refusing to probe ${socket}`);
  process.exit(1);
}

console.log(`tmux ${tmux('-V')}`);
const pane = tmux('new-window', '-d', '-P', '-F', '#{pane_id}', '-t', '0:', 'cat -v');
const option = '@muxify-in-probe';

const child = spawn('tmux', ['-C', 'attach', '-t', '0']);
let buffered = '';
let blocks = [];
let open = null;
let waiter = null;
child.stdout.on('data', (chunk) => {
  buffered += chunk.toString('utf8');
  for (let at = buffered.indexOf('\n'); at >= 0; at = buffered.indexOf('\n')) {
    const line = buffered.slice(0, at);
    buffered = buffered.slice(at + 1);
    if (line.startsWith('%begin ')) open = [];
    else if (open !== null && (line.startsWith('%end ') || line.startsWith('%error '))) {
      blocks.push({ ok: line.startsWith('%end '), text: open.join('\\n') });
      open = null;
      if (waiter && blocks.at(-1).text === waiter.sentinel) waiter.done();
    } else if (open !== null) open.push(line);
  }
});

let sentinels = 0;
/** Writes one line and resolves with the blocks tmux answered it with. */
function ask(line) {
  const sentinel = `sentinel-${++sentinels}`;
  return new Promise((resolve) => {
    blocks = [];
    waiter = {
      sentinel,
      done: () => {
        waiter = null;
        resolve(blocks.slice(0, -1));
      },
    };
    child.stdin.write(`${line}\ndisplay-message -p ${sentinel}\n`);
  });
}

const show = (label, got) =>
  console.log(
    `${label}: ${got.length} blocks [${got.map((b) => `${b.ok ? 'end' : 'error'}:"${b.text}"`).join(', ')}]`,
  );
const screen = () => tmux('capture-pane', '-p', '-t', pane).trimEnd().replace(/\n/g, '\\n');
const hex = (text) => [...Buffer.from(text)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
const quote = (value) =>
  value.includes("'") ? `"${value.replace(/[\\"$]/g, (c) => `\\${c}`)}"` : `'${value}'`;

const mark = `display-message -p -t ${pane} '#{${option}}\t#{pid}\t#{pane_pid}\t#{pane_current_command}'`;
const pad = 'display-message -p muxify-dup ; display-message -p muxify-dup';
const guarded = (seq, inner, target = pane) =>
  `if-shell -F -t ${target} '#{e|<:#{e|+:0,#{${option}}},${seq}}' ${quote(inner)} ${quote(pad)} ; ${mark.replaceAll(pane, target)}`;
const keys = (seq, send, target = pane) =>
  guarded(seq, `${send} ; set-option -p -t ${target} ${option} ${seq}`, target);

await ask('display-message -p warm-up');

show('attach reply, then a first line', await ask(`display-message -p -t ${pane} hello`));

const first = keys(1, `send-keys -t ${pane} -H ${hex('a')}`);
show('guard true (option unset, seq 1)', await ask(first));
show('the same line again (dup)', await ask(first));
console.log(`  screen: "${screen()}"`);

show('seq 9', await ask(keys(9, `send-keys -t ${pane} -H ${hex('b')}`)));
show('seq 10 after 9 (numeric compare)', await ask(keys(10, `send-keys -t ${pane} -H ${hex('c')}`)));
show('seq 9 after 10 (late line)', await ask(keys(9, `send-keys -t ${pane} -H ${hex('X')}`)));
console.log(`  screen: "${screen()}"`);
show('string compare #{<:9,10}', await ask("display-message -p '#{<:9,10} #{e|<:9,10}'"));

show(
  'inner send-keys fails (bad -N)',
  await ask(keys(11, `send-keys -t ${pane} -N zz -H ${hex('Y')}`)),
);
show(
  'inner send-keys to a Pane that is gone, guard Pane alive',
  await ask(keys(11, `send-keys -t %999 -H ${hex('Y')}`)),
);
show('guard and mark aimed at a Pane that is gone', await ask(keys(1, `send-keys -t %999 -H ${hex('Y')}`, '%999')));
show('mark alone, Pane gone', await ask(mark.replaceAll(pane, '%999')));
show('mark alone, Pane alive', await ask(mark));
console.log(`  screen: "${screen()}"`);

let seq = 20;
for (const name of ['M-;', "M-'", 'M-"', 'M-\\', 'M-$', 'M-#', 'M-{', ';', "'", '#{pid}', '$HOME', 'C-c']) {
  if (name === 'C-c') continue;
  tmux('send-keys', '-t', pane, 'Enter');
  const before = screen();
  const got = await ask(keys(++seq, `send-keys -t ${pane} ${quote(name)}`));
  const after = screen();
  console.log(
    `key ${name}: ${got.length} blocks, ${got.every((b) => b.ok) ? 'ok' : `error "${got.find((b) => !b.ok).text}"`}, typed "${after.slice(before.length).trim()}"`,
  );
}

for (const size of [2048, 4096, 8000, 16000]) {
  tmux('send-keys', '-t', pane, 'Enter');
  const line = keys(++seq, `send-keys -t ${pane} -H ${Array(size).fill('78').join(' ')}`);
  const got = await ask(line);
  console.log(
    `${size} typed bytes, line of ${line.length}: ${got.length} blocks, ${got.every((b) => b.ok) ? 'ok' : `error "${got.find((b) => !b.ok).text.slice(0, 80)}"`}`,
  );
}

child.stdin.end();
child.kill();
process.exit(0);
