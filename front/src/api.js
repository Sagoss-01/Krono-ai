// Service d'API pour communiquer avec le backend FastAPI de Krono AI

let apiBaseUrl = localStorage.getItem('KRONO_API_URL') || 'http://127.0.0.1:8000';

export function getApiUrl() {
  return apiBaseUrl;
}

export function setApiUrl(url) {
  apiBaseUrl = url;
  localStorage.setItem('KRONO_API_URL', url);
}

// Helper pour récupérer le token JWT stocké
function getHeaders(extraHeaders = {}) {
  const token = localStorage.getItem('KRONO_TOKEN');
  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// Transforme le champ "detail" renvoyé par FastAPI en message lisible.
// - erreur métier : detail est une chaîne ("Email ou mot de passe incorrect.")
// - erreur de validation (422) : detail est une liste d'objets {loc, msg, ...}
function extractErrorMessage(detail) {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : null;
        const msg = item.msg || 'Valeur invalide';
        // "body" / "password" ne sont pas parlants pour l'utilisateur : on garde seulement le message
        return field && field !== 'body' ? `${msg} (${field})` : msg;
      })
      .join(' · ');
  }
  return null;
}

// POST JSON vers une route d'authentification (pas de jeton requis).
// Si le serveur est injoignable, fetch lève une erreur technique : on la
// remplace par un message compréhensible pour l'utilisateur.
async function postAuthJson(path, body) {
  try {
    return await fetch(`${apiBaseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (networkError) {
    throw new Error(`Serveur injoignable (${apiBaseUrl}). Vérifiez que le backend est démarré.`);
  }
}

async function handleResponse(response) {
  if (!response.ok) {
    let errorDetail = 'Une erreur est survenue';
    try {
      const errJson = await response.json();
      errorDetail = extractErrorMessage(errJson.detail) || errJson.message || errorDetail;
    } catch (e) {
      // Pas de JSON : on garde le message générique
    }
    const error = new Error(errorDetail);
    // Le code HTTP permet à l'appelant de réagir (ex. 401 = session expirée)
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export const api = {
  getApiUrl() {
    return apiBaseUrl;
  },
  // --- BOÎTE DE RÉCEPTION (INBOX) ---
  async getInboxMessages(provider = null) {
    const params = provider ? `?provider=${provider}` : '';
    const res = await fetch(`${apiBaseUrl}/inbox/messages${params}`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async fetchInbox(hoursBack = 24) {
    const res = await fetch(`${apiBaseUrl}/inbox/fetch?hours_back=${hoursBack}`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  // --- AUTHENTIFICATION ---
  async register(email, password, fullName) {
    const res = await postAuthJson('/auth/register', {
      email,
      password,
      full_name: fullName?.trim() || null,
    });
    return handleResponse(res);
  },

  // Renvoie { access_token, token_type }. Le jeton est stocké ici pour que
  // les appels suivants (getHeaders) l'envoient automatiquement.
  async login(email, password) {
    const res = await postAuthJson('/auth/login', { email, password });
    const data = await handleResponse(res);
    if (data.access_token) {
      localStorage.setItem('KRONO_TOKEN', data.access_token);
    }
    return data;
  },

  async me() {
    const res = await fetch(`${apiBaseUrl}/auth/me`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  logout() {
    localStorage.removeItem('KRONO_TOKEN');
  },

  // --- GOOGLE : compte, Gmail (envoi confirmé), réunion vidéo ---
  async googleStatus() {
    const res = await fetch(`${apiBaseUrl}/google/status`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async googleSend(payload) {
    const res = await fetch(`${apiBaseUrl}/google/gmail/send`, {
      method: 'POST', headers: getHeaders(), body: JSON.stringify({ ...payload, confirmed: true }),
    });
    return handleResponse(res);
  },

  async googleSchedule(payload) {
    const res = await fetch(`${apiBaseUrl}/google/gmail/schedule`, {
      method: 'POST', headers: getHeaders(), body: JSON.stringify({ ...payload, confirmed: true }),
    });
    return handleResponse(res);
  },

  async assistantCreateMeeting(payload) {
    const res = await fetch(`${apiBaseUrl}/assistant/meetings`, {
      method: 'POST', headers: getHeaders(), body: JSON.stringify({ ...payload, confirmed: true }),
    });
    return handleResponse(res);
  },

  // --- ASSISTANT AURA : conversation multi-tours ---
  // messages : [{role: 'user'|'assistant', content}], nowLocal : 'AAAA-MM-JJTHH:MM'
  // Renvoie { reply, suggestions, actions }. Aucune action n'est exécutée par cet appel.
  async assistantChat(messages, nowLocal) {
    const res = await fetch(`${apiBaseUrl}/assistant/chat`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ messages, now_local: nowLocal }),
    });
    return handleResponse(res);
  },

  // --- LIEUX FRÉQUENTÉS (carte) ---
  async frequentPlacesList() {
    const res = await fetch(`${apiBaseUrl}/geo/frequent-places`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async createFrequentPlace(payload) {
    const res = await fetch(`${apiBaseUrl}/geo/frequent-places`, {
      method: 'POST', headers: getHeaders(), body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async updateFrequentPlace(placeId, payload) {
    const res = await fetch(`${apiBaseUrl}/geo/frequent-places/${placeId}`, {
      method: 'PUT', headers: getHeaders(), body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async deleteFrequentPlace(placeId) {
    const res = await fetch(`${apiBaseUrl}/geo/frequent-places/${placeId}`, {
      method: 'DELETE', headers: getHeaders(),
    });
    if (!res.ok) return handleResponse(res);
    return null;
  },

  // --- ITINÉRAIRE DE LA JOURNÉE ---
  async dayItinerary({ date, mode = 'drive', lat, lon }) {
    const params = new URLSearchParams({ date, mode });
    if (lat != null && lon != null) {
      params.set('lat', String(lat));
      params.set('lon', String(lon));
    }
    const res = await fetch(`${apiBaseUrl}/geo/day-itinerary?${params}`, { headers: getHeaders() });
    return handleResponse(res);
  },

  // --- MESSAGERIE : ADRESSES LIÉES (IMAP/SMTP) & ASSISTANCE IA ---
  async mailboxListAccounts() {
    const res = await fetch(`${apiBaseUrl}/mailbox/accounts`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async mailboxLinkAccount(payload) {
    const res = await fetch(`${apiBaseUrl}/mailbox/accounts`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  async mailboxUnlinkAccount(accountId) {
    const res = await fetch(`${apiBaseUrl}/mailbox/accounts/${accountId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) return handleResponse(res); // lève l'erreur avec le message du serveur
    return null; // 204 : pas de contenu
  },

  async mailboxListMessages(accountId, { folder = 'INBOX', unread = false, q = '' } = {}) {
    const params = new URLSearchParams({ folder, unread: String(unread), q });
    const res = await fetch(`${apiBaseUrl}/mailbox/accounts/${accountId}/messages?${params}`, { headers: getHeaders() });
    return handleResponse(res);
  },

  async mailboxReadMessage(accountId, uid, folder = 'INBOX') {
    const params = new URLSearchParams({ folder });
    const res = await fetch(`${apiBaseUrl}/mailbox/accounts/${accountId}/messages/${encodeURIComponent(uid)}?${params}`, { headers: getHeaders() });
    return handleResponse(res);
  },

  // Envoi réel : payload.confirmed doit être true (confirmation faite dans l'interface)
  async mailboxSend(accountId, payload) {
    const res = await fetch(`${apiBaseUrl}/mailbox/accounts/${accountId}/send`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  // Renvoie un texte proposé (subject / body / summary). N'envoie rien.
  async mailboxAssist(payload) {
    const res = await fetch(`${apiBaseUrl}/mailbox/ai/assist`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(res);
  },

  // --- AGENT CONVERSATIONNEL ---
  async processAgentCommand(text, todayIso) {
    const res = await fetch(`${apiBaseUrl}/agent/process`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ text, today_iso: todayIso }),
    });
    return handleResponse(res);
  },

  // --- SMART SCHEDULER & CONFLITS ---
  async getEvents() {
    const res = await fetch(`${apiBaseUrl}/scheduler/events`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async optimizeFuzzy(text, todayIso) {
    const res = await fetch(`${apiBaseUrl}/scheduler/optimize-fuzzy`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ text, today_iso: todayIso }),
    });
    return handleResponse(res);
  },

  async batchCreateEvents(events) {
    const res = await fetch(`${apiBaseUrl}/scheduler/batch-create`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ events }),
    });
    return handleResponse(res);
  },

  async createEvent(title, startTime, endTime, constraintType = 'soft', description = '', location = null) {
    const res = await fetch(`${apiBaseUrl}/scheduler/events`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        title,
        start_time: startTime,
        end_time: endTime,
        constraint_type: constraintType,
        description,
        location,
      }),
    });
    return handleResponse(res);
  },

  async updateEvent(eventId, { title, startTime, endTime, constraintType, description } = {}) {
    const body = {};
    if (title !== undefined)          body.title           = title;
    if (startTime !== undefined)      body.start_time      = startTime;
    if (endTime !== undefined)        body.end_time        = endTime;
    if (constraintType !== undefined) body.constraint_type = constraintType;
    if (description !== undefined)    body.description     = description;

    const res = await fetch(`${apiBaseUrl}/scheduler/events/${eventId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(body),
    });
    return handleResponse(res);
  },

  async deleteEvent(eventId) {
    const res = await fetch(`${apiBaseUrl}/scheduler/events/${eventId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (res.status === 204) return; // No Content — succès sans corps
    return handleResponse(res);
  },

  async resolveConflicts() {
    const res = await fetch(`${apiBaseUrl}/scheduler/resolve`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async computeEta(currentLat, currentLng, meetingLat, meetingLng, meetingTimeIso) {
    const res = await fetch(`${apiBaseUrl}/scheduler/eta`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        current_lat: parseFloat(currentLat),
        current_lng: parseFloat(currentLng),
        meeting_lat: parseFloat(meetingLat),
        meeting_lng: parseFloat(meetingLng),
        meeting_time: meetingTimeIso,
      }),
    });
    return handleResponse(res);
  },

  // --- SYNCHRONISATION DE CALENDRIER ---
  async getCalendarLinks() {
    const res = await fetch(`${apiBaseUrl}/calendar/links`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async addCalendarLink(provider, accessToken, refreshToken = null, expiresInSeconds = 3600) {
    const res = await fetch(`${apiBaseUrl}/calendar/links`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        provider,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in_seconds: expiresInSeconds
      }),
    });
    return handleResponse(res);
  },

  async syncCalendars() {
    const res = await fetch(`${apiBaseUrl}/calendar/sync`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  // --- NOTIFICATIONS PUSH ---
  async subscribePush(subscriptionInfo) {
    const res = await fetch(`${apiBaseUrl}/notifications/subscribe`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(subscriptionInfo),
    });
    return handleResponse(res);
  },

  async testPushNotification(title, body, urgency = 'normal') {
    const res = await fetch(`${apiBaseUrl}/notifications/trigger`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ title, body, urgency }),
    });
    return handleResponse(res);
  },

  // --- GEOLOCALISATION (Geoapify via proxy FastAPI) ---
  async geocode(query) {
    const res = await fetch(`${apiBaseUrl}/geo/geocode`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ query }),
    });
    return handleResponse(res);
  },

  async searchPlaces(lat, lon, category, radius = 2000, limit = 10) {
    const res = await fetch(`${apiBaseUrl}/geo/places`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ lat, lon, category, radius, limit }),
    });
    return handleResponse(res);
  },

  async calculateRoute(originLat, originLon, destLat, destLon, mode = 'drive') {
    const res = await fetch(`${apiBaseUrl}/geo/route`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        origin_lat: originLat,
        origin_lon: originLon,
        dest_lat: destLat,
        dest_lon: destLon,
        mode,
      }),
    });
    return handleResponse(res);
  },

  async autocomplete(text, limit = 5) {
    const params = new URLSearchParams({ text, limit });
    const res = await fetch(`${apiBaseUrl}/geo/autocomplete?${params}`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async getMapTilesKey() {
    const res = await fetch(`${apiBaseUrl}/geo/tiles-key`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  // --- CONTACTS & CARNET D'ADRESSES ---
  async getContacts() {
    const res = await fetch(`${apiBaseUrl}/contacts`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async createContact(name, email = null, phoneNumber = null, company = null, notes = null) {
    const res = await fetch(`${apiBaseUrl}/contacts`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        name,
        email: email || null,
        phone_number: phoneNumber || null,
        company: company || null,
        notes: notes || null,
      }),
    });
    return handleResponse(res);
  },

  async seedDemoContacts() {
    const res = await fetch(`${apiBaseUrl}/contacts/seed-demo`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async batchImportContacts(contacts) {
    const res = await fetch(`${apiBaseUrl}/contacts/batch`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ contacts }),
    });
    return handleResponse(res);
  },

  async deleteContact(contactId) {
    const res = await fetch(`${apiBaseUrl}/contacts/${contactId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (res.status === 204) return;
    return handleResponse(res);
  },

  // --- ENVOI DE MESSAGES (EMAIL & WHATSAPP) ---
  async sendMessage(channel, recipient, subject, body) {
    const res = await fetch(`${apiBaseUrl}/messaging/send`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        channel,
        recipient,
        subject: subject || null,
        body,
      }),
    });
    return handleResponse(res);
  },

  // --- BRIEFING MATINAL ---
  async getMorningBriefing(dateIso = null) {
    const params = dateIso ? `?date=${dateIso}` : '';
    const res = await fetch(`${apiBaseUrl}/briefing/today${params}`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async regenerateBriefing(dateIso = null) {
    const params = dateIso ? `?date=${dateIso}` : '';
    const res = await fetch(`${apiBaseUrl}/briefing/regenerate${params}`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  // --- IMPORT D'EMPLOI DU TEMPS ---
  async uploadAndParseSchedule(file, weekStart = null, repeatWeeks = 1) {
    const token = localStorage.getItem('KRONO_TOKEN');
    const formData = new FormData();
    formData.append('file', file);
    if (weekStart) formData.append('week_start', weekStart);
    formData.append('repeat_weeks', String(repeatWeeks));

    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${apiBaseUrl}/schedule-import/upload-and-parse`, {
      method: 'POST',
      headers,
      body: formData,
    });
    return handleResponse(res);
  },

  async confirmScheduleImport(events) {
    const res = await fetch(`${apiBaseUrl}/schedule-import/confirm-import`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ events }),
    });
    return handleResponse(res);
  },

  // --- SÉCURITÉ, 2FA, QUICK CONNECT & APPAREILS (TECHSPHERE) ---
  async get2FAStatus() {
    const res = await fetch(`${apiBaseUrl}/auth/security/2fa/status`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async setup2FA() {
    const res = await fetch(`${apiBaseUrl}/auth/security/2fa/setup`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async enable2FA(code) {
    const res = await fetch(`${apiBaseUrl}/auth/security/2fa/enable`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ code }),
    });
    return handleResponse(res);
  },

  async disable2FA(code) {
    const res = await fetch(`${apiBaseUrl}/auth/security/2fa/disable`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ code }),
    });
    return handleResponse(res);
  },

  async quickConnectGenerate() {
    const res = await fetch(`${apiBaseUrl}/auth/security/quick-connect/generate`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async quickConnectRequest() {
    const res = await fetch(`${apiBaseUrl}/auth/security/quick-connect/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse(res);
  },

  async quickConnectStatus(token) {
    const res = await fetch(`${apiBaseUrl}/auth/security/quick-connect/status/${token}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    return handleResponse(res);
  },

  async quickConnectDecide(token, action) {
    const res = await fetch(`${apiBaseUrl}/auth/security/quick-connect/decide`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ token, action }),
    });
    return handleResponse(res);
  },

  async quickConnectConsume(token) {
    const res = await fetch(`${apiBaseUrl}/auth/security/quick-connect/consume-approved`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await handleResponse(res);
    if (data.access_token) {
      localStorage.setItem('KRONO_TOKEN', data.access_token);
    }
    return data;
  },

  async getDevices() {
    const res = await fetch(`${apiBaseUrl}/auth/security/devices`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async trustDevice(deviceId) {
    const res = await fetch(`${apiBaseUrl}/auth/security/devices/${deviceId}/trust`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async blockDevice(deviceId) {
    const res = await fetch(`${apiBaseUrl}/auth/security/devices/${deviceId}/block`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async revokeDevice(deviceId) {
    const res = await fetch(`${apiBaseUrl}/auth/security/devices/${deviceId}/revoke`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async forgotPassword(email) {
    const res = await fetch(`${apiBaseUrl}/auth/security/recovery/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return handleResponse(res);
  },

  async resetPassword(email, code, new_password) {
    const res = await fetch(`${apiBaseUrl}/auth/security/recovery/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, new_password }),
    });
    return handleResponse(res);
  },

  async exportGDPRData() {
    const res = await fetch(`${apiBaseUrl}/auth/security/account/export`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async deleteAccountGDPR() {
    const res = await fetch(`${apiBaseUrl}/auth/security/account/delete`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ confirm: true }),
    });
    return handleResponse(res);
  },

  // --- PANNEAU D'ADMINISTRATION (TECHSPHERE) ---
  async getAdminOverview() {
    const res = await fetch(`${apiBaseUrl}/admin/overview`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async getAdminUsers() {
    const res = await fetch(`${apiBaseUrl}/admin/users`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async suspendUser(userId) {
    const res = await fetch(`${apiBaseUrl}/admin/users/${userId}/suspend`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async unsuspendUser(userId) {
    const res = await fetch(`${apiBaseUrl}/admin/users/${userId}/unsuspend`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async toggleAdminRole(userId) {
    const res = await fetch(`${apiBaseUrl}/admin/users/${userId}/toggle-admin`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async getAdminAudit() {
    const res = await fetch(`${apiBaseUrl}/admin/audit`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async getAdminAiSettings() {
    const res = await fetch(`${apiBaseUrl}/admin/ai/settings`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async updateAdminAiSettings(settings) {
    const res = await fetch(`${apiBaseUrl}/admin/ai/settings`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(settings),
    });
    return handleResponse(res);
  },

  async getAdminAiFeedbacks() {
    const res = await fetch(`${apiBaseUrl}/admin/ai/feedbacks`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async submitAiFeedback(data) {
    const res = await fetch(`${apiBaseUrl}/ai/feedback`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  // --- EXPORT CALENDRIER ICALENDAR (.ICS) ---
  async exportEventsIcs() {
    const token = localStorage.getItem('KRONO_TOKEN');
    const res = await fetch(`${apiBaseUrl}/scheduler/events/export/ics`, {
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    });
    if (!res.ok) throw new Error("Impossible d'exporter le fichier .ics");
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `krono_calendar_${Date.now()}.ics`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },

  async exportSingleEventIcs(eventId) {
    const token = localStorage.getItem('KRONO_TOKEN');
    const res = await fetch(`${apiBaseUrl}/scheduler/events/${eventId}/ics`, {
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    });
    if (!res.ok) throw new Error("Impossible d'exporter l'événement .ics");
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `event_${eventId}.ics`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },

  // --- CONTACTS FAVORIS ---
  async toggleFavoriteContact(contactId) {
    const res = await fetch(`${apiBaseUrl}/contacts/${contactId}/favorite`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  // --- MESSAGES PROGRAMMÉS (SCHEDULED EMAILS) ---
  async scheduleMessage(recipient, channel, subject, body, scheduledAt) {
    const res = await fetch(`${apiBaseUrl}/messaging/schedule`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        recipient,
        channel,
        subject,
        body,
        scheduled_at: scheduledAt,
      }),
    });
    return handleResponse(res);
  },

  async getScheduledMessages() {
    const res = await fetch(`${apiBaseUrl}/messaging/schedule`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  async cancelScheduledMessage(messageId) {
    const res = await fetch(`${apiBaseUrl}/messaging/schedule/${messageId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse(res);
  },

  // --- ASSISTANT IA ÉTENDU & OUTILS RÉUNIONS ---
  async chatWithAura(messages, conversationId = null) {
    const res = await fetch(`${apiBaseUrl}/ai/chat`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ messages, conversation_id: conversationId }),
    });
    return handleResponse(res);
  },

  async checkAgendaAvailability(proposedTitle, proposedDate, proposedTime, durationMinutes = 60) {
    const res = await fetch(`${apiBaseUrl}/ai/agenda/check`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        proposed_title: proposedTitle,
        proposed_date: proposedDate,
        proposed_time: proposedTime,
        duration_minutes: durationMinutes,
      }),
    });
    return handleResponse(res);
  },

  async generateMeetingSummary(meetingId, notes) {
    const res = await fetch(`${apiBaseUrl}/ai/meetings/${meetingId}/summary`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ notes }),
    });
    return handleResponse(res);
  },

  async generateMeetingQuiz(meetingId, notes) {
    const res = await fetch(`${apiBaseUrl}/ai/meetings/${meetingId}/quiz`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ notes }),
    });
    return handleResponse(res);
  },
};
