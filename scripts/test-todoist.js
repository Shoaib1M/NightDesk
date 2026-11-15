// Unit test for the Todoist connection (plain Node, no app window):  node scripts/test-todoist.js
// A stand-in for Todoist's API answers the requests; checks the token handling, paging, due dates
// and closing a task.
const Module = require('module');
const fs = require('fs'), os = require('os'), path = require('path');

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-todoist-test-'));
const calls = [];
const GOOD = 'a'.repeat(40);
const pages = {
  '': { results: [
    { id: '1', content: 'Essay draft', due: { date: '2026-11-15', is_recurring: false }, priority: 4 },
    { id: '2', content: 'No due date', due: null, priority: 1 },
    { id: '3', content: 'Call at ten', due: { date: '2026-11-16T10:00:00', is_recurring: false }, priority: 2 },
  ], next_cursor: 'p2' },
  p2: { results: [
    { id: '4', content: 'Gym', due: { date: '2026-11-17', datetime: '2026-11-17T07:30:00Z', is_recurring: true }, priority: 1 },
    { id: '5', content: 'Already done', due: { date: '2026-11-15' }, checked: true },
  ], next_cursor: null },
};
const fakeFetch = async (url, opts = {}) => {
  const u = new URL(url);
  calls.push({ method: opts.method, path: u.pathname, query: u.search, auth: opts.headers && opts.headers.Authorization });
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
  if (opts.headers.Authorization !== `Bearer ${GOOD}`) return json(401, {});
  if (opts.method === 'GET' && u.pathname === '/api/v1/tasks') return json(200, pages[u.searchParams.get('cursor') || '']);
  if (opts.method === 'POST' && /^\/api\/v1\/tasks\/\w+\/close$/.test(u.pathname)) return { ok: true, status: 204, json: async () => null };
  return json(404, {});
};
const load = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { app: { getPath: () => data }, safeStorage: { isEncryptionAvailable: () => false }, net: { fetch: fakeFetch } };
  return load.call(this, req, ...rest);
};
const todoist = require('../todoist');

const fails = [];
let count = 0;
const check = (name, ok, info) => { count++; if (!ok) fails.push(`${name} -> ${JSON.stringify(info)}`); };
const throws = async (fn) => { try { await fn(); return ''; } catch (e) { return e.message; } };

(async () => {
  check('starts disconnected', todoist.status().connected === false);
  check('tasks need a connection', /not connected/.test(await throws(() => todoist.tasks())));
  check('a malformed token is refused before any request', /does not look like/.test(await throws(() => todoist.connect('hello'))) && calls.length === 0);
  check('a wrong token is refused by Todoist and not kept', /did not accept/.test(await throws(() => todoist.connect('b'.repeat(40)))) && !todoist.status().connected && !fs.existsSync(path.join(data, 'todoist.bin')));
  await todoist.connect('  ' + GOOD + '\n');
  check('a good token connects and is saved', todoist.status().connected && fs.existsSync(path.join(data, 'todoist.bin')));
  check('the token goes in the Authorization header', calls.at(-1).auth === `Bearer ${GOOD}`);

  calls.length = 0;
  const list = await todoist.tasks();
  check('follows the page cursor', calls.length === 2 && calls[1].query.includes('cursor=p2'), calls);
  check('only open tasks with a due date', list.map((t) => t.id).join() === '1,3,4', list);
  const [a, b, c] = list;
  check('all-day task', a.allDay === true && a.date === '2026-11-15' && a.title === 'Essay draft' && a.priority === 4, a);
  check('a date with a time is a timed task in local time', b.allDay === false && new Date(b.at).getTime() === new Date('2026-11-16T10:00:00').getTime(), b);
  check('datetime wins over date, and repeating is noted', c.allDay === false && c.at === '2026-11-17T07:30:00.000Z' && c.recurring === true, c);

  calls.length = 0;
  await todoist.close('3');
  check('closing posts to the task', calls.length === 1 && calls[0].method === 'POST' && calls[0].path === '/api/v1/tasks/3/close', calls);
  check('odd task ids are refused', /Bad task id/.test(await throws(() => todoist.close('../x'))));

  todoist.disconnect();
  check('disconnect forgets the token', !todoist.status().connected && !fs.existsSync(path.join(data, 'todoist.bin')));

  fs.rmSync(data, { recursive: true, force: true });
  if (fails.length) { console.log('FAIL test-todoist\n' + fails.join('\n')); process.exit(1); }
  console.log(JSON.stringify({ ok: true, checks: count }));
})();
