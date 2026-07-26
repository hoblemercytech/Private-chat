import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* ==========================================================
   CONFIGURATION
========================================================== */

const config = window.APP_CONFIG;

if (
  !config ||
  !config.SUPABASE_URL ||
  !config.SUPABASE_ANON_KEY
) {
  throw new Error(
    "Missing Supabase configuration. Check config.js."
  );
}

const supabase = createClient(
  config.SUPABASE_URL,
  config.SUPABASE_ANON_KEY
);

/* ==========================================================
   DOM ELEMENTS
========================================================== */

const loginSection =
  document.getElementById("loginSection");

const dashboardSection =
  document.getElementById("dashboardSection");

const loginForm =
  document.getElementById("loginForm");

const adminEmail =
  document.getElementById("adminEmail");

const adminPassword =
  document.getElementById("adminPassword");

const loginBtn =
  document.getElementById("loginBtn");

const loginStatus =
  document.getElementById("loginStatus");

const togglePasswordBtn =
  document.getElementById("togglePasswordBtn");

const logoutBtn =
  document.getElementById("logoutBtn");

const createShareLinkBtn =
  document.getElementById("createShareLinkBtn");

const refreshSessionsBtn =
  document.getElementById("refreshSessionsBtn");

const sessionsList =
  document.getElementById("sessionsList");

const sessionCount =
  document.getElementById("sessionCount");

const selectedVisitorName =
  document.getElementById("selectedVisitorName");

const sessionStatusBadge =
  document.getElementById("sessionStatusBadge");

const travelMode =
  document.getElementById("travelMode");

const trackRouteBtn =
  document.getElementById("trackRouteBtn");

const routeDistance =
  document.getElementById("routeDistance");

const routeDuration =
  document.getElementById("routeDuration");

const locationAccuracy =
  document.getElementById("locationAccuracy");

const lastLocationUpdate =
  document.getElementById("lastLocationUpdate");

const locationInformation =
  document.getElementById("locationInformation");

const deviceInformation =
  document.getElementById("deviceInformation");

const routeInstructions =
  document.getElementById("routeInstructions");

const shareLinkModal =
  document.getElementById("shareLinkModal");

const closeModalBtn =
  document.getElementById("closeModalBtn");

const newVisitorName =
  document.getElementById("newVisitorName");

const confirmCreateLinkBtn =
  document.getElementById("confirmCreateLinkBtn");

const createdLinkContainer =
  document.getElementById("createdLinkContainer");

const createdShareLink =
  document.getElementById("createdShareLink");

const copyShareLinkBtn =
  document.getElementById("copyShareLinkBtn");

const modalStatus =
  document.getElementById("modalStatus");

const mapElement =
  document.getElementById("map");

/* ==========================================================
   APPLICATION STATE
========================================================== */

let currentUser = null;

let sessions = [];

let selectedSession = null;

let selectedLocation = null;

let realtimeChannel = null;

let map = null;

let visitorMarker = null;

let adminMarker = null;

let accuracyCircle = null;

let routePolyline = null;

let adminPosition = null;

let mapsLoaded = false;

let AdvancedMarkerElement = null;
let useAdvancedMarkers = false;

/* ==========================================================
   START APPLICATION
========================================================== */

document.addEventListener(
  "DOMContentLoaded",
  initialiseApplication
);

async function initialiseApplication() {
  bindEvents();

  createToastContainer();

  setLoginStatus(
    "Checking your administrator session."
  );

  try {
    const {
      data: { session },
      error
    } = await supabase.auth.getSession();

    if (error) {
      throw error;
    }

    if (session?.user) {
      currentUser = session.user;

      await verifyAdministrator();
      await openDashboard();
    } else {
      showLogin();
    }
  } catch (error) {
    console.error(
      "Application initialization error:",
      error
    );

    showLogin();

    setLoginStatus(
      error.message ||
        "The administrator session could not be checked.",
      "error"
    );
  }
}

/* ==========================================================
   EVENT LISTENERS
========================================================== */

function bindEvents() {
  loginForm.addEventListener(
    "submit",
    handleLogin
  );

  togglePasswordBtn.addEventListener(
    "click",
    togglePasswordVisibility
  );

  logoutBtn.addEventListener(
    "click",
    handleLogout
  );

  refreshSessionsBtn.addEventListener(
    "click",
    refreshSessions
  );

  createShareLinkBtn.addEventListener(
    "click",
    openShareLinkModal
  );

  closeModalBtn.addEventListener(
    "click",
    closeShareLinkModal
  );

  confirmCreateLinkBtn.addEventListener(
    "click",
    createShareLink
  );

  copyShareLinkBtn.addEventListener(
    "click",
    copyGeneratedLink
  );

  trackRouteBtn.addEventListener(
    "click",
    trackSelectedRoute
  );

  shareLinkModal.addEventListener(
    "click",
    event => {
      if (event.target === shareLinkModal) {
        closeShareLinkModal();
      }
    }
  );

  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Escape" &&
        !shareLinkModal.classList.contains(
          "hidden"
        )
      ) {
        closeShareLinkModal();
      }
    }
  );

  supabase.auth.onAuthStateChange(
    async (event, session) => {
      if (event === "SIGNED_OUT") {
        currentUser = null;

        unsubscribeFromRealtime();

        showLogin();
      }

      if (
        event === "SIGNED_IN" &&
        session?.user
      ) {
        currentUser = session.user;
      }
    }
  );
}

/* ==========================================================
   ADMIN LOGIN
========================================================== */

async function handleLogin(event) {
  event.preventDefault();

  const email =
    adminEmail.value.trim().toLowerCase();

  const password =
    adminPassword.value;

  if (!isValidEmail(email)) {
    setLoginStatus(
      "Enter a valid administrator email address.",
      "error"
    );

    adminEmail.focus();
    return;
  }

  if (password.length < 6) {
    setLoginStatus(
      "Your password must contain at least six characters.",
      "error"
    );

    adminPassword.focus();
    return;
  }

  setButtonLoading(
    loginBtn,
    true,
    "Signing In"
  );

  setLoginStatus(
    "Signing in securely."
  );

  try {
    const {
      data,
      error
    } =
      await supabase.auth.signInWithPassword({
        email,
        password
      });

    if (error) {
      throw error;
    }

    if (!data.user) {
      throw new Error(
        "Supabase did not return an authenticated user."
      );
    }

    currentUser = data.user;

    await verifyAdministrator();

    adminPassword.value = "";

    setLoginStatus(
      "Login successful.",
      "success"
    );

    await openDashboard();

    showToast(
      "Welcome",
      "You are now signed in to the live-location dashboard.",
      "success"
    );
  } catch (error) {
    console.error(
      "Administrator login error:",
      error
    );

    await supabase.auth.signOut();

    setLoginStatus(
      getFriendlyLoginError(error),
      "error"
    );
  } finally {
    setButtonLoading(
      loginBtn,
      false,
      "Sign In"
    );
  }
}

