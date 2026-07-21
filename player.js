Js/player.js


const audio = document.getElementById("audio");
const playButton = document.getElementById("play-btn");
const progress = document.getElementById("progress");
const currentTimeText = document.getElementById("current-time");
const durationText = document.getElementById("duration");
const volume = document.getElementById("volume");

let isPlaying = false;

function togglePlay() {
  if (isPlaying) {
    audio.pause();
    playButton.textContent = "▶";
    isPlaying = false;
  } else {
    audio.play();
    playButton.textContent = "❚❚";
    isPlaying = true;
  }
}

function formatTime(time) {
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);

  if (seconds < 10) {
    return `${minutes}:0${seconds}`;
  }

  return `${minutes}:${seconds}`;
}

function updateProgress() {
  if (audio.duration) {
    const progressPercent = (audio.currentTime / audio.duration) * 100;
    progress.value = progressPercent;

    currentTimeText.textContent = formatTime(audio.currentTime);
    durationText.textContent = formatTime(audio.duration);
  }
}

function scrubAudio() {
  if (audio.duration) {
    audio.currentTime = (progress.value / 100) * audio.duration;
  }
}

function changeVolume() {
  audio.volume = volume.value;
}

playButton.addEventListener("click", togglePlay);
audio.addEventListener("timeupdate", updateProgress);
progress.addEventListener("input", scrubAudio);
volume.addEventListener("input", changeVolume);