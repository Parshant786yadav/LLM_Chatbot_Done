let loginMode = "guest";
let userEmail = null;
let userUserId = null;  // User ID string (A1, C2...) for chat naming (A1.1, A1.2)
let userIsAdmin = false;
var SUPER_ADMIN_EMAIL = "parshant786yadav@gmail.com";
function isSuperAdmin() {
    return !!(userEmail && (userEmail + "").trim().toLowerCase() === SUPER_ADMIN_EMAIL);
}
let dbData = null;  // admin database view data
let chats = [];
/** @type {Record<string, number>} maps chat name -> server chat id (for API keys) */
let chatIdByName = {};
let cachedApiKeys = [];
let currentChat = null;
let globalDocuments = [];
let chatDocuments = {};
let companyDocuments = [];  // HR company docs (same-domain users access via chat only)
var API_BASE = (window.location.protocol === "http:" || window.location.protocol === "https:") ? "" : "http://localhost:8000";

/** Bot avatar — bump BOT_AVATAR_REVISION when you replace Backend/static/bot-avatar.png (avoids stale browser cache). */
var BOT_AVATAR_REVISION = "4";
var BOT_AVATAR_URL = API_BASE + "/static/bot-avatar.png?v=" + BOT_AVATAR_REVISION;

/* ---------------- LOADERS ---------------- */
function showChatListLoader() {
    var chatList = document.getElementById("chatList");
    if (chatList) chatList.innerHTML = '<li class="chat-list-loading"><span class="chat-loader-dot"></span><span class="chat-loader-dot"></span><span class="chat-loader-dot"></span></li>';
}

function showChatAreaLoader() {
    var chatArea = document.getElementById("chatArea");
    if (chatArea) chatArea.innerHTML = '<div class="chat-area-loading"><span class="chat-loader-dot"></span><span class="chat-loader-dot"></span><span class="chat-loader-dot"></span></div>';
}

function hideChatAreaLoader() {
    var chatArea = document.getElementById("chatArea");
    if (chatArea) chatArea.innerHTML = "";
}

function prefersReducedMotion() {
    try {
        return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
        return false;
    }
}

function scrollChatToBottomSmooth() {
    var el = document.getElementById("chatArea");
    if (!el) return;
    if (prefersReducedMotion()) {
        el.scrollTop = el.scrollHeight;
        return;
    }
    try {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } catch (e) {
        el.scrollTop = el.scrollHeight;
    }
}

/* ---------------- TOASTS & CONFIRM (in-app; no browser alert/confirm) ---------------- */
var TOAST_ICONS = {
    success: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M20 6L9 17l-5-5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>",
    error: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M15 9l-6 6M9 9l6 6\" stroke-linecap=\"round\"/></svg>",
    warning: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M12 9v4M12 17h.01\" stroke-linecap=\"round\"/><path d=\"M10.3 3.2L1.8 18.5c-.5 1 .1 2.2 1.2 2.2h18c1.1 0 1.7-1.2 1.2-2.2L13.7 3.2c-.5-1-1.1-1-1.4-1s-.9 0-1.4 1z\" stroke-linejoin=\"round\"/></svg>",
    info: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 16v-4M12 8h.01\" stroke-linecap=\"round\"/></svg>"
};

var TOAST_SPINNER_SVG = "<svg class=\"toast-spinner\" viewBox=\"0 0 24 24\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"9.5\" stroke=\"currentColor\" stroke-width=\"2.25\" stroke-linecap=\"round\" stroke-dasharray=\"14 50\"/></svg>";

function toast(message, type, opts) {
    type = type || "info";
    opts = opts || {};
    var container = document.getElementById("toastContainer");
    if (!container || message == null || message === "") return null;
    var el = document.createElement("div");
    el.className = "toast toast--" + type;
    el.setAttribute("role", "status");
    var iconEl = document.createElement("span");
    if (type === "loading") {
        iconEl.className = "toast-icon toast-icon--spinner";
        iconEl.innerHTML = TOAST_SPINNER_SVG;
    } else {
        iconEl.className = "toast-icon";
        iconEl.innerHTML = TOAST_ICONS[type] || TOAST_ICONS.info;
    }
    var msgEl = document.createElement("span");
    msgEl.className = "toast-message";
    msgEl.textContent = String(message);
    var dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "toast-dismiss";
    dismiss.setAttribute("aria-label", "Dismiss");
    dismiss.innerHTML = "&times;";
    el.appendChild(iconEl);
    el.appendChild(msgEl);
    el.appendChild(dismiss);
    container.appendChild(el);
    requestAnimationFrame(function () { el.classList.add("toast--visible"); });
    var duration;
    if (opts.persistent) {
        duration = null;
    } else if (opts.duration != null) {
        duration = opts.duration;
    } else if (type === "loading") {
        duration = null;
    } else {
        duration = type === "error" ? 6500 : 5000;
    }
    var timer = null;
    if (duration != null && duration > 0) {
        timer = setTimeout(function () { removeToast(el); }, duration);
    }
    dismiss.onclick = function () {
        if (timer) clearTimeout(timer);
        removeToast(el);
    };
    return el;
}

function removeToast(el) {
    if (!el || !el.parentNode) return;
    el.classList.remove("toast--visible");
    el.classList.add("toast--out");
    var ms = prefersReducedMotion() ? 0 : 280;
    setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
    }, ms);
}

function confirmDialog(message, opts) {
    opts = opts || {};
    var confirmLabel = opts.confirmLabel || "Confirm";
    var cancelLabel = opts.cancelLabel || "Cancel";
    var danger = !!opts.danger;
    return new Promise(function (resolve) {
        var overlay = document.getElementById("confirmDialog");
        if (!overlay) {
            resolve(false);
            return;
        }
        var msgEl = document.getElementById("confirmDialogMessage");
        var okBtn = document.getElementById("confirmDialogOk");
        var cancelBtn = document.getElementById("confirmDialogCancel");
        var backdrop = overlay.querySelector(".confirm-dialog-backdrop");
        if (!msgEl || !okBtn || !cancelBtn || !backdrop) {
            resolve(false);
            return;
        }
        msgEl.textContent = String(message);
        okBtn.textContent = confirmLabel;
        cancelBtn.textContent = cancelLabel;
        okBtn.classList.remove("confirm-dialog-btn--primary", "confirm-dialog-btn--danger");
        if (danger) {
            okBtn.classList.add("confirm-dialog-btn--danger");
        } else {
            okBtn.classList.add("confirm-dialog-btn--primary");
        }
        var finished = false;
        function end(val) {
            if (finished) return;
            finished = true;
            overlay.classList.add("hidden");
            overlay.setAttribute("aria-hidden", "true");
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = "";
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            backdrop.onclick = null;
            resolve(val);
        }
        function onKey(e) {
            if (e.key === "Escape") end(false);
        }
        okBtn.onclick = function () { end(true); };
        cancelBtn.onclick = function () { end(false); };
        backdrop.onclick = function () { end(false); };
        document.addEventListener("keydown", onKey);
        document.body.style.overflow = "hidden";
        overlay.classList.remove("hidden");
        overlay.setAttribute("aria-hidden", "false");
    });
}

/* ---------------- PROFILE DROPDOWN ---------------- */

function toggleProfileDropdown(event) {
    if (event) event.stopPropagation();
    var box = document.getElementById("profileBox");
    if (!box) return;
    box.classList.toggle("open");
    var trigger = document.getElementById("profileTrigger");
    if (trigger) trigger.setAttribute("aria-expanded", box.classList.contains("open"));
    if (box.classList.contains("open")) {
        document.addEventListener("click", closeProfileDropdownOnClickOutside);
    } else {
        document.removeEventListener("click", closeProfileDropdownOnClickOutside);
    }
}

function closeProfileDropdownOnClickOutside(e) {
    var box = document.getElementById("profileBox");
    var trigger = document.getElementById("profileTrigger");
    if (box && trigger && !box.contains(e.target)) {
        closeProfileDropdown();
    }
}

function closeProfileDropdown() {
    var box = document.getElementById("profileBox");
    if (box) {
        box.classList.remove("open");
        document.removeEventListener("click", closeProfileDropdownOnClickOutside);
    }
    var trigger = document.getElementById("profileTrigger");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
}

/* ---------------- MOBILE SIDEBAR ---------------- */

function toggleSidebar() {
    var layout = document.getElementById("layout");
    if (layout) layout.classList.toggle("sidebar-open");
}

function closeSidebar() {
    var layout = document.getElementById("layout");
    if (layout) layout.classList.remove("sidebar-open");
}

(function setupSidebarOverlay() {
    var overlay = document.getElementById("sidebarOverlay");
    if (overlay) overlay.addEventListener("click", closeSidebar);
})();

/* ================= PROFILE (display name + photo, server-backed) ================= */

var _profileCache = { email: null, display_name: null, profile_photo: null };
var DEFAULT_AVATAR_URL = "https://api.dicebear.com/7.x/avataaars/svg?seed=default";
var PROFILE_LS_PREFIX = "documind_profile_v1_";

/** Default display name = first part of the user's email. */
function _defaultDisplayNameFromEmail(email) {
    if (!email) return "User";
    var local = String(email).split("@")[0] || "";
    return local.trim() || "User";
}

/** Save profile to localStorage so a refresh can show it instantly (no flash to old name). */
function _saveProfileToLocalStorage(profile) {
    if (!profile || !profile.email) return;
    try {
        var key = PROFILE_LS_PREFIX + String(profile.email).toLowerCase();
        localStorage.setItem(key, JSON.stringify({
            email: profile.email,
            display_name: profile.display_name || null,
            profile_photo: profile.profile_photo || null,
            ts: Date.now()
        }));
    } catch (e) { /* quota/private-mode: ignore */ }
}

/** Read cached profile for an email, returns null if not cached. */
function _readCachedProfile(email) {
    if (!email) return null;
    try {
        var key = PROFILE_LS_PREFIX + String(email).toLowerCase();
        var raw = localStorage.getItem(key);
        if (!raw) return null;
        var obj = JSON.parse(raw);
        if (!obj || !obj.email) return null;
        return obj;
    } catch (e) { return null; }
}

function _clearCachedProfile(email) {
    if (!email) return;
    try { localStorage.removeItem(PROFILE_LS_PREFIX + String(email).toLowerCase()); } catch (e) {}
}

/** Apply profile (name + photo) to the sidebar trigger and modal. */
function applyProfileToUI(profile, opts) {
    opts = opts || {};
    var p = profile || {};
    var email = p.email || userEmail || "";
    var name = (p.display_name || "").trim() || _defaultDisplayNameFromEmail(email);
    var photo = p.profile_photo || "";

    _profileCache = { email: email, display_name: name, profile_photo: photo || null };

    if (opts.persist !== false && email) {
        _saveProfileToLocalStorage(_profileCache);
    }

    var nameEl = document.getElementById("profileName");
    if (nameEl) {
        nameEl.textContent = name;
        nameEl.title = email;
    }
    var sidebarImg = document.getElementById("profilePhoto");
    if (sidebarImg) sidebarImg.src = photo || DEFAULT_AVATAR_URL;

    var modalImg = document.getElementById("profileModalPhoto");
    if (modalImg) modalImg.src = photo || DEFAULT_AVATAR_URL;
    var modalNameDisplay = document.getElementById("profileModalNameDisplay");
    if (modalNameDisplay) modalNameDisplay.textContent = name;
    var modalEmailEl = document.getElementById("profileModalEmail");
    if (modalEmailEl) modalEmailEl.value = email;
}

/** Apply locally-cached profile for `email` immediately (synchronous, no flash on refresh). */
function applyCachedProfileImmediately(email) {
    if (!email) return false;
    var cached = _readCachedProfile(email);
    if (!cached) return false;
    // Don't re-persist the same value back to localStorage.
    applyProfileToUI(cached, { persist: false });
    return true;
}

/** Pull latest profile from the server (fixes the photo-not-persisting bug). */
async function refreshProfileFromServer() {
    if (!userEmail) return;
    try {
        var res = await fetch(API_BASE + "/api/profile?email=" + encodeURIComponent(userEmail));
        if (!res.ok) {
            // Don't clobber a good cached value with a generic fallback.
            if (!_readCachedProfile(userEmail)) {
                applyProfileToUI({ email: userEmail });
            }
            return;
        }
        var data = await res.json();
        applyProfileToUI(data);
    } catch (e) {
        console.error("Could not load profile", e);
        if (!_readCachedProfile(userEmail)) {
            applyProfileToUI({ email: userEmail });
        }
    }
}