/* ==========================================================
   VERIFY ADMINISTRATOR
========================================================== */

async function verifyAdministrator() {
  if (!currentUser) {
    throw new Error(
      "No authenticated administrator was found."
    );
  }

  const {
    data,
    error
  } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Administrator verification failed: ${error.message}`
    );
  }

  if (!data) {
    throw new Error(
      "This account is not authorised to access the administrator dashboard."
    );
  }

  return true;
}

/* ==========================================================
   LOGOUT
========================================================== */

async function handleLogout() {
  logoutBtn.disabled = true;
  logoutBtn.textContent = "Logging Out...";

  try {
    unsubscribeFromRealtime();

    const { error } =
      await supabase.auth.signOut();

    if (error) {
      throw error;
    }

    resetDashboard();

    showLogin();

    setLoginStatus(
      "You have been logged out successfully.",
      "success"
    );
  } catch (error) {
    console.error(
      "Logout error:",
      error
    );

    showToast(
      "Logout failed",
      error.message ||
        "You could not be logged out.",
      "error"
    );
  } finally {
    logoutBtn.disabled = false;
    logoutBtn.textContent = "Log Out";
  }
}

/* ==========================================================
   PAGE VISIBILITY
========================================================== */

function showLogin() {
  loginSection.classList.remove("hidden");
  dashboardSection.classList.add("hidden");
}

async function openDashboard() {
  loginSection.classList.add("hidden");
  dashboardSection.classList.remove("hidden");

  await loadGoogleMaps();
  await requestAdministratorLocation();
  await loadSessions();
  subscribeToRealtime();
}

/* ==========================================================
   PASSWORD VISIBILITY
========================================================== */

function togglePasswordVisibility() {
  const passwordIsHidden =
    adminPassword.type === "password";

  adminPassword.type =
    passwordIsHidden
      ? "text"
      : "password";

  togglePasswordBtn.textContent =
    passwordIsHidden
      ? "🙈"
      : "👁";

  togglePasswordBtn.setAttribute(
    "aria-label",
    passwordIsHidden
      ? "Hide password"
      : "Show password"
  );
}

/* ==========================================================
   LOGIN STATUS
========================================================== */

function setLoginStatus(
  message,
  type = ""
) {
  loginStatus.textContent = message;
  loginStatus.className = "message-box";

  if (type === "success") {
    loginStatus.classList.add(
      "success-message"
    );
  }

  if (type === "error") {
    loginStatus.classList.add(
      "error-message"
    );
  }
}

/* ==========================================================
   GOOGLE MAPS LOADER
========================================================== */
/* ==========================================================
   GOOGLE MAPS LOADER
========================================================== */

async function loadGoogleMaps() {
  if (mapsLoaded && map) {
    return;
  }
  
  const apiKey = String(
    config.GOOGLE_MAPS_BROWSER_KEY || ""
  ).trim();
  
  if (
    !apiKey ||
    apiKey.includes("YOUR_GOOGLE")
  ) {
    throw new Error(
      "Add your Google Maps browser API key to config.js."
    );
  }
  
  try {
    /*
      If Google Maps has not already been loaded,
      insert the script using the direct loading method.
    */
    
    if (
      !window.google ||
      !window.google.maps ||
      !window.google.maps.Map
    ) {
      await insertGoogleMapsScript();
    }
    
    if (
      !window.google ||
      !window.google.maps ||
      !window.google.maps.Map
    ) {
      throw new Error(
        "Google Maps loaded, but the Maps library is unavailable."
      );
    }
    
    /*
      AdvancedMarkerElement may already be available because
      libraries=marker is included in the script URL.
    */
    
    AdvancedMarkerElement =
      window.google.maps.marker
      ?.AdvancedMarkerElement ||
      null;
    
    useAdvancedMarkers =
      typeof AdvancedMarkerElement ===
      "function";
    
    mapElement.innerHTML = "";
    
    const mapOptions = {
      center: {
        lat: 9.082,
        lng: 8.6753
      },
      
      zoom: 6,
      
      streetViewControl: false,
      mapTypeControl: true,
      fullscreenControl: true,
      clickableIcons: true,
      gestureHandling: "greedy"
    };
    
    /*
      Advanced markers require a valid Map ID.
      Only include mapId when one is configured.
    */
    
    const configuredMapId = String(
      config.GOOGLE_MAP_ID || ""
    ).trim();
    
    if (
      configuredMapId &&
      configuredMapId !==
      "DEMO_MAP_ID" &&
      !configuredMapId.includes(
        "YOUR_GOOGLE"
      )
    ) {
      mapOptions.mapId =
        configuredMapId;
    }
    
    map = new google.maps.Map(
      mapElement,
      mapOptions
    );
    
    mapsLoaded = true;
    
    console.log(
      useAdvancedMarkers ?
      "Google Maps loaded with Advanced Markers." :
      "Google Maps loaded with standard markers."
    );
  } catch (error) {
    mapsLoaded = false;
    
    console.error(
      "Google Maps loading error:",
      error
    );
    
    mapElement.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">⚠️</span>

        <p>
          Google Maps could not be loaded.
          Check your API key, billing and API restrictions.
        </p>
      </div>
    `;
    
    throw error;
  }
}

