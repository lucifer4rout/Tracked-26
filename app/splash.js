const statusEl = document.getElementById("splashStatus");
const spinnerEl = document.getElementById("splashSpinner");
const progressTrackEl = document.getElementById("splashProgressTrack");
const progressFillEl = document.getElementById("splashProgressFill");

function render(status) {
  if (!status) return;

  switch (status.status) {
    case "checking":
      statusEl.textContent = "Checking for updates…";
      spinnerEl.hidden = false;
      progressTrackEl.hidden = true;
      break;

    case "dev-mode":
      statusEl.textContent = "Starting Tracked 26…";
      spinnerEl.hidden = false;
      progressTrackEl.hidden = true;
      break;

    case "up-to-date":
      statusEl.textContent = "You're up to date";
      spinnerEl.hidden = true;
      progressTrackEl.hidden = true;
      break;

    case "downloading":
      statusEl.textContent = status.version
        ? `Downloading v${status.version}…`
        : "Downloading update…";
      spinnerEl.hidden = true;
      progressTrackEl.hidden = false;
      progressFillEl.style.width = "0%";
      break;

    case "progress":
      progressTrackEl.hidden = false;
      progressFillEl.style.width = `${Math.round(status.percent || 0)}%`;
      statusEl.textContent = `Downloading… ${Math.round(status.percent || 0)}%`;
      break;

    case "restarting":
      statusEl.textContent = status.version
        ? `Restarting to install v${status.version}…`
        : "Restarting to install update…";
      spinnerEl.hidden = false;
      progressTrackEl.hidden = true;
      break;

    case "error":
      statusEl.textContent = "Couldn't check for updates — continuing…";
      spinnerEl.hidden = true;
      progressTrackEl.hidden = true;
      break;
  }
}

if (window.splashAPI) {
  window.splashAPI.onStatus(render);
}