<script setup>
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const loading = ref(false);
const error = ref("");
const infoMessage = ref("");
const searchQuery = ref("");
const requestReasonByRegistrationId = ref({});
const removingRegistrationId = ref(null);
const decidingRequestId = ref(null);
const followupTextByRequestId = ref({});
const activeFollowupRequestId = ref(null);
const isFollowupChatOpen = ref(false);
const supportThreads = ref([]);
const supportMessages = ref([]);
const activeSupportThreadId = ref("");
const supportReplyByThreadId = ref({});
const analytics = ref({
  totals: {
    totalEvents: 0,
    totalSessions: 0,
    totalRegistrations: 0,
    totalCheckedIn: 0,
    totalCapacity: 0,
    utilizationPercent: 0,
  },
  eventPerformance: [],
  sessionFillRates: [],
  recentRegistrations: [],
  registrationDetails: [],
  removalRequests: [],
  removalRequestMessages: [],
});

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "TBD" : date.toLocaleString();
}

async function loadAnalytics() {
  loading.value = true;
  error.value = "";
  try {
    analytics.value = await api.request("/analytics", {}, auth.token);
    if (auth.user?.role === "admin") {
      await loadSupportThreads();
    }
    infoMessage.value = "";
    if (
      auth.user?.role === "organizer" &&
      !activeFollowupRequestId.value &&
      analytics.value.removalRequests.length > 0
    ) {
      activeFollowupRequestId.value = analytics.value.removalRequests[0].id;
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function loadSupportThreads() {
  supportThreads.value = await api.request("/support-threads", {}, auth.token);
  if (!activeSupportThreadId.value && supportThreads.value.length > 0) {
    activeSupportThreadId.value = String(supportThreads.value[0].id);
  }
  await loadSupportMessages();
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

async function sendSupportReply(threadId) {
  const message = (supportReplyByThreadId.value[threadId] || "").trim();
  if (message.length < 3) {
    error.value = "Reply must be at least 3 characters.";
    return;
  }
  error.value = "";
  try {
    await api.request(
      `/support-threads/${threadId}/messages`,
      { method: "POST", body: JSON.stringify({ message }) },
      auth.token
    );
    supportReplyByThreadId.value[threadId] = "";
    await loadSupportThreads();
  } catch (e) {
    error.value = e.message;
  }
}

const filteredRegistrationDetails = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return analytics.value.registrationDetails;

  return analytics.value.registrationDetails.filter((row) =>
    [row.student_name, row.student_email, row.event_title].some((value) =>
      String(value || "").toLowerCase().includes(query)
    )
  );
});

async function removeRegistration(row) {
  const confirmed = window.confirm(`Remove ${row.student_name} from ${row.event_title}?`);
  if (!confirmed) return;

  removingRegistrationId.value = row.registration_id;
  error.value = "";
  try {
    await api.request(`/registrations/${row.registration_id}`, { method: "DELETE" }, auth.token);
    await loadAnalytics();
  } catch (e) {
    error.value = e.message;
  } finally {
    removingRegistrationId.value = null;
  }
}

async function sendRemovalRequest(row) {
  const reason = (requestReasonByRegistrationId.value[row.registration_id] || "").trim();
  if (reason.length < 10) {
    error.value = "Please provide a detailed reason (at least 10 characters).";
    return;
  }

  error.value = "";
  try {
    await api.request(
      "/removal-requests",
      {
        method: "POST",
        body: JSON.stringify({ registrationId: row.registration_id, reason }),
      },
      auth.token
    );
    requestReasonByRegistrationId.value[row.registration_id] = "";
    infoMessage.value = "Request sent to admin. Please wait for admin review.";
    await loadAnalytics();
  } catch (e) {
    error.value = e.message;
  }
}

const pendingRemovalRequests = computed(() =>
  analytics.value.removalRequests.filter((item) => item.status === "pending")
);
const reviewedRemovalRequests = computed(() =>
  analytics.value.removalRequests.filter((item) => item.status !== "pending")
);

const organizerRequests = computed(() =>
  analytics.value.removalRequests.filter((item) => item.requested_by_name === auth.user?.name)
);

const activeFollowupMessages = computed(() => {
  if (!activeFollowupRequestId.value) return [];
  return analytics.value.removalRequestMessages.filter(
    (item) => item.removal_request_id === activeFollowupRequestId.value
  );
});

async function decideRemovalRequest(request, decision) {
  decidingRequestId.value = request.id;
  error.value = "";
  try {
    await api.request(
      `/removal-requests/${request.id}/decision`,
      {
        method: "POST",
        body: JSON.stringify({
          decision,
          reviewNote:
            decision === "approved"
              ? "Approved by admin after review."
              : "Rejected by admin after review.",
        }),
      },
      auth.token
    );
    await loadAnalytics();
  } catch (e) {
    error.value = e.message;
  } finally {
    decidingRequestId.value = null;
  }
}

async function sendFollowupMessage(requestId) {
  const message = (followupTextByRequestId.value[requestId] || "").trim();
  if (message.length < 3) {
    error.value = "Follow-up must be at least 3 characters.";
    return;
  }

  error.value = "";
  try {
    await api.request(
      `/removal-requests/${requestId}/followups`,
      { method: "POST", body: JSON.stringify({ message }) },
      auth.token
    );
    followupTextByRequestId.value[requestId] = "";
    infoMessage.value = "Follow-up sent to admin.";
    await loadAnalytics();
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(loadAnalytics);
</script>

<template>
  <section>
    <div class="section-head">
      <h2>Analytics</h2>
      <button class="ghost" @click="loadAnalytics">Refresh</button>
    </div>
    <p class="muted" v-if="auth.user?.role === 'organizer'">
      Showing analytics for events you organize.
    </p>
    <p class="muted" v-else-if="auth.user?.role === 'admin'">
      Showing analytics across all events.
    </p>
    <p v-if="loading">Loading analytics...</p>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="infoMessage" class="muted">{{ infoMessage }}</p>

    <div class="metric-grid">
      <article class="card metric-card">
        <p class="muted">Total Events</p>
        <h3>{{ analytics.totals.totalEvents }}</h3>
      </article>
      <article class="card metric-card">
        <p class="muted">Total Sessions</p>
        <h3>{{ analytics.totals.totalSessions }}</h3>
      </article>
      <article class="card metric-card">
        <p class="muted">Registrations</p>
        <h3>{{ analytics.totals.totalRegistrations }}</h3>
      </article>
      <article class="card metric-card">
        <p class="muted">People Attended</p>
        <h3>{{ analytics.totals.totalCheckedIn }}</h3>
      </article>
      <article class="card metric-card">
        <p class="muted">Capacity Usage</p>
        <h3>{{ analytics.totals.utilizationPercent }}%</h3>
      </article>
    </div>

    <h3>Event Performance</h3>
    <article class="card" v-for="event in analytics.eventPerformance" :key="event.event_id">
      <div class="section-head">
        <strong>{{ event.title }}</strong>
        <span class="muted">{{ event.registrations_count }} registrations</span>
      </div>
      <p class="muted">
        {{ event.sessions_count }} sessions | {{ event.capacity_total }} capacity | {{ event.checked_in_count }} checked in
      </p>
      <div class="progress-wrap">
        <div
          class="progress-bar"
          :style="{ width: `${event.capacity_total > 0 ? Math.min(100, Math.round((event.registrations_count / event.capacity_total) * 100)) : 0}%` }"
        ></div>
      </div>
    </article>

    <h3>Session Fill Rates</h3>
    <article class="card" v-for="session in analytics.sessionFillRates" :key="session.session_id">
      <div class="section-head">
        <strong>{{ session.event_title }}</strong>
        <span>{{ session.fillRate }}%</span>
      </div>
      <p class="muted">{{ formatDate(session.starts_at) }}</p>
      <p class="muted">{{ session.registrations_count }} / {{ session.capacity }} seats filled</p>
      <p class="muted">
        {{ session.checked_in_count }} attended ({{ session.attendanceRate }}% of registrations)
      </p>
      <div class="progress-wrap">
        <div class="progress-bar" :style="{ width: `${session.fillRate}%` }"></div>
      </div>
    </article>

    <h3>Recent Registration Trend (7 days)</h3>
    <article class="card" v-if="analytics.recentRegistrations.length === 0">
      <p class="muted">No registration data yet.</p>
    </article>
    <article class="card" v-for="item in analytics.recentRegistrations" :key="item.day">
      <div class="section-head">
        <strong>{{ item.day }}</strong>
        <span>{{ item.count }} registrations</span>
      </div>
    </article>

    <h3>Registered Students</h3>
    <article class="card">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Search by student name, email, or event"
      />
    </article>
    <article class="card" v-if="filteredRegistrationDetails.length === 0">
      <p class="muted">No student registrations yet.</p>
    </article>
    <article class="card" v-for="row in filteredRegistrationDetails" :key="row.registration_id">
      <div class="section-head">
        <strong>{{ row.student_name }}</strong>
        <span class="muted">{{ row.student_email }}</span>
      </div>
      <p class="muted">{{ row.event_title }} | {{ formatDate(row.starts_at) }}</p>
      <p class="muted">Reason: {{ row.reason || "N/A" }}</p>
      <p class="muted">Registered at: {{ formatDate(row.created_at) }}</p>
      <div v-if="auth.user?.role === 'organizer'" class="stack">
        <textarea
          v-model="requestReasonByRegistrationId[row.registration_id]"
          placeholder="Reason for removal request (required, min 10 chars)"
          rows="3"
        />
        <button class="ghost" @click="sendRemovalRequest(row)">Send Request to Admin</button>
      </div>
      <button
        v-else-if="auth.user?.role === 'admin'"
        class="ghost"
        :disabled="removingRegistrationId === row.registration_id"
        @click="removeRegistration(row)"
      >
        {{ removingRegistrationId === row.registration_id ? "Removing..." : "Remove Now (Admin Override)" }}
      </button>
    </article>

    <h3 v-if="auth.user?.role === 'admin'">Removal Requests From Organizers</h3>
    <article class="card" v-if="auth.user?.role === 'admin' && pendingRemovalRequests.length === 0">
      <p class="muted">No pending organizer removal requests.</p>
    </article>
    <article
      class="card"
      v-for="request in auth.user?.role === 'admin' ? pendingRemovalRequests : []"
      :key="request.id"
    >
      <div class="section-head">
        <strong>{{ request.student_name }}</strong>
        <span class="muted">{{ request.event_title }}</span>
      </div>
      <p class="muted">Requested by: {{ request.requested_by_name }}</p>
      <p class="muted">Reason: {{ request.reason }}</p>
      <p class="muted">Requested at: {{ formatDate(request.created_at) }}</p>
      <div class="section-head">
        <button
          class="primary"
          :disabled="decidingRequestId === request.id"
          @click="decideRemovalRequest(request, 'approved')"
        >
          Approve & Remove
        </button>
        <button
          class="ghost"
          :disabled="decidingRequestId === request.id"
          @click="decideRemovalRequest(request, 'rejected')"
        >
          Reject
        </button>
      </div>
    </article>

    <h3 v-if="auth.user?.role === 'admin'">Removal Request Audit Log</h3>
    <article class="card" v-if="auth.user?.role === 'admin' && reviewedRemovalRequests.length === 0">
      <p class="muted">No reviewed requests yet.</p>
    </article>

    <h3 v-if="auth.user?.role === 'admin'">Student Registration Support Inbox</h3>
    <article class="card" v-if="auth.user?.role === 'admin' && supportThreads.length === 0">
      <p class="muted">No support threads yet.</p>
    </article>
    <article class="card" v-if="auth.user?.role === 'admin' && supportThreads.length > 0">
      <div class="stack">
        <label for="support-thread-select">Select student thread</label>
        <select id="support-thread-select" v-model="activeSupportThreadId" @change="loadSupportMessages">
          <option v-for="thread in supportThreads" :key="thread.id" :value="String(thread.id)">
            #{{ thread.id }} - {{ thread.student_name }} - {{ thread.subject }} ({{ thread.status }})
          </option>
        </select>
      </div>
      <p class="muted" v-if="activeSupportThreadId">
        Student: {{
          supportThreads.find((item) => String(item.id) === activeSupportThreadId)?.student_name
        }}
        ({{ supportThreads.find((item) => String(item.id) === activeSupportThreadId)?.student_email }})
      </p>
      <p class="muted" v-if="activeSupportThreadId">
        Registration/Event:
        {{
          supportThreads.find((item) => String(item.id) === activeSupportThreadId)?.event_title ||
          "General registration issue"
        }}
      </p>
      <div class="followup-messages">
        <p class="muted" v-if="supportMessages.length === 0">No messages yet.</p>
        <div class="followup-message" v-for="msg in supportMessages" :key="`support-msg-${msg.id}`">
          <strong>{{ msg.sender_name }} ({{ msg.sender_role }})</strong>
          <p>{{ msg.message }}</p>
          <small class="muted">{{ formatDate(msg.created_at) }}</small>
        </div>
      </div>
      <textarea
        v-if="activeSupportThreadId"
        v-model="supportReplyByThreadId[activeSupportThreadId]"
        placeholder="Reply to student"
        rows="3"
      />
      <button
        v-if="activeSupportThreadId"
        class="primary"
        @click="sendSupportReply(activeSupportThreadId)"
      >
        Send Reply to Student
      </button>
    </article>
    <article
      class="card"
      v-for="request in auth.user?.role === 'admin' ? reviewedRemovalRequests : []"
      :key="`reviewed-${request.id}`"
    >
      <div class="section-head">
        <strong>{{ request.student_name }}</strong>
        <span class="muted">{{ request.event_title }}</span>
      </div>
      <p class="muted">
        Status: {{ request.status }} | Requested by: {{ request.requested_by_name }}
      </p>
      <p class="muted">Reason: {{ request.reason }}</p>
      <p class="muted">Reviewed by: {{ request.reviewed_by_name || "N/A" }}</p>
      <p class="muted">Review note: {{ request.review_note || "No note" }}</p>
      <p class="muted">Reviewed at: {{ formatDate(request.reviewed_at) }}</p>
    </article>

    <aside v-if="auth.user?.role === 'organizer'" class="followup-chat-panel">
      <button class="followup-chat-icon" @click="isFollowupChatOpen = !isFollowupChatOpen">
        💬
      </button>

      <div v-if="isFollowupChatOpen" class="followup-chat-card">
        <div class="section-head">
          <h4>Follow-up Chat</h4>
          <button class="ghost" @click="isFollowupChatOpen = false">Close</button>
        </div>
        <p class="muted">Request sent. Wait for admin review and send follow-ups here.</p>
        <select v-model="activeFollowupRequestId">
          <option disabled value="">Select your request</option>
          <option v-for="request in organizerRequests" :key="request.id" :value="request.id">
            #{{ request.id }} - {{ request.student_name }} ({{ request.status }})
          </option>
        </select>

        <div class="followup-messages">
          <p class="muted" v-if="activeFollowupMessages.length === 0">No messages yet.</p>
          <div class="followup-message" v-for="msg in activeFollowupMessages" :key="msg.id">
            <strong>{{ msg.sender_name }} ({{ msg.sender_role }})</strong>
            <p>{{ msg.message }}</p>
            <small class="muted">{{ formatDate(msg.created_at) }}</small>
          </div>
        </div>

        <textarea
          v-if="activeFollowupRequestId"
          v-model="followupTextByRequestId[activeFollowupRequestId]"
          placeholder="Type a follow-up message to admin"
          rows="3"
        />
        <button
          v-if="activeFollowupRequestId"
          class="primary"
          @click="sendFollowupMessage(activeFollowupRequestId)"
        >
          Send Follow-up
        </button>
      </div>
    </aside>
  </section>
</template>