function insertGoogleMapsScript() {
  return new Promise(
    (resolve, reject) => {
      /*
        Resolve immediately if Maps already exists.
      */
      
      if (
        window.google?.maps?.Map
      ) {
        resolve();
        return;
      }
      
      /*
        Reuse an existing loader promise.
        This prevents duplicate scripts.
      */
      
      if (
        window.__googleMapsLoadingPromise
      ) {
        window.__googleMapsLoadingPromise
          .then(resolve)
          .catch(reject);
        
        return;
      }
      
      window.__googleMapsLoadingPromise =
        new Promise(
          (
            internalResolve,
            internalReject
          ) => {
            /*
              Remove incomplete Google Maps scripts left
              behind by an earlier failed load.
            */
            
            document
              .querySelectorAll(
                'script[src*="maps.googleapis.com/maps/api/js"]'
              )
              .forEach(script => {
                if (
                  !window.google?.maps?.Map
                ) {
                  script.remove();
                }
              });
            
            const callbackName =
              `initLocationMap_${Date.now()}`;
            
            let timeoutId = null;
            
            const cleanup = () => {
              if (timeoutId) {
                clearTimeout(timeoutId);
              }
              
              try {
                delete window[
                  callbackName
                ];
              } catch {
                window[
                  callbackName
                ] = undefined;
              }
            };
            
            window[callbackName] =
              () => {
                cleanup();
                
                if (
                  window.google
                  ?.maps?.Map
                ) {
                  internalResolve();
                } else {
                  internalReject(
                    new Error(
                      "Google Maps returned an incomplete response."
                    )
                  );
                }
              };
            
            const script =
              document.createElement(
                "script"
              );
            
            const apiKey =
              encodeURIComponent(
                config
                .GOOGLE_MAPS_BROWSER_KEY
              );
            
            script.src =
              `https://maps.googleapis.com/maps/api/js` +
              `?key=${apiKey}` +
              `&v=weekly` +
              `&libraries=marker,geometry` +
              `&callback=${callbackName}`;
            
            script.async = true;
            script.defer = true;
            
            script.dataset.googleMaps =
              "true";
            
            script.onerror = () => {
              cleanup();
              
              internalReject(
                new Error(
                  "Google Maps JavaScript API could not be downloaded."
                )
              );
            };
            
            timeoutId = setTimeout(
              () => {
                cleanup();
                
                internalReject(
                  new Error(
                    "Google Maps took too long to load."
                  )
                );
              },
              20000
            );
            
            document.head.appendChild(
              script
            );
          }
        );
      
      window.__googleMapsLoadingPromise
        .then(resolve)
        .catch(error => {
          window.__googleMapsLoadingPromise =
            null;
          
          reject(error);
        });
    }
  );
}





/* ==========================================================
   ADMINISTRATOR LOCATION
========================================================== */

async function requestAdministratorLocation() {
  if (!navigator.geolocation) {
    showToast(
      "Location unavailable",
      "This browser does not support administrator location access.",
      "warning"
    );

    return;
  }

  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      position => {
        adminPosition = {
          latitude:
            position.coords.latitude,
          longitude:
            position.coords.longitude,
          accuracy:
            position.coords.accuracy
        };

        displayAdministratorMarker();

        resolve();
      },

      error => {
        console.warn(
          "Administrator location error:",
          error
        );

        showToast(
          "Administrator location",
          "Allow location access when you want to calculate a route from your position.",
          "warning"
        );

        resolve();
      },

      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 10000
      }
    );
  });
}

function displayAdministratorMarker() {
  if (
    !map ||
    !adminPosition
  ) {
    return;
  }

  const position = {
    lat: Number(
      adminPosition.latitude
    ),

    lng: Number(
      adminPosition.longitude
    )
  };

  if (adminMarker) {
    setMapMarkerPosition(
      adminMarker,
      position
    );

    return;
  }

  adminMarker = createGoogleMarker({
    position,
    title:
      "Administrator's current location",
    label: "A",
    type: "administrator"
  });
}


/* ==========================================================
   MAP MARKER DESIGN
========================================================== */

function createMapMarker(
  label,
  type
) {
  const marker =
    document.createElement("div");

  marker.textContent = label;

  marker.style.width = "44px";
  marker.style.height = "44px";
  marker.style.borderRadius = "50%";
  marker.style.display = "grid";
  marker.style.placeItems = "center";
  marker.style.color = "#ffffff";
  marker.style.fontWeight = "800";
  marker.style.fontSize = "15px";
  marker.style.border =
    "4px solid #ffffff";
  marker.style.boxShadow =
    "0 8px 22px rgba(15, 23, 42, 0.28)";

  marker.style.background =
    type === "visitor"
      ? "#dc2626"
      : "#315efb";

  return marker;
}


/* ==========================================================
   GOOGLE MARKER HELPERS
========================================================== */

function createGoogleMarker({
  position,
  title,
  label,
  type
}) {
  if (
    useAdvancedMarkers &&
    AdvancedMarkerElement
  ) {
    return new AdvancedMarkerElement({
      map,
      position,
      title,
      content: createMapMarker(
        label,
        type
      )
    });
  }

  /*
    Fallback for browsers or loaders where
    AdvancedMarkerElement is unavailable.
  */

  return new google.maps.Marker({
    map,
    position,
    title,

    label: {
      text: label,
      color: "#ffffff",
      fontWeight: "800"
    },

    icon: {
      path:
        google.maps.SymbolPath.CIRCLE,

      fillColor:
        type === "visitor"
          ? "#dc2626"
          : "#315efb",

      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeOpacity: 1,
      strokeWeight: 4,
      scale: 18
    },

    zIndex:
      type === "visitor"
        ? 20
        : 10
  });
}

function setMapMarkerPosition(
  marker,
  position
) {
  if (!marker) {
    return;
  }

  if (
    typeof marker.setPosition ===
    "function"
  ) {
    marker.setPosition(
      position
    );

    return;
  }

  marker.position =
    position;
}

function removeMapMarker(marker) {
  if (!marker) {
    return;
  }

  if (
    typeof marker.setMap ===
    "function"
  ) {
    marker.setMap(null);
    return;
  }

  marker.map = null;
}


/* ==========================================================
   GENERAL HELPERS
========================================================== */

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    email
  );
}

function getFriendlyLoginError(error) {
  const message =
    String(error?.message || "").toLowerCase();

  if (
    message.includes(
      "invalid login credentials"
    )
  ) {
    return "The email address or password is incorrect.";
  }

  if (
    message.includes(
      "email not confirmed"
    )
  ) {
    return "Confirm the administrator email address before signing in.";
  }

  if (
    message.includes(
      "not authorised"
    )
  ) {
    return "This account is not authorised to access the dashboard.";
  }

  return (
    error?.message ||
    "The administrator login failed."
  );
}

