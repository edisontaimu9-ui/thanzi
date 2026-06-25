/**
 * drawer.js — Thanzi Side Drawer
 * Wired: dashboard
 * Stubs: ai, meals, custom-foods, meal-templates, exercise, weight, goals, settings
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
    // ✅ Wired — triggers existing bottom nav
    dashboard: () => document.getElementById('nav-home').click(),

    // 🔲 Stubs — wire up one by one
    ai:             () => console.log('TODO: AI Assistant'),
    meals:          () => console.log('TODO: Meals'),
    'custom-foods': () => console.log('TODO: Custom Foods'),
    'meal-templates': () => console.log('TODO: Meal Templates'),
    exercise:       () => console.log('TODO: Exercise'),
    weight:         () => console.log('TODO: Weight'),
    goals:          () => console.log('TODO: Goals'),
    profile:        () => document.getElementById('nav-profile').click(),
    settings:       () => console.log('TODO: Settings'),
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
