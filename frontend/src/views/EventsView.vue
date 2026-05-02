<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import { api } from "../api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const events = ref([]);
const loading = ref(false);
const error = ref("");
const notification = ref({ type: "", message: "" });
const registrationReason = ref({});
let notificationTimer = null;

function clearNotificationTimer() {
  if (notificationTimer) {
    clearTimeout(notificationTimer);
    notificationTimer = null;
  }
}

function showNotification(type, message) {
  clearNotificationTimer();
  notification.value = { type, message };
  if (!message) return;
  notificationTimer = setTimeout(() => {
    notification.value = { type: "", message: "" };
    notificationTimer = null;
  }, 4000);
}

function seatClass(session) {
  const ratio = session.availableSeats / session.capacity;
  if (ratio > 0.5) return "green";
  if (ratio > 0.2) return "amber";
  return "red";
}

async function loadEvents() {
  loading.value = true;
  error.value = "";
  try {
    events.value = await api.request("/events", {}, auth.token);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function register(sessionId) {
  showNotification("", "");
  try {
    await api.request(
      `/sessions/${sessionId}/register`,
      { method: "POST", body: JSON.stringify({ reason: registrationReason.value[sessionId] || "" }) },
      auth.token
    );
    showNotification("success", "Registration successful.");
    await loadEvents();
  } catch (e) {
    const fullMessage = "All slots are filled for this session. Please look for another event.";
    showNotification("error", e.message.includes("filled") ? fullMessage : e.message);
  }
}

async function unregister(sessionId) {
  showNotification("", "");
  try {
    await api.request(`/sessions/${sessionId}/register`, { method: "DELETE" }, auth.token);
    showNotification("success", "Registration canceled.");
    await loadEvents();
  } catch (e) {
    showNotification("error", e.message);
  }
}

onMounted(loadEvents);
onBeforeUnmount(() => {
  clearNotificationTimer();
});
</script>

<template>
  <section>
    <div class="section-head">
      <h2>Event Selection</h2>
      <button class="ghost" @click="loadEvents">Refresh</button>
    </div>
    <p v-if="loading">Loading events...</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="notification.message" :class="notification.type === 'error' ? 'error' : 'success'">
      {{ notification.message }}
    </p>
    <div class="event-grid">
      <article v-for="event in events" :key="event.id" class="card">
        <h3>{{ event.title }}</h3>
        <p class="muted">{{ event.description }}</p>
        <p><strong>Location:</strong> {{ event.location }}</p>
        <p><strong>Organizer:</strong> {{ event.organizer_name }}</p>
        <h4>Sessions</h4>
        <p v-if="event.sessions.length === 0" class="muted">
          No sessions available yet for this event. Ask the organizer to add a session.
        </p>
        <div v-for="session in event.sessions" :key="session.id" class="session">
          <p>
            {{ new Date(session.starts_at).toLocaleString() }} - {{ new Date(session.ends_at).toLocaleTimeString() }}
          </p>
          <p>
            <span class="badge" :class="seatClass(session)">
              {{ session.availableSeats }}/{{ session.capacity }} seats left
            </span>
          </p>
          <div class="session-actions" v-if="auth.user?.role === 'student' || auth.user?.role === 'admin'">
            <input
              v-model="registrationReason[session.id]"
              placeholder="Registration reason (optional)"
            />
            <button class="primary" :disabled="session.availableSeats <= 0" @click="register(session.id)">
              {{ session.availableSeats <= 0 ? "Full" : "Register" }}
            </button>
            <button class="ghost" @click="unregister(session.id)">Cancel</button>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>
