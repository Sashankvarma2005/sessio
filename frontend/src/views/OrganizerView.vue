<script setup>
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const overview = ref([]);
const form = ref({
  title: "",
  description: "",
  location: "",
  eventId: "",
  sessionDate: "",
  endDate: "",
  startTime: "",
  endTime: "",
  capacity: 25,
});
const events = ref([]);
const feedback = ref("");
const loading = ref(false);
const startDateInput = ref(null);
const endDateInput = ref(null);
const startTimeSelect = ref(null);
const endTimeSelect = ref(null);
const today = new Date().toISOString().slice(0, 10);

/** Max calendar days between session start date and end date (inclusive span limit). */
const MAX_SESSION_DAY_SPAN = 10;

function addDaysToDateString(dateStr, days) {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function calendarDaysBetween(startDateStr, endDateStr) {
  if (!startDateStr || !endDateStr) return 0;
  const ms =
    new Date(`${endDateStr}T12:00:00`).getTime() - new Date(`${startDateStr}T12:00:00`).getTime();
  return Math.round(ms / 86400000);
}

const timeOptions = (() => {
  const opts = [];
  for (let h = 0; h < 24; h += 1) {
    for (let m = 0; m < 60; m += 15) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      const value = `${hh}:${mm}`;
      const d = new Date(`2000-01-01T${value}:00`);
      const label = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      opts.push({ value, label });
    }
  }
  return opts;
})();

const maxEndDate = computed(() => addDaysToDateString(form.value.sessionDate, MAX_SESSION_DAY_SPAN));

const sessionDateSpanWarning = computed(() => {
  if (!form.value.sessionDate || !form.value.endDate) return "";
  const span = calendarDaysBetween(form.value.sessionDate, form.value.endDate);
  if (span > MAX_SESSION_DAY_SPAN) {
    return `Start and end dates may be at most ${MAX_SESSION_DAY_SPAN} days apart.`;
  }
  return "";
});

const sessionStartsAt = computed(() => {
  if (!form.value.sessionDate || !form.value.startTime) return null;
  return new Date(`${form.value.sessionDate}T${form.value.startTime}:00`);
});

const liveDateTimeWarning = computed(() => {
  if (!sessionStartsAt.value || Number.isNaN(sessionStartsAt.value.getTime())) return "";
  if (sessionStartsAt.value <= new Date()) {
    return "Session start time has already passed. Please choose a future date/time.";
  }
  return "";
});

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "TBD" : date.toLocaleString();
}

function openNativeDatePicker(inputEl) {
  // Chromium-based browsers support showPicker() for opening the native calendar popup.
  if (typeof inputEl?.showPicker === "function") {
    inputEl.showPicker();
  }
}

function openTimeDropdown(selectEl) {
  if (!selectEl) return;
  selectEl.focus();
  selectEl.click();
}

async function loadData() {
  loading.value = true;
  try {
    overview.value = await api.request("/organizer/overview", {}, auth.token);
    events.value = await api.request("/events", {}, auth.token);
    if (!form.value.eventId && events.value.length > 0) {
      form.value.eventId = String(events.value[0].id);
    }
  } catch (error) {
    feedback.value = error.message;
  } finally {
    loading.value = false;
  }
}

async function createEvent() {
  if (!form.value.title || !form.value.description || !form.value.location) {
    feedback.value = "Please fill title, description, and location before creating an event.";
    return;
  }
  try {
    const event = await api.request(
      "/events",
      {
        method: "POST",
        body: JSON.stringify({
          title: form.value.title,
          description: form.value.description,
          location: form.value.location,
        }),
      },
      auth.token
    );
    form.value.title = "";
    form.value.description = "";
    form.value.location = "";
    form.value.eventId = String(event.id);
    feedback.value = `Created event: ${event.title}`;
    await loadData();
  } catch (error) {
    feedback.value = error.message;
  }
}

async function addSession() {
  if (!form.value.eventId) {
    feedback.value = "Select an event before adding a session.";
    return;
  }
  if (!form.value.sessionDate || !form.value.endDate || !form.value.startTime || !form.value.endTime) {
    feedback.value = "Please choose start date, end date, start time, and end time.";
    return;
  }

  const startsAt = `${form.value.sessionDate}T${form.value.startTime}:00`;
  const endsAt = `${form.value.endDate}T${form.value.endTime}:00`;
  if (liveDateTimeWarning.value) {
    feedback.value = liveDateTimeWarning.value;
    return;
  }

  if (new Date(endsAt) <= new Date(startsAt)) {
    feedback.value = "Session end time must be after start time.";
    return;
  }
  if (sessionDateSpanWarning.value) {
    feedback.value = sessionDateSpanWarning.value;
    return;
  }
  try {
    await api.request(
      `/events/${form.value.eventId}/sessions`,
      {
        method: "POST",
        body: JSON.stringify({
          startsAt,
          endsAt,
          capacity: Number(form.value.capacity),
        }),
      },
      auth.token
    );
    form.value.sessionDate = "";
    form.value.endDate = "";
    form.value.startTime = "";
    form.value.endTime = "";
    feedback.value = "Session added successfully.";
    await loadData();
  } catch (error) {
    feedback.value = error.message;
  }
}

