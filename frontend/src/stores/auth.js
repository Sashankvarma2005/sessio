import { defineStore } from "pinia";
import { api } from "../api";

const TOKEN_KEY = "sessio_token";
const USER_KEY = "sessio_user";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY),
    user: JSON.parse(localStorage.getItem(USER_KEY) || "null"),
    loading: false,
  }),
  actions: {
    persist() {
      if (this.token) {
        localStorage.setItem(TOKEN_KEY, this.token);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
      if (this.user) {
        localStorage.setItem(USER_KEY, JSON.stringify(this.user));
      } else {
        localStorage.removeItem(USER_KEY);
      }
    },
    setSession(payload) {
      this.token = payload.token;
      this.user = payload.user;
      this.persist();
    },
    async signIn(email, password) {
      this.loading = true;
      try {
        const payload = await api.request(
          "/auth/signin",
          { method: "POST", body: JSON.stringify({ email, password }) }
        );
        this.setSession(payload);
      } finally {
        this.loading = false;
      }
    },
    async signUp(name, email, password, role) {
      this.loading = true;
      try {
        const payload = await api.request(
          "/auth/signup",
          { method: "POST", body: JSON.stringify({ name, email, password, role }) }
        );
        this.setSession(payload);
      } finally {
        this.loading = false;
      }
    },
    signOut() {
      this.token = null;
      this.user = null;
      this.persist();
    },
  },
});
