"use strict";

/* ========================================
   BARK BEAT — SPOTIFY INTEGRATION

   Uses Spotify Authorization Code with PKCE.
   Do not place your Spotify Client Secret here.
======================================== */

const SPOTIFY_CLIENT_ID =
  "42556580e4224ecaa7de1f4ec4c37263";

const LOCAL_REDIRECT_URI =
  "http://127.0.0.1:5500/callback";

const GITHUB_REDIRECT_URI =
  "https://adampherigo-sketch.github.io/bark-beat-player/";

const SPOTIFY_REDIRECT_URI =
  window.location.hostname === "127.0.0.1"
    ? LOCAL_REDIRECT_URI
    : GITHUB_REDIRECT_URI;

const SPOTIFY_SCOPES = [
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-recently-played"
];

/* ========================================
   PAGE ELEMENTS
======================================== */

const spotifyLoginButton =
  document.getElementById("spotify-login-btn");

const spotifyStatus =
  document.getElementById("spotify-status");

const trackTitle =
  document.getElementById("track-title");

const trackArtist =
  document.getElementById("track-artist");

const trackAlbum =
  document.getElementById("track-album");

const coverImage =
  document.getElementById("cover-image") ||
  document.querySelector(".cover-card img");

const playButton =
  document.getElementById("play-btn");

const nextButton =
  document.getElementById("next-btn");

const previousButton =
  document.getElementById("back-btn");

const progressInput =
  document.getElementById("progress");

const currentTimeElement =
  document.getElementById("current-time");

const durationElement =
  document.getElementById("duration");

const volumeInput =
  document.getElementById("volume");

const recentlyPlayedContainer =
  document.getElementById("recently-played");

const playlistTotal =
  document.getElementById("playlist-total");

/* ========================================
   APP STATE
======================================== */

let spotifyPlaybackState = null;

let spotifyRefreshTimer = null;
let progressTimer = null;
let volumeChangeTimer = null;

let spotifyControlIsBusy = false;
let tokenRefreshPromise = null;

let lastLoadedTrackId = null;

/* ========================================
   TOKEN STORAGE KEYS
======================================== */

const TOKEN_STORAGE_KEYS = {
  accessToken: "spotify_access_token",
  refreshToken: "spotify_refresh_token",
  expiresAt: "spotify_token_expires_at",
  codeVerifier: "spotify_code_verifier"
};

/* ========================================
   PKCE HELPERS
======================================== */

function generateRandomString(length = 64) {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

  const randomValues =
    crypto.getRandomValues(
      new Uint8Array(length)
    );

  return Array.from(randomValues)
    .map((value) => {
      return characters[
        value % characters.length
      ];
    })
    .join("");
}

async function createCodeChallenge(verifier) {
  const encodedVerifier =
    new TextEncoder().encode(verifier);

  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      encodedVerifier
    );

  return base64UrlEncode(digest);
}

function base64UrlEncode(arrayBuffer) {
  const bytes =
    new Uint8Array(arrayBuffer);

  let binaryString = "";

  bytes.forEach((byte) => {
    binaryString +=
      String.fromCharCode(byte);
  });

  return btoa(binaryString)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/* ========================================
   SPOTIFY LOGIN
======================================== */

async function connectSpotify() {
  if (!SPOTIFY_CLIENT_ID) {
    updateSpotifyStatus(
      "Spotify Client ID is missing."
    );

    return;
  }

  const verifier =
    generateRandomString(64);

  const challenge =
    await createCodeChallenge(verifier);

  localStorage.setItem(
    TOKEN_STORAGE_KEYS.codeVerifier,
    verifier
  );

  const authorizationUrl =
    new URL(
      "https://accounts.spotify.com/authorize"
    );

  authorizationUrl.search =
    new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      response_type: "code",
      redirect_uri: SPOTIFY_REDIRECT_URI,
      scope: SPOTIFY_SCOPES.join(" "),
      code_challenge_method: "S256",
      code_challenge: challenge,
      show_dialog: "true"
    }).toString();

  window.location.assign(
    authorizationUrl.toString()
  );
}