/** Resize/compress an image File to a square JPEG data URL (≤256x256, ~85% quality). */
function _imageFileToCompressedDataUrl(file, maxSize) {
    maxSize = maxSize || 256;
    return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onerror = function () { reject(new Error("Could not read image")); };
        reader.onload = function () {
            var img = new Image();
            img.onerror = function () { reject(new Error("Could not load image")); };
            img.onload = function () {
                var w = img.naturalWidth || img.width;
                var h = img.naturalHeight || img.height;
                if (!w || !h) { reject(new Error("Invalid image")); return; }
                var side = Math.min(w, h);
                var sx = (w - side) / 2;
                var sy = (h - side) / 2;
                var canvas = document.createElement("canvas");
                canvas.width = maxSize;
                canvas.height = maxSize;
                var ctx = canvas.getContext("2d");
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = "high";
                ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);
                try {
                    var url = canvas.toDataURL("image/jpeg", 0.85);
                    resolve(url);
                } catch (err) { reject(err); }
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

async function _patchProfile(payload) {
    var body = Object.assign({ email: userEmail }, payload || {});
    var res = await fetch(API_BASE + "/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
        var msg = (data && (typeof data.detail === "string" ? data.detail : (data.detail && data.detail.msg))) || "Could not update profile";
        throw new Error(msg);
    }
    return data;
}

/** Open the profile modal and refresh data from server. */
async function openProfileModal() {
    if (!userEmail) {
        toast("Please sign in first.", "info");
        return;
    }
    closeProfileDropdown();
    var modal = document.getElementById("profileModal");
    if (!modal) return;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    cancelEditProfileName();
    applyProfileToUI(_profileCache.email === userEmail ? _profileCache : { email: userEmail });
    refreshProfileFromServer();
}

function closeProfileModal() {
    var modal = document.getElementById("profileModal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    cancelEditProfileName();
}

function startEditProfileName() {
    var disp = document.getElementById("profileModalNameDisplay");
    var inp = document.getElementById("profileModalNameInput");
    var saveBtn = document.getElementById("profileModalNameSaveBtn");
    var cancelBtn = document.getElementById("profileModalNameCancelBtn");
    var editBtn = document.getElementById("profileModalNameEditBtn");
    if (!disp || !inp || !saveBtn || !cancelBtn || !editBtn) return;
    inp.value = disp.textContent || "";
    disp.style.display = "none";
    editBtn.style.display = "none";
    inp.style.display = "inline-block";
    saveBtn.style.display = "inline-flex";
    cancelBtn.style.display = "inline-flex";
    inp.focus();
    inp.select();
    inp.onkeydown = function (e) {
        if (e.key === "Enter") { e.preventDefault(); commitEditProfileName(); }
        else if (e.key === "Escape") { e.preventDefault(); cancelEditProfileName(); }
    };
}

function cancelEditProfileName() {
    var disp = document.getElementById("profileModalNameDisplay");
    var inp = document.getElementById("profileModalNameInput");
    var saveBtn = document.getElementById("profileModalNameSaveBtn");
    var cancelBtn = document.getElementById("profileModalNameCancelBtn");
    var editBtn = document.getElementById("profileModalNameEditBtn");
    if (disp) disp.style.display = "";
    if (editBtn) editBtn.style.display = "";
    if (inp) inp.style.display = "none";
    if (saveBtn) saveBtn.style.display = "none";
    if (cancelBtn) cancelBtn.style.display = "none";
}

async function commitEditProfileName() {
    var inp = document.getElementById("profileModalNameInput");
    var saveBtn = document.getElementById("profileModalNameSaveBtn");
    if (!inp) return;
    var newName = (inp.value || "").trim();
    if (!newName) { toast("Name can't be empty.", "warning"); return; }
    if (newName.length > 60) { toast("Name is too long (max 60 chars).", "warning"); return; }
    if (newName === (_profileCache.display_name || "")) {
        cancelEditProfileName();
        return;
    }
    if (saveBtn) saveBtn.disabled = true;
    try {
        var data = await _patchProfile({ display_name: newName });
        applyProfileToUI(data);
        cancelEditProfileName();
        toast("Name updated.", "success");
    } catch (e) {
        toast(e.message || "Could not update name.", "error");
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

async function onProfilePhotoSelected() {
    var input = document.getElementById("profileModalPhotoInput");
    if (!input || !input.files || !input.files.length) return;
    var file = input.files[0];
    if (!file.type || !/^image\//.test(file.type)) {
        toast("Please choose an image file (JPG, PNG, etc.).", "warning");
        input.value = "";
        return;
    }
    var notice = toast("Uploading photo…", "loading", { persistent: true });
    try {
        var dataUrl = await _imageFileToCompressedDataUrl(file, 256);
        var data = await _patchProfile({ profile_photo: dataUrl });
        if (notice) removeToast(notice);
        applyProfileToUI(data);
        toast("Profile photo updated.", "success");
    } catch (e) {
        if (notice) removeToast(notice);
        toast(e.message || "Could not update photo.", "error");
    } finally {
        input.value = "";
    }
}

/* ---------------- LOGIN POPUP ---------------- */

var loginPopupMode = "personal";  // "personal" or "company"

function openLoginPopup() {
    closeSidebar();
    var popup = document.getElementById("loginPopup");
    if (popup) popup.classList.add("is-open");
    document.body.style.overflow = "hidden";
    showLoginStep1();
}

function closeLoginPopup() {
    var popup = document.getElementById("loginPopup");
    if (popup) popup.classList.remove("is-open");
    document.body.style.overflow = "";
}

function showLoginStep1() {
    document.getElementById("loginStep1").style.display = "block";
    document.getElementById("loginStep2").style.display = "none";
}

function resetOtpStep() {
    document.getElementById("loginOtpSection").style.display = "none";
    document.getElementById("loginOtpInput").value = "";
    var btn = document.getElementById("loginEmailBtn");
    btn.textContent = "Send verification code";
    btn.onclick = doSendOtp;
}

function showPersonalLogin() {
    loginPopupMode = "personal";
    document.getElementById("loginStep1").style.display = "none";
    document.getElementById("loginStep2").style.display = "block";
    document.getElementById("loginStep2Title").textContent = "Personal sign in";
    var hint = document.getElementById("loginStep2Hint");
    if (hint) hint.textContent = "Didn’t get the OTP? Check spam";
    document.getElementById("loginEmailInput").placeholder = "you@example.com";
    document.getElementById("loginEmailInput").value = "";
    resetOtpStep();
    var input = document.getElementById("loginEmailInput");
    input.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); doSendOtp(); } };
    input.focus();
}

function showCompanyLogin() {
    loginPopupMode = "company";
    document.getElementById("loginStep1").style.display = "none";
    document.getElementById("loginStep2").style.display = "block";
    document.getElementById("loginStep2Title").textContent = "Company sign in";
    var hint = document.getElementById("loginStep2Hint");
    if (hint) hint.textContent = "Use your work email. We’ll send a code to verify your organization.";
    document.getElementById("loginEmailInput").placeholder = "you@company.com";
    document.getElementById("loginEmailInput").value = "";
    resetOtpStep();
    var input = document.getElementById("loginEmailInput");
    input.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); doSendOtp(); } };
    input.focus();
}

async function doSendOtp() {
    var email = (document.getElementById("loginEmailInput").value || "").trim();
    if (!email || !email.includes("@")) {
        toast(loginPopupMode === "company" ? "Enter a valid company email." : "Enter a valid email.", "warning");
        return;
    }
    var btn = document.getElementById("loginEmailBtn");
    btn.disabled = true;
    btn.textContent = "Sending...";
    try {
        var res = await fetch(API_BASE + "/auth/send-otp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email })
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
            toast(data.detail || "Failed to send OTP.", "error");
            btn.disabled = false;
            btn.textContent = "Send verification code";
            return;
        }
        document.getElementById("loginOtpSection").style.display = "block";
        btn.textContent = "Resend code";
        btn.onclick = doSendOtp;
        btn.disabled = false;
        document.getElementById("loginOtpInput").value = "";
        document.getElementById("loginOtpInput").focus();
        document.getElementById("loginVerifyOtpBtn").onclick = doVerifyOtp;
        document.getElementById("loginOtpInput").onkeydown = function (e) {
            if (e.key === "Enter") { e.preventDefault(); doVerifyOtp(); }
        };
    } catch (e) {
        console.error(e);
        toast("Failed to send OTP. Check your connection.", "error");
        btn.disabled = false;
        btn.textContent = "Send verification code";
    }
}

async function doVerifyOtp() {
    var email = (document.getElementById("loginEmailInput").value || "").trim();
    var otp = (document.getElementById("loginOtpInput").value || "").trim();
    if (!email || !email.includes("@")) {
        toast("Enter a valid email first.", "warning");
        return;
    }
    if (!otp || otp.length < 4) {
        toast("Enter the 6-digit code from your email.", "warning");
        return;
    }
    try {
        var res = await fetch(API_BASE + "/auth/verify-otp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email, otp: otp, mode: loginPopupMode || "personal" })
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
            toast(data.detail || "Invalid or expired code.", "error");
            return;
        }
        // Save whatever user typed in chat before login
        var pendingMsg = "";
        try { 
            var msgInput = document.getElementById("messageInput");
            if (msgInput) pendingMsg = msgInput.value || "";
        } catch(e) {}
        closeLoginPopup();
        if (loginPopupMode === "personal") {
            loginMode = "personal";
            userEmail = email;
            try { localStorage.setItem("userEmail", email); localStorage.setItem("loginMode", "personal"); } catch(e) {}
            applyPersonalLoginUI(email);
        } else {
            loginMode = "company";
            userEmail = email;
            try { localStorage.setItem("userEmail", email); localStorage.setItem("loginMode", "company"); } catch(e) {}
            applyCompanyLoginUI(email);
        }
        refreshProfileFromServer();
        var claimed = await claimGuestChatIfAny(email);
        if (!claimed) loadUserData(email);
        // Restore pending message after login
        try {
            if (pendingMsg) {
                var msgInput = document.getElementById("messageInput");
                if (msgInput) msgInput.value = pendingMsg;
            }
        } catch(e) {}
    } catch (e) {
        console.error(e);
        toast("Verification failed. Check your connection.", "error");
    }
    
}

// Restore session from localStorage on page load
(function restoreSession() {
    function doRestore() {
        try {
            // Reset guest count if no active guest chat
            if (!localStorage.getItem("documind_guest_chat_id")) {
                localStorage.removeItem("documind_guest_msg_count");
            }

            if (localStorage.getItem("loggedOut") === "1") {
                localStorage.removeItem("loggedOut");
                return;
            }

            var savedEmail = localStorage.getItem("userEmail");
            var savedMode = localStorage.getItem("loginMode") || "personal";
            if (!savedEmail) return;

            userEmail = savedEmail;
            loginMode = savedMode;

            if (savedMode === "company") {
                applyCompanyLoginUI(savedEmail);
            } else {
                applyPersonalLoginUI(savedEmail);
            }

            refreshProfileFromServer();

            var savedChat = localStorage.getItem("currentChat");
            loadUserData(savedEmail).then(function() {
                if (savedChat && chats.indexOf(savedChat) !== -1) {
                    selectChat(savedChat);
                }
            });

        } catch(e) {}
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", doRestore);
    } else {
        doRestore();
    }
})();

function googleLoginFromPopup() {
    closeLoginPopup();
    // Save pending message before redirect
    try {
        var msgInput = document.getElementById("messageInput");
        if (msgInput && msgInput.value) {
            localStorage.setItem("pendingMsg", msgInput.value);
        }
    } catch(e) {}
    googleLogin();
}

/* ================= LOAD USER DATA ================= */

async function loadUserData(email) {
    try {
        // Fetch user_id (A1, C2, etc.) for profile and chat naming
        try {
            var infoRes = await fetch(API_BASE + "/user-info?email=" + encodeURIComponent(email));
            var info = await infoRes.json();
            userUserId = info.user_id || null;
            userIsAdmin = !!info.is_admin;
            var dispEl = document.getElementById("profileUserId");
            if (dispEl) dispEl.textContent = userUserId || "--";
            var adminSec = document.getElementById("adminSection");
            if (adminSec) adminSec.style.display = userIsAdmin ? "block" : "none";
        } catch (e) {
            console.error("Failed to load user info", e);
        }

        // Load chats
        showChatListLoader();
        const chatRes = await fetch(API_BASE + "/chats/" + encodeURIComponent(email));
        const chatData = await chatRes.json();
        chatIdByName = {};
        chats = (chatData.chats || []).map(function (c) {
            if (typeof c === "string") return c;
            if (c && c.name != null) {
                if (c.id != null) chatIdByName[c.name] = c.id;
                return c.name;
            }
            return String(c);
        });
        renderChats();

        // Load global documents (only for personal mode) - backend returns only global (chat_id null)
        if (loginMode === "personal") {
            const docRes = await fetch(`${API_BASE}/documents/${email}`);
            const docData = await docRes.json();
            const docList = docData.documents || [];
            globalDocuments = docList.map(function (d) { return { id: d.id, name: d.name, file: null, has_preview: d.has_preview }; });
            renderGlobalDocs();
        }
        // Load company documents for HR (company mode, hr@...)
        if (loginMode === "company" && email && email.trim().toLowerCase().startsWith("hr@")) {
            try {
                const companyRes = await fetch(`${API_BASE}/documents/company/${encodeURIComponent(email)}`);
                const companyData = await companyRes.json();
                companyDocuments = (companyData.documents || []).map(function (d) { return { id: d.id, name: d.name, has_preview: d.has_preview }; });
                renderCompanyDocs();
                var setRes = await fetch(`${API_BASE}/company/settings?email=${encodeURIComponent(email)}`);
                var setData = await setRes.json().catch(function () { return {}; });
                var check = document.getElementById("companyShowCountCheck");
                if (check) check.checked = !!setData.show_doc_count_to_employees;
            } catch (e) {
                companyDocuments = [];
            }
        }
        // Load company document count for employees (when HR enabled "show count to employees")
        if (loginMode === "company" && email && !email.trim().toLowerCase().startsWith("hr@")) {
            try {
                const countRes = await fetch(`${API_BASE}/documents/company/count?email=${encodeURIComponent(email)}`);
                const countData = await countRes.json().catch(function () { return {}; });
                var countEl = document.getElementById("companyDocCountEmployee");
                if (countEl && countData.visible) {
                    countEl.textContent = "Company documents: " + (countData.count || 0);
                    countEl.style.display = "block";
                }
            } catch (e) {}
        }

        if (loginMode === "personal") {
            const chatNames = chats.slice();
            await Promise.all(
                chatNames.map(function (chatName) {
                    return fetch(`${API_BASE}/documents/${email}/${encodeURIComponent(chatName)}`)
                        .then(function (r) { return r.json(); })
                        .then(function (chatDocData) {
                            const chatDocList = chatDocData.documents || [];
                            chatDocuments[chatName] = chatDocList.map(function (d) {
                                return { id: d.id, name: d.name, file: null, has_preview: d.has_preview };
                            });
                        })
                        .catch(function (err) {
                            console.error("Error loading docs for chat " + chatName, err);
                            chatDocuments[chatName] = chatDocuments[chatName] || [];
                        });
                })
            );
        }

        if (loginMode === "personal") {
            await refreshApiKeys();
        } else {
            cachedApiKeys = [];
            renderGlobalApiKeysList();
            renderChatApiKeysList();
        }
        updateApiKeysSectionVisibility();

    } catch (error) {
        console.error("Error loading user data:", error);
    }
}


/* ================= PERSONAL / COMPANY LOGIN UI ================= */

function applyPersonalLoginUI(email) {
    document.getElementById("loginBtn").style.display = "none";
    document.getElementById("profileBox").style.display = "block";
    var nameEl = document.getElementById("profileName");
    nameEl.title = email;
    if (!applyCachedProfileImmediately(email)) {
        nameEl.textContent = _defaultDisplayNameFromEmail(email);
    }
    document.getElementById("documentSection").style.display = "block";
    document.getElementById("documentSectionTitle").textContent = "Global Documents";
    document.getElementById("documentUploadWrap").style.display = "block";
    document.getElementById("globalDocsBlock").style.display = "block";
    var companyDocsBlock = document.getElementById("companyDocsBlock");
    if (companyDocsBlock) companyDocsBlock.style.display = "none";
    var companyShowCountWrap = document.getElementById("companyShowCountWrap");
    if (companyShowCountWrap) companyShowCountWrap.style.display = "none";
    document.getElementById("companyDocCountEmployee").style.display = "none";
    document.getElementById("companyDocHintHr").style.display = "none";
    document.getElementById("companyDocHintEmployee").style.display = "none";
    var panel = document.getElementById("chatDocsPanel");
    if (panel) panel.style.display = "block";
    renderChatDocs();
    updateApiKeysSectionVisibility();
}

