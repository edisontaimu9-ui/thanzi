/**
 * drawer.js — Thanzi Side Drawer
 * Open/close only. Nav items are stubs — wire up one by one.
 */
const ThanziDrawer = (() => {
  'use strict';

  const _drawer  = () => document.getElementById('side-drawer');
  const _overlay = () => document.getElementById('drawer-overlay');

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

  function setActive(navKey) {
    document.querySelectorAll('.drawer-nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.nav === navKey);
    });
  }

  function setUser(name, sub) {
    const nameEl = document.getElementById('drawer-user-name');
    const subEl  = document.getElementById('drawer-user-sub');
    if (nameEl) nameEl.textContent = name || '';
    if (subEl)  subEl.textContent  = sub  || '';
  }

  function init() {
    // Hamburger opens drawer
    document.getElementById('hamburger-btn')
      .addEventListener('click', open);

    // Overlay click closes drawer
    _overlay().addEventListener('click', close);

    // Nav item stubs — close drawer then TODO: route
    document.querySelectorAll('.drawer-nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        setActive(btn.dataset.nav);
        close();
        // TODO: handle btn.dataset.nav routing
      });
    });

    // Logout stub
    document.getElementById('drawer-logout-btn')
      .addEventListener('click', () => {
        close();
        // TODO: call ThanziAuth.logout()
      });
  }

  return { init, open, close, setActive, setUser };
})();

document.addEventListener('DOMContentLoaded', ThanziDrawer.init);