async function handleSpotifyCallback() {
  const urlParameters =
    new URLSearchParams(
      window.location.search
    );

  const authorizationCode =
    urlParameters.get("code");

  const authorizationError =
    urlParameters.get("error");

  if (authorizationError) {
    updateSpotifyStatus(
      `Spotify connection failed: ${authorizationError}`
    );

    clearSpotifyQueryParameters();

    return false;
  }

  if (!authorizationCode) {
    return false;
  }

  const verifier =
    localStorage.getItem(
      TOKEN_STORAGE_KEYS.codeVerifier
    );

  if (!verifier) {
    updateSpotifyStatus(
      "Spotify login data is missing. Connect again."
    );

    clearSpotifyQueryParameters();

    return false;
  }

  updateSpotifyStatus(
    "Finishing Spotify connection..."
  );

  try {
    const response =
      await fetch(
        "https://accounts.spotify.com/api/token",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded"
          },

          body: new URLSearchParams({
            client_id: SPOTIFY_CLIENT_ID,
            grant_type:
              "authorization_code",
            code: authorizationCode,
            redirect_uri:
              SPOTIFY_REDIRECT_URI,
            code_verifier: verifier
          })
        }
      );

    if (!response.ok) {
      const errorDetails =
        await safelyReadResponseText(
          response
        );

      throw new Error(
        `Spotify authorization failed: ${errorDetails}`
      );
    }

    const tokenData =
      await response.json();

    saveSpotifyTokens(tokenData);

    localStorage.removeItem(
      TOKEN_STORAGE_KEYS.codeVerifier
    );

    clearSpotifyQueryParameters();

    updateSpotifyStatus(
      "Spotify connected successfully."
    );

    return true;
  } catch (error) {
    console.error(
      "Spotify callback error:",
      error
    );

    updateSpotifyStatus(
      "Spotify could not finish connecting."
    );

    clearSpotifyQueryParameters();

    return false;
  }
}

/* ========================================
   TOKEN MANAGEMENT
======================================== */

function saveSpotifyTokens(tokenData) {
  if (tokenData.access_token) {
    localStorage.setItem(
      TOKEN_STORAGE_KEYS.accessToken,
      tokenData.access_token
    );
  }

  if (tokenData.refresh_token) {
    localStorage.setItem(
      TOKEN_STORAGE_KEYS.refreshToken,
      tokenData.refresh_token
    );
  }

  const expiresInSeconds =
    Number(tokenData.expires_in) || 3600;

  const expirationTime =
    Date.now() +
    expiresInSeconds * 1000;

  localStorage.setItem(
    TOKEN_STORAGE_KEYS.expiresAt,
    String(expirationTime)
  );
}

async function getSpotifyAccessToken() {
  const accessToken =
    localStorage.getItem(
      TOKEN_STORAGE_KEYS.accessToken
    );

  if (!accessToken) {
    return null;
  }

  const expirationTime =
    Number(
      localStorage.getItem(
        TOKEN_STORAGE_KEYS.expiresAt
      )
    );

  const tokenExpiresSoon =
    !expirationTime ||
    Date.now() >= expirationTime - 60000;

  if (tokenExpiresSoon) {
    return refreshSpotifyAccessToken();
  }

  return accessToken;
}

async function refreshSpotifyAccessToken() {
  if (tokenRefreshPromise) {
    return tokenRefreshPromise;
  }

  tokenRefreshPromise =
    performTokenRefresh();

  try {
    return await tokenRefreshPromise;
  } finally {
    tokenRefreshPromise = null;
  }
}