function applyCompanyLoginUI(email) {
    document.getElementById("loginBtn").style.display = "none";
    document.getElementById("profileBox").style.display = "block";
    var nameEl = document.getElementById("profileName");
    nameEl.title = email;
    if (!applyCachedProfileImmediately(email)) {
        nameEl.textContent = _defaultDisplayNameFromEmail(email);
    }
    document.getElementById("documentSection").style.display = "block";
    document.getElementById("documentSectionTitle").textContent = "Company Documents";
    document.getElementById("globalDocsBlock").style.display = "none";
    var isHr = email && String(email).trim().toLowerCase().startsWith("hr@");
    document.getElementById("documentUploadWrap").style.display = isHr ? "block" : "none";
    document.getElementById("companyDocHintHr").style.display = isHr ? "block" : "none";
    var companyShowCountWrap = document.getElementById("companyShowCountWrap");
    if (companyShowCountWrap) companyShowCountWrap.style.display = isHr ? "block" : "none";
    var companyDocsBlock = document.getElementById("companyDocsBlock");
    if (companyDocsBlock) companyDocsBlock.style.display = isHr ? "block" : "none";
    document.getElementById("companyDocCountEmployee").style.display = "none";
    document.getElementById("companyDocHintEmployee").style.display = isHr ? "none" : "block";
    var panel = document.getElementById("chatDocsPanel");
    if (panel) panel.style.display = "none";
    updateApiKeysSectionVisibility();
}

function logout() {
    closeProfileDropdown();
    closeProfileModal();
    _clearCachedProfile(userEmail);
    _profileCache = { email: null, display_name: null, profile_photo: null };
    var sidebarImg = document.getElementById("profilePhoto");
    if (sidebarImg) sidebarImg.src = DEFAULT_AVATAR_URL;
    var profileNameEl = document.getElementById("profileName");
    if (profileNameEl) { profileNameEl.textContent = "Account"; profileNameEl.title = ""; }
    loginMode = "guest";
    userEmail = null;
    chatIdByName = {};
    cachedApiKeys = [];
    clearGuestSession();
try { localStorage.removeItem("currentChat"); } catch(e) {}

try { 
    localStorage.removeItem("userEmail"); 
    localStorage.removeItem("loginMode"); 
    localStorage.setItem("loggedOut", "1");
    sessionStorage.clear();
} catch(e) {}
history.replaceState({}, document.title, window.location.pathname || "/");
    document.getElementById("loginBtn").style.display = "block";
    document.getElementById("profileBox").style.display = "none";

    chats = [];
    globalDocuments = [];
    chatDocuments = {};
    companyDocuments = [];
    currentChat = null;

    var gar = document.getElementById("globalApiKeyReveal");
    if (gar) { gar.style.display = "none"; gar.textContent = ""; }
    var car = document.getElementById("chatApiKeyReveal");
    if (car) { car.style.display = "none"; car.textContent = ""; }
    closeChatApiKeyPopover();
    closeChatDocsUploadPopover();

    document.getElementById("chatList").innerHTML = "";
    document.getElementById("chatArea").innerHTML = "";
    document.getElementById("chatTitle").innerText = "DocuMind";
    var panel = document.getElementById("chatDocsPanel");
    if (panel) panel.style.display = "block";
    /* Keep sidebar same as after login: show Global Documents section */
    document.getElementById("documentSection").style.display = "block";
    document.getElementById("documentSectionTitle").textContent = "Global Documents";
    document.getElementById("documentUploadWrap").style.display = "block";
    document.getElementById("globalDocsBlock").style.display = "block";
    var companyDocsBlock = document.getElementById("companyDocsBlock");
    if (companyDocsBlock) companyDocsBlock.style.display = "none";
    var companyShowCountWrap = document.getElementById("companyShowCountWrap");
    if (companyShowCountWrap) companyShowCountWrap.style.display = "none";
    document.getElementById("companyDocCountEmployee").style.display = "none";
    document.getElementById("companyDocHintHr").style.display = "none";
    document.getElementById("companyDocHintEmployee").style.display = "none";
    showStartView();
    userUserId = null;
    userIsAdmin = false;
    var dispEl = document.getElementById("profileUserId");
    if (dispEl) dispEl.textContent = "--";
    var adminSec = document.getElementById("adminSection");
    if (adminSec) adminSec.style.display = "none";
    closeDatabaseView();
    renderGlobalDocs();
}

/* ---------------- GUEST CHAT (2 messages without login) ---------------- */

var GUEST_CHAT_STORAGE_KEY = "documind_guest_chat_id";
var GUEST_COUNT_STORAGE_KEY = "documind_guest_msg_count";

function getOrCreateGuestChatId() {
    try {
        var id = localStorage.getItem(GUEST_CHAT_STORAGE_KEY);
        if (id) return id;
        var uuid = "guest-" + crypto.randomUUID();
        localStorage.setItem(GUEST_CHAT_STORAGE_KEY, uuid);
        return uuid;
    } catch (e) {
        return "guest-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    }
}

function getGuestMessageCount() {
    try {
        var n = parseInt(localStorage.getItem(GUEST_COUNT_STORAGE_KEY), 10);
        return isNaN(n) ? 0 : n;
    } catch (e) {
        return 0;
    }
}

function setGuestMessageCount(n) {
    try {
        localStorage.setItem(GUEST_COUNT_STORAGE_KEY, String(n));
    } catch (e) {}
}

function clearGuestSession() {
    try {
        localStorage.removeItem(GUEST_CHAT_STORAGE_KEY);
        localStorage.removeItem(GUEST_COUNT_STORAGE_KEY);
    } catch (e) {}
}

/** If user had a guest chat, claim it so all messages get the user's display_id and chat is renamed to "Chat 1". No message reload to avoid refresh. Call after successful login. Returns true if a chat was claimed. */
async function claimGuestChatIfAny(email) {
    try {
        var guestChatId = localStorage.getItem(GUEST_CHAT_STORAGE_KEY);
        if (!guestChatId) return false;
        var res = await fetch(API_BASE + "/chats/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ guest_chat_name: guestChatId, email: email })
        });
        if (!res.ok) return false;
        var data = await res.json().catch(function () { return {}; });
        clearGuestSession();
        var newName = (data.name && data.name.trim()) ? data.name.trim() : guestChatId;

        currentChat = newName;
        try { localStorage.setItem("currentChat", newName); } catch(e) {}
        document.getElementById("chatTitle").innerText = newName;
        // Keep existing messages in the DOM — no reload (server already has them after claim).
        var gi = chats.indexOf(guestChatId);
        if (gi !== -1) chats[gi] = newName;
        else if (chats.indexOf(newName) === -1) chats.unshift(newName);
        if (chatIdByName[guestChatId] !== undefined) {
            chatIdByName[newName] = chatIdByName[guestChatId];
            delete chatIdByName[guestChatId];
        }
        renderChats();

        try {
            var infoRes = await fetch(API_BASE + "/user-info?email=" + encodeURIComponent(email));
            var info = await infoRes.json();
            userUserId = info.user_id || null;
            userIsAdmin = !!info.is_admin;
            var dispEl = document.getElementById("profileUserId");
            if (dispEl) dispEl.textContent = userUserId || "--";
            var adminSec = document.getElementById("adminSection");
            if (adminSec) adminSec.style.display = userIsAdmin ? "block" : "none";
        } catch (e) {
            console.error("Failed to load user info after claim", e);
        }

        loadUserData(email).catch(function (err) {
            console.error("Error loading user data after guest claim", err);
        });
        return true;
    } catch (e) {
        console.error("Claim guest chat error", e);
        clearGuestSession();
        return false;
    }
}

/** Tracks created chats that haven't been used yet (no message, no doc, no API key).
    Used so clicking "+ New Chat" reuses an existing empty chat instead of piling up empties. */
var _emptyChats = (function () {
    var s = {};
    return {
        add: function (name) { if (name) s[name] = true; },
        remove: function (name) { if (name) delete s[name]; },
        has: function (name) { return !!s[name]; },
        first: function () { for (var k in s) { if (s.hasOwnProperty(k)) return k; } return null; },
        clearAll: function () { s = {}; }
    };
})();

/** Slim animated bar at the top — for lightweight transitions like opening a new empty chat. */
function showTopProgress() {
    var bar = document.getElementById("topProgressBar");
    if (bar) bar.classList.add("is-active");
}
function hideTopProgress() {
    var bar = document.getElementById("topProgressBar");
    if (bar) bar.classList.remove("is-active");
}

/** Polished skeleton loader for chat history. Shows immediately on chat click. */
function showChatLoading(label) {
    var chatArea = document.getElementById("chatArea");
    if (!chatArea) return;
    var html =
        '<div class="chat-loading" id="chatLoading" role="status" aria-live="polite" aria-label="Loading messages">' +
        '<div class="chat-loading-row">' +
            '<div class="chat-loading-avatar"></div>' +
            '<div class="chat-loading-bubble chat-loading-bubble--med"></div>' +
        '</div>' +
        '<div class="chat-loading-row chat-loading-row--user">' +
            '<div class="chat-loading-bubble chat-loading-bubble--short"></div>' +
        '</div>' +
        '<div class="chat-loading-row">' +
            '<div class="chat-loading-avatar"></div>' +
            '<div class="chat-loading-bubble chat-loading-bubble--long"></div>' +
        '</div>' +
        '<div class="chat-loading-row chat-loading-row--user">' +
            '<div class="chat-loading-bubble chat-loading-bubble--med"></div>' +
        '</div>' +
        '<div class="chat-loading-status">' +
            '<span class="chat-loading-spinner" aria-hidden="true"></span>' +
            '<span>' + (label || "Loading chat…") + '</span>' +
        '</div>' +
        '</div>';
    chatArea.innerHTML = html;
}

function hideChatLoading() {
    var el = document.getElementById("chatLoading");
    if (el && el.parentNode) el.parentNode.removeChild(el);
}

/** Render an array of messages using a single fragment + one scroll for fast loads. */
function renderMessagesBatch(messages) {
    var chatArea = document.getElementById("chatArea");
    if (!chatArea) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        var node = buildMessageNode(msg.content, msg.role);
        if (node) frag.appendChild(node);
    }
    chatArea.appendChild(frag);
    requestAnimationFrame(function () {
        scrollChatToBottomSmooth();
    });
}

/** Token to ignore stale responses when the user rapidly switches chats. */
var _chatLoadToken = 0;

/** Load messages for currentChat from server and re-render. Used after claiming guest chat so messages show under user. */
async function loadMessagesForCurrentChat() {
    if (!currentChat || !userEmail) return;
    var chatArea = document.getElementById("chatArea");
    if (!chatArea) return;
    var token = ++_chatLoadToken;
    showTopProgress();
    try {
        var res = await fetch(
            API_BASE + "/messages/" + encodeURIComponent(userEmail) + "/" + encodeURIComponent(currentChat)
        );
        var data = await res.json();
        if (token !== _chatLoadToken) {
            hideTopProgress();
            return;
        }
        var messages = data.messages || [];
        chatArea.innerHTML = "";
        renderMessagesBatch(messages);
        if (messages.length > 0) {
            showChatView();
        } else {
            showStartView();
        }
    } catch (e) {
        console.error("Error loading messages for current chat", e);
        showStartView();
    } finally {
        hideTopProgress();
    }
}

/* ---------------- CHAT LOGIC ---------------- */

/** Creates a new chat on server and in local state. Returns the new chat name or null on failure. Does not select it. */
async function createNewChatAndReturnName() {
    if (!userEmail) return null;
    if (!userUserId) {
        try {
            var r = await fetch(API_BASE + "/user-info?email=" + encodeURIComponent(userEmail));
            var info = await r.json();
            userUserId = info.user_id || null;
            var dispEl = document.getElementById("profileUserId");
            if (dispEl) dispEl.textContent = userUserId || "--";
        } catch (e) {}
    }
    var n = 1;
    while (chats.indexOf("New Chat " + n) !== -1) n++;
    var chatName = "New Chat " + n;
    try {
        var createRes = await fetch(API_BASE + "/chats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: userEmail, name: chatName, mode: loginMode || "personal" })
        });
        var createData = await createRes.json().catch(function () { return {}; });
        if (!createRes.ok && createRes.status !== 200) return null;
        if (createData.chat_id != null) chatIdByName[chatName] = createData.chat_id;
    } catch (err) {
        console.error("Create chat error", err);
        return null;
    }
    chats.push(chatName);
    chatDocuments[chatName] = [];
    return chatName;
}

async function createChat() {
    if (!userEmail) {
        toast("Please sign in first.", "info");
        return;
    }

    // ChatGPT-style: if an unused empty chat already exists, reuse it instead of creating another.
    var reusable = _emptyChats.first();
    if (reusable && chats.indexOf(reusable) !== -1) {
        if (currentChat === reusable) {
            closeSidebar();
            return;
        }
        await selectChat(reusable, { knownEmpty: true });
        return;
    }

    showTopProgress();
    var chatName = await createNewChatAndReturnName();
    if (!chatName) {
        hideTopProgress();
        toast("Could not create chat. Is the backend running?", "error");
        return;
    }
    _emptyChats.add(chatName);
    renderChats();
    await selectChat(chatName, { knownEmpty: true });
}

function renderChats() {
    const chatList = document.getElementById("chatList");
    chatList.innerHTML = "";

    chats.forEach(chat => {
        const li = document.createElement("li");
        li.className = "chat-list-item" + (chat === currentChat ? " chat-list-item-active" : "");
        li.setAttribute("data-chat-name", chat);

        const nameWrap = document.createElement("span");
        nameWrap.className = "chat-name-wrap";
        const nameSpan = document.createElement("span");
        nameSpan.className = "chat-name-text";
        nameSpan.textContent = (chat && String(chat).indexOf("guest-") === 0) ? "Guest chat" : chat;
        nameWrap.appendChild(nameSpan);

        const actions = document.createElement("div");
        actions.className = "chat-item-actions";
        const menuBtn = document.createElement("button");
        menuBtn.type = "button";
        menuBtn.className = "chat-menu-btn";
        menuBtn.setAttribute("aria-label", "Chat options");
        menuBtn.innerHTML = "&#8942;";
        const dropdown = document.createElement("div");
        dropdown.className = "chat-menu-dropdown";
        dropdown.setAttribute("role", "menu");
        const renameBtn = document.createElement("button");
        renameBtn.type = "button";
        renameBtn.className = "chat-menu-rename";
        renameBtn.textContent = "Rename";
        renameBtn.setAttribute("role", "menuitem");
        dropdown.appendChild(renameBtn);
        actions.appendChild(menuBtn);
        actions.appendChild(dropdown);

        li.appendChild(nameWrap);
        li.appendChild(actions);

        nameWrap.onclick = function (e) { e.stopPropagation(); selectChat(chat); };
        menuBtn.onclick = function (e) {
            e.stopPropagation();
            closeAllChatMenus();
            dropdown.classList.toggle("open");
        };
        renameBtn.onclick = function (e) {
            e.stopPropagation();
            dropdown.classList.remove("open");
            startRenameChat(li, chat, nameSpan);
        };

        chatList.appendChild(li);
    });
}