function setButtonLoading(
  button,
  loading,
  label
) {
  button.disabled = loading;

  if (loading) {
    button.innerHTML =
      `<span class="spinner"></span> ${escapeHtml(
        label
      )}`;
  } else {
    button.textContent = label;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}



/* ==========================================================
   LOAD TRACKING SESSIONS
========================================================== */

async function loadSessions() {
  setSessionsLoading(true);

  try {
    const {
      data,
      error
    } = await supabase
      .from("tracking_sessions")
      .select(`
        id,
        tracking_code,
        visitor_name,
        consented_at,
        last_seen_at,
        stopped_at,
        status,
        created_at
      `)
      .eq("created_by", currentUser.id)
      .order("created_at", {
        ascending: false
      });

    if (error) {
      throw error;
    }

    sessions = Array.isArray(data)
      ? data
      : [];

    renderSessions();

    if (selectedSession) {
      const refreshedSession =
        sessions.find(
          session =>
            session.id ===
            selectedSession.id
        );

      if (refreshedSession) {
        selectedSession =
          refreshedSession;

        updateSelectedSessionHeader();
      }
    }
  } catch (error) {
    console.error(
      "Load sessions error:",
      error
    );

    sessionsList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">⚠️</span>
        <p>${escapeHtml(
          error.message ||
          "Sessions could not be loaded."
        )}</p>
      </div>
    `;

    showToast(
      "Sessions unavailable",
      error.message ||
        "The sharing sessions could not be loaded.",
      "error"
    );
  } finally {
    setSessionsLoading(false);
  }
}

/* ==========================================================
   REFRESH SESSIONS
========================================================== */

async function refreshSessions() {
  refreshSessionsBtn.disabled = true;
  refreshSessionsBtn.textContent = "…";

  try {
    await loadSessions();

    showToast(
      "Sessions refreshed",
      "The latest sharing sessions have been loaded.",
      "success"
    );
  } finally {
    refreshSessionsBtn.disabled = false;
    refreshSessionsBtn.textContent = "↻";
  }
}

/* ==========================================================
   RENDER SESSION CARDS
========================================================== */

function renderSessions() {
  sessionCount.textContent =
    `${sessions.length} ${
      sessions.length === 1
        ? "session"
        : "sessions"
    }`;

  if (sessions.length === 0) {
    sessionsList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📍</span>
        <p>No location-sharing session yet.</p>
      </div>
    `;

    return;
  }

  sessionsList.innerHTML =
    sessions
      .map(createSessionCardHtml)
      .join("");

  sessionsList
    .querySelectorAll(
      "[data-session-id]"
    )
    .forEach(card => {
      card.addEventListener(
        "click",
        () => {
          selectSession(
            card.dataset.sessionId
          );
        }
      );
    });
}

/* ==========================================================
   SESSION CARD TEMPLATE
========================================================== */

function createSessionCardHtml(session) {
  const isSelected =
    selectedSession?.id === session.id;

  const live =
    isSessionLive(session);

  const displayName =
    session.visitor_name?.trim() ||
    "Unnamed Visitor";

  const lastSeen =
    session.last_seen_at
      ? formatRelativeTime(
          session.last_seen_at
        )
      : "No location yet";

  const createdAt =
    session.created_at
      ? new Date(
          session.created_at
        ).toLocaleString(
          "en-GB",
          {
            dateStyle: "medium",
            timeStyle: "short"
          }
        )
      : "Unknown";

  return `
    <article
      class="session-card ${
        isSelected ? "active" : ""
      }"
      data-session-id="${escapeHtml(
        session.id
      )}"
    >
      <div class="session-top">
        <div>
          <div class="session-name">
            ${escapeHtml(displayName)}
          </div>

          <div class="session-time">
            ${escapeHtml(lastSeen)}
          </div>
        </div>

        <span class="session-status ${
          live ? "live" : "offline"
        }">
          ${live ? "Live" : "Offline"}
        </span>
      </div>

      <div class="session-details">
        <div class="session-row">
          <span class="session-label">
            Created
          </span>

          <span class="session-value">
            ${escapeHtml(createdAt)}
          </span>
        </div>

        <div class="session-row">
          <span class="session-label">
            Status
          </span>

          <span class="session-value">
            ${escapeHtml(
              getSessionStatusText(
                session
              )
            )}
          </span>
        </div>
      </div>
    </article>
  `;
}

/* ==========================================================
   SELECT SESSION
========================================================== */

async function selectSession(sessionId) {
  const session =
    sessions.find(
      item =>
        String(item.id) ===
        String(sessionId)
    );

  if (!session) {
    showToast(
      "Session unavailable",
      "The selected sharing session could not be found.",
      "error"
    );

    return;
  }

  selectedSession = session;
  selectedLocation = null;

  renderSessions();
  updateSelectedSessionHeader();
  resetLocationPanels();

  trackRouteBtn.disabled = true;

  await loadLatestLocation(
    selectedSession.id
  );
}

/* ==========================================================
   SELECTED SESSION HEADER
========================================================== */

function updateSelectedSessionHeader() {
  if (!selectedSession) {
    selectedVisitorName.textContent =
      "Select a session";

    sessionStatusBadge.textContent =
      "Offline";

    sessionStatusBadge.className =
      "status-badge offline";

    return;
  }

  selectedVisitorName.textContent =
    selectedSession.visitor_name?.trim() ||
    "Unnamed Visitor";

  const live =
    isSessionLive(selectedSession);

  sessionStatusBadge.textContent =
    live
      ? "Live"
      : getSessionStatusText(
          selectedSession
        );

  sessionStatusBadge.className =
    `status-badge ${
      live ? "online" : "offline"
    }`;
}

/* ==========================================================
   LOAD LATEST LOCATION
========================================================== */

async function loadLatestLocation(
  sessionId
) {
  showToast(
    "Loading location",
    "Retrieving the latest visitor location.",
    "warning"
  );

  try {
    const {
      data,
      error
    } = await supabase
      .from("location_updates")
      .select("*")
      .eq(
        "session_id",
        sessionId
      )
      .order(
        "created_at",
        {
          ascending: false
        }
      )
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      showToast(
        "Waiting for location",
        "The visitor has not shared a location yet.",
        "warning"
      );

      resetLocationPanels();
      return;
    }

    selectedLocation = data;

    updateDashboardWithLocation(
      selectedLocation
    );
  } catch (error) {
    console.error(
      "Latest location error:",
      error
    );

    showToast(
      "Location unavailable",
      error.message ||
        "The latest visitor location could not be loaded.",
      "error"
    );
  }
}