async function performTokenRefresh() {
  const refreshToken =
    localStorage.getItem(
      TOKEN_STORAGE_KEYS.refreshToken
    );

  if (!refreshToken) {
    disconnectSpotify();

    throw new Error(
      "Spotify login expired. Connect again."
    );
  }

  const response =
    await fetch(
      "https://accounts.spotify.com/api/token",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body: new URLSearchParams({
          client_id: SPOTIFY_CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: refreshToken
        })
      }
    );

  if (!response.ok) {
    const errorDetails =
      await safelyReadResponseText(
        response
      );

    disconnectSpotify();

    throw new Error(
      `Spotify login refresh failed: ${errorDetails}`
    );
  }

  const tokenData =
    await response.json();

  saveSpotifyTokens(tokenData);

  return tokenData.access_token;
}

/* ========================================
   SPOTIFY API REQUESTS
======================================== */

async function spotifyApiRequest(
  endpoint,
  options = {},
  hasRetried = false
) {
  let accessToken =
    await getSpotifyAccessToken();

  if (!accessToken) {
    throw new Error(
      "Connect Bark Beat to Spotify first."
    );
  }

  let response =
    await fetchSpotifyEndpoint(
      endpoint,
      options,
      accessToken
    );

  if (
    response.status === 401 &&
    !hasRetried
  ) {
    accessToken =
      await refreshSpotifyAccessToken();

    response =
      await fetchSpotifyEndpoint(
        endpoint,
        options,
        accessToken
      );
  }

  if (response.status === 204) {
    return null;
  }

  if (response.status === 429) {
    const retryAfter =
      response.headers.get(
        "Retry-After"
      );

    throw new Error(
      retryAfter
        ? `Spotify is receiving commands too quickly. Try again in ${retryAfter} seconds.`
        : "Spotify is receiving commands too quickly. Wait a moment."
    );
  }

  if (response.status === 403) {
    throw new Error(
      "Spotify rejected this control. Confirm that you have Premium and an active playback device."
    );
  }

  if (response.status === 404) {
    throw new Error(
      "No active Spotify playback device was found."
    );
  }

  if (!response.ok) {
    const errorDetails =
      await safelyReadResponseText(
        response
      );

    throw new Error(
      `Spotify error ${response.status}: ${errorDetails}`
    );
  }

  const contentType =
    response.headers.get(
      "Content-Type"
    );

  if (
    contentType?.includes(
      "application/json"
    )
  ) {
    return response.json();
  }

  return null;
}

function fetchSpotifyEndpoint(
  endpoint,
  options,
  accessToken
) {
  const headers = {
    Authorization:
      `Bearer ${accessToken}`,
    ...options.headers
  };

  /*
    Only include a JSON Content-Type when
    an actual body is being sent.
  */
  if (options.body) {
    headers["Content-Type"] =
      "application/json";
  }

  return fetch(
    `https://api.spotify.com/v1${endpoint}`,
    {
      ...options,
      headers
    }
  );
}

/* ========================================
   PLAYBACK STATE
======================================== */

async function getSpotifyPlaybackState() {
  return spotifyApiRequest(
    "/me/player?additional_types=track,episode"
  );
}

async function loadSpotifyPlayback({
  showErrors = true
} = {}) {
  try {
    const playbackState =
      await getSpotifyPlaybackState();

    if (
      !playbackState ||
      !playbackState.item
    ) {
      spotifyPlaybackState = null;

      stopProgressTimer();

      updateSpotifyStatus(
        "Spotify connected — start playing something in Spotify."
      );

      return null;
    }

    const previousTrackId =
      spotifyPlaybackState?.item?.id;

    spotifyPlaybackState =
      playbackState;

    renderSpotifyPlayback(
      playbackState
    );

    startProgressTimer();

    const currentTrackId =
      playbackState.item.id;

    if (
      currentTrackId &&
      currentTrackId !== previousTrackId
    ) {
      lastLoadedTrackId =
        currentTrackId;

      loadRecentlyPlayed({
        showErrors: false
      });
    }

    const deviceName =
      playbackState.device?.name;

    updateSpotifyStatus(
      deviceName
        ? `Playing on ${deviceName}`
        : "Spotify connected"
    );

    return playbackState;
  } catch (error) {
    console.error(
      "Spotify playback error:",
      error
    );

    if (showErrors) {
      updateSpotifyStatus(
        error.message
      );
    }

    return null;
  }
}