function closeAllChatMenus() {
    document.querySelectorAll(".chat-menu-dropdown.open").forEach(function (el) { el.classList.remove("open"); });
}

function startRenameChat(li, oldName, nameSpan) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "chat-name-edit";
    input.value = oldName;
    const wrap = li.querySelector(".chat-name-wrap");
    wrap.replaceChild(input, nameSpan);
    input.focus();
    input.select();

    function finishRename() {
        const newName = input.value.trim();
        wrap.removeChild(input);
        const span = document.createElement("span");
        span.className = "chat-name-text";
        span.textContent = newName ? newName : oldName;
        wrap.appendChild(span);
        span.onclick = function (e) { e.stopPropagation(); selectChat(newName || oldName); };

        if (newName && newName !== oldName) {
            renameChatOnServer(oldName, newName);
        }
        input.removeEventListener("blur", finishRename);
        input.removeEventListener("keydown", onKey);
    }

    function onKey(e) {
        if (e.key === "Enter") { e.preventDefault(); finishRename(); }
        if (e.key === "Escape") {
            e.preventDefault();
            input.value = oldName;
            finishRename();
        }
    }

    input.addEventListener("blur", finishRename);
    input.addEventListener("keydown", onKey);
}

async function renameChatOnServer(oldName, newName) {
    if (!userEmail) return;
    try {
        const res = await fetch(API_BASE + "/chats/rename", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: userEmail, old_name: oldName, new_name: newName })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
            const idx = chats.indexOf(oldName);
            if (idx !== -1) chats[idx] = newName;
            if (currentChat === oldName) {
                currentChat = newName;
                document.getElementById("chatTitle").innerText = newName;
            }
            if (chatDocuments[oldName] !== undefined) {
                chatDocuments[newName] = chatDocuments[oldName];
                delete chatDocuments[oldName];
            }
            if (chatIdByName[oldName] !== undefined) {
                chatIdByName[newName] = chatIdByName[oldName];
                delete chatIdByName[oldName];
            }
            renderChats();
            closeChatApiKeyPopover();
            closeChatDocsUploadPopover();
        } else {
            const msg = Array.isArray(data.detail) ? data.detail.map(function (x) { return x.msg || x; }).join(" ") : (data.detail || "Rename failed");
            toast(msg, "error");
        }
    } catch (err) {
        console.error("Rename error", err);
        toast("Rename failed. Is the backend running?", "error");
    }
}

async function selectChat(chatName, opts) {
    var options = opts || {};
    closeSidebar();
    closeDatabaseView();
    closeChatApiKeyPopover();
    closeChatDocsUploadPopover();
    currentChat = chatName;
    try { localStorage.setItem("currentChat", chatName); } catch(e) {}
    document.getElementById("chatTitle").innerText = chatName;
    var chatArea = document.getElementById("chatArea");
    if (chatArea) chatArea.innerHTML = "";
    renderChats();

    var token = ++_chatLoadToken;
    var isKnownEmpty = !!options.knownEmpty || _emptyChats.has(chatName);
    if (isKnownEmpty) {
        showStartView();
    } else {
        showChatView();
    }
    showTopProgress();

    var panel = document.getElementById("chatDocsPanel");
    if (panel) panel.style.display = (loginMode === "company") ? "none" : "block";

    var docsPromise = Promise.resolve();
    if (loginMode === "personal" && panel) {
        if (!chatDocuments[chatName]) {
            docsPromise = fetch(API_BASE + "/documents/" + encodeURIComponent(userEmail) + "/" + encodeURIComponent(chatName))
                .then(function (r) { return r.json(); })
                .then(function (chatDocData) {
                    var chatDocList = (chatDocData && chatDocData.documents) || [];
                    chatDocuments[chatName] = chatDocList.map(function (d) {
                        return { id: d.id, name: d.name, file: null, has_preview: d.has_preview };
                    });
                })
                .catch(function (err) {
                    console.error("Error loading docs for chat", err);
                    chatDocuments[chatName] = [];
                });
        }
    }

    var messagesPromise = fetch(
        API_BASE + "/messages/" + encodeURIComponent(userEmail) + "/" + encodeURIComponent(chatName)
    )
    .then(function (res) { return res.json(); })
    .catch(function (err) {
        console.error("Error loading messages:", err);
        return { messages: [] };
    });

    var results;
    try {
        results = await Promise.all([messagesPromise, docsPromise]);
    } catch (e) {
        results = [{ messages: [] }];
    }

    if (token !== _chatLoadToken) {
        hideTopProgress();
        return;
    }

    var data = results[0] || { messages: [] };
    var messages = data.messages || [];

    if (chatArea) chatArea.innerHTML = "";
    if (messages.length > 0) {
        renderMessagesBatch(messages);
        showChatView();
        _emptyChats.remove(chatName);
    } else {
        showStartView();
    }
    hideTopProgress();

    if (loginMode === "personal" && panel) renderChatDocs();
    updateApiKeysSectionVisibility();
    renderChatApiKeysList();
}

/* ---------------- USER API KEYS (personal) ---------------- */

function updateApiKeysSectionVisibility() {
    var g = document.getElementById("globalApiKeysSection");
    var tbar = document.getElementById("chatApiKeyToolbar");
    var personal = loginMode === "personal" && !!userEmail;
    if (g) g.style.display = personal ? "block" : "none";
    if (tbar) tbar.style.display = personal && currentChat ? "block" : "none";
    if (!personal || !currentChat) {
        closeChatApiKeyPopover();
        closeChatDocsUploadPopover();
    }
}

function closeChatApiKeyPopover() {
    var pop = document.getElementById("chatApiKeyPopover");
    var btn = document.getElementById("chatApiKeyPopoverBtn");
    if (pop) {
        pop.classList.remove("chat-api-key-popover--open");
        pop.setAttribute("aria-hidden", "true");
    }
    if (btn) btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", closeChatApiKeyPopoverOnOutside);
}

function closeChatApiKeyPopoverOnOutside(e) {
    var wrap = document.querySelector(".chat-api-key-toolbar-inner");
    if (wrap && !wrap.contains(e.target)) {
        closeChatApiKeyPopover();
    }
}

function toggleChatApiKeyPopover(e) {
    if (e) e.stopPropagation();
    var pop = document.getElementById("chatApiKeyPopover");
    var btn = document.getElementById("chatApiKeyPopoverBtn");
    if (!pop || !btn) return;
    if (pop.classList.contains("chat-api-key-popover--open")) {
        closeChatApiKeyPopover();
        return;
    }
    closeChatDocsUploadPopover();
    pop.classList.add("chat-api-key-popover--open");
    pop.setAttribute("aria-hidden", "false");
    btn.setAttribute("aria-expanded", "true");
    setTimeout(function () {
        document.addEventListener("click", closeChatApiKeyPopoverOnOutside);
    }, 0);
}

function closeChatDocsUploadPopover() {
    var pop = document.getElementById("chatDocsUploadPopover");
    var btn = document.getElementById("chatDocsUploadPopoverBtn");
    if (pop) {
        pop.classList.remove("chat-docs-upload-popover--open");
        pop.setAttribute("aria-hidden", "true");
    }
    if (btn) btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", closeChatDocsUploadPopoverOnOutside);
}

function closeChatDocsUploadPopoverOnOutside(e) {
    var wrap = document.querySelector(".chat-docs-upload-toolbar-inner");
    if (wrap && !wrap.contains(e.target)) {
        closeChatDocsUploadPopover();
    }
}

function toggleChatDocsUploadPopover(e) {
    if (e) e.stopPropagation();
    var pop = document.getElementById("chatDocsUploadPopover");
    var btn = document.getElementById("chatDocsUploadPopoverBtn");
    if (!pop || !btn) return;
    if (pop.classList.contains("chat-docs-upload-popover--open")) {
        closeChatDocsUploadPopover();
        return;
    }
    closeChatApiKeyPopover();
    pop.classList.add("chat-docs-upload-popover--open");
    pop.setAttribute("aria-hidden", "false");
    btn.setAttribute("aria-expanded", "true");
    setTimeout(function () {
        document.addEventListener("click", closeChatDocsUploadPopoverOnOutside);
    }, 0);
}

async function refreshApiKeys() {
    if (!userEmail || loginMode !== "personal") return;
    try {
        var res = await fetch(API_BASE + "/api-keys/list?email=" + encodeURIComponent(userEmail));
        var data = await res.json().catch(function () { return {}; });
        cachedApiKeys = data.keys || [];
        if (data.warning) console.warn(data.warning);
        renderGlobalApiKeysList();
        renderChatApiKeysList();
    } catch (e) {
        console.error("refreshApiKeys", e);
    }
}

function renderGlobalApiKeysList() {
    var ul = document.getElementById("globalApiKeysList");
    if (!ul) return;
    ul.innerHTML = "";
    cachedApiKeys.filter(function (k) { return k.scope === "global"; }).forEach(function (k) {
        var li = document.createElement("li");
        var span = document.createElement("span");
        span.className = "api-key-meta";
        span.textContent = (k.label || "—") + " · " + (k.key_hint || "••••");
        li.appendChild(span);
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "api-keys-revoke";
        btn.textContent = "Revoke";
        btn.onclick = function () { revokeApiKey(k.id); };
        li.appendChild(btn);
        ul.appendChild(li);
    });
}

function renderChatApiKeysList() {
    var ul = document.getElementById("chatApiKeysList");
    if (!ul) return;
    ul.innerHTML = "";
    if (!currentChat) return;
    var cid = chatIdByName[currentChat];
    if (cid == null) {
        var miss = document.createElement("li");
        miss.className = "api-keys-li-muted";
        miss.style.color = "#94a3b8";
        miss.textContent = "Chat id not loaded — switch chat or refresh the page.";
        ul.appendChild(miss);
        return;
    }
    cachedApiKeys.filter(function (k) { return k.scope === "chat" && Number(k.chat_id) === Number(cid); }).forEach(function (k) {
        var li = document.createElement("li");
        var span = document.createElement("span");
        span.className = "api-key-meta";
        span.textContent = (k.label || "—") + " · " + (k.key_hint || "••••");
        li.appendChild(span);
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "api-keys-revoke";
        btn.textContent = "Revoke";
        btn.onclick = function () { revokeApiKey(k.id); };
        li.appendChild(btn);
        ul.appendChild(li);
    });
}

async function createGlobalApiKey() {
    if (!userEmail || loginMode !== "personal") return;
    var labelIn = document.getElementById("globalApiKeyLabel");
    var label = labelIn ? labelIn.value.trim() : "";
    var reveal = document.getElementById("globalApiKeyReveal");
    try {
        var res = await fetch(API_BASE + "/api-keys/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: userEmail, scope: "global", label: label || null })
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
            toast((data.detail && (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail))) || "Could not create key", "error");
            return;
        }
        if (reveal) {
            reveal.style.display = "block";
            reveal.textContent = "Save this key now (shown once): " + (data.api_key || "");
        }
        if (labelIn) labelIn.value = "";
        await refreshApiKeys();
        toast("Global API key created.", "success");
    } catch (e) {
        console.error(e);
        toast("Could not create API key.", "error");
    }
}

async function createChatApiKey() {
    if (!userEmail || !currentChat || loginMode !== "personal") return;
    var labelIn = document.getElementById("chatApiKeyLabel");
    var label = labelIn ? labelIn.value.trim() : "";
    var reveal = document.getElementById("chatApiKeyReveal");
    try {
        var res = await fetch(API_BASE + "/api-keys/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: userEmail,
                scope: "chat",
                chat_name: currentChat,
                label: label || null
            })
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
            toast((data.detail && (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail))) || "Could not create key", "error");
            return;
        }
        if (reveal) {
            reveal.style.display = "block";
            reveal.textContent = "Save this key now (shown once): " + (data.api_key || "");
        }
        if (labelIn) labelIn.value = "";
        if (currentChat) _emptyChats.remove(currentChat);
        await refreshApiKeys();
        toast("Chat API key created.", "success");
    } catch (e) {
        console.error(e);
        toast("Could not create API key.", "error");
    }
}

async function revokeApiKey(keyId) {
    if (!userEmail) return;
    if (!(await confirmDialog("Revoke this API key? Apps using it will stop working.", { confirmLabel: "Revoke", cancelLabel: "Cancel", danger: true }))) return;
    try {
        var res = await fetch(API_BASE + "/api-keys/revoke", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: userEmail, key_id: keyId })
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
            toast(data.detail || "Could not revoke.", "error");
            return;
        }
        await refreshApiKeys();
        toast("Key revoked.", "success");
    } catch (e) {
        console.error(e);
        toast("Could not revoke key.", "error");
    }
}

/* ---------------- DOCUMENTS (PERSONAL MODE ONLY) ---------------- */

function checkLoginBeforeUpload(event) {
    if (!userEmail) {
        event.preventDefault();
        toast("Please signin first.", "info");
    }
}

function uploadGlobal() {
    if (loginMode !== "personal") return;
    const file = document.getElementById("globalUpload").files[0];
    if (!file) return;
    globalDocuments.push({ name: file.name, file: file });
    renderGlobalDocs();
    document.getElementById("globalUpload").value = "";
}

