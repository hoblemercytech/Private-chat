import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const config = window.APP_CONFIG;

const supabase = createClient(
  config.SUPABASE_URL,
  config.SUPABASE_ANON_KEY
);

const sessionToken = new URLSearchParams(
  window.location.search
).get("s");

const consentCheckbox = document.getElementById(
  "consentCheckbox"
);

const visitorNameInput = document.getElementById(
  "visitorName"
);

const shareLocationBtn = document.getElementById(
  "shareLocationBtn"
);

const stopSharingBtn = document.getElementById(
  "stopSharingBtn"
);

const statusMessage = document.getElementById(
  "statusMessage"
);

const accuracyValue = document.getElementById(
  "accuracyValue"
);

const lastSentValue = document.getElementById(
  "lastSentValue"
);

const invalidLink = document.getElementById(
  "invalidLink"
);

let watchId = null;

let isSending = false;

let firstLocationSent = false;

let lastSentTime = 0;

let lastPosition = null;

const minimumSendInterval = 5000;

const minimumMovementDistance = 20;

/* ============================
   CHECK LINK
============================ */

if (!sessionToken) {
  invalidLink.classList.remove("hidden");

  shareLocationBtn.disabled = true;

  showStatus(
    "This sharing link is missing its session code.",
    "error"
  );
}

/* ============================
   BUTTON EVENTS
============================ */

shareLocationBtn.addEventListener(
  "click",
  startLocationSharing
);

stopSharingBtn.addEventListener(
  "click",
  stopLocationSharing
);

window.addEventListener(
  "beforeunload",
  clearLocationWatch
);

/* ============================
   START SHARING
============================ */

function startLocationSharing() {
  if (!sessionToken) {
    showStatus(
      "This sharing link is invalid.",
      "error"
    );

    return;
  }

  if (!consentCheckbox.checked) {
    showStatus(
      "Please tick the consent box before sharing.",
      "error"
    );

    return;
  }

  if (!navigator.geolocation) {
    showStatus(
      "Your browser does not support location access.",
      "error"
    );

    return;
  }

  shareLocationBtn.disabled = true;

  shareLocationBtn.textContent =
    "Requesting Permission...";

  showStatus(
    "Please allow location access in your browser."
  );

  watchId = navigator.geolocation.watchPosition(
    handleLocationUpdate,
    handleLocationError,
    {
      enableHighAccuracy: true,
      timeout: 25000,
      maximumAge: 3000
    }
  );

  stopSharingBtn.classList.remove("hidden");
}

/* ============================
   HANDLE LOCATION
============================ */

async function handleLocationUpdate(position) {
  const coordinates = position.coords;
  const currentTime = Date.now();

  const movedDistance = lastPosition
    ? calculateDistance(
        lastPosition.latitude,
        lastPosition.longitude,
        coordinates.latitude,
        coordinates.longitude
      )
    : Infinity;

  const timeSinceLastSend = currentTime - lastSentTime;

  const shouldSend =
    !firstLocationSent ||
    timeSinceLastSend >= minimumSendInterval ||
    movedDistance >= minimumMovementDistance;

  if (!shouldSend) return;
  if (isSending) return;

  isSending = true;

  const device = getDeviceInformation();

  const payload = {
    tracking_code: sessionToken,          // was session_token
    visitor_name: visitorNameInput.value.trim() || null,

    latitude: coordinates.latitude,        // flattened, was nested under `location`
    longitude: coordinates.longitude,
    accuracy: coordinates.accuracy ?? null,
    altitude: coordinates.altitude ?? null,
    altitude_accuracy: coordinates.altitudeAccuracy ?? null,
    speed: coordinates.speed ?? null,
    heading: coordinates.heading ?? null,

    ...device                              // flattened, was nested under `device`
  };

  try {
    showStatus(
      firstLocationSent
        ? "Updating your live location..."
        : "Sending your first location..."
    );

    const { error } = await supabase.functions.invoke("submit-location", {
  body: {
    tracking_code: sessionToken,   // was session_token
    action: "stop"
  }
});



    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || "The location update was rejected.");

    firstLocationSent = true;
    lastSentTime = currentTime;
    lastPosition = {
      latitude: coordinates.latitude,
      longitude: coordinates.longitude
    };

    accuracyValue.textContent = coordinates.accuracy
      ? `±${Math.round(coordinates.accuracy)} metres`
      : "Unknown";

    lastSentValue.textContent = new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });

    shareLocationBtn.classList.add("hidden");
    stopSharingBtn.classList.remove("hidden");

    showStatus("Your live location is being shared. Keep this page open.", "success");
  } catch (error) {
    console.error("Location sending error:", error);
    showStatus(error.message || "Your location could not be sent.", "error");
    shareLocationBtn.disabled = false;
    shareLocationBtn.textContent = "Share Live Location";
  } finally {
    isSending = false;
  }
}




/* ============================
   STOP SHARING
============================ */

