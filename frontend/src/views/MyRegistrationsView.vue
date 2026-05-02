<script setup>
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const records = ref([]);
const notifications = ref([]);
const supportThreads = ref([]);
const supportMessages = ref([]);
const activeSupportThreadId = ref("");
const supportReplyText = ref("");
const supportForm = ref({
  registrationId: "",
  subject: "",
  message: "",
});
const loading = ref(false);
const activeTab = ref("registered");

const registeredOnly = computed(() =>
  records.value.filter((r) => r.attendance_status !== "checked_in")
);
const attendedOnly = computed(() =>
  records.value.filter((r) => r.attendance_status === "checked_in")
);
const visibleList = computed(() =>
  activeTab.value === "registered" ? registeredOnly.value : attendedOnly.value
);

async function loadSupportThreads() {
  supportThreads.value = await api.request("/support-threads", {}, auth.token);
  if (!activeSupportThreadId.value && supportThreads.value.length > 0) {
    activeSupportThreadId.value = String(supportThreads.value[0].id);
  }
}

async function loadSupportMessages() {
  if (!activeSupportThreadId.value) {
    supportMessages.value = [];
    return;
  }
  supportMessages.value = await api.request(
    `/support-threads/${activeSupportThreadId.value}/messages`,
    {},
    auth.token
  );
}

async function createSupportThread() {
  const payload = {
    registrationId: supportForm.value.registrationId ? Number(supportForm.value.registrationId) : null,
    subject: supportForm.value.subject,
    message: supportForm.value.message,
  };
  await api.request("/support-threads", { method: "POST", body: JSON.stringify(payload) }, auth.token);
  supportForm.value = { registrationId: "", subject: "", message: "" };
  await loadSupportThreads();
  await loadSupportMessages();
}

async function sendSupportReply() {
  if (!activeSupportThreadId.value || !supportReplyText.value.trim()) return;
  await api.request(
    `/support-threads/${activeSupportThreadId.value}/messages`,
    { method: "POST", body: JSON.stringify({ message: supportReplyText.value.trim() }) },
    auth.token
  );
  supportReplyText.value = "";
  await loadSupportThreads();
  await loadSupportMessages();
}