async function uploadChatDoc() {
    if (!userEmail) {
        toast("Please sign in to upload documents.", "info");
        return;
    }
    if (loginMode !== "personal") return;
    if (!currentChat) {
        toast("Select a chat first.", "info");
        return;
    }
    const fileInput = document.getElementById("chatUpload");
    const file = fileInput.files[0];
    if (!file) return;
    var ok = file.type === "application/pdf" || (file.type && file.type.indexOf("image/") === 0);
    if (!ok) {
        toast("Only PDF and images (JPG, PNG, GIF, etc.) are supported.", "warning");
        return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("email", userEmail || "guest");
    formData.append("chat", currentChat);
    formData.append("mode", loginMode === "company" ? "company" : "personal");

    var uploadNotice = null;
    try {
        uploadNotice = toast("Uploading…", "loading", { persistent: true });
        const response = await fetch(API_BASE + "/upload", {
            method: "POST",
            body: formData
        });
        const data = await response.json();
        if (uploadNotice) removeToast(uploadNotice);
        uploadNotice = null;
        if (data.error) {
            toast(data.error, "error");
            return;
        }
        chatDocuments[currentChat] = chatDocuments[currentChat] || [];
        chatDocuments[currentChat].push({ id: data.document_id, name: file.name, file: file, has_preview: true });
        _emptyChats.remove(currentChat);
        renderChatDocs();
        fileInput.value = "";
        if (data.message) toast(data.message, "success");
    } catch (err) {
        if (uploadNotice) removeToast(uploadNotice);
        console.error("Chat document upload error:", err);
        toast("Upload failed. Is the backend running?", "error");
    }
}

function openDocPreview(doc) {
    if (!doc) return;
    if ((doc.id && doc.has_preview !== false) && userEmail) {
        var url = API_BASE + "/documents/file/" + doc.id + "?email=" + encodeURIComponent(userEmail);
        window.open(url, "_blank", "noopener");
        return;
    }
    if (doc.file) {
        var blobUrl = URL.createObjectURL(doc.file);
        window.open(blobUrl, "_blank", "noopener");
        setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 60000);
        return;
    }
    toast("Preview is not available for this document.", "info");
}

function toggleGlobalDocsList() {
    var list = document.getElementById("globalDocs");
    list.classList.toggle("doc-list-collapsed");
}

function toggleChatDocsList() {
    var list = document.getElementById("chatDocs");
    if (!list) return;
    list.classList.toggle("doc-list-collapsed");
}

function renderGlobalDocs() {
    var list = document.getElementById("globalDocs");
    var toggleBtn = document.getElementById("globalDocsToggle");
    if (!list || !toggleBtn) return;
    var n = globalDocuments.length;
    toggleBtn.textContent = "Documents uploaded " + n;
    list.innerHTML = "";
    list.classList.add("doc-list-collapsed");
    globalDocuments.forEach(function (doc) {
        var li = document.createElement("li");
        li.className = "doc-item";
        var link = document.createElement("a");
        link.className = "doc-link";
        link.textContent = doc.name;
        link.title = (doc.has_preview || doc.file || (doc.id && doc.has_preview !== false)) ? "Open preview" : "Preview not available";
        link.href = "#";
        link.onclick = function (e) {
            e.preventDefault();
            openDocPreview(doc);
        };
        var removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "doc-remove-btn";
        removeBtn.innerHTML = "&times;";
        removeBtn.title = "Remove document";
        removeBtn.onclick = function (e) {
            e.stopPropagation();
            removeGlobalDoc(doc.id);
        };
        li.appendChild(link);
        li.appendChild(removeBtn);
        list.appendChild(li);
    });
}

async function removeGlobalDoc(docId) {
    if (!(await confirmDialog("Remove this document from your library?", { confirmLabel: "Remove", cancelLabel: "Cancel", danger: true }))) return;
    if (!userEmail) return;
    try {
        var res = await fetch(API_BASE + "/documents/" + docId + "?email=" + encodeURIComponent(userEmail), { method: "DELETE" });
        if (!res.ok) {
            var data = await res.json().catch(function () { return {}; });
            toast(data.detail || "Could not delete document.", "error");
            return;
        }
    } catch (e) {
        console.error(e);
        toast("Could not delete document.", "error");
        return;
    }
    globalDocuments = globalDocuments.filter(function (d) { return d.id !== docId; });
    renderGlobalDocs();
    toast("Document removed.", "success");
}

function toggleCompanyDocsList() {
    var list = document.getElementById("companyDocsList");
    if (list) list.classList.toggle("doc-list-collapsed");
}

function renderCompanyDocs() {
    var list = document.getElementById("companyDocsList");
    var toggleBtn = document.getElementById("companyDocsToggle");
    if (!list || !toggleBtn) return;
    var n = companyDocuments.length;
    toggleBtn.textContent = "Documents uploaded " + n;
    list.innerHTML = "";
    list.classList.add("doc-list-collapsed");
    companyDocuments.forEach(function (doc) {
        var li = document.createElement("li");
        li.className = "doc-item";
        var link = document.createElement("a");
        link.className = "doc-link";
        link.textContent = doc.name;
        link.title = (doc.has_preview !== false) ? "Open preview" : "Preview not available";
        link.href = "#";
        link.onclick = function (e) {
            e.preventDefault();
            openDocPreview(doc);
        };
        var removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "doc-remove-btn";
        removeBtn.innerHTML = "&times;";
        removeBtn.title = "Remove document";
        removeBtn.onclick = function (e) {
            e.stopPropagation();
            removeCompanyDoc(doc.id);
        };
        li.appendChild(link);
        li.appendChild(removeBtn);
        list.appendChild(li);
    });
}

async function removeCompanyDoc(docId) {
    if (!(await confirmDialog("Remove this company document?", { confirmLabel: "Remove", cancelLabel: "Cancel", danger: true }))) return;
    if (!userEmail) return;
    try {
        var res = await fetch(API_BASE + "/documents/" + docId + "?email=" + encodeURIComponent(userEmail), { method: "DELETE" });
        if (!res.ok) {
            var data = await res.json().catch(function () { return {}; });
            toast(data.detail || "Could not delete document.", "error");
            return;
        }
    } catch (e) {
        console.error(e);
        toast("Could not delete document.", "error");
        return;
    }
    companyDocuments = companyDocuments.filter(function (d) { return d.id !== docId; });
    renderCompanyDocs();
    toast("Document removed.", "success");
}

async function toggleCompanyShowCountToEmployees() {
    var check = document.getElementById("companyShowCountCheck");
    if (!check || !userEmail) return;
    try {
        var res = await fetch(API_BASE + "/company/settings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: userEmail, show_doc_count_to_employees: check.checked })
        });
        if (!res.ok) {
            var data = await res.json().catch(function () { return {}; });
            toast(data.detail || "Could not update setting.", "error");
            check.checked = !check.checked;
        }
    } catch (e) {
        console.error(e);
        check.checked = !check.checked;
        toast("Could not update setting.", "error");
    }
}

/** Reserved for resize hooks; chat docs list lives in the upload popover (no DOM reparenting). */
function layoutChatDocsPanelForViewport() {}

function renderChatDocs() {
    if (loginMode !== "personal") return;
    var list = document.getElementById("chatDocs");
    var toggleBtn = document.getElementById("chatDocsToggle");
    if (!toggleBtn || !list) return;
    var docs = currentChat ? chatDocuments[currentChat] || [] : [];
    var n = docs.length;
    toggleBtn.textContent = "Documents uploaded " + n;
    toggleBtn.setAttribute("data-count", n);
    list.innerHTML = "";
    list.classList.add("doc-list-collapsed");
    if (!currentChat) return;
    docs.forEach(function (doc) {
        var li = document.createElement("li");
        li.className = "doc-item chat-doc-item";
        var link = document.createElement("a");
        link.className = "doc-link";
        link.textContent = doc.name;
        link.title = (doc.has_preview || doc.file || (doc.id && doc.has_preview !== false)) ? "Open preview" : "Preview not available";
        link.href = "#";
        link.onclick = function (e) {
            e.preventDefault();
            openDocPreview(doc);
        };
        var removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "doc-remove-btn";
        removeBtn.innerHTML = "&times;";
        removeBtn.title = "Remove document";
        removeBtn.onclick = function (e) {
            e.stopPropagation();
            removeChatDoc(doc.id);
        };
        li.appendChild(link);
        li.appendChild(removeBtn);
        list.appendChild(li);
    });
}

async function removeChatDoc(docId) {
    if (!(await confirmDialog("Remove this document from the current chat?", { confirmLabel: "Remove", cancelLabel: "Cancel", danger: true }))) return;
    if (!currentChat || !userEmail) return;
    try {
        var res = await fetch(API_BASE + "/documents/" + docId + "?email=" + encodeURIComponent(userEmail), { method: "DELETE" });
        if (!res.ok) {
            var data = await res.json().catch(function () { return {}; });
            toast(data.detail || "Could not delete document.", "error");
            return;
        }
    } catch (e) {
        console.error(e);
        toast("Could not delete document.", "error");
        return;
    }
    chatDocuments[currentChat] = (chatDocuments[currentChat] || []).filter(function (d) { return d.id !== docId; });
    renderChatDocs();
    toast("Document removed from chat.", "success");
}

/* ---------------- SEND MESSAGE ---------------- */

function showStartView() {
    var container = document.getElementById("chatContainer");
    if (container) container.classList.remove("has-messages");
}

function showChatView() {
    var container = document.getElementById("chatContainer");
    if (container) container.classList.add("has-messages");
}

(function setupEnterToSend() {
    var input = document.getElementById("messageInput");
    if (input) {
        input.addEventListener("keydown", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                sendMessage();
            }
        });
    }
})();

async function sendMessage() {
    var input = document.getElementById("messageInput");
    if (!input) return;
    const message = input.value;

    if (!message || !message.trim()) return;

    if (!currentChat) {
        if (!userEmail) {
            currentChat = getOrCreateGuestChatId();
            document.getElementById("chatTitle").innerText = "Guest chat";
        } else {
            var newName = await createNewChatAndReturnName();
            if (!newName) {
                toast("Could not create chat. Is the backend running?", "error");
                return;
            }
            currentChat = newName;
            document.getElementById("chatTitle").innerText = currentChat;
            var panel = document.getElementById("chatDocsPanel");
            if (loginMode === "personal" && panel) {
                panel.style.display = "block";
                renderChatDocs();
            }
            renderChats();
        }
    }

    if (!userEmail && getGuestMessageCount() >= 2) {
        openLoginPopup();
        toast("Please sign in to continue chatting.", "info");
        return;
    }

    var isVoiceTurn = !!(window.VoiceMode && window.VoiceMode.isActive());
    if (currentChat) _emptyChats.remove(currentChat);
    addMessage(message, "user", { voice: isVoiceTurn });
    input.value = "";
    if (!document.getElementById("chatContainer").classList.contains("has-messages")) {
        showChatView();
        requestAnimationFrame(function () {
            scrollChatToBottomSmooth();
        });
    }
    addTypingIndicator();

    fetch(API_BASE + "/chat/stream", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream"
        },
        body: JSON.stringify({
            mode: userEmail ? loginMode : "personal",
            email: userEmail || "guest",
            chat: currentChat,
            message: message,
            voice: isVoiceTurn
        })
    })
    .then(function (res) {
        return consumeChatStreamResponse(res, { voice: isVoiceTurn });
    })
    .then(function (result) {
        if (result && result.ok && !userEmail) {
            setGuestMessageCount(getGuestMessageCount() + 1);
        }
        if (window.VoiceMode && window.VoiceMode.isActive() && result && result.assistantText) {
            window.VoiceMode.handleAssistantReply(result.assistantText);
        }
    })
    .catch(function (error) {
        console.error("Error:", error);
        removeTypingIndicator();
        addMessage("Error: " + (error.message || "Server unreachable. Is the backend running?"), "bot");
        if (window.VoiceMode && window.VoiceMode.isActive()) {
            window.VoiceMode.handleError(error.message || "Sorry, something went wrong.");
        }
    });
}

function addTypingIndicator() {
    var chatArea = document.getElementById("chatArea");
    if (!chatArea) return;
    var wrapper = document.createElement("div");
    wrapper.className = "typing-indicator-wrapper message-row message-row--assistant";
    wrapper.setAttribute("data-typing", "1");
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "flex-start";
    wrapper.style.marginBottom = "10px";
    var avatar = document.createElement("img");
    avatar.className = "message-avatar message-avatar--bot";
    avatar.src = BOT_AVATAR_URL;
    avatar.alt = "DocuMind";
    var messageDiv = document.createElement("div");
    messageDiv.className = "message bot typing-indicator";
    messageDiv.innerText = "typing...";
    wrapper.appendChild(avatar);
    wrapper.appendChild(messageDiv);
    chatArea.appendChild(wrapper);
    scrollChatToBottomSmooth();
}

function removeTypingIndicator() {
    var el = document.querySelector(".typing-indicator-wrapper");
    if (el) el.remove();
}

/** Empty bot bubble for SSE chunks (same layout as addMessage role bot). */
function createStreamingBotMessage(opts) {
    var voice = !!(opts && opts.voice);
    var chatArea = document.getElementById("chatArea");
    var wrapper = document.createElement("div");
    wrapper.className = "message-row message-row--assistant";
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "flex-start";
    wrapper.style.marginBottom = "10px";
    var avatar = document.createElement("img");
    avatar.className = "message-avatar message-avatar--bot";
    avatar.src = BOT_AVATAR_URL;
    avatar.alt = "DocuMind";
    var messageDiv = document.createElement("div");
    messageDiv.className = "message bot";
    if (voice) messageDiv.classList.add("message--voice");
    messageDiv.innerText = voice ? "\u00ab" : "";
    wrapper.appendChild(avatar);
    wrapper.appendChild(messageDiv);
    chatArea.appendChild(wrapper);
    scrollChatToBottomSmooth();
    var fullText = "";
    var finalized = false;
    return {
        append: function (s) {
            fullText += s;
            if (voice) {
                messageDiv.innerText = "\u00ab" + fullText;
            } else {
                messageDiv.innerText += s;
            }
            scrollChatToBottomSmooth();
        },
        finalize: function () {
            if (finalized) return;
            finalized = true;
            if (voice) {
                messageDiv.innerText = "\u00ab" + fullText.trim() + "\u00bb";
            }
        },
        getText: function () {
            return fullText;
        }
    };
}

/**
 * Read POST /chat/stream SSE: JSON lines data: {"t":"d","c":"..."} | {"t":"done"} | {"t":"e","m":"..."}
 * @returns {Promise<{ ok: boolean, hadAssistantBubble: boolean }>}
 */