/* ==========================================================
   UPDATE DASHBOARD WITH LOCATION
========================================================== */

function updateDashboardWithLocation(
  location
) {
  if (
    !location ||
    !Number.isFinite(
      Number(location.latitude)
    ) ||
    !Number.isFinite(
      Number(location.longitude)
    )
  ) {
    return;
  }

  selectedLocation = location;

  updateVisitorMarker(location);
  updateLocationMetrics(location);
  updateLocationInformation(location);
  updateDeviceInformation(location);

  trackRouteBtn.disabled =
    !adminPosition;

  if (!adminPosition) {
    showToast(
      "Route unavailable",
      "Allow administrator location access before calculating a route.",
      "warning"
    );
  }
}

/* ==========================================================
   VISITOR MARKER
========================================================== */

function updateVisitorMarker(
  location
) {
  if (!map) {
    return;
  }

  const latitude =
    Number(location.latitude);

  const longitude =
    Number(location.longitude);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return;
  }

  const position = {
    lat: latitude,
    lng: longitude
  };

  if (visitorMarker) {
    setMapMarkerPosition(
      visitorMarker,
      position
    );
  } else {
    visitorMarker =
      createGoogleMarker({
        position,

        title:
          selectedSession
            ?.visitor_name ||
          "Visitor",

        label: "V",
        type: "visitor"
      });
  }

  updateAccuracyCircle(
    position,
    Number(location.accuracy)
  );

  fitMapToMarkers(position);
}



/* ==========================================================
   ACCURACY CIRCLE
========================================================== */

function updateAccuracyCircle(
  position,
  accuracy
) {
  if (
    !map ||
    !Number.isFinite(accuracy) ||
    accuracy <= 0
  ) {
    if (accuracyCircle) {
      accuracyCircle.setMap(null);
      accuracyCircle = null;
    }

    return;
  }

  if (!accuracyCircle) {
    accuracyCircle =
      new google.maps.Circle({
        map,
        center: position,
        radius: accuracy,
        strokeOpacity: 0.55,
        strokeWeight: 2,
        fillOpacity: 0.12
      });
  } else {
    accuracyCircle.setCenter(
      position
    );

    accuracyCircle.setRadius(
      accuracy
    );

    accuracyCircle.setMap(map);
  }
}

/* ==========================================================
   FIT MAP
========================================================== */

function fitMapToMarkers(
  visitorPosition
) {
  if (!map) {
    return;
  }

  if (adminPosition) {
    const bounds =
      new google.maps.LatLngBounds();

    bounds.extend(
      visitorPosition
    );

    bounds.extend({
      lat: adminPosition.latitude,
      lng: adminPosition.longitude
    });

    map.fitBounds(
      bounds,
      80
    );
  } else {
    map.panTo(
      visitorPosition
    );

    map.setZoom(17);
  }
}

/* ==========================================================
   LOCATION METRICS
========================================================== */

function updateLocationMetrics(
  location
) {
  const accuracy =
    Number(location.accuracy);

  locationAccuracy.textContent =
    Number.isFinite(accuracy)
      ? `±${Math.round(
          accuracy
        )} metres`
      : "Unknown";

  lastLocationUpdate.textContent =
    location.created_at
      ? formatRelativeTime(
          location.created_at
        )
      : "Unknown";
}

/* ==========================================================
   LOCATION INFORMATION
========================================================== */

function updateLocationInformation(
  location
) {
  const coordinates =
    `${Number(
      location.latitude
    ).toFixed(6)}, ${Number(
      location.longitude
    ).toFixed(6)}`;

  setDefinitionValues(
    locationInformation,
    [
      location.address ||
        "Address not available",
      coordinates,
      location.nearest_school ||
        "Not available",
      location.nearest_park ||
        "Not available",
      location.nearest_hospital ||
        "Not available",
      location.nearest_police_station ||
        "Not available"
    ]
  );
}

/* ==========================================================
   DEVICE INFORMATION
========================================================== */

function updateDeviceInformation(
  location
) {
  setDefinitionValues(
    deviceInformation,
    [
      simplifyUserAgent(
        location.user_agent
      ),
      location.platform ||
        "Unknown",
      location.language ||
        "Unknown",
      location.screen_size ||
        "Unknown",
      formatNetworkInformation(
        location
      ),
      location.timezone ||
        "Unknown"
    ]
  );
}

/* ==========================================================
   SET DEFINITION LIST VALUES
========================================================== */

function setDefinitionValues(
  container,
  values
) {
  const items =
    container.querySelectorAll("dd");

  items.forEach(
    (item, index) => {
      item.textContent =
        values[index] ?? "—";
    }
  );
}

/* ==========================================================
   RESET LOCATION PANELS
========================================================== */

function resetLocationPanels() {
  routeDistance.textContent = "—";
  routeDuration.textContent = "—";
  locationAccuracy.textContent = "—";
  lastLocationUpdate.textContent = "—";

  setDefinitionValues(
    locationInformation,
    [
      "—",
      "—",
      "—",
      "—",
      "—",
      "—"
    ]
  );

  setDefinitionValues(
    deviceInformation,
    [
      "—",
      "—",
      "—",
      "—",
      "—",
      "—"
    ]
  );

  routeInstructions.innerHTML = `
    <li>
      Select a sharing session and tap Track Route.
    </li>
  `;

  if (visitorMarker) {
  removeMapMarker(
    visitorMarker
  );
  
  visitorMarker = null;
}

  if (accuracyCircle) {
    accuracyCircle.setMap(null);
    accuracyCircle = null;
  }

  clearRoutePolyline();
}

/* ==========================================================
   SESSION STATUS
========================================================== */

function isSessionLive(session) {
  if (
    !session ||
    session.stopped_at ||
    session.status === "stopped"
  ) {
    return false;
  }

  if (!session.last_seen_at) {
    return false;
  }

  const lastSeen =
    new Date(
      session.last_seen_at
    ).getTime();

  return (
    Date.now() - lastSeen
  ) <= 30000;
}

function getSessionStatusText(
  session
) {
  if (
    session?.stopped_at ||
    session?.status === "stopped"
  ) {
    return "Stopped";
  }

  if (!session?.consented_at) {
    return "Waiting for consent";
  }

  if (!session?.last_seen_at) {
    return "Waiting for location";
  }

  return isSessionLive(session)
    ? "Live"
    : "Offline";
}

