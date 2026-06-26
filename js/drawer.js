/**
 * drawer.js — Thanzi Side Drawer
 * Wired: dashboard
 * Stubs: ai, meals, custom-foods, meal-templates, exercise, weight, goals
 */
const ThanziDrawer = (() => {
  'use strict';

  const _drawer  = () => document.getElementById('side-drawer');
  const _overlay = () => document.getElementById('drawer-overlay');

  // ── Open / Close ─────────────────────────────────────────────────────────

  function open() {
    _drawer().classList.add('open');
    _overlay().classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    _drawer().classList.remove('open');
    _overlay().classList.remove('open');
    document.body.style.overflow = '';
  }

  // ── Active state ──────────────────────────────────────────────────────────

  function setActive(navKey) {
    document.querySelectorAll('.drawer-nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.nav === navKey);
    });
  }

  // ── User info ─────────────────────────────────────────────────────────────

  function setUser(name, sub) {
    const nameEl = document.getElementById('drawer-user-name');
    const subEl  = document.getElementById('drawer-user-sub');
    if (nameEl) nameEl.textContent = name || '';
    if (subEl)  subEl.textContent  = sub  || '';
  }

  // ── Nav routing ───────────────────────────────────────────────────────────

  const _routes = {
    // ✅ Wired
    dashboard: () => document.getElementById('nav-home').click(),

    ai: () => {
      document.querySelectorAll('.dash-panel').forEach(p => p.style.display = 'none');
      document.getElementById('ai-panel').style.display = 'block';
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      if (typeof ThanziAI !== 'undefined') ThanziAI.onFocus();
    },
    'custom-foods': () => {
      document.querySelectorAll('.dash-panel').forEach(p => p.style.display = 'none');
      document.getElementById('custom-foods-panel').style.display = 'block';
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      if (typeof ThanziCustomFoods !== 'undefined') ThanziCustomFoods.refresh();
    },
    'meal-templates': () => {
      document.querySelectorAll('.dash-panel').forEach(p => p.style.display = 'none');
      document.getElementById('meal-templates-panel').style.display = 'block';
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      if (typeof ThanziMealTemplates !== 'undefined') ThanziMealTemplates.refresh();
    },
    exercise: () => {
      document.querySelectorAll('.dash-panel').forEach(p => p.style.display = 'none');
      document.getElementById('exercise-panel').style.display = 'block';
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      if (typeof ThanziExercise !== 'undefined') ThanziExercise.refresh();
    },
    weight: () => {
      document.querySelectorAll('.dash-panel').forEach(p => p.style.display = 'none');
      document.getElementById('weight-panel').style.display = 'block';
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      if (typeof ThanziWeight !== 'undefined') ThanziWeight.refresh();
    },
    goals: () => {
      // Goals content lives inside profile-panel as the Health & Goals sub-tab
      document.getElementById('nav-profile').click();
      // Activate the Health & Goals sub-tab
      const goalsTab = document.querySelector('.psub-btn[data-ptab="goals"]');
      if (goalsTab) goalsTab.click();
      if (typeof ThanziGoals !== 'undefined') ThanziGoals.refresh();
    },
    profile:        () => document.getElementById('nav-profile').click(),
    settings: () => {
      document.querySelectorAll('.dash-panel').forEach(p => p.style.display = 'none');
      document.getElementById('settings-panel').style.display = 'block';
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      if (typeof ThanziSettings !== 'undefined') ThanziSettings.refresh();
    },
  };

  // ── Init ─────────────────────────────────────────────────────────────────

  function init() {
    document.getElementById('hamburger-btn')
      .addEventListener('click', open);

    _overlay().addEventListener('click', close);

    document.querySelectorAll('.drawer-nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.nav;
        setActive(key);
        close();
        if (_routes[key]) _routes[key]();
      });
    });

    document.getElementById('drawer-logout-btn')
      .addEventListener('click', () => {
        close();
        document.getElementById('logout-btn').click();
      });
  }

  return { init, open, close, setActive, setUser };
})();

document.addEventListener('DOMContentLoaded', ThanziDrawer.init);
