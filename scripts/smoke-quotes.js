// Quote mode check: NIGHTDESK_SHOTS=<dir> NIGHTDESK_EVAL=scripts/smoke-quotes.js electron .
(async () => {
  const r = { builtIn: QUOTES.length, before: allQuotes().length };
  // The top-bar Quotes switch is an overlay setting, not navigation.
  showView('focus');
  $('#b-quote').click();
  r.keepsCurrentView = settings.view === 'focus';
  $('#b-quote').click();
  settings.quotes = true; emit('settings');
  await new Promise((res) => setTimeout(res, 4000)); // automatic daily fetch
  r.afterAutoFetch = allQuotes().length;
  r.fetchedStamp = store.get('quotesFetched', '');
  await fetchQuotes(true); // manual "Fetch more now"
  r.afterManualFetch = allQuotes().length;
  r.sample = quote.online.slice(0, 2);
  r.persisted = store.get('quotesOnline', []).length;
  const start = quote.i;
  cycleQuote(1); const next = $('#q-text').textContent;
  cycleQuote(-1); r.cycleBackSame = quote.i === start && $('#q-text').textContent !== next;
  quote.i = allQuotes().length - 1; cycleQuote(1); r.wraps = quote.i === 0;
  settings.quoteMin = 1; quote.changedAt = Date.now() - 61000; const i0 = quote.i; tickQuote(); r.autoRotates = quote.i === i0 + 1;
  return JSON.stringify(r, null, 1);
})();