/* ==========================================================
   FORMAT DATE
========================================================== */

function formatRelativeTime(
  value
) {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "Unknown";
  }

  const difference =
    Date.now() -
    date.getTime();

  const seconds =
    Math.floor(
      difference / 1000
    );

  if (seconds < 10) {
    return "Just now";
  }

  if (seconds < 60) {
    return `${seconds} seconds ago`;
  }

  const minutes =
    Math.floor(
      seconds / 60
    );

  if (minutes < 60) {
    return `${minutes} ${
      minutes === 1
        ? "minute"
        : "minutes"
    } ago`;
  }

  const hours =
    Math.floor(
      minutes / 60
    );

  if (hours < 24) {
    return `${hours} ${
      hours === 1
        ? "hour"
        : "hours"
    } ago`;
  }

  return date.toLocaleString(
    "en-GB",
    {
      dateStyle: "medium",
      timeStyle: "short"
    }
  );
}

/* ==========================================================
   DEVICE HELPERS
========================================================== */

function simplifyUserAgent(
  userAgent
) {
  if (!userAgent) {
    return "Unknown";
  }

  if (
    userAgent.includes("Edg/")
  ) {
    return "Microsoft Edge";
  }

  if (
    userAgent.includes("Chrome/") &&
    !userAgent.includes("Edg/")
  ) {
    return "Google Chrome";
  }

  if (
    userAgent.includes("Firefox/")
  ) {
    return "Mozilla Firefox";
  }

  if (
    userAgent.includes("Safari/") &&
    !userAgent.includes("Chrome/")
  ) {
    return "Apple Safari";
  }

  return userAgent;
}

function formatNetworkInformation(
  location
) {
  const parts = [];

  if (
    location.network_type
  ) {
    parts.push(
      location.network_type
    );
  }

  if (
    Number.isFinite(
      Number(
        location.downlink_mbps
      )
    )
  ) {
    parts.push(
      `${location.downlink_mbps} Mbps`
    );
  }

  if (
    location.save_data === true
  ) {
    parts.push(
      "Data saver enabled"
    );
  }

  return parts.length > 0
    ? parts.join(" • ")
    : "Unknown";
}

/* ==========================================================
   SESSION LOADING STATE
========================================================== */

function setSessionsLoading(
  loading
) {
  if (!loading) {
    return;
  }

  sessionsList.innerHTML = `
    <div class="empty-state">
      <span class="spinner"></span>
      <p style="margin-top: 14px;">
        Loading sharing sessions...
      </p>
    </div>
  `;
}

/* ==========================================================
   SUPABASE REALTIME
========================================================== */