/* ========================================
   RENDER NOW PLAYING
======================================== */

function renderSpotifyPlayback(
  playbackState
) {
  const item =
    playbackState.item;

  if (!item) {
    return;
  }

  const isEpisode =
    item.type === "episode";

  const artistNames =
    isEpisode
      ? item.show?.name ||
        "Spotify Podcast"
      : item.artists
          ?.map((artist) => {
            return artist.name;
          })
          .join(", ") ||
        "Unknown artist";

  const albumName =
    isEpisode
      ? item.show?.publisher ||
        item.show?.name ||
        "Podcast"
      : item.album?.name ||
        "Unknown album";

  const imageUrl =
    isEpisode
      ? item.images?.[0]?.url ||
        item.show?.images?.[0]?.url
      : item.album?.images?.[0]?.url;

  if (trackTitle) {
    trackTitle.textContent =
      item.name || "Unknown title";
  }

  if (trackArtist) {
    trackArtist.textContent =
      artistNames;
  }

  if (trackAlbum) {
    trackAlbum.textContent =
      albumName;
  }

  if (coverImage && imageUrl) {
    coverImage.src = imageUrl;

    coverImage.alt =
      `${item.name || "Spotify"} cover artwork`;
  }

  if (playButton) {
    playButton.textContent =
      playbackState.is_playing
        ? "❚❚"
        : "▶";

    playButton.setAttribute(
      "aria-label",
      playbackState.is_playing
        ? "Pause Spotify"
        : "Play Spotify"
    );
  }

  const progressMilliseconds =
    Number(
      playbackState.progress_ms
    ) || 0;

  const durationMilliseconds =
    Number(item.duration_ms) || 0;

  if (progressInput) {
    progressInput.min = "0";

    progressInput.max =
      String(
        Math.max(
          durationMilliseconds,
          1
        )
      );

    progressInput.value =
      String(
        Math.min(
          progressMilliseconds,
          durationMilliseconds
        )
      );
  }

  if (currentTimeElement) {
    currentTimeElement.textContent =
      formatSpotifyTime(
        progressMilliseconds
      );
  }

  if (durationElement) {
    durationElement.textContent =
      formatSpotifyTime(
        durationMilliseconds
      );
  }

  const deviceVolume =
    playbackState.device
      ?.volume_percent;

  if (
    volumeInput &&
    typeof deviceVolume === "number"
  ) {
    volumeInput.value =
      String(deviceVolume);
  }
}

/* ========================================
   ACTIVE DEVICE HELPERS
======================================== */

function getActiveSpotifyDeviceId() {
  return (
    spotifyPlaybackState
      ?.device
      ?.id || null
  );
}

function createDeviceEndpoint(endpoint) {
  const deviceId =
    getActiveSpotifyDeviceId();

  if (!deviceId) {
    return endpoint;
  }

  const separator =
    endpoint.includes("?")
      ? "&"
      : "?";

  return (
    `${endpoint}${separator}` +
    `device_id=${encodeURIComponent(deviceId)}`
  );
}

/* ========================================
   CONTROL LOCK
======================================== */

function setPlaybackButtonsDisabled(
  disabled
) {
  if (playButton) {
    playButton.disabled = disabled;
  }

  if (nextButton) {
    nextButton.disabled = disabled;
  }

  if (previousButton) {
    previousButton.disabled =
      disabled;
  }
}

async function runSpotifyControl(action) {
  if (spotifyControlIsBusy) {
    return;
  }

  spotifyControlIsBusy = true;

  setPlaybackButtonsDisabled(true);

  try {
    await action();
  } finally {
    await wait(500);

    spotifyControlIsBusy = false;

    setPlaybackButtonsDisabled(false);
  }
}

/* ========================================
   PLAY AND PAUSE
======================================== */