async function deleteEvent(event) {
  const confirmed = window.confirm(`Delete "${event.title}"? This cannot be undone.`);
  if (!confirmed) return;

  try {
    await api.request(`/events/${event.id}`, { method: "DELETE" }, auth.token);
    if (String(form.value.eventId) === String(event.id)) {
      form.value.eventId = "";
    }
    feedback.value = `Deleted event: ${event.title}`;
    await loadData();
  } catch (error) {
    feedback.value = error.message;
  }
}

async function clearEventRegistrations(event) {
  const confirmed = window.confirm(
    `Remove all registrations under "${event.title}"? Students will be unregistered.`
  );
  if (!confirmed) return;
  try {
    const result = await api.request(
      `/events/${event.id}/registrations`,
      { method: "DELETE" },
      auth.token
    );
    feedback.value = `Removed ${result.removedRegistrations} registrations from ${event.title}.`;
    await loadData();
  } catch (error) {
    feedback.value = error.message;
  }
}

onMounted(loadData);
</script>

<template>
  <section>
    <h2>Organizer Dashboard</h2>
    <p v-if="loading">Loading organizer data...</p>
    <p v-if="feedback" class="muted">{{ feedback }}</p>
    <div class="split-grid">
      <article class="card">
        <h3>Create Event</h3>
        <div class="stack">
          <input v-model="form.title" placeholder="Event title" />
          <textarea v-model="form.description" placeholder="Event description" />
          <input v-model="form.location" placeholder="Location" />
          <button class="primary" @click="createEvent">Create Event</button>
        </div>
      </article>
      <article class="card">
        <h3>Manage Sessions</h3>
        <div class="stack">
          <label for="session-event">Event</label>
          <select id="session-event" v-model="form.eventId">
            <option disabled value="">Select event</option>
            <option v-for="event in events" :key="event.id" :value="event.id">{{ event.title }}</option>
          </select>
          <label for="session-date">Session Start Date</label>
          <div class="date-input-row">
            <input id="session-date" ref="startDateInput" v-model="form.sessionDate" type="date" :min="today" />
            <button class="ghost date-picker-btn" type="button" @click="openNativeDatePicker(startDateInput)">
              Pick
            </button>
          </div>
          <label for="session-end-date">End Date</label>
          <div class="date-input-row">
            <input id="session-end-date" ref="endDateInput" v-model="form.endDate" type="date" :min="today" />
            <button class="ghost date-picker-btn" type="button" @click="openNativeDatePicker(endDateInput)">
              Pick
            </button>
          </div>
          <label for="session-start">Start Time</label>
          <div class="date-input-row">
            <select
              id="session-start"
              ref="startTimeSelect"
              v-model="form.startTime"
            >
              <option disabled value="">Select start time</option>
              <option v-for="opt in timeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
            <button
              class="ghost date-picker-btn"
              type="button"
              @click="openTimeDropdown(startTimeSelect)"
            >
              Pick
            </button>
          </div>
          <label for="session-end">End Time</label>
          <div class="date-input-row">
            <select
              id="session-end"
              ref="endTimeSelect"
              v-model="form.endTime"
            >
              <option disabled value="">Select end time</option>
              <option v-for="opt in timeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
            <button
              class="ghost date-picker-btn"
              type="button"
              @click="openTimeDropdown(endTimeSelect)"
            >
              Pick
            </button>
          </div>
          <label for="session-capacity">Capacity</label>
          <input id="session-capacity" v-model="form.capacity" type="number" min="1" />
          <p v-if="liveDateTimeWarning" class="error">{{ liveDateTimeWarning }}</p>
          <button class="primary" @click="addSession">Add Session</button>
        </div>
      </article>
    </div>

    <h3>Manage Events</h3>
    <div class="card" v-for="event in events" :key="event.id">
      <strong>{{ event.title }}</strong>
      <p class="muted">{{ event.location }}</p>
      <button class="ghost" @click="clearEventRegistrations(event)">Clear Registrations</button>
      <button class="ghost" @click="deleteEvent(event)">Delete Event</button>
    </div>

    <h3>Attendance Stats</h3>
    <div v-for="row in overview" :key="row.session_id" class="card">
      <strong>{{ row.title }}</strong>
      <p>{{ formatDate(row.starts_at) }}</p>
      <p>{{ row.registrations }} / {{ row.capacity }} registered</p>
    </div>
  </section>
</template>