function subscribeToRealtime() {
  unsubscribeFromRealtime();

  if (!currentUser) {
    return;
  }

  realtimeChannel = supabase
    .channel(`location-dashboard-${currentUser.id}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "tracking_sessions",
        filter: `created_by=eq.${currentUser.id}`
      },
      handleSessionRealtimeChange
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "location_updates"
      },
      handleLocationRealtimeChange
    )
    .subscribe(status => {
      if (status === "SUBSCRIBED") {
        console.log(
          "Realtime location updates connected."
        );
      }

      if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT"
      ) {
        showToast(
          "Realtime connection",
          "Live updates were interrupted. Use the refresh button if necessary.",
          "warning"
        );
      }
    });
}

function unsubscribeFromRealtime() {
  if (!realtimeChannel) {
    return;
  }

  supabase.removeChannel(
    realtimeChannel
  );

  realtimeChannel = null;
}

/* ==========================================================
   REALTIME SESSION CHANGES
========================================================== */

async function handleSessionRealtimeChange(
  payload
) {
  const record =
    payload.new || payload.old;

  if (!record) {
    return;
  }

  if (
    payload.eventType === "DELETE"
  ) {
    sessions = sessions.filter(
      session =>
        session.id !== record.id
    );

    if (
      selectedSession?.id ===
      record.id
    ) {
      selectedSession = null;
      selectedLocation = null;

      updateSelectedSessionHeader();
      resetLocationPanels();

      trackRouteBtn.disabled = true;
    }
  } else {
    const existingIndex =
      sessions.findIndex(
        session =>
          session.id === record.id
      );

    if (existingIndex >= 0) {
      sessions[existingIndex] = {
        ...sessions[existingIndex],
        ...record
      };
    } else {
      sessions.unshift(record);
    }

    if (
      selectedSession?.id ===
      record.id
    ) {
      selectedSession = {
        ...selectedSession,
        ...record
      };

      updateSelectedSessionHeader();
    }
  }

  sessions.sort(
    (a, b) =>
      new Date(b.created_at).getTime() -
      new Date(a.created_at).getTime()
  );

  renderSessions();
}

/* ==========================================================
   REALTIME LOCATION CHANGES
========================================================== */

async function handleLocationRealtimeChange(
  payload
) {
  const location = payload.new;

  if (
    !location ||
    !selectedSession
  ) {
    return;
  }

  if (
    location.session_id !==
    selectedSession.id
  ) {
    return;
  }

  selectedLocation = location;

  updateDashboardWithLocation(
    location
  );

  selectedSession = {
    ...selectedSession,
    last_seen_at:
      location.created_at ||
      new Date().toISOString(),
    status: "active",
    stopped_at: null
  };

  const sessionIndex =
    sessions.findIndex(
      session =>
        session.id ===
        selectedSession.id
    );

  if (sessionIndex >= 0) {
    sessions[sessionIndex] =
      selectedSession;
  }

  updateSelectedSessionHeader();
  renderSessions();
}

/* ==========================================================
   SHARE LINK MODAL
========================================================== */

function openShareLinkModal() {
  newVisitorName.value = "";

  createdShareLink.value = "";

  createdLinkContainer.classList.add(
    "hidden"
  );

  hideModalStatus();

  shareLinkModal.classList.remove(
    "hidden"
  );

  setTimeout(
    () => newVisitorName.focus(),
    100
  );
}

function closeShareLinkModal() {
  shareLinkModal.classList.add(
    "hidden"
  );

  confirmCreateLinkBtn.disabled =
    false;

  confirmCreateLinkBtn.textContent =
    "Create Share Link";
}

function setModalStatus(
  message,
  type = ""
) {
  modalStatus.textContent = message;

  modalStatus.className =
    "message-box";

  if (type === "success") {
    modalStatus.classList.add(
      "success-message"
    );
  }

  if (type === "error") {
    modalStatus.classList.add(
      "error-message"
    );
  }

  modalStatus.classList.remove(
    "hidden"
  );
}

function hideModalStatus() {
  modalStatus.classList.add(
    "hidden"
  );

  modalStatus.textContent = "";
}

/* ==========================================================
   CREATE SHARE LINK
========================================================== */

async function createShareLink() {
  const visitorName =
    newVisitorName.value.trim();

  setButtonLoading(
    confirmCreateLinkBtn,
    true,
    "Creating Link"
  );

  hideModalStatus();

  try {
    const {
      data,
      error
    } =
      await supabase.functions.invoke(
        "create-session",
        {
          body: {
            visitor_name:
              visitorName || null
          }
        }
      );

    if (error) {
      throw error;
    }

    if (
      !data?.ok ||
      !data?.tracking_code
    ) {
      throw new Error(
        data?.error ||
        "The sharing link could not be created."
      );
    }

    const publicSiteUrl =
      getPublicSiteUrl();

    const generatedLink =
      `${publicSiteUrl}/location.html?s=${encodeURIComponent(
        data.tracking_code
      )}`;

    createdShareLink.value =
      generatedLink;

    createdLinkContainer.classList.remove(
      "hidden"
    );

    setModalStatus(
      "The consent-based sharing link was created successfully.",
      "success"
    );

    await loadSessions();

    showToast(
      "Share link created",
      "Send the generated link only to someone who has agreed to share their live location.",
      "success"
    );
  } catch (error) {
    console.error(
      "Create share link error:",
      error
    );

    setModalStatus(
      error.message ||
        "The sharing link could not be created.",
      "error"
    );
  } finally {
    setButtonLoading(
      confirmCreateLinkBtn,
      false,
      "Create Share Link"
    );
  }
}

function getPublicSiteUrl() {
  const configuredUrl =
    String(
      config.PUBLIC_SITE_URL || ""
    )
      .trim()
      .replace(/\/+$/, "");

  if (
    configuredUrl &&
    !configuredUrl.includes(
      "your-project"
    )
  ) {
    return configuredUrl;
  }

  return window.location.origin;
}

/* ==========================================================
   COPY SHARE LINK
========================================================== */

async function copyGeneratedLink() {
  const link =
    createdShareLink.value.trim();

  if (!link) {
    setModalStatus(
      "Create a sharing link before copying.",
      "error"
    );

    return;
  }

  try {
    if (
      navigator.clipboard &&
      window.isSecureContext
    ) {
      await navigator.clipboard.writeText(
        link
      );
    } else {
      createdShareLink.select();
      createdShareLink.setSelectionRange(
        0,
        createdShareLink.value.length
      );

      const copied =
        document.execCommand("copy");

      if (!copied) {
        throw new Error(
          "The browser did not allow clipboard access."
        );
      }
    }

    const originalText =
      copyShareLinkBtn.textContent;

    copyShareLinkBtn.textContent =
      "Copied Successfully";

    setModalStatus(
      "The sharing link has been copied.",
      "success"
    );

    setTimeout(() => {
      copyShareLinkBtn.textContent =
        originalText;
    }, 1800);
  } catch (error) {
    console.error(
      "Copy link error:",
      error
    );

    setModalStatus(
      "Copying failed. Press and hold the link, then copy it manually.",
      "error"
    );
  }
}

/* ==========================================================
   TRACK SELECTED ROUTE
========================================================== */

async function trackSelectedRoute() {
  if (!selectedSession) {
    showToast(
      "Select a visitor",
      "Choose a location-sharing session first.",
      "warning"
    );

    return;
  }

  if (!selectedLocation) {
    showToast(
      "Location unavailable",
      "The selected visitor has not shared a location yet.",
      "warning"
    );

    return;
  }

  if (!adminPosition) {
    await requestAdministratorLocation();
  }

  if (!adminPosition) {
    showToast(
      "Administrator location required",
      "Allow location access so the route can begin from your current position.",
      "error"
    );

    return;
  }

  setButtonLoading(
    trackRouteBtn,
    true,
    "Calculating"
  );

  routeInstructions.innerHTML = `
    <li>
      Calculating the best route to the visitor...
    </li>
  `;

  try {
    const {
      data: {
        session
      }
    } =
      await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error(
        "Your administrator session has expired. Sign in again."
      );
    }

    const {
      data,
      error
    } =
      await supabase.functions.invoke(
        "location-insights",
        {
          body: {
            session_id:
              selectedSession.id,

            origin: {
              latitude:
                adminPosition.latitude,
              longitude:
                adminPosition.longitude
            },

            destination: {
              latitude:
                Number(
                  selectedLocation.latitude
                ),
              longitude:
                Number(
                  selectedLocation.longitude
                )
            },

            travel_mode:
              travelMode.value
          }
        }
      );

    if (error) {
      throw error;
    }

    if (!data?.ok) {
      throw new Error(
        data?.error ||
        "The route could not be calculated."
      );
    }

    applyLocationInsights(data);

    showToast(
      "Route ready",
      "Distance, estimated time and road directions have been updated.",
      "success"
    );
  } catch (error) {
    console.error(
      "Route calculation error:",
      error
    );

    routeInstructions.innerHTML = `
      <li>
        ${escapeHtml(
          error.message ||
          "The route could not be calculated."
        )}
      </li>
    `;

    showToast(
      "Route unavailable",
      error.message ||
        "The route could not be calculated.",
      "error"
    );
  } finally {
    setButtonLoading(
      trackRouteBtn,
      false,
      "Track Route"
    );
  }
}

/* ==========================================================
   APPLY LOCATION INSIGHTS
========================================================== */

function applyLocationInsights(data) {
  routeDistance.textContent =
    data.distance_text ||
    formatDistanceMetres(
      data.distance_meters
    );

  routeDuration.textContent =
    data.duration_text ||
    formatDurationSeconds(
      data.duration_seconds
    );

  const currentAddress =
    data.address ||
    selectedLocation.address ||
    "Address not available";

  const currentSchool =
    data.nearest_school ||
    selectedLocation.nearest_school ||
    "Not available";

  const currentPark =
    data.nearest_park ||
    selectedLocation.nearest_park ||
    "Not available";

  const currentHospital =
    data.nearest_hospital ||
    selectedLocation.nearest_hospital ||
    "Not available";

  const currentPolice =
    data.nearest_police_station ||
    selectedLocation.nearest_police_station ||
    "Not available";

  selectedLocation = {
    ...selectedLocation,
    address: currentAddress,
    nearest_school:
      currentSchool,
    nearest_park:
      currentPark,
    nearest_hospital:
      currentHospital,
    nearest_police_station:
      currentPolice
  };

  updateLocationInformation(
    selectedLocation
  );

  renderRouteInstructions(
    data.instructions
  );

  drawRoutePolyline(
    data.encoded_polyline
  );
}

/* ==========================================================
   ROUTE INSTRUCTIONS
========================================================== */

function renderRouteInstructions(
  instructions
) {
  if (
    !Array.isArray(instructions) ||
    instructions.length === 0
  ) {
    routeInstructions.innerHTML = `
      <li>
        The route was calculated, but detailed road instructions were not returned.
      </li>
    `;

    return;
  }

  routeInstructions.innerHTML =
    instructions
      .map((instruction, index) => {
        const text =
          typeof instruction === "string"
            ? instruction
            : instruction.instruction ||
              instruction.text ||
              `Route step ${index + 1}`;

        const distance =
          typeof instruction === "object"
            ? instruction.distance_text ||
              ""
            : "";

        return `
          <li>
            <strong>
              ${escapeHtml(text)}
            </strong>

            ${
              distance
                ? `<span style="display:block;margin-top:5px;color:#667085;font-size:13px;">
                    ${escapeHtml(
                      distance
                    )}
                  </span>`
                : ""
            }
          </li>
        `;
      })
      .join("");
}

/* ==========================================================
   DRAW ROUTE POLYLINE
========================================================== */

function drawRoutePolyline(
  encodedPolyline
) {
  clearRoutePolyline();

  if (
    !map ||
    !encodedPolyline
  ) {
    return;
  }

  const path =
    decodeGooglePolyline(
      encodedPolyline
    );

  if (path.length === 0) {
    return;
  }

  routePolyline =
    new google.maps.Polyline({
      path,
      geodesic: true,
      strokeOpacity: 0.92,
      strokeWeight: 7,
      map
    });

  const bounds =
    new google.maps.LatLngBounds();

  path.forEach(point =>
    bounds.extend(point)
  );

  map.fitBounds(
    bounds,
    70
  );
}

function clearRoutePolyline() {
  if (!routePolyline) {
    return;
  }

  routePolyline.setMap(null);
  routePolyline = null;
}

/* ==========================================================
   GOOGLE POLYLINE DECODER
========================================================== */

function decodeGooglePolyline(
  encoded
) {
  const points = [];

  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte;

    do {
      byte =
        encoded.charCodeAt(index++) -
        63;

      result |=
        (byte & 0x1f) << shift;

      shift += 5;
    } while (byte >= 0x20);

    const latitudeChange =
      result & 1
        ? ~(result >> 1)
        : result >> 1;

    latitude += latitudeChange;

    result = 0;
    shift = 0;

    do {
      byte =
        encoded.charCodeAt(index++) -
        63;

      result |=
        (byte & 0x1f) << shift;

      shift += 5;
    } while (byte >= 0x20);

    const longitudeChange =
      result & 1
        ? ~(result >> 1)
        : result >> 1;

    longitude += longitudeChange;

    points.push({
      lat: latitude / 1e5,
      lng: longitude / 1e5
    });
  }

  return points;
}

/* ==========================================================
   ROUTE FORMATTERS
========================================================== */

function formatDistanceMetres(
  metres
) {
  const value =
    Number(metres);

  if (!Number.isFinite(value)) {
    return "—";
  }

  if (value < 1000) {
    return `${Math.round(
      value
    )} metres`;
  }

  return `${(
    value / 1000
  ).toFixed(1)} km`;
}

function formatDurationSeconds(
  seconds
) {
  const value =
    Number(seconds);

  if (!Number.isFinite(value)) {
    return "—";
  }

  const totalMinutes =
    Math.max(
      1,
      Math.round(value / 60)
    );

  if (totalMinutes < 60) {
    return `${totalMinutes} ${
      totalMinutes === 1
        ? "minute"
        : "minutes"
    }`;
  }

  const hours =
    Math.floor(
      totalMinutes / 60
    );

  const minutes =
    totalMinutes % 60;

  return minutes > 0
    ? `${hours} ${
        hours === 1
          ? "hour"
          : "hours"
      } ${minutes} minutes`
    : `${hours} ${
        hours === 1
          ? "hour"
          : "hours"
      }`;
}

/* ==========================================================
   TOAST NOTIFICATIONS
========================================================== */

function createToastContainer() {
  if (
    document.querySelector(
      ".toast-container"
    )
  ) {
    return;
  }

  const container =
    document.createElement("div");

  container.className =
    "toast-container";

  container.setAttribute(
    "aria-live",
    "polite"
  );

  document.body.appendChild(
    container
  );
}

function showToast(
  title,
  message,
  type = ""
) {
  const container =
    document.querySelector(
      ".toast-container"
    );

  if (!container) {
    return;
  }

  const toast =
    document.createElement("article");

  toast.className =
    `toast ${type}`.trim();

  toast.innerHTML = `
    <div class="toast-title">
      ${escapeHtml(title)}
    </div>

    <div class="toast-message">
      ${escapeHtml(message)}
    </div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform =
      "translateX(40px)";
  }, 4200);

  setTimeout(() => {
    toast.remove();
  }, 4600);
}

/* ==========================================================
   RESET DASHBOARD
========================================================== */

function resetDashboard() {
  sessions = [];
  selectedSession = null;
  selectedLocation = null;
  adminPosition = null;

  sessionCount.textContent =
    "0 sessions";

  sessionsList.innerHTML = `
    <div class="empty-state">
      <span class="empty-icon">
        📍
      </span>

      <p>
        No location-sharing session yet.
      </p>
    </div>
  `;

  updateSelectedSessionHeader();
  resetLocationPanels();

  trackRouteBtn.disabled = true;

 if (adminMarker) {
  removeMapMarker(
    adminMarker
  );
  
  adminMarker = null;
}
}