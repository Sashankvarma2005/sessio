import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "./stores/auth";
import SignInView from "./views/SignInView.vue";
import EventsView from "./views/EventsView.vue";
import MyRegistrationsView from "./views/MyRegistrationsView.vue";
import OrganizerView from "./views/OrganizerView.vue";
import AnalyticsView from "./views/AnalyticsView.vue";
import CheckInView from "./views/CheckInView.vue";

const routes = [
  { path: "/signin", name: "signin", component: SignInView },
  { path: "/", name: "events", component: EventsView, meta: { auth: true } },
  {
    path: "/registrations",
    name: "registrations",
    component: MyRegistrationsView,
    meta: { auth: true, studentOnly: true },
  },
  {
    path: "/organizer",
    name: "organizer",
    component: OrganizerView,
    meta: { auth: true, organizerOnly: true },
  },
  {
    path: "/analytics",
    name: "analytics",
    component: AnalyticsView,
    meta: { auth: true, organizerOnly: true },
  },
  {
    path: "/checkin",
    name: "checkin",
    component: CheckInView,
    meta: { auth: true, organizerOnly: true },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.auth && !auth.token) return { name: "signin" };
  if (to.name === "signin" && auth.token) return { name: "events" };
  if (to.meta.organizerOnly && !["organizer", "admin"].includes(auth.user?.role)) {
    return { name: "events" };
  }
  if (to.meta.studentOnly && !["student", "admin"].includes(auth.user?.role)) {
    return { name: "events" };
  }
  return true;
});

export default router;
