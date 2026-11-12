'use strict';
// Quote mode: a motivational line above the clock that rotates on its own and can be cycled by hand.

const QUOTES = [
  ['The journey of a thousand miles begins with a single step.', 'Lao Tzu'],
  ['Well begun is half done.', 'Aristotle'],
  ['It is not that we have a short time to live, but that we waste a lot of it.', 'Seneca'],
  ['We suffer more often in imagination than in reality.', 'Seneca'],
  ['Dripping water hollows out stone, not through force but through persistence.', 'Ovid'],
  ['The mind is not a vessel to be filled but a fire to be kindled.', 'Plutarch'],
  ['Fall seven times, stand up eight.', 'Japanese proverb'],
  ['Energy and persistence conquer all things.', 'Benjamin Franklin'],
  ['Little strokes fell great oaks.', 'Benjamin Franklin'],
  ['An investment in knowledge pays the best interest.', 'Benjamin Franklin'],
  ['If I have seen further, it is by standing on the shoulders of giants.', 'Isaac Newton'],
  ['Nothing in life is to be feared, it is only to be understood.', 'Marie Curie'],
  ['Genius is one percent inspiration and ninety-nine percent perspiration.', 'Thomas Edison'],
  ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'],
  ['He who has a why to live can bear almost any how.', 'Friedrich Nietzsche'],
  ['The best way out is always through.', 'Robert Frost'],
  ['The expert in anything was once a beginner.', 'Helen Hayes'],
  ['The secret of getting ahead is getting started.', 'attributed to Mark Twain'],
  ['It always seems impossible until it is done.', 'attributed to Nelson Mandela'],
  ['It is not that I am so smart, it is just that I stay with problems longer.', 'attributed to Albert Einstein'],
  ['Arise, awake, and stop not till the goal is reached.', 'Swami Vivekananda'],
  ['A dream is not what you see in sleep; it is the thing that does not let you sleep.', 'A. P. J. Abdul Kalam'],
  ['First, solve the problem. Then, write the code.', 'John Johnson'],
  ['Premature optimization is the root of all evil.', 'Donald Knuth'],
  ['Simplicity is prerequisite for reliability.', 'Edsger Dijkstra'],
  ['Talk is cheap. Show me the code.', 'Linus Torvalds'],
  ['One more problem. Then one more.', 'Nightdesk'],
  ['You do not have to feel like it. You only have to start.', 'Nightdesk'],
  ['Future you is watching this session.', 'Nightdesk'],
  ['Slow progress at 2 a.m. still counts.', 'Nightdesk'],
];

// Quotes pulled from the internet are added to this pool and kept on disk, so it keeps growing
// and still works offline. The built-in list above is the starting point.
const QUOTE_CAP = 1000;
const quote = { online: store.get('quotesOnline', []), changedAt: Date.now(), loading: false };
const allQuotes = () => [...QUOTES, ...quote.online];
quote.i = store.get('quoteIndex', Math.floor(Math.random() * QUOTES.length)) % allQuotes().length;

async function fetchQuotes(force) {
  const today = ymd(new Date());
  if (quote.loading) return;
  if (!force && (!settings.quotes || !settings.quotesOnline || store.get('quotesFetched', '') === today)) return;
  quote.loading = true;
  try {
    const fresh = await call(api.quotes.fetch());
    const have = new Set(allQuotes().map(([q]) => q.toLowerCase()));
    const added = fresh.filter(([q]) => { const k = q.toLowerCase(); if (have.has(k)) return false; have.add(k); return true; });
    quote.online = [...quote.online, ...added].slice(-QUOTE_CAP);
    store.set('quotesOnline', quote.online);
    store.set('quotesFetched', today);
    if (force) toast(added.length ? `Added ${added.length} new quotes (${allQuotes().length} total).` : 'No new quotes right now. Try again later.');
  } catch (err) {
    if (force) toast('Could not fetch quotes. Check your connection.');
  }
  quote.loading = false;
}

function renderQuote() {
  $('#quote').hidden = !settings.quotes;
  $('#b-quote').classList.toggle('on', settings.quotes);
  const list = allQuotes();
  quote.i %= list.length;
  const [text, by] = list[quote.i];
  $('#q-text').textContent = `“${text}”`;
  $('#q-by').textContent = by;
  fetchQuotes(false);
}
function cycleQuote(step) {
  const n = allQuotes().length;
  quote.i = (quote.i + step + n) % n;
  quote.changedAt = Date.now();
  store.set('quoteIndex', quote.i);
  renderQuote();
}
function tickQuote() {
  if (settings.quotes && settings.quoteMin > 0 && Date.now() - quote.changedAt >= settings.quoteMin * 60000) cycleQuote(1);
}

$('#q-prev').addEventListener('click', () => cycleQuote(-1));
$('#q-next').addEventListener('click', () => cycleQuote(1));
$('#quote p').addEventListener('click', () => cycleQuote(1));
on('arrow', (step) => { if (settings.quotes && settings.view === 'clock') cycleQuote(step); });
on('settings', renderQuote);
