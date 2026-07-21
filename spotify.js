"use strict";

/*
  Bark Beat Spotify Integration
  Authorization Code with PKCE
*/

// Safe to expose in browser code.
// Never add your Spotify Client Secret here.
const SPOTIFY_CLIENT_ID = "42556580e4224ecaa7de1f4ec4c37263";

const SPOTIFY_REDIRECT_URI =
  window.location.hostname === "127.0.0.1"
    ? "http://127.0.0.1:5500/callback"
    : "https://adampherigo-sketch.github.io/bark-beat-player/";

const SPOTIFY_SCOPES = [
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-recently-played"
];

const spotifyLoginButton =
  document.getElementById("spotify-login-btn");

const spotifyStatus =
  document.getElementById("spotify-status");

const trackTitle =
  document.getElementById("track-title");

const trackArtist =
  document.getElementById("track-artist");

const coverImage =
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

let spotifyPlaybackState = null;
let spotifyRefreshTimer = null;

/*
  Create a random PKCE verifier.
*/
function generateRandomString(length) {
  const possibleCharacters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  const randomValues =
    crypto.getRandomValues(new Uint8Array(length));

  return Array.from(randomValues)
    .map(
      value =>
        possibleCharacters[
          value % possibleCharacters.length
        ]
    )
    .join("");
}

/*
  Hash the verifier using SHA-256.
*/
async function createCodeChallenge(verifier) {
  const data =
    new TextEncoder().encode(verifier);

  const digest =
    await crypto.subtle.digest("SHA-256", data);

  return base64UrlEncode(digest);
}

/*
  Convert the SHA-256 result into Spotify's
  required URL-safe Base64 format.
*/
function base64UrlEncode(arrayBuffer) {
  const bytes =
    new Uint8Array(arrayBuffer);

  let binaryString = "";

  bytes.forEach(byte => {
    binaryString += String.fromCharCode(byte);
  });

  return btoa(binaryString)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/*
  Send the user to Spotify's authorization page.
*/
async function connectSpotify() {
  if (
    !SPOTIFY_CLIENT_ID ||
    SPOTIFY_CLIENT_ID === "PASTE_YOUR_CLIENT_ID_HERE"
  ) {
    updateSpotifyStatus(
      "Add your Spotify Client ID to spotify.js first."
    );

    return;
  }

  const verifier =
    generateRandomString(64);

  const challenge =
    await createCodeChallenge(verifier);

  localStorage.setItem(
    "spotify_code_verifier",
    verifier
  );

  const authorizationUrl =
    new URL("https://accounts.spotify.com/authorize");

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

/*
  Spotify redirects back with ?code=...
  Exchange that code for an access token.
*/
async function handleSpotifyCallback() {
  const urlParameters =
    new URLSearchParams(window.location.search);

  const authorizationCode =
    urlParameters.get("code");

  const authorizationError =
    urlParameters.get("error");

  if (authorizationError) {
    updateSpotifyStatus(
      `Spotify connection failed: ${authorizationError}`
    );

    clearSpotifyQueryParameters();

    return;
  }

  if (!authorizationCode) {
    return;
  }

  const verifier =
    localStorage.getItem("spotify_code_verifier");

  if (!verifier) {
    updateSpotifyStatus(
      "Spotify login data was missing. Please connect again."
    );

    return;
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
            grant_type: "authorization_code",
            code: authorizationCode,
            redirect_uri: SPOTIFY_REDIRECT_URI,
            code_verifier: verifier
          })
        }
      );

    if (!response.ok) {
      const errorDetails =
        await response.text();

      throw new Error(
        `Spotify token request failed: ${errorDetails}`
      );
    }

    const tokenData =
      await response.json();

    saveSpotifyTokens(tokenData);

    localStorage.removeItem(
      "spotify_code_verifier"
    );

    clearSpotifyQueryParameters();

    updateSpotifyStatus(
      "Spotify connected"
    );
  } catch (error) {
    console.error(error);

    updateSpotifyStatus(
      "Spotify could not finish connecting."
    );
  }
}

