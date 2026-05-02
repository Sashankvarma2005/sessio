<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "./stores/auth";
import sessioLogo from "./assets/sessio-logo.png";

const auth = useAuthStore();
const router = useRouter();
const isOrganizer = computed(() => ["organizer", "admin"].includes(auth.user?.role));
const canViewRegistrations = computed(() => ["student", "admin"].includes(auth.user?.role));

function signOut() {
  auth.signOut();
  router.push({ name: "signin" });
}
</script>

<template>
  <div class="app-shell">
    <div class="cosmic-orb cosmic-orb--1" aria-hidden="true" />
    <div class="cosmic-orb cosmic-orb--2" aria-hidden="true" />
    <div class="cosmic-orb cosmic-orb--3" aria-hidden="true" />
    <header class="topbar" v-if="auth.user">
      <div class="brand">
        <img :src="sessioLogo" alt="Sessio logo" class="brand-logo" />
        <span class="brand-title">Sessio</span>
      </div>
      <nav class="nav-links">
        <RouterLink to="/">Events</RouterLink>
        <RouterLink v-if="canViewRegistrations" to="/registrations">My Registrations</RouterLink>
        <RouterLink v-if="isOrganizer" to="/organizer">Organizer</RouterLink>
        <RouterLink v-if="isOrganizer" to="/analytics">Analytics</RouterLink>
        <RouterLink v-if="isOrganizer" to="/checkin">Check-in</RouterLink>
      </nav>
      <div class="profile">
        <span>{{ auth.user.name }} ({{ auth.user.role }})</span>
        <button class="ghost" @click="signOut">Sign out</button>
      </div>
    </header>
    <main class="page-body">
      <RouterView />
    </main>
  </div>
</template>