async function toggleSpotifyPlayback() {
  await runSpotifyControl(
    async () => {
      const playbackState =
        await loadSpotifyPlayback();

      if (!playbackState) {
        updateSpotifyStatus(
          "Start playing something in Spotify first."
        );

        return;
      }

      const endpoint =
        playbackState.is_playing
          ? "/me/player/pause"
          : "/me/player/play";

      updateSpotifyStatus(
        playbackState.is_playing
          ? "Pausing Spotify..."
          : "Starting Spotify..."
      );

      await spotifyApiRequest(
        createDeviceEndpoint(
          endpoint
        ),
        {
          method: "PUT"
        }
      );

      /*
        Update the interface immediately while
        Spotify finishes processing the command.
      */
      spotifyPlaybackState.is_playing =
        !playbackState.is_playing;

      if (playButton) {
        playButton.textContent =
          spotifyPlaybackState
            .is_playing
            ? "❚❚"
            : "▶";
      }

      await wait(700);

      await loadSpotifyPlayback();
    }
  );
}

/* ========================================
   NEXT TRACK
======================================== */

async function skipSpotifyNext() {
  await runSpotifyControl(
    async () => {
      const playbackState =
        await loadSpotifyPlayback();

      if (
        !playbackState ||
        !getActiveSpotifyDeviceId()
      ) {
        updateSpotifyStatus(
          "No active Spotify device was found."
        );

        return;
      }

      const startingTrackId =
        playbackState.item?.id;

      updateSpotifyStatus(
        "Skipping to the next track..."
      );

      await spotifyApiRequest(
        createDeviceEndpoint(
          "/me/player/next"
        ),
        {
          method: "POST"
        }
      );

      await waitForTrackChange(
        startingTrackId
      );
    }
  );
}

/* ========================================
   PREVIOUS TRACK
======================================== */

async function skipSpotifyPrevious() {
  await runSpotifyControl(
    async () => {
      const playbackState =
        await loadSpotifyPlayback();

      if (
        !playbackState ||
        !getActiveSpotifyDeviceId()
      ) {
        updateSpotifyStatus(
          "No active Spotify device was found."
        );

        return;
      }

      const startingTrackId =
        playbackState.item?.id;

      updateSpotifyStatus(
        "Going to the previous track..."
      );

      await spotifyApiRequest(
        createDeviceEndpoint(
          "/me/player/previous"
        ),
        {
          method: "POST"
        }
      );

      /*
        Spotify can restart the current track when
        Previous is pressed after the track has played
        for a while. The track ID may therefore remain
        the same even though the command succeeded.
      */
      await waitForTrackChange(
        startingTrackId,
        {
          allowSameTrack: true
        }
      );
    }
  );
}

async function waitForTrackChange(
  startingTrackId,
  {
    allowSameTrack = false
  } = {}
) {
  const maximumAttempts = 6;
  const delayMilliseconds = 450;

  for (
    let attempt = 0;
    attempt < maximumAttempts;
    attempt += 1
  ) {
    await wait(
      delayMilliseconds
    );

    const playbackState =
      await getSpotifyPlaybackState();

    if (
      !playbackState ||
      !playbackState.item
    ) {
      continue;
    }

    spotifyPlaybackState =
      playbackState;

    renderSpotifyPlayback(
      playbackState
    );

    const currentTrackId =
      playbackState.item.id;

    const restartedCurrentTrack =
      allowSameTrack &&
      currentTrackId ===
        startingTrackId &&
      Number(
        playbackState.progress_ms
      ) < 3000;

    if (
      currentTrackId !==
        startingTrackId ||
      restartedCurrentTrack
    ) {
      updateSpotifyStatus(
        playbackState.device?.name
          ? `Playing on ${playbackState.device.name}`
          : "Spotify connected"
      );

      loadRecentlyPlayed({
        showErrors: false
      });

      return;
    }
  }

  /*
    Even if the API takes longer than expected,
    perform one final refresh.
  */
  await loadSpotifyPlayback();
}

/* ========================================
   SEEKING
======================================== */

