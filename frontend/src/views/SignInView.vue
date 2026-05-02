<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import sessioLogo from "../assets/sessio-logo.png";

const auth = useAuthStore();
const router = useRouter();
const mode = ref("signin");
const name = ref("");
const email = ref("");
const password = ref("");
const showPassword = ref(false);
const role = ref("student");
const error = ref("");

async function submit() {
  error.value = "";
  try {
    if (mode.value === "signin") {
      await auth.signIn(email.value, password.value);
    } else {
      await auth.signUp(name.value, email.value, password.value, role.value);
    }
    router.push({ name: "events" });
  } catch (e) {
    error.value = e.message;
  }
}

</script>

<template>
  <section class="auth-wrap">
    <div class="auth-card">
      <div class="auth-brand">
        <img :src="sessioLogo" alt="Sessio logo" class="auth-logo" />
        <h1>Sessio</h1>
      </div>
      <p class="muted">Sign in to browse events, reserve sessions, and track registrations.</p>
      <div class="mode-toggle">
        <button :class="{ active: mode === 'signin' }" @click="mode = 'signin'">Sign in</button>
        <button :class="{ active: mode === 'signup' }" @click="mode = 'signup'">Create account</button>
      </div>
      <form @submit.prevent="submit" class="stack">
        <input v-if="mode === 'signup'" v-model="name" placeholder="Full name" required />
        <input v-model="email" type="email" placeholder="Email" required />
        <div class="password-field">
          <input
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            placeholder="Password"
            required
            minlength="8"
          />
          <button
            class="password-toggle"
            type="button"
            :aria-label="showPassword ? 'Hide password' : 'Show password'"
            @click="showPassword = !showPassword"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
        <select v-if="mode === 'signup'" v-model="role">
          <option value="student">Student</option>
          <option value="organizer">Organizer</option>
        </select>
        <button class="primary" :disabled="auth.loading">
          {{ mode === "signin" ? "Sign in" : "Create account" }}
        </button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
    </div>
  </section>
</template>