function consumeChatStreamResponse(res, streamOpts) {
    if (!res.ok) {
        return res.text().then(function (t) {
            throw new Error(res.status + " " + (t || res.statusText));
        });
    }
    if (!res.body || typeof res.body.getReader !== "function") {
        return Promise.reject(new Error("Streaming not supported in this browser."));
    }
    var voice = !!(streamOpts && streamOpts.voice);
    var reader = res.body.getReader();
    var dec = new TextDecoder();
    var buf = "";
    var streamBubble = null;
    var sawDone = false;
    var sawError = false;

    function parseSseBlocks(text) {
        var parts = text.split("\n\n");
        for (var i = 0; i < parts.length; i++) {
            var block = parts[i].trim();
            if (!block) continue;
            var lines = block.split("\n");
            for (var j = 0; j < lines.length; j++) {
                var ln = lines[j].trim();
                if (ln.indexOf("data:") !== 0) continue;
                var payload = ln.slice(5).trim();
                var ev;
                try {
                    ev = JSON.parse(payload);
                } catch (e) {
                    continue;
                }
                if (ev.t === "d" && ev.c != null) {
                    removeTypingIndicator();
                    if (!streamBubble) streamBubble = createStreamingBotMessage({ voice: voice });
                    streamBubble.append(String(ev.c));
                } else if (ev.t === "done") {
                    removeTypingIndicator();
                    if (streamBubble) streamBubble.finalize();
                    sawDone = true;
                } else if (ev.t === "e") {
                    removeTypingIndicator();
                    sawError = true;
                    var em = ev.m != null ? String(ev.m) : "Unknown error";
                    if (streamBubble) {
                        streamBubble.append("\n\n" + em);
                    } else {
                        addMessage("Error: " + em, "bot");
                    }
                }
            }
        }
    }

    function pump() {
        return reader.read().then(function (x) {
            if (x.value) {
                buf += dec.decode(x.value, { stream: !x.done });
            }
            if (x.done) {
                parseSseBlocks(buf);
                buf = "";
                removeTypingIndicator();
                if (streamBubble) streamBubble.finalize();
                if (!sawDone && !sawError && !streamBubble) {
                    addMessage("No reply from server.", "bot");
                }
                return {
                    ok: sawDone && !sawError,
                    hadAssistantBubble: !!streamBubble,
                    assistantText: streamBubble ? streamBubble.getText() : ""
                };
            }
            var lastSep = buf.lastIndexOf("\n\n");
            if (lastSep !== -1) {
                parseSseBlocks(buf.slice(0, lastSep + 2));
                buf = buf.slice(lastSep + 2);
            }
            return pump();
        });
    }
    return pump();
}

/** Detects a stored voice turn (wrapped in « … » by the server). */
function isVoiceWrappedText(text) {
    var s = (text == null ? "" : String(text)).trim();
    return s.length >= 2 && s.charAt(0) === "\u00ab" && s.charAt(s.length - 1) === "\u00bb";
}

/** Build a single message DOM node (without inserting). Used by addMessage and batch loaders. */
function buildMessageNode(text, role, opts) {
    var options = opts || {};
    var voice = !!options.voice || isVoiceWrappedText(text);

    var displayText = String(text == null ? "" : text);
    if (voice && !isVoiceWrappedText(displayText)) {
        displayText = "\u00ab" + displayText.trim() + "\u00bb";
    }

    var wrapper = document.createElement("div");
    wrapper.className = "message-row";
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "flex-start";
    wrapper.style.marginBottom = "10px";

    var messageDiv = document.createElement("div");
    messageDiv.className = "message " + role;
    if (voice) messageDiv.classList.add("message--voice");
    messageDiv.innerText = displayText;

    if (role === "user") {
        wrapper.style.justifyContent = "flex-end";
        wrapper.appendChild(messageDiv);
    } else {
        wrapper.classList.add("message-row--assistant");
        var avatar = document.createElement("img");
        avatar.className = "message-avatar message-avatar--bot";
        avatar.src = BOT_AVATAR_URL;
        avatar.alt = "DocuMind";
        avatar.loading = "lazy";
        wrapper.appendChild(avatar);
        wrapper.appendChild(messageDiv);
    }
    return wrapper;
}

function addMessage(text, role, opts) {
    var chatArea = document.getElementById("chatArea");
    if (!chatArea) return;
    var node = buildMessageNode(text, role, opts);
    if (node) {
        chatArea.appendChild(node);
        scrollChatToBottomSmooth();
    }
}

async function uploadDocument() {

    const fileInput = document.getElementById("globalUpload");
    const file = fileInput.files[0];

    if (!file) {
        toast("Please select a file first.", "info");
        return;
    }

    if (!userEmail) {
        toast("Please signin first.", "info");
        return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("email", userEmail);
    formData.append("mode", loginMode === "company" ? "company" : "personal");
    // Global/company uploads: no chat. (Chat-specific docs use the Chat Documents panel in personal mode.)

    var uploadNotice = null;
    try {
        uploadNotice = toast("Uploading…", "loading", { persistent: true });
        const response = await fetch(API_BASE + "/upload", {
            method: "POST",
            body: formData
        });

        var data = {};
        try {
            var ct = response.headers.get("Content-Type") || "";
            if (ct.includes("application/json")) {
                data = await response.json();
            }
        } catch (e) {
            console.error("Upload response parse error", e);
        }

        if (uploadNotice) removeToast(uploadNotice);
        uploadNotice = null;

        if (!response.ok) {
            toast(data.detail || data.error || "Upload failed.", "error");
            fileInput.value = "";
            return;
        }
        if (data.error) {
            toast(data.error, "error");
            fileInput.value = "";
            return;
        }
        if (loginMode === "personal" && data.message) {
            globalDocuments.push({ id: data.document_id, name: file.name, file: file, has_preview: true });
            renderGlobalDocs();
        }
        if (loginMode === "company") {
            if (data.document_id != null) {
                companyDocuments.push({ id: data.document_id, name: file.name, has_preview: true });
                renderCompanyDocs();
            }
            toast("Document uploaded and processed. Colleagues on your company domain can ask about it in chat.", "success");
        } else {
            toast(data.message || "Document uploaded and processed.", "success");
        }
        fileInput.value = "";
    } catch (error) {
        if (uploadNotice) removeToast(uploadNotice);
        console.error("Upload error:", error);
        toast("Upload failed. Check the console and that the backend is running.", "error");
    }
}

/* ---------------- ADMIN DATABASE VIEW ---------------- */

function openDatabaseView() {
    if (!userEmail || !userIsAdmin) return;
    var mainPanel = document.getElementById("mainChatPanel");
    var dbView = document.getElementById("databaseView");
    if (mainPanel) mainPanel.style.display = "none";
    if (dbView) dbView.style.display = "flex";
    fetchDatabaseAndAdmins();
}

function closeDatabaseView() {
    var mainPanel = document.getElementById("mainChatPanel");
    var dbView = document.getElementById("databaseView");
    if (mainPanel) mainPanel.style.display = "flex";
    if (dbView) dbView.style.display = "none";
}

async function fetchDatabaseAndAdmins() {
    if (!userEmail) return;
    try {
        var dbRes = await fetch(API_BASE + "/admin/database?email=" + encodeURIComponent(userEmail));
        if (!dbRes.ok) {
            toast("Admin access denied or error loading data.", "error");
            return;
        }
        dbData = await dbRes.json();
        var superAdmin = isSuperAdmin();
        var addSection = document.getElementById("adminAddAdminSection");
        if (addSection) addSection.style.display = superAdmin ? "block" : "none";
        if (superAdmin) {
            var adminsRes = await fetch(API_BASE + "/admin/admins?email=" + encodeURIComponent(userEmail));
            if (adminsRes.ok) {
                var adminsData = await adminsRes.json();
                renderAdminListWithRemove(adminsData.admins || [], true);
            } else {
                renderAdminListWithRemove([], true);
            }
        } else {
            var toggleBtn = document.getElementById("adminListToggle");
            var listEl = document.getElementById("adminListCollapsible");
            if (toggleBtn) toggleBtn.style.display = "none";
            if (listEl) listEl.innerHTML = "";
        }
        renderDbTab();
        setupDbTabs();
        setupDbSearch();
    } catch (e) {
        console.error("Error loading admin data", e);
        toast("Could not load database. Is the backend running?", "error");
    }
}

function setupDbTabs() {
    document.querySelectorAll(".db-tab").forEach(function (btn) {
        btn.onclick = function () {
            document.querySelectorAll(".db-tab").forEach(function (b) { b.classList.remove("active"); });
            btn.classList.add("active");
            renderDbTab();
        };
    });
}

function renderDbTab() {
    var active = document.querySelector(".db-tab.active");
    var tableName = active ? active.getAttribute("data-table") : "users";
    var container = document.getElementById("dbTableContent");
    var searchInput = document.getElementById("dbSearchInput");
    var searchTerm = (searchInput && searchInput.value) ? searchInput.value.trim().toLowerCase() : "";
    if (!container || !dbData) return;
    var rows = dbData[tableName] || [];
    if (searchTerm) {
        rows = rows.filter(function (row) {
            return Object.keys(row).some(function (k) {
                var v = row[k];
                if (v === null || v === undefined) return false;
                return String(v).toLowerCase().indexOf(searchTerm) !== -1;
            });
        });
    }
    if (rows.length === 0) {
        container.innerHTML = "<p class=\"db-empty\">No rows" + (searchTerm ? " matching search" : "") + "</p>";
        return;
    }
    var keys = Object.keys(rows[0]);
    var html = "<table class=\"db-table\"><thead><tr>";
    keys.forEach(function (k) {
        html += "<th>" + escapeHtml(k) + "</th>";
    });
    if (tableName === "documents") html += "<th>Actions</th>";
    html += "</tr></thead><tbody>";
    rows.forEach(function (row) {
        html += "<tr>";
        keys.forEach(function (k) {
            var v = row[k];
            if (v === null || v === undefined) v = "";
            var str = typeof v === "object" ? JSON.stringify(v) : String(v);
            if (str.length > 200) str = str.substring(0, 200) + "...";
            html += "<td>" + escapeHtml(str) + "</td>";
        });
        if (tableName === "documents" && row.id != null) {
            var docUrl = API_BASE + "/documents/file/" + row.id + "?email=" + encodeURIComponent(userEmail || "");
            html += "<td><a href=\"" + escapeHtml(docUrl) + "\" target=\"_blank\" rel=\"noopener\" class=\"db-doc-link\">View / Download</a></td>";
        }
        html += "</tr>";
    });
    html += "</tbody></table>";
    container.innerHTML = html;
}

function setupDbSearch() {
    var searchInput = document.getElementById("dbSearchInput");
    if (!searchInput) return;
    searchInput.value = "";
    searchInput.oninput = function () { renderDbTab(); };
}

function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    var div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
}

async function addAdminEmail() {
    var input = document.getElementById("newAdminEmail");
    if (!input || !userEmail) return;
    var newEmail = (input.value || "").trim();
    if (!newEmail || !newEmail.includes("@")) {
        toast("Enter a valid email address.", "warning");
        return;
    }
    try {
        var res = await fetch(API_BASE + "/admin/admins", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: userEmail, new_admin_email: newEmail })
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
            toast(data.detail || "Failed to add admin.", "error");
            return;
        }
        input.value = "";
        renderAdminListWithRemove(data.admins || [], true);
        toast(data.message || "Admin added.", "success");
    } catch (e) {
        console.error("Add admin error", e);
        toast("Failed to add admin.", "error");
    }
}

function toggleAdminList() {
    var list = document.getElementById("adminListCollapsible");
    if (list) list.classList.toggle("doc-list-collapsed");
}

function renderAdminListWithRemove(admins, showRemoveButtons) {
    var toggleBtn = document.getElementById("adminListToggle");
    var listEl = document.getElementById("adminListCollapsible");
    if (!toggleBtn || !listEl) return;
    var superAdmin = showRemoveButtons === true;
    var n = (admins && admins.length) || 0;
    toggleBtn.textContent = "Admins (" + n + ")";
    toggleBtn.style.display = "block";
    if (n === 0) {
        listEl.innerHTML = "<li class=\"admin-list-li admin-list-empty\">No admins listed.</li>";
        listEl.classList.add("doc-list-collapsed");
        return;
    }
    var html = "";
    admins.forEach(function (email) {
        html += "<li class=\"admin-list-li\"><span class=\"admin-email\">" + escapeHtml(email) + "</span>";
        if (superAdmin) {
            var safeEmail = escapeHtml(email).replace(/"/g, "&quot;");
            html += " <button type=\"button\" class=\"admin-remove-btn\" data-remove-email=\"" + safeEmail + "\">Remove</button>";
        }
        html += "</li>";
    });
    listEl.innerHTML = html;
    if (superAdmin) {
        listEl.querySelectorAll(".admin-remove-btn").forEach(function (btn) {
            btn.onclick = function () { removeAdminEmail(btn.getAttribute("data-remove-email")); };
        });
    }
}

async function removeAdminEmail(emailToRemove) {
    if (!userEmail || !emailToRemove) return;
    if (!(await confirmDialog("Remove " + emailToRemove + " from admins?", { confirmLabel: "Remove", cancelLabel: "Cancel", danger: true }))) return;
    try {
        var res = await fetch(API_BASE + "/admin/admins/remove", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: userEmail, remove_admin_email: emailToRemove })
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
            toast(data.detail || "Failed to remove admin.", "error");
            return;
        }
        renderAdminListWithRemove(data.admins || [], true);
        toast(data.message || "Admin removed.", "success");
        if ((data.admins || []).indexOf(userEmail) === -1) {
            userIsAdmin = false;
            var adminSec = document.getElementById("adminSection");
            if (adminSec) adminSec.style.display = "none";
            closeDatabaseView();
        }
    } catch (e) {
        console.error("Remove admin error", e);
        toast("Failed to remove admin.", "error");
    }
}

// Close chat dropdowns when clicking outside
document.addEventListener("click", function () {
    closeAllChatMenus();
});


function googleLogin() {
    window.location.href = API_BASE + "/login/google";
}

(function checkGoogleLoginCallback() {
    var params = new URLSearchParams(window.location.search);
    var error = params.get("error");
    var message = params.get("message");
    if (error === "oauth" && message) {
        try { message = decodeURIComponent(message); } catch (e) {}
        toast(message, "error");
        history.replaceState({}, document.title, window.location.pathname || "/");
        return;
    }
    var email = params.get("email");
    if (!email) return;
    userEmail = email;
    loginMode = "personal";
    try { localStorage.setItem("userEmail", email); localStorage.setItem("loginMode", "personal"); } catch(e) {}
    document.getElementById("loginBtn").style.display = "none";
    document.getElementById("profileBox").style.display = "block";
    document.getElementById("profileName").title = email;
    if (!applyCachedProfileImmediately(email)) {
        document.getElementById("profileName").textContent = _defaultDisplayNameFromEmail(email);
    }
    document.getElementById("documentSection").style.display = "block";
    document.getElementById("documentSectionTitle").textContent = "Global Documents";
    document.getElementById("documentUploadWrap").style.display = "block";
    document.getElementById("globalDocsBlock").style.display = "block";
    var companyDocsBlock = document.getElementById("companyDocsBlock");
    if (companyDocsBlock) companyDocsBlock.style.display = "none";
    var companyShowCountWrap = document.getElementById("companyShowCountWrap");
    if (companyShowCountWrap) companyShowCountWrap.style.display = "none";
    document.getElementById("companyDocCountEmployee").style.display = "none";
    document.getElementById("companyDocHintHr").style.display = "none";
    document.getElementById("companyDocHintEmployee").style.display = "none";
    var panel = document.getElementById("chatDocsPanel");
    if (panel) panel.style.display = "block";
    renderChatDocs();
    refreshProfileFromServer();
    claimGuestChatIfAny(email).then(function (claimed) {
    if (!claimed) loadUserData(email).catch(function (e) { console.error("Error loading user data after Google login", e); });
    // Restore pending message
    try {
        var pending = localStorage.getItem("pendingMsg");
        if (pending) {
            var msgInput = document.getElementById("messageInput");
            if (msgInput) msgInput.value = pending;
            localStorage.removeItem("pendingMsg");
        }
    } catch(e) {}
});
    history.replaceState({}, document.title, window.location.pathname || "/");
})();