async function seekSpotifyPlayback() {
  if (!progressInput) {
    return;
  }

  await runSpotifyControl(
    async () => {
      const playbackState =
        await loadSpotifyPlayback();

      if (!playbackState) {
        updateSpotifyStatus(
          "Start playing something in Spotify first."
        );

        return;
      }

      const positionMilliseconds =
        Math.max(
          0,
          Math.round(
            Number(
              progressInput.value
            )
          )
        );

      updateSpotifyStatus(
        `Seeking to ${formatSpotifyTime(positionMilliseconds)}...`
      );

      await spotifyApiRequest(
        createDeviceEndpoint(
          `/me/player/seek?position_ms=${positionMilliseconds}`
        ),
        {
          method: "PUT"
        }
      );

      spotifyPlaybackState.progress_ms =
        positionMilliseconds;

      renderSpotifyPlayback(
        spotifyPlaybackState
      );

      await wait(500);

      await loadSpotifyPlayback();
    }
  );
}

/* ========================================
   VOLUME
======================================== */

async function changeSpotifyVolume() {
  if (!volumeInput) {
    return;
  }

  const volumePercent =
    Math.min(
      100,
      Math.max(
        0,
        Math.round(
          Number(volumeInput.value)
        )
      )
    );

  const playbackState =
    await loadSpotifyPlayback({
      showErrors: false
    });

  if (!playbackState) {
    updateSpotifyStatus(
      "Start playing something in Spotify first."
    );

    return;
  }

  await spotifyApiRequest(
    createDeviceEndpoint(
      `/me/player/volume?volume_percent=${volumePercent}`
    ),
    {
      method: "PUT"
    }
  );

  if (
    spotifyPlaybackState?.device
  ) {
    spotifyPlaybackState
      .device
      .volume_percent =
        volumePercent;
  }

  updateSpotifyStatus(
    `Spotify volume: ${volumePercent}%`
  );
}

/* ========================================
   RECENTLY PLAYED
======================================== */

async function loadRecentlyPlayed({
  showErrors = true
} = {}) {
  if (
    !recentlyPlayedContainer ||
    !playlistTotal
  ) {
    return;
  }

  try {
    const response =
      await spotifyApiRequest(
        "/me/player/recently-played?limit=5"
      );

    const recentItems =
      response?.items || [];

    if (recentItems.length === 0) {
      renderEmptyRecentlyPlayed();

      return;
    }

    recentlyPlayedContainer
      .replaceChildren();

    recentItems.forEach(
      ({ track }) => {
        if (!track) {
          return;
        }

        const playlistItem =
          createRecentlyPlayedItem(
            track
          );

        recentlyPlayedContainer
          .appendChild(
            playlistItem
          );
      }
    );

    playlistTotal.textContent =
      `${recentItems.length} recently played tracks`;
  } catch (error) {
    console.error(
      "Recently played error:",
      error
    );

    if (showErrors) {
      playlistTotal.textContent =
        "Recently played unavailable";
    }
  }
}

function createRecentlyPlayedItem(
  track
) {
  const playlistItem =
    document.createElement("div");

  playlistItem.className =
    "playlist-item";

  const artwork =
    document.createElement("img");

  artwork.src =
    track.album
      ?.images
      ?.[2]
      ?.url ||
    track.album
      ?.images
      ?.[0]
      ?.url ||
    "cover.jpg";

  artwork.alt = "";

  const trackInformation =
    document.createElement("div");

  const trackName =
    document.createElement("h4");

  trackName.textContent =
    track.name ||
    "Unknown track";

  const artistName =
    document.createElement("p");

  artistName.textContent =
    track.artists
      ?.map((artist) => {
        return artist.name;
      })
      .join(", ") ||
    "Unknown artist";

  trackInformation.append(
    trackName,
    artistName
  );

  const duration =
    document.createElement("span");

  duration.textContent =
    formatSpotifyTime(
      track.duration_ms || 0
    );

  playlistItem.append(
    artwork,
    trackInformation,
    duration
  );

  return playlistItem;
}