async function load() {
  loading.value = true;
  try {
    records.value = await api.request("/registrations/me", {}, auth.token);
    notifications.value = await api.request("/notifications/me", {}, auth.token);
    await loadSupportThreads();
    await loadSupportMessages();
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section>
    <div class="section-head">
      <h2>My Registrations</h2>
      <button class="ghost" @click="load">Refresh</button>
    </div>

    <article class="card notification-card" v-if="notifications.length > 0">
      <h3>Notifications</h3>
      <div v-for="item in notifications" :key="item.id" class="student-notification">
        <p class="student-notification-title">{{ item.title }}</p>
        <p class="muted">{{ item.message }}</p>
        <p class="muted">{{ new Date(item.created_at).toLocaleString() }}</p>
      </div>
    </article>

    <article class="card notification-card" v-if="auth.user?.role === 'student' || auth.user?.role === 'admin'">
      <h3>Registration Support Chat (Student ↔ Admin)</h3>
      <p class="muted">Ask admin what went wrong with your registration and continue the conversation here.</p>
      <div class="stack">
        <label for="support-registration">Related registration (optional)</label>
        <select id="support-registration" v-model="supportForm.registrationId">
          <option value="">General registration issue</option>
          <option v-for="item in records" :key="`support-${item.id}`" :value="item.id">
            {{ item.event_title }} - {{ new Date(item.starts_at).toLocaleString() }}
          </option>
        </select>
        <input v-model="supportForm.subject" placeholder="Issue subject (e.g., removed by mistake)" />
        <textarea
          v-model="supportForm.message"
          rows="3"
          placeholder="Describe your issue for admin (what happened, what you expected)"
        />
        <button class="ghost" @click="createSupportThread">Send to Admin</button>
      </div>

      <div class="stack" v-if="supportThreads.length > 0">
        <label for="support-thread">Your support threads</label>
        <select
          id="support-thread"
          v-model="activeSupportThreadId"
          @change="loadSupportMessages"
        >
          <option v-for="thread in supportThreads" :key="thread.id" :value="String(thread.id)">
            #{{ thread.id }} - {{ thread.subject }} ({{ thread.status }})
          </option>
        </select>
        <div class="followup-messages">
          <p class="muted" v-if="supportMessages.length === 0">No messages yet.</p>
          <div class="followup-message" v-for="msg in supportMessages" :key="msg.id">
            <strong>{{ msg.sender_name }} ({{ msg.sender_role }})</strong>
            <p>{{ msg.message }}</p>
            <small class="muted">{{ new Date(msg.created_at).toLocaleString() }}</small>
          </div>
        </div>
        <textarea
          v-if="activeSupportThreadId"
          v-model="supportReplyText"
          rows="3"
          placeholder="Reply to admin"
        />
        <button v-if="activeSupportThreadId" class="primary" @click="sendSupportReply">
          Send Reply
        </button>
      </div>
    </article>

    <div class="reg-tabs" role="tablist" aria-label="Registration status">
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'registered'"
        class="reg-tab"
        :class="{ active: activeTab === 'registered' }"
        @click="activeTab = 'registered'"
      >
        Registered
        <span v-if="registeredOnly.length" class="reg-tab-count">{{ registeredOnly.length }}</span>
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'attended'"
        class="reg-tab"
        :class="{ active: activeTab === 'attended' }"
        @click="activeTab = 'attended'"
      >
        Attended
        <span v-if="attendedOnly.length" class="reg-tab-count">{{ attendedOnly.length }}</span>
      </button>
    </div>

    <p v-if="loading">Loading...</p>

    <div v-for="item in visibleList" :key="item.id" class="card" :class="{ 'card-attended': activeTab === 'attended' }">
      <div v-if="activeTab === 'attended'" class="attended-badge">You attended</div>
      <h3>{{ item.event_title }}</h3>
      <p>{{ new Date(item.starts_at).toLocaleString() }} - {{ new Date(item.ends_at).toLocaleTimeString() }}</p>
      <p class="muted">Reason: {{ item.reason || "N/A" }}</p>

      <template v-if="activeTab === 'registered'">
        <p class="muted">Show this code or QR at the venue to check in.</p>
        <p><strong>Check-in Code:</strong> {{ item.checkin_code }}</p>
        <img
          v-if="item.qrCodeDataUrl"
          :src="item.qrCodeDataUrl"
          alt="Check-in QR code"
          class="registration-qr"
        />
      </template>
      <template v-else>
        <p v-if="item.checked_in_at" class="attended-time">
          Checked in {{ new Date(item.checked_in_at).toLocaleString() }}
        </p>
        <p v-else class="attended-time muted">Checked in (time pending sync — tap Refresh)</p>
      </template>
    </div>

    <p v-if="!loading && records.length === 0" class="muted">No registrations yet.</p>
    <p v-else-if="!loading && visibleList.length === 0 && activeTab === 'registered'" class="muted">
      Nothing waiting for check-in. Open the Attended tab for past check-ins.
    </p>
    <p v-else-if="!loading && visibleList.length === 0 && activeTab === 'attended'" class="muted">
      No sessions marked attended yet. After an organizer scans your code, it will appear here.
    </p>
  </section>
</template>

<style scoped>
.reg-tabs {
  display: flex;
  gap: 0.35rem;
  margin: 1rem 0 1.25rem;
  padding: 0.35rem;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  width: fit-content;
  box-shadow: 0 8px 24px rgba(79, 70, 229, 0.08);
}

.reg-tab {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--text-2);
  font: inherit;
  font-weight: 650;
  padding: 0.55rem 1rem;
  border-radius: 10px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  transition: background 0.18s ease, color 0.18s ease;
}

.reg-tab:hover {
  color: var(--text-1);
  background: rgba(34, 211, 238, 0.08);
  box-shadow: 0 0 20px rgba(34, 211, 238, 0.1);
}

.reg-tab.active {
  background: linear-gradient(135deg, rgba(34, 211, 238, 0.22), rgba(232, 121, 249, 0.18));
  color: var(--neon-cyan);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.15),
    0 0 24px rgba(236, 72, 153, 0.15);
  text-shadow: 0 0 24px rgba(34, 211, 238, 0.35);
}

.reg-tab-count {
  font-size: 0.78rem;
  font-weight: 700;
  padding: 0.12rem 0.45rem;
  border-radius: 999px;
  background: rgba(168, 85, 247, 0.2);
  color: var(--neon-magenta);
}

.reg-tab.active .reg-tab-count {
  background: rgba(10, 4, 20, 0.55);
  color: var(--neon-amber);
}

.card-attended {
  border-color: rgba(74, 222, 128, 0.45);
  box-shadow:
    0 0 40px rgba(74, 222, 128, 0.2),
    0 14px 36px rgba(0, 0, 0, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.attended-badge {
  display: inline-block;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #4ade80;
  background: linear-gradient(135deg, rgba(74, 222, 128, 0.25), rgba(34, 211, 238, 0.12));
  padding: 0.35rem 0.65rem;
  border-radius: 8px;
  margin-bottom: 0.65rem;
  box-shadow: 0 0 20px rgba(74, 222, 128, 0.25);
}

.attended-time {
  margin: 0.35rem 0 0;
  font-weight: 600;
  color: var(--neon-cyan);
}

.notification-card {
  margin-bottom: 1rem;
}

.student-notification {
  border-top: 1px solid rgba(167, 139, 250, 0.2);
  padding-top: 0.55rem;
  margin-top: 0.55rem;
}

.student-notification:first-of-type {
  border-top: none;
  padding-top: 0;
  margin-top: 0;
}

.student-notification-title {
  margin: 0;
  font-weight: 700;
  color: #fda4af;
}

.followup-messages {
  max-height: 260px;
  overflow: auto;
  border: 1px solid rgba(167, 139, 250, 0.2);
  border-radius: 10px;
  padding: 0.6rem;
}

.followup-message {
  border-bottom: 1px dashed rgba(167, 139, 250, 0.25);
  padding: 0.45rem 0;
}

.followup-message:last-child {
  border-bottom: none;
}

.followup-message p {
  margin: 0.2rem 0 0.25rem;
}
</style>
