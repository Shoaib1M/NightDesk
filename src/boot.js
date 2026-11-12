'use strict';
// Start-up: build the chrome, show the last view, and run the tick loops.

buildChrome();
applyTheme();
fillSubjects();
resetEventForm();
showView(settings.view === 'lamp' ? 'clock' : settings.view);
tickClock();
renderPomo();
renderTimer();
renderAlarms();
buddyTick();
renderQuote();

setInterval(() => { tickClock(); tickPomo(); tickTimer(); tickAlarms(); tickQuote(); }, 250);
setInterval(buddyTick, 700);
setInterval(() => {
 
  contestReminders();
  if (settings.view === 'contests') renderContests();
  if (settings.view === 'alarm') renderAlarms();
}, 30000);
setInterval(syncCalendar, 10 * 60000);
setInterval(loadContests, 30 * 60000);

syncCalendar();
loadContests();
loadCfUser();