function renderEmptyRecentlyPlayed() {
  if (
    !recentlyPlayedContainer ||
    !playlistTotal
  ) {
    return;
  }

  recentlyPlayedContainer
    .replaceChildren();

  const playlistItem =
    document.createElement("div");

  playlistItem.className =
    "playlist-item";

  const artwork =
    document.createElement("img");

  artwork.src = "cover.jpg";
  artwork.alt = "";

  const information =
    document.createElement("div");

  const heading =
    document.createElement("h4");

  heading.textContent =
    "No recent tracks";

  const message =
    document.createElement("p");

  message.textContent =
    "Play something through Spotify.";

  information.append(
    heading,
    message
  );

  const emptyDuration =
    document.createElement("span");

  emptyDuration.textContent = "—";

  playlistItem.append(
    artwork,
    information,
    emptyDuration
  );

  recentlyPlayedContainer
    .appendChild(
      playlistItem
    );

  playlistTotal.textContent =
    "No recently played tracks found";
}

/* ========================================
   PROGRESS TIMER
======================================== */

function startProgressTimer() {
  stopProgressTimer();

  progressTimer =
    window.setInterval(
      () => {
        if (
          !spotifyPlaybackState ||
          !spotifyPlaybackState
            .is_playing ||
          !progressInput
        ) {
          return;
        }

        const duration =
          Number(
            progressInput.max
          ) || 0;

        const currentProgress =
          Number(
            progressInput.value
          ) || 0;

        const updatedProgress =
          Math.min(
            currentProgress + 1000,
            duration
          );

        progressInput.value =
          String(updatedProgress);

        if (currentTimeElement) {
          currentTimeElement.textContent =
            formatSpotifyTime(
              updatedProgress
            );
        }
      },
      1000
    );
}

function stopProgressTimer() {
  if (progressTimer) {
    clearInterval(
      progressTimer
    );

    progressTimer = null;
  }
}

/* ========================================
   CONNECTION MANAGEMENT
======================================== */

function disconnectSpotify() {
  Object.values(
    TOKEN_STORAGE_KEYS
  ).forEach((storageKey) => {
    localStorage.removeItem(
      storageKey
    );
  });

  spotifyPlaybackState = null;
  lastLoadedTrackId = null;

  stopSpotifyRefreshTimer();
  stopProgressTimer();

  if (volumeChangeTimer) {
    clearTimeout(
      volumeChangeTimer
    );

    volumeChangeTimer = null;
  }

  if (spotifyLoginButton) {
    spotifyLoginButton.textContent =
      "Connect Spotify";
  }

  if (playButton) {
    playButton.textContent = "▶";
  }

  updateSpotifyStatus(
    "Spotify is not connected"
  );

  if (playlistTotal) {
    playlistTotal.textContent =
      "Spotify not connected";
  }
}

/* ========================================
   REFRESH TIMER
======================================== */

function startSpotifyRefreshTimer() {
  stopSpotifyRefreshTimer();

  spotifyRefreshTimer =
    window.setInterval(
      () => {
        /*
          Avoid competing playback requests while
          a button command is being processed.
        */
        if (!spotifyControlIsBusy) {
          loadSpotifyPlayback({
            showErrors: false
          });
        }
      },
      5000
    );
}

function stopSpotifyRefreshTimer() {
  if (spotifyRefreshTimer) {
    clearInterval(
      spotifyRefreshTimer
    );

    spotifyRefreshTimer = null;
  }
}

/* ========================================
   GENERAL HELPERS
======================================== */

function updateSpotifyStatus(message) {
  if (spotifyStatus) {
    spotifyStatus.textContent =
      message;
  }
}

function formatSpotifyTime(
  milliseconds
) {
  const safeMilliseconds =
    Math.max(
      0,
      Number(milliseconds) || 0
    );

  const totalSeconds =
    Math.floor(
      safeMilliseconds / 1000
    );

  const minutes =
    Math.floor(
      totalSeconds / 60
    );

  const seconds =
    String(
      totalSeconds % 60
    ).padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function wait(milliseconds) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds
      );
    }
  );
}

