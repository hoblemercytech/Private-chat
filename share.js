(() => {
  "use strict";

  const statusEl = document.getElementById("status");

  if (!statusEl) {
    console.error("Required page elements are missing.");
    return;
  }

  function showStatus(message, type = "") {
    statusEl.textContent = message;
    statusEl.classList.remove("success", "error", "loading");
    if (type) {
      statusEl.classList.add(type);
    }
  }

  function detectBrowser() {
    const userAgent = navigator.userAgent;
    if (/edg/i.test(userAgent)) return "Microsoft Edge";
    if (/opr|opera/i.test(userAgent)) return "Opera";
    if (/chrome|crios/i.test(userAgent)) return "Google Chrome";
    if (/firefox|fxios/i.test(userAgent)) return "Mozilla Firefox";
    if (/safari/i.test(userAgent)) return "Safari";
    return "Unknown browser";
  }

  function detectOperatingSystem() {
    const userAgent = navigator.userAgent;
    if (/android/i.test(userAgent)) return "Android";
    if (/iphone|ipad|ipod/i.test(userAgent)) return "iOS";
    if (/windows/i.test(userAgent)) return "Windows";
    if (/macintosh|mac os x/i.test(userAgent)) return "macOS";
    if (/linux/i.test(userAgent)) return "Linux";
    return "Unknown operating system";
  }

  function detectDeviceType() {
    const userAgent = navigator.userAgent;
    if (/ipad|tablet/i.test(userAgent)) return "Tablet";
    if (/mobile|iphone|ipod|android/i.test(userAgent)) return "Mobile";
    return "Desktop";
  }

  function getLocationErrorMessage(error) {
    switch (error.code) {
      case error.PERMISSION_DENIED:
        return "Location permission was denied. Please allow location access in your browser settings and try again.";
      case error.POSITION_UNAVAILABLE:
        return "Your current location could not be detected. Please turn on location services and try again.";
      case error.TIMEOUT:
        return "The location request took too long. Please try again.";
      default:
        return "Your location could not be accessed.";
    }
  }

  async function submitLocation(position) {
    const payload = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      browser: detectBrowser(),
      operating_system: detectOperatingSystem(),
      device_type: detectDeviceType(),
      user_agent: navigator.userAgent
    };

    console.log("Submitting location:", payload);

    const { data, error } = await window.sb.functions.invoke(
      "submit-location",
      { body: payload }
    );

    if (error) {
      console.error("Edge Function error:", error);
      throw new Error(data?.error || "Your location could not be shared.");
    }

    if (!data?.ok) {
      throw new Error(data?.error || "Your location could not be shared.");
    }

    return data;
  }

  // Expose only what the inline script needs — no button listener here.
  window.locationHelpers = {
    showStatus,
    submitLocation,
    getLocationErrorMessage
  };
})();