/* Update Chat Documents toggle text, mobile count, and input placeholder on resize */
(function setupChatDocsToggleResize() {
    function updateMessageInputPlaceholder() {
        var input = document.getElementById("messageInput");
        if (!input) return;
        var mobile = input.getAttribute("data-placeholder-mobile");
        var desktop = input.getAttribute("data-placeholder-desktop");
        if (mobile && desktop) {
            input.placeholder = window.innerWidth <= 768 ? mobile : desktop;
        }
    }
    function updateChatDocsToggleText() {
        var toggleBtn = document.getElementById("chatDocsToggle");
        if (toggleBtn) {
            var n = toggleBtn.getAttribute("data-count");
            if (n === null) {
                var m = toggleBtn.textContent.match(/Documents uploaded (\d+)/);
                n = m ? m[1] : "0";
                toggleBtn.setAttribute("data-count", n);
            }
            toggleBtn.textContent = "Documents uploaded " + n;
        }
        updateMessageInputPlaceholder();
        layoutChatDocsPanelForViewport();
    }
    window.addEventListener("resize", updateChatDocsToggleText);
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", updateChatDocsToggleText);
    } else {
        updateChatDocsToggleText();
    }
})();

/** Dismiss SEO footer strip; preference stored so it stays hidden on return visits */
(function initSeoFooterDismiss() {
    var STORAGE_KEY = "documind_seo_footer_hidden";
    function apply() {
        var footer = document.getElementById("siteSeoFooter");
        var btn = document.getElementById("siteSeoFooterClose");
        if (!footer || !btn) return;
        try {
            if (localStorage.getItem(STORAGE_KEY) === "1") {
                footer.style.display = "none";
                return;
            }
        } catch (e) {}
        btn.addEventListener("click", function () {
            try {
                localStorage.setItem(STORAGE_KEY, "1");
            } catch (e) {}
            footer.style.display = "none";
        });
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", apply);
    } else {
        apply();
    }
})();

/* ============================================================
   Voice Mode (ChatGPT-style fullscreen voice chat)
   - Browser-only: SpeechRecognition (STT) + speechSynthesis (TTS)
   - Uses existing sendMessage() → POST /chat/stream (same chat, same history,
     same document chunks / rules as typed messages).
   ============================================================ */