async function stopLocationSharing() {
  clearLocationWatch();

  stopSharingBtn.disabled = true;

  stopSharingBtn.textContent =
    "Stopping...";

  try {
    if (sessionToken) {
      const { error } =
        await supabase.functions.invoke(
          "submit-location",
          {
            body: {
              session_token:
                sessionToken,

              action: "stop"
            }
          }
        );

      if (error) {
        console.warn(
          "Could not update stopped state:",
          error
        );
      }
    }

    firstLocationSent = false;

    lastPosition = null;

    lastSentTime = 0;

    shareLocationBtn.classList.remove(
      "hidden"
    );

    shareLocationBtn.disabled = false;

    shareLocationBtn.textContent =
      "Share Live Location";

    stopSharingBtn.classList.add(
      "hidden"
    );

    showStatus(
      "Location sharing has stopped."
    );
  } catch (error) {
    console.error(
      "Stop sharing error:",
      error
    );

    showStatus(
      "Location sharing stopped on this device, but the server status could not be updated.",
      "error"
    );
  } finally {
    stopSharingBtn.disabled = false;

    stopSharingBtn.textContent =
      "Stop Sharing";
  }
}

/* ============================
   LOCATION ERRORS
============================ */

function handleLocationError(error) {
  clearLocationWatch();

  shareLocationBtn.disabled = false;

  shareLocationBtn.textContent =
    "Share Live Location";

  stopSharingBtn.classList.add(
    "hidden"
  );

  let message =
    "Your location could not be retrieved.";

  if (
    error.code ===
    error.PERMISSION_DENIED
  ) {
    message =
      "Location permission was denied. Open your browser settings, allow location access and try again.";
  }

  if (
    error.code ===
    error.POSITION_UNAVAILABLE
  ) {
    message =
      "Your device could not determine its location. Turn on GPS and try again.";
  }

  if (
    error.code ===
    error.TIMEOUT
  ) {
    message =
      "The location request timed out. Move to an open area and try again.";
  }

  showStatus(
    message,
    "error"
  );
}

/* ============================
   DEVICE INFORMATION
============================ */

function getDeviceInformation() {
  const connection =
    navigator.connection || navigator.mozConnection || navigator.webkitConnection;

  const ua = navigator.userAgent || "";

  // Simple parse — good enough unless you want a UA-parsing library
  const browserName = ua.includes("Edg/") ? "Edge"
    : ua.includes("Firefox/") ? "Firefox"
    : ua.includes("Chrome/") ? "Chrome"
    : ua.includes("Safari/") ? "Safari"
    : "Unknown";

  const operatingSystem = ua.includes("Windows") ? "Windows"
    : ua.includes("Mac OS") ? "macOS"
    : ua.includes("Android") ? "Android"
    : ua.includes("iPhone") || ua.includes("iPad") ? "iOS"
    : ua.includes("Linux") ? "Linux"
    : "Unknown";

  return {
    browser_name: browserName,
    browser_version: null,          // fill in if you add a proper UA parser
    operating_system: operatingSystem,
    device_type: /Mobi|Android/i.test(ua) ? "mobile" : "desktop",
    device_vendor: null,
    device_model: null,
    platform: navigator.userAgentData?.platform || navigator.platform || "Unknown",
    user_agent: ua || "Unknown",
    language: navigator.language || "Unknown",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Unknown",
    network_type: connection?.type || "Unknown",
    effective_network_type: connection?.effectiveType || "Unknown",
    connection_downlink: connection?.downlink ?? null,
    connection_rtt: connection?.rtt ?? null,
    screen_width: window.screen.width,
    screen_height: window.screen.height,
    pixel_ratio: window.devicePixelRatio ?? null,
    battery_level: null,   // Battery Status API is deprecated/removed in most browsers
    battery_charging: null
  };
}


/* ============================
   CLEAR LOCATION WATCH
============================ */

function clearLocationWatch() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(
      watchId
    );

    watchId = null;
  }
}

/* ============================
   STATUS MESSAGE
============================ */

function showStatus(
  message,
  type = ""
) {
  statusMessage.textContent = message;

  statusMessage.className =
    "message-box";

  if (type === "success") {
    statusMessage.classList.add(
      "success-message"
    );
  }

  if (type === "error") {
    statusMessage.classList.add(
      "error-message"
    );
  }
}

/* ============================
   DISTANCE CALCULATION
============================ */

function calculateDistance(
  latitude1,
  longitude1,
  latitude2,
  longitude2
) {
  const earthRadius = 6371000;

  const latitude1Radians =
    latitude1 * Math.PI / 180;

  const latitude2Radians =
    latitude2 * Math.PI / 180;

  const latitudeDifference =
    (
      latitude2 - latitude1
    ) * Math.PI / 180;

  const longitudeDifference =
    (
      longitude2 - longitude1
    ) * Math.PI / 180;

  const calculation =
    Math.sin(
      latitudeDifference / 2
    ) ** 2 +
    Math.cos(
      latitude1Radians
    ) *
    Math.cos(
      latitude2Radians
    ) *
    Math.sin(
      longitudeDifference / 2
    ) ** 2;

  const angularDistance =
    2 *
    Math.atan2(
      Math.sqrt(calculation),
      Math.sqrt(
        1 - calculation
      )
    );

  return earthRadius *
    angularDistance;
}