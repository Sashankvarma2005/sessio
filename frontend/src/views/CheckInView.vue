<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import { api } from "../api";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const videoRef = ref(null);
const cameraOn = ref(false);
const scanning = ref(false);
const manualCode = ref("");
const resultMessage = ref("");
const logs = ref([]);
let mediaStream = null;
let scanTimer = null;
let detector = null;

async function loadLogs() {
  logs.value = await api.request("/checkin/logs", {}, auth.token);
}

async function sendCheckin(body) {
  const response = await api.request("/checkin/mark", { method: "POST", body: JSON.stringify(body) }, auth.token);
  if (response.alreadyCheckedIn) {
    resultMessage.value = `${response.studentName} was already checked in.`;
  } else {
    resultMessage.value = `Checked in ${response.studentName} for ${response.eventTitle}.`;
  }
  await loadLogs();
}

async function submitManualCode() {
  if (!manualCode.value.trim()) return;
  try {
    await sendCheckin({ checkinCode: manualCode.value.trim().toUpperCase() });
    manualCode.value = "";
  } catch (error) {
    resultMessage.value = error.message;
  }
}

async function scanFrame() {
  if (!cameraOn.value || !videoRef.value || !detector) return;
  try {
    const barcodes = await detector.detect(videoRef.value);
    if (barcodes.length > 0 && barcodes[0].rawValue) {
      await sendCheckin({ payload: barcodes[0].rawValue });
    }
  } catch {
    // Silent by design: camera or browser may not support scan on every frame.
  }
}

async function startCamera() {
  if (!("BarcodeDetector" in window)) {
    resultMessage.value = "Camera QR scanning not supported in this browser. Use manual code entry.";
    return;
  }
  try {
    detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    videoRef.value.srcObject = mediaStream;
    await videoRef.value.play();
    cameraOn.value = true;
    scanning.value = true;
    scanTimer = setInterval(scanFrame, 900);
  } catch (error) {
    resultMessage.value = `Camera error: ${error.message}`;
  }
}

function stopCamera() {
  scanning.value = false;
  cameraOn.value = false;
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
  if (videoRef.value) videoRef.value.srcObject = null;
}

onMounted(loadLogs);
onBeforeUnmount(stopCamera);
</script>

<template>
  <section>
    <div class="section-head">
      <h2>QR Code Check-in</h2>
      <button class="ghost" @click="loadLogs">Refresh Logs</button>
    </div>

    <div class="split-grid">
      <article class="card">
        <h3>Camera Scanner</h3>
        <video ref="videoRef" class="scanner-video" muted playsinline></video>
        <div class="section-head">
          <button class="primary" v-if="!cameraOn" @click="startCamera">Start Camera</button>
          <button class="ghost" v-else @click="stopCamera">Stop Camera</button>
          <span class="muted">{{ scanning ? "Scanning..." : "Idle" }}</span>
        </div>
      </article>

      <article class="card">
        <h3>Manual Check-in</h3>
        <p class="muted">Enter the student's check-in code if camera scan is unavailable.</p>
        <div class="stack">
          <input v-model="manualCode" placeholder="Enter code (example: A1B2C3D4)" />
          <button class="primary" @click="submitManualCode">Check In by Code</button>
        </div>
        <p class="muted" v-if="resultMessage">{{ resultMessage }}</p>
      </article>
    </div>

    <h3>Attendance Logs</h3>
    <article class="card" v-if="logs.length === 0">
      <p class="muted">No check-ins yet.</p>
    </article>
    <article class="card" v-for="log in logs" :key="log.id">
      <div class="section-head">
        <strong>{{ log.student_name }}</strong>
        <span class="muted">{{ log.event_title }}</span>
      </div>
      <p class="muted">Action: {{ log.action }} via {{ log.method }}</p>
      <p class="muted">By: {{ log.actor_name }} at {{ new Date(log.created_at).toLocaleString() }}</p>
    </article>
  </section>
</template>