window.VoiceMode = (function () {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var hasTTS = typeof window.speechSynthesis !== "undefined";
    var recognition = null;
    var active = false;
    var listening = false;
    var muted = false;
    var awaitingReply = false;
    var preferredVoice = null;

    var LANG_LS_KEY = "documind_voice_lang";
    var currentLang = "en-US";
    try {
        var savedLang = localStorage.getItem(LANG_LS_KEY);
        if (savedLang === "en-US" || savedLang === "hi-IN") currentLang = savedLang;
    } catch (e) {}

    // ---------- Barge-in (interrupt-while-speaking) state ----------
    // We combine 3 signals so background voices / TV / bot's own echo CAN'T trigger an interrupt:
    //   1) Voice Activity Detection (real RMS energy from the mic, calibrated to ambient)
    //   2) Word-count + length thresholds on the transcript
    //   3) Substring check against the bot's currently-spoken text (anti-echo)
    var speakSession = 0;             // increments each new speech; old chunks self-abort
    var currentSpokenText = "";       // the bot's currently-speaking text (for echo check)
    var isBotSpeaking = false;
    var interruptArmed = false;       // true while bot is speaking AND mic is open

    // Web Audio VAD
    var audioCtx = null;
    var micStream = null;
    var analyser = null;
    var vadBuf = null;
    var vadRaf = null;
    var vadLastTs = 0;
    var vadVoicedMs = 0;              // ms of continuous "above threshold"
    var vadSilenceMs = 0;
    var vadActive = false;            // true = real sustained speech happening NOW
    var vadThreshold = 0.05;          // calibrated each session
    var vadCalibrated = false;

    var TRIVIAL_WORDS = /^(uh|um+|hm+|ah|oh|ok(ay)?|yes|yeah|yep|no|nope|right|sure|cool|haan|hai|ji|achha|accha|theek|thik|han|nahi|nahin|haa)\.?\??$/i;

    function isTrivialUtterance(text) {
        var s = String(text || "").trim();
        if (!s) return true;
        if (s.length < 4) return true;
        if (TRIVIAL_WORDS.test(s)) return true;
        return false;
    }

    function looksLikeEcho(text) {
        if (!currentSpokenText) return false;
        var u = String(text || "").toLowerCase().trim();
        if (!u) return true;
        var spoken = currentSpokenText.toLowerCase();
        var words = u.split(/\s+/).filter(Boolean);
        if (!words.length) return true;
        var matched = 0;
        for (var i = 0; i < words.length; i++) {
            if (words[i].length >= 3 && spoken.indexOf(words[i]) !== -1) matched++;
        }
        // If most of the user's words appear in the bot's currently-speaking text, it's echo.
        return (matched / words.length) >= 0.75;
    }

    function startVAD() {
        if (audioCtx || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
        try {
            navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            }).then(function (stream) {
                micStream = stream;
                var Ctx = window.AudioContext || window.webkitAudioContext;
                if (!Ctx) return;
                audioCtx = new Ctx();
                var source = audioCtx.createMediaStreamSource(stream);
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 1024;
                analyser.smoothingTimeConstant = 0.55;
                source.connect(analyser);
                vadBuf = new Uint8Array(analyser.frequencyBinCount);

                // Calibrate ambient noise for ~700ms before arming VAD.
                var calStart = performance.now();
                var calSum = 0, calN = 0;
                function calTick() {
                    if (!analyser) return;
                    analyser.getByteTimeDomainData(vadBuf);
                    var s = 0;
                    for (var i = 0; i < vadBuf.length; i++) {
                        var v = (vadBuf[i] - 128) / 128;
                        s += v * v;
                    }
                    calSum += Math.sqrt(s / vadBuf.length);
                    calN++;
                    if (performance.now() - calStart < 700) {
                        requestAnimationFrame(calTick);
                    } else {
                        var ambient = calSum / Math.max(1, calN);
                        // Threshold: well above ambient, with a sane floor.
                        // Real human speech near a laptop mic typically RMS 0.08–0.25.
                        vadThreshold = Math.max(0.07, ambient * 3.5);
                        vadCalibrated = true;
                        vadLastTs = 0;
                        loop();
                    }
                }
                function loop() {
                    if (!audioCtx || !analyser) return;
                    analyser.getByteTimeDomainData(vadBuf);
                    var s = 0;
                    for (var i = 0; i < vadBuf.length; i++) {
                        var v = (vadBuf[i] - 128) / 128;
                        s += v * v;
                    }
                    var rms = Math.sqrt(s / vadBuf.length);
                    var now = performance.now();
                    var dt = vadLastTs ? Math.min(80, now - vadLastTs) : 16;
                    vadLastTs = now;
                    if (rms > vadThreshold) {
                        vadVoicedMs += dt;
                        vadSilenceMs = 0;
                        // require ~280ms of sustained energy → real speech, not a click/cough/echo blip
                        if (vadVoicedMs > 280) vadActive = true;
                    } else {
                        vadSilenceMs += dt;
                        if (vadSilenceMs > 220) {
                            vadVoicedMs = 0;
                            vadActive = false;
                        }
                    }
                    vadRaf = requestAnimationFrame(loop);
                }
                requestAnimationFrame(calTick);
            }).catch(function (err) {
                console.warn("VoiceMode: VAD getUserMedia denied/failed", err);
            });
        } catch (e) {
            console.warn("VoiceMode: VAD init failed", e);
        }
    }

    function stopVAD() {
        if (vadRaf) { try { cancelAnimationFrame(vadRaf); } catch (e) {} }
        vadRaf = null;
        analyser = null;
        vadBuf = null;
        vadVoicedMs = 0;
        vadSilenceMs = 0;
        vadActive = false;
        vadCalibrated = false;
        if (micStream) {
            try { micStream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (e) {}
            micStream = null;
        }
        if (audioCtx) {
            try { audioCtx.close(); } catch (e) {}
            audioCtx = null;
        }
    }

    function interruptSpeech() {
        speakSession++;       // any in-flight chunks will see a stale id and abort
        isBotSpeaking = false;
        interruptArmed = false;
        currentSpokenText = "";
        try { window.speechSynthesis.cancel(); } catch (e) {}
    }

    /** Decide whether an ASR transcript during bot speech is a real interrupt.
     *  Requires VAD-confirmed sustained voice + non-trivial text + not-echo. */
    function isRealInterrupt(text, isFinal) {
        if (!interruptArmed) return false;
        var s = String(text || "").trim();
        if (!s) return false;
        if (isTrivialUtterance(s)) return false;
        // Word + length thresholds (more permissive on final than interim).
        var words = s.split(/\s+/).filter(Boolean);
        var minWords = isFinal ? 2 : 3;
        var minChars = isFinal ? 8 : 11;
        if (words.length < minWords) return false;
        if (s.length < minChars) return false;
        if (looksLikeEcho(s)) return false;
        // VAD gate: must currently be sustaining real-mic energy.
        // If VAD didn't initialize (permission denied), fall back to text-only checks (still safe).
        if (vadCalibrated && !vadActive) return false;
        return true;
    }

    var GREETINGS_EN = [
        "Hi! I'm DocuMind. How can I help you today?",
        "Hello! What can I help you find in your documents?",
        "Hey there! Ask me anything about the documents you've uploaded.",
        "Hi! I'm ready when you are — what would you like to know?"
    ];
    var GREETINGS_HI = [
        "नमस्ते! मैं DocuMind हूँ। मैं आपकी कैसे मदद कर सकता हूँ?",
        "हैलो! आप अपने डॉक्युमेंट से क्या जानना चाहेंगे?",
        "नमस्कार! जो भी सवाल हो, अपने अपलोड किए हुए डॉक्युमेंट के बारे में पूछ सकते हैं।",
        "हाय! बताइए, क्या जानना चाहेंगे?"
    ];

    var STR = {
        listening: { "en-US": "Listening…", "hi-IN": "सुन रहा हूँ…" },
        speaking:  { "en-US": "Speaking…",  "hi-IN": "बोल रहा हूँ…" },
        thinking:  { "en-US": "Thinking…",  "hi-IN": "सोच रहा हूँ…" },
        tap_speak: { "en-US": "Tap to speak, or just talk…", "hi-IN": "बोलिए, मैं सुन रहा हूँ…" },
        muted:     { "en-US": "Mic muted. Tap the mic to unmute.", "hi-IN": "माइक म्यूट है। अनम्यूट करने के लिए टैप करें।" },
        no_catch:  { "en-US": "Didn't catch that — try again.", "hi-IN": "समझ नहीं आया — फिर से बोलिए।" },
        mic_err:   { "en-US": "Mic error. Tap the mic to try again.", "hi-IN": "माइक में दिक्कत है। फिर से कोशिश करें।" },
        mic_deny:  { "en-US": "Mic permission denied. Please allow microphone access.", "hi-IN": "माइक की अनुमति नहीं मिली। कृपया अनुमति दें।" },
        switched:  { "en-US": "Switched to English.", "hi-IN": "हिंदी पर स्विच किया गया।" },
        not_supp:  { "en-US": "Speech input isn't supported in this browser. Type instead, or use Chrome/Edge.", "hi-IN": "इस ब्राउज़र में वॉइस इनपुट सपोर्ट नहीं है। Chrome या Edge इस्तेमाल करें।" },
        couldnt:   { "en-US": "Couldn't send. Tap × to close.", "hi-IN": "भेज नहीं पाया। बंद करने के लिए × दबाएँ।" },
        error:     { "en-US": "Something went wrong.", "hi-IN": "कुछ गड़बड़ हो गई।" }
    };

    function t(key) {
        var bag = STR[key] || {};
        return bag[currentLang] || bag["en-US"] || "";
    }

    function el(id) { return document.getElementById(id); }

    function setOrbState(state) {
        var orb = el("voiceOrb");
        if (orb) orb.setAttribute("data-state", state);
    }

    function setStatus(text) {
        var s = el("voiceStatusText");
        if (s) s.textContent = text;
    }

    function detectScriptLang(text) {
        return /[\u0900-\u097F]/.test(text || "") ? "hi-IN" : "en-US";
    }

    function pickVoiceForLang(lang) {
        if (!hasTTS) return null;
        var voices = window.speechSynthesis.getVoices() || [];
        if (!voices.length) return null;
        function score(v) {
            var n = (v.name || "").toLowerCase();
            var vl = (v.lang || "").toLowerCase();
            var s = 0;
            if (/natural|neural|premium|enhanced|online/i.test(n)) s += 120;
            if (/compact|novelty|robot/i.test(n)) s -= 70;
            if (lang === "hi-IN") {
                if (/^hi(-|_)/.test(vl)) s += 220;
                if (/microsoft/i.test(n) && /(swara|madhur|prabhat|kavya|kunal|rehaan|ananya|aarav|hemant|heera|kalpana)/i.test(n)) s += 90;
                if (/google/i.test(n) && /(hindi|हिन्दी|हिंदी)/i.test(n)) s += 90;
                if (/hindi/i.test(n)) s += 40;
            } else {
                if (/^en(-|_)/.test(vl)) s += 100;
                if (/^en-us|^en_us/.test(vl)) s += 25;
                if (/microsoft/i.test(n) && /(aria|jenny|guy|michelle|sonia|ashley|ryan|olivia|emma)/i.test(n)) s += 70;
                if (/google/i.test(n) && /(english.*female|us english|uk english)/i.test(n)) s += 65;
                if (/samantha|karen|daniel|zira|hazel|alex/i.test(n)) s += 55;
            }
            return s;
        }
        var best = null;
        var bestScore = -1;
        for (var i = 0; i < voices.length; i++) {
            var sc = score(voices[i]);
            if (sc > bestScore) {
                bestScore = sc;
                best = voices[i];
            }
        }
        return best || voices[0];
    }

    function pickVoice() {
        return pickVoiceForLang(currentLang);
    }

    function refreshVoices() {
        if (!hasTTS) return;
        preferredVoice = pickVoiceForLang(currentLang);
    }

    /** Split reply into short phrases for calmer, more natural pacing (browser TTS).
     *  Handles English (.!?) and Hindi danda (।) sentence terminators. */
    function splitForSpeech(text) {
        var src = String(text || "").replace(/\s+/g, " ").trim();
        if (!src) return [];
        if (src.length < 100) return [src];
        var chunks = src.match(/[^.!?।]+[.!?।]+|[^.!?।]+$/g);
        if (!chunks || chunks.length <= 1) return [src];
        var out = [];
        for (var i = 0; i < chunks.length; i++) {
            var c = chunks[i].trim();
            if (c) out.push(c);
        }
        return out.length ? out : [src];
    }

    function ensureRecognition() {
        if (!SR) return null;
        if (recognition) return recognition;
        recognition = new SR();
        recognition.lang = currentLang;
        recognition.interimResults = true;
        recognition.continuous = false;
        recognition.maxAlternatives = 1;

        var lastFinal = "";

        recognition.onstart = function () {
            listening = true;
            setOrbState("listening");
            setStatus(t("listening"));
        };
        recognition.onresult = function (e) {
            var interim = "";
            lastFinal = "";
            for (var i = e.resultIndex; i < e.results.length; i++) {
                var r = e.results[i];
                if (r.isFinal) lastFinal += r[0].transcript;
                else interim += r[0].transcript;
            }
            var shown = (lastFinal + interim).trim();

            // Barge-in: if the bot is speaking AND this is real user speech (VAD + text gates),
            // cut the bot off immediately. The final transcript will be submitted via onend.
            if (isBotSpeaking && shown) {
                if (isRealInterrupt(shown, !!lastFinal)) {
                    interruptSpeech();
                    setOrbState("listening");
                    setStatus(t("listening"));
                }
            }

            if (shown) setStatus("\u201C" + shown + "\u201D");
        };
        recognition.onerror = function (ev) {
            listening = false;
            if (ev && (ev.error === "no-speech" || ev.error === "aborted")) {
                if (active && !muted && !awaitingReply) {
                    setStatus(t("no_catch"));
                    safeStart(800);
                }
                return;
            }
            if (ev && ev.error === "not-allowed") {
                setStatus(t("mic_deny"));
                setOrbState("muted");
                return;
            }
            setStatus(t("mic_err"));
            setOrbState("idle");
        };
        recognition.onend = function () {
            listening = false;
            if (!active) return;
            var transcript = (lastFinal || "").trim();
            lastFinal = "";
            if (transcript) {
                submitTranscript(transcript);
            } else if (!awaitingReply && !muted) {
                safeStart(400);
            }
        };
        return recognition;
    }

    function safeStart(delayMs) {
        // Mic may run during bot speech (for barge-in). It must NOT run while we're waiting
        // for the LLM (no useful input there) or while muted.
        if (!active || muted || awaitingReply) return;
        setTimeout(function () {
            if (!active || muted || awaitingReply) return;
            try {
                ensureRecognition();
                if (recognition && !listening) recognition.start();
            } catch (e) {
                console.warn("Voice: recognition.start() failed", e);
            }
        }, delayMs || 0);
    }

    function stopListening() {
        if (recognition && listening) {
            try { recognition.stop(); } catch (e) {}
        }
        listening = false;
    }

    function speak(text, onDone) {
        if (!hasTTS || !text) {
            if (onDone) onDone();
            return;
        }
        try { window.speechSynthesis.cancel(); } catch (e) {}
        var clean = String(text).replace(/[\u2022\u2023\u25E6\*\#`>_]/g, "").replace(/\s+/g, " ").trim();
        if (!clean) { if (onDone) onDone(); return; }

        var chunks = splitForSpeech(clean);
        var idx = 0;
        var session = ++speakSession;
        currentSpokenText = clean;
        isBotSpeaking = true;

        function finish() {
            // Only clear "speaking" flags if this session is still the current one.
            if (session === speakSession) {
                isBotSpeaking = false;
                interruptArmed = false;
                currentSpokenText = "";
            }
            if (onDone) onDone();
        }

        function speakChunk() {
            if (!active || session !== speakSession) {
                finish();
                return;
            }
            if (idx >= chunks.length) {
                finish();
                return;
            }
            var chunkText = chunks[idx];
            var chunkLang = detectScriptLang(chunkText);
            var u = new SpeechSynthesisUtterance(chunkText);
            u.lang = chunkLang;
            if (chunkLang === "hi-IN") {
                u.rate = 0.96;
                u.pitch = 1.0;
            } else {
                u.rate = 0.92;
                u.pitch = 0.98;
            }
            u.volume = 1;
            var v = pickVoiceForLang(chunkLang);
            if (v) u.voice = v;

            setOrbState("speaking");
            setStatus(t("speaking"));

            u.onstart = function () {
                if (session !== speakSession) return;
                // Arm the barge-in detector once the bot's voice is actually playing.
                interruptArmed = true;
                // Reset VAD counters so leftover energy from the previous chunk doesn't false-trigger.
                vadVoicedMs = 0;
                vadSilenceMs = 0;
                vadActive = false;
            };
            u.onend = function () {
                if (session !== speakSession) return;
                idx++;
                if (idx < chunks.length) {
                    setTimeout(speakChunk, 140);
                } else {
                    finish();
                }
            };
            u.onerror = function () {
                if (session !== speakSession) return;
                idx++;
                if (idx < chunks.length) {
                    setTimeout(speakChunk, 80);
                } else {
                    finish();
                }
            };
            try {
                window.speechSynthesis.speak(u);
            } catch (e) {
                finish();
            }
        }

        speakChunk();
    }

    /** Voice-command language switch: lets the user say "talk in hindi" / "english mein baat karo"
     *  to flip the recognizer + voice + UI pill, without sending the command to the LLM. */
    var SWITCH_TO_HI_PATTERNS = [
        /\b(switch|change|set|use)\s+(to\s+)?hindi\b/i,
        /\b(speak|talk|reply|answer|say|chat|respond)\s+(in\s+)?hindi\b/i,
        /\bhindi\s+(me(in)?|main)\s+(baat|bolo|bol|baat\s*kar(o|en|ein|ungi|unga)|reply|answer|jawab)\b/i,
        /\b(can\s+you|please|plz|pls)?\s*(speak|talk|reply)\s+hindi\b/i,
        /\bhindi\s+(please|plz|pls)\b/i,
        /\bhindi\s+mode\b/i,
        /\b(turn|switch)\s+on\s+hindi\b/i,
        /हिंदी\s*(में|me|mein|main)?\s*(बात|बोलो|बोल|जवाब|reply)/,
        /हिन्दी\s*(में|me|mein|main)?\s*(बात|बोलो|बोल|जवाब|reply)/
    ];
    var SWITCH_TO_EN_PATTERNS = [
        /\b(switch|change|set|use)\s+(to\s+)?english\b/i,
        /\b(speak|talk|reply|answer|say|chat|respond)\s+(in\s+)?english\b/i,
        /\benglish\s+(me(in)?|main)\s+(baat|bolo|bol|baat\s*kar(o|en|ein|ungi|unga)|reply|answer|jawab)\b/i,
        /\b(can\s+you|please|plz|pls)?\s*(speak|talk|reply)\s+english\b/i,
        /\benglish\s+(please|plz|pls)\b/i,
        /\benglish\s+mode\b/i,
        /\b(turn|switch)\s+on\s+english\b/i,
        /(अंग्रेज़ी|अंग्रेजी|इंग्लिश)\s*(में|me|mein|main)?\s*(बात|बोलो|बोल|जवाब|reply)/
    ];

    function intentSwitchLang(text) {
        var s = String(text || "").trim();
        if (!s) return null;
        if (s.length > 80) return null;
        var i;
        for (i = 0; i < SWITCH_TO_HI_PATTERNS.length; i++) {
            if (SWITCH_TO_HI_PATTERNS[i].test(s)) return "hi-IN";
        }
        for (i = 0; i < SWITCH_TO_EN_PATTERNS.length; i++) {
            if (SWITCH_TO_EN_PATTERNS[i].test(s)) return "en-US";
        }
        return null;
    }

    var ACK_HI = [
        "ठीक है, अब मैं हिंदी में बात करूँगी।",
        "बिल्कुल! अब हिंदी में बात करते हैं।",
        "ओके, हिंदी मोड चालू कर दिया।",
        "जी हाँ, अब आगे की बातचीत हिंदी में होगी।"
    ];
    var ACK_EN = [
        "Sure, I'll speak in English now.",
        "Got it — switching to English.",
        "Okay, English it is. What would you like to ask?",
        "Done — we'll continue in English."
    ];

    function applyLangCommand(newLang) {
        setLang(newLang);
        var pool = newLang === "hi-IN" ? ACK_HI : ACK_EN;
        var ack = pool[Math.floor(Math.random() * pool.length)];
        interruptSpeech();
        if (recognition) {
            try { recognition.abort(); } catch (e) {}
            recognition = null;
        }
        listening = false;
        awaitingReply = true;
        setOrbState("speaking");
        setStatus(ack);
        speak(ack, function () {
            awaitingReply = false;
            if (!active) return;
            setOrbState("idle");
            setStatus(t("listening"));
            safeStart(220);
        });
    }

    function submitTranscript(text) {
        var newLang = intentSwitchLang(text);
        if (newLang) {
            applyLangCommand(newLang);
            return;
        }
        var input = el("messageInput");
        if (!input) return;
        input.value = text;
        awaitingReply = true;
        setOrbState("thinking");
        setStatus(t("thinking"));
        try {
            sendMessage();
        } catch (e) {
            console.error(e);
            awaitingReply = false;
            setStatus(t("couldnt"));
        }
    }

    function handleAssistantReply(text) {
        awaitingReply = false;
        if (!active) return;
        // Open the mic NOW so the user can interrupt mid-reply.
        // (The interrupt detector runs only while `interruptArmed` is true → set in u.onstart.)
        if (!muted) safeStart(120);
        speak(text, function () {
            if (!active) return;
            setOrbState("idle");
            setStatus(t("tap_speak"));
            // Recognition is likely already running; safeStart is a no-op if so.
            safeStart(150);
        });
    }

    function handleError(msg) {
        awaitingReply = false;
        if (!active) return;
        setOrbState("idle");
        setStatus(msg || t("error"));
        safeStart(800);
    }

    function startGreeting() {
        if (!active) return;
        if (hasTTS) refreshVoices();
        var pool = currentLang === "hi-IN" ? GREETINGS_HI : GREETINGS_EN;
        var greeting = pool[Math.floor(Math.random() * pool.length)];
        setStatus(greeting);
        speak(greeting, function () {
            if (!active) return;
            if (!SR) {
                setStatus(t("not_supp"));
                return;
            }
            setOrbState("idle");
            setStatus(t("listening"));
            safeStart(150);
        });
    }

    function syncLangButtons() {
        var btns = document.querySelectorAll(".voice-lang-btn");
        for (var i = 0; i < btns.length; i++) {
            var b = btns[i];
            var on = b.getAttribute("data-lang") === currentLang;
            b.classList.toggle("is-active", on);
            b.setAttribute("aria-checked", on ? "true" : "false");
        }
    }

    function setLang(lang) {
        if (lang !== "en-US" && lang !== "hi-IN") return;
        if (lang === currentLang) {
            syncLangButtons();
            return;
        }
        currentLang = lang;
        try { localStorage.setItem(LANG_LS_KEY, lang); } catch (e) {}
        syncLangButtons();

        try { window.speechSynthesis.cancel(); } catch (e) {}
        if (recognition) {
            try { recognition.abort(); } catch (e) {}
            recognition = null;
        }
        listening = false;
        preferredVoice = null;
        refreshVoices();

        if (active) {
            setStatus(t("switched"));
            if (!awaitingReply && !muted) safeStart(450);
        }
    }

    function open() {
        if (active) return;
        if (!SR && !hasTTS) {
            alert("Voice mode isn't supported in this browser. Try Chrome, Edge, or Safari.");
            return;
        }
        var overlay = el("voiceOverlay");
        if (!overlay) return;
        overlay.classList.add("is-open");
        overlay.setAttribute("aria-hidden", "false");
        active = true;
        muted = false;
        awaitingReply = false;
        setOrbState("idle");
        syncLangButtons();
        startVAD();
        var muteBtn = el("voiceMuteBtn");
        if (muteBtn) muteBtn.classList.remove("is-muted");

        if (hasTTS && window.speechSynthesis.getVoices().length === 0) {
            var started = false;
            function begin() {
                if (started || !active) return;
                started = true;
                window.speechSynthesis.removeEventListener("voiceschanged", begin);
                startGreeting();
            }
            window.speechSynthesis.addEventListener("voiceschanged", begin);
            setTimeout(begin, 400);
        } else {
            startGreeting();
        }
    }

    function close() {
        if (!active) return;
        active = false;
        awaitingReply = false;
        listening = false;
        interruptSpeech();
        try { if (recognition) recognition.abort(); } catch (e) {}
        stopVAD();
        var overlay = el("voiceOverlay");
        if (overlay) {
            overlay.classList.remove("is-open");
            overlay.setAttribute("aria-hidden", "true");
        }
        setOrbState("idle");
    }

    function toggleMute() {
        muted = !muted;
        var btn = el("voiceMuteBtn");
        if (btn) btn.classList.toggle("is-muted", muted);
        if (muted) {
            stopListening();
            setOrbState("muted");
            setStatus(t("muted"));
        } else {
            setOrbState("idle");
            setStatus(t("listening"));
            safeStart(150);
        }
    }

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && active) close();
    });

    return {
        open: open,
        close: close,
        toggleMute: toggleMute,
        setLang: setLang,
        getLang: function () { return currentLang; },
        isActive: function () { return active; },
        handleAssistantReply: handleAssistantReply,
        handleError: handleError
    };
})();

function openVoiceMode() {
    if (window.VoiceMode) window.VoiceMode.open();
}
function closeVoiceMode() {
    if (window.VoiceMode) window.VoiceMode.close();
}
function toggleVoiceMute() {
    if (window.VoiceMode) window.VoiceMode.toggleMute();
}
function setVoiceLang(lang) {
    if (window.VoiceMode) window.VoiceMode.setLang(lang);
}