async function safelyReadResponseText(
  response
) {
  try {
    const responseText =
      await response.text();

    return (
      responseText ||
      response.statusText ||
      "Unknown Spotify error"
    );
  } catch {
    return (
      response.statusText ||
      "Unknown Spotify error"
    );
  }
}

function clearSpotifyQueryParameters() {
  const cleanUrl =
    `${window.location.pathname}${window.location.hash}`;

  window.history.replaceState(
    {},
    document.title,
    cleanUrl
  );
}

function handleSpotifyError(
  error,
  context
) {
  console.error(
    `${context}:`,
    error
  );

  updateSpotifyStatus(
    error.message ||
    "Spotify encountered an error."
  );
}

/* ========================================
   EVENT LISTENERS
======================================== */

spotifyLoginButton
  ?.addEventListener(
    "click",
    async () => {
      const existingToken =
        localStorage.getItem(
          TOKEN_STORAGE_KEYS.accessToken
        );

      if (existingToken) {
        disconnectSpotify();

        return;
      }

      try {
        await connectSpotify();
      } catch (error) {
        handleSpotifyError(
          error,
          "Spotify login error"
        );
      }
    }
  );

playButton
  ?.addEventListener(
    "click",
    async (event) => {
      event.preventDefault();

      try {
        await toggleSpotifyPlayback();
      } catch (error) {
        handleSpotifyError(
          error,
          "Spotify play/pause error"
        );
      }
    }
  );

nextButton
  ?.addEventListener(
    "click",
    async (event) => {
      event.preventDefault();

      try {
        await skipSpotifyNext();
      } catch (error) {
        handleSpotifyError(
          error,
          "Spotify next-track error"
        );
      }
    }
  );

previousButton
  ?.addEventListener(
    "click",
    async (event) => {
      event.preventDefault();

      try {
        await skipSpotifyPrevious();
      } catch (error) {
        handleSpotifyError(
          error,
          "Spotify previous-track error"
        );
      }
    }
  );

progressInput
  ?.addEventListener(
    "input",
    () => {
      if (currentTimeElement) {
        currentTimeElement.textContent =
          formatSpotifyTime(
            progressInput.value
          );
      }
    }
  );

progressInput
  ?.addEventListener(
    "change",
    async () => {
      try {
        await seekSpotifyPlayback();
      } catch (error) {
        handleSpotifyError(
          error,
          "Spotify seek error"
        );
      }
    }
  );

volumeInput
  ?.addEventListener(
    "input",
    () => {
      if (volumeChangeTimer) {
        clearTimeout(
          volumeChangeTimer
        );
      }

      /*
        Debounce volume requests so dragging the
        slider does not flood Spotify with calls.
      */
      volumeChangeTimer =
        window.setTimeout(
          async () => {
            try {
              await changeSpotifyVolume();
            } catch (error) {
              handleSpotifyError(
                error,
                "Spotify volume error"
              );
            }
          },
          350
        );
    }
  );

/* ========================================
   INITIALIZE BARK BEAT
======================================== */

async function initializeSpotify() {
  try {
    await handleSpotifyCallback();

    const accessToken =
      await getSpotifyAccessToken();

    if (!accessToken) {
      updateSpotifyStatus(
        "Spotify is not connected"
      );

      return;
    }

    if (spotifyLoginButton) {
      spotifyLoginButton.textContent =
        "Disconnect Spotify";
    }

    updateSpotifyStatus(
      "Spotify connected"
    );

    await Promise.all([
      loadSpotifyPlayback(),
      loadRecentlyPlayed({
        showErrors: false
      })
    ]);

    startSpotifyRefreshTimer();
  } catch (error) {
    handleSpotifyError(
      error,
      "Spotify initialization error"
    );
  }
}

initializeSpotify();