/*
  Save access and refresh tokens locally.
*/
function saveSpotifyTokens(tokenData) {
  const expirationTime =
    Date.now() +
    tokenData.expires_in * 1000;

  localStorage.setItem(
    "spotify_access_token",
    tokenData.access_token
  );

  localStorage.setItem(
    "spotify_token_expires_at",
    String(expirationTime)
  );

  if (tokenData.refresh_token) {
    localStorage.setItem(
      "spotify_refresh_token",
      tokenData.refresh_token
    );
  }
}

/*
  Refresh an expired Spotify access token.
*/
async function refreshSpotifyAccessToken() {
  const refreshToken =
    localStorage.getItem(
      "spotify_refresh_token"
    );

  if (!refreshToken) {
    disconnectSpotify();

    throw new Error(
      "No Spotify refresh token is available."
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
    disconnectSpotify();

    throw new Error(
      "Spotify token refresh failed."
    );
  }

  const tokenData =
    await response.json();

  saveSpotifyTokens(tokenData);

  return tokenData.access_token;
}

/*
  Return a valid access token.
*/
async function getSpotifyAccessToken() {
  const accessToken =
    localStorage.getItem(
      "spotify_access_token"
    );

  const expirationTime =
    Number(
      localStorage.getItem(
        "spotify_token_expires_at"
      )
    );

  if (!accessToken) {
    return null;
  }

  const tokenExpiresSoon =
    Date.now() >= expirationTime - 60000;

  if (tokenExpiresSoon) {
    return refreshSpotifyAccessToken();
  }

  return accessToken;
}

/*
  General Spotify API request helper.
*/
async function spotifyApiRequest(
  endpoint,
  options = {}
) {
  const accessToken =
    await getSpotifyAccessToken();

  if (!accessToken) {
    throw new Error(
      "Spotify is not connected."
    );
  }

  const response =
    await fetch(
      `https://api.spotify.com/v1${endpoint}`,
      {
        ...options,

        headers: {
          Authorization:
            `Bearer ${accessToken}`,

          "Content-Type":
            "application/json",

          ...options.headers
        }
      }
    );

  if (response.status === 401) {
    await refreshSpotifyAccessToken();

    return spotifyApiRequest(
      endpoint,
      options
    );
  }

  if (!response.ok && response.status !== 204) {
    const errorText =
      await response.text();

    throw new Error(
      `Spotify API error ${response.status}: ${errorText}`
    );
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

/*
  Read the active Spotify playback state.
*/
async function loadSpotifyPlayback() {
  try {
    const playbackState =
      await spotifyApiRequest(
        "/me/player?additional_types=track,episode"
      );

    if (!playbackState || !playbackState.item) {
      updateSpotifyStatus(
        "Spotify connected — start playing something in Spotify."
      );

      return;
    }

    spotifyPlaybackState =
      playbackState;

    renderSpotifyPlayback(
      playbackState
    );

    updateSpotifyStatus(
      playbackState.device?.name
        ? `Playing on ${playbackState.device.name}`
        : "Spotify connected"
    );
  } catch (error) {
    console.error(error);

    updateSpotifyStatus(
      error.message
    );
  }
}

/*
  Put Spotify track information into Bark Beat.
*/
function renderSpotifyPlayback(playbackState) {
  const item =
    playbackState.item;

  const artistNames =
    item.artists
      ? item.artists
          .map(artist => artist.name)
          .join(", ")
      : item.show?.name || "Spotify";

  if (trackTitle) {
    trackTitle.textContent =
      item.name || "Unknown title";
  }

  if (trackArtist) {
    trackArtist.textContent =
      artistNames;
  }

  const imageUrl =
    item.album?.images?.[0]?.url ||
    item.images?.[0]?.url ||
    item.show?.images?.[0]?.url;

  if (coverImage && imageUrl) {
    coverImage.src = imageUrl;
    coverImage.alt =
      `${item.name} cover artwork`;
  }

  if (playButton) {
    playButton.textContent =
      playbackState.is_playing
        ? "⏸"
        : "▶";
  }

  const progressMilliseconds =
    playbackState.progress_ms || 0;

  const durationMilliseconds =
    item.duration_ms || 0;

  if (progressInput) {
    progressInput.max =
      String(durationMilliseconds);

    progressInput.value =
      String(progressMilliseconds);
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
}

/*
  Play or pause Spotify.
*/
async function toggleSpotifyPlayback() {
  if (!spotifyPlaybackState) {
    await loadSpotifyPlayback();

    return;
  }

  const endpoint =
    spotifyPlaybackState.is_playing
      ? "/me/player/pause"
      : "/me/player/play";

  await spotifyApiRequest(
    endpoint,
    {
      method: "PUT"
    }
  );

  await wait(400);

  await loadSpotifyPlayback();
}

/*
  Skip to the next song.
*/
async function skipSpotifyNext() {
  await spotifyApiRequest(
    "/me/player/next",
    {
      method: "POST"
    }
  );

  await wait(500);

  await loadSpotifyPlayback();
}

/*
  Go to the previous song.
*/
async function skipSpotifyPrevious() {
  await spotifyApiRequest(
    "/me/player/previous",
    {
      method: "POST"
    }
  );

  await wait(500);

  await loadSpotifyPlayback();
}

/*
  Seek when the user moves Bark Beat's progress slider.
*/
async function seekSpotifyPlayback() {
  const positionMilliseconds =
    Number(progressInput.value);

  await spotifyApiRequest(
    `/me/player/seek?position_ms=${positionMilliseconds}`,
    {
      method: "PUT"
    }
  );

  await loadSpotifyPlayback();
}

/*
  Clear Spotify tokens and reset the connection.
*/
function disconnectSpotify() {
  localStorage.removeItem(
    "spotify_access_token"
  );

  localStorage.removeItem(
    "spotify_refresh_token"
  );

  localStorage.removeItem(
    "spotify_token_expires_at"
  );

  localStorage.removeItem(
    "spotify_code_verifier"
  );

  spotifyPlaybackState = null;

  if (spotifyRefreshTimer) {
    clearInterval(
      spotifyRefreshTimer
    );
  }

  updateSpotifyStatus(
    "Spotify is not connected"
  );

  if (spotifyLoginButton) {
    spotifyLoginButton.textContent =
      "Connect Spotify";
  }
}

/*
  Remove ?code=... from the visible URL.
*/
function clearSpotifyQueryParameters() {
  window.history.replaceState(
    {},
    document.title,
    window.location.pathname
  );
}

function updateSpotifyStatus(message) {
  if (spotifyStatus) {
    spotifyStatus.textContent =
      message;
  }
}

function formatSpotifyTime(milliseconds) {
  const totalSeconds =
    Math.floor(milliseconds / 1000);

  const minutes =
    Math.floor(totalSeconds / 60);

  const seconds =
    String(totalSeconds % 60)
      .padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function wait(milliseconds) {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

/*
  Start Spotify integration.
*/
async function initializeSpotify() {
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

  await loadSpotifyPlayback();

  spotifyRefreshTimer =
    window.setInterval(
      loadSpotifyPlayback,
      5000
    );
}

spotifyLoginButton?.addEventListener(
  "click",
  async () => {
    const accessToken =
      localStorage.getItem(
        "spotify_access_token"
      );

    if (accessToken) {
      disconnectSpotify();

      return;
    }

    await connectSpotify();
  }
);

playButton?.addEventListener(
  "click",
  async event => {
    event.preventDefault();

    try {
      await toggleSpotifyPlayback();
    } catch (error) {
      console.error(error);

      updateSpotifyStatus(
        error.message
      );
    }
  }
);

nextButton?.addEventListener(
  "click",
  async event => {
    event.preventDefault();

    try {
      await skipSpotifyNext();
    } catch (error) {
      console.error(error);

      updateSpotifyStatus(
        error.message
      );
    }
  }
);

previousButton?.addEventListener(
  "click",
  async event => {
    event.preventDefault();

    try {
      await skipSpotifyPrevious();
    } catch (error) {
      console.error(error);

      updateSpotifyStatus(
        error.message
      );
    }
  }
);

progressInput?.addEventListener(
  "change",
  async () => {
    try {
      await seekSpotifyPlayback();
    } catch (error) {
      console.error(error);

      updateSpotifyStatus(
        error.message
      );
    }
  }
);

initializeSpotify();
