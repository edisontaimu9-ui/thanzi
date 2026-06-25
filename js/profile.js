/**
 * profile.js — Thanzi Profile Panel
 *
 * Reads BMI / BMR / TDEE straight from the nutrition plan already saved in
 * localStorage at onboarding (thanzi_profile_<uid>) — no new calculation
 * needed, ThanziNutrition.generate() already returns these in `assessment`.
 *
 * Avatar photos are resized client-side (canvas) and stored as a data URL in
 * localStorage under thanzi_avatar_<uid>. This keeps the upload control fully
 * working today without a backend dependency. When Thanzi gets an Appwrite
 * Storage bucket, swap _bindAvatarUpload's save step for a real upload and
 * keep everything else the same.
 */
const ThanziProfile = (() => {

  const AVATAR_MAX_DIM     = 480;   // px, longest side after resize
  const AVATAR_JPEG_QUALITY = 0.82;
  const AVATAR_MAX_BYTES   = 5 * 1024 * 1024; // 5MB, matches the UI hint

  let _user = null;

  const _el = (id) => document.getElementById(id);

  const _planKey   = (uid) => `thanzi_profile_${uid}`;
  const _avatarKey = (uid) => `thanzi_avatar_${uid}`;
  const _bioKey    = (uid) => `thanzi_bio_${uid}`;

  // ── Stat cards (BMI / BMR / TDEE) ────────────────────────────────────────

  const _renderStats = (uid) => {
    let plan;
    try {
      const raw = localStorage.getItem(_planKey(uid));
      plan = raw ? JSON.parse(raw) : null;
    } catch (e) {
      plan = null;
    }
    const a = plan && plan.assessment;
    if (!a) return;

    _el('profile-bmi').textContent     = a.bmi;
    _el('profile-bmi-cat').textContent = a.bmi_category;
    _el('profile-bmr').textContent     = Math.round(a.bmr_kcal);
    _el('profile-tdee').textContent    = Math.round(a.eer_kcal);
  };

  // ── Account info ─────────────────────────────────────────────────────────

  const _renderAccount = (user) => {
    _el('profile-email').textContent = user.email || '—';
    _el('profile-name').value = user.name || '';
  };

  // ── Avatar ───────────────────────────────────────────────────────────────

  const _showAvatar = (dataUrl) => {
    const img    = _el('avatar-img');
    const circle = _el('avatar-circle');
    if (dataUrl) {
      img.src = dataUrl;
      img.style.display = 'block';
      circle.classList.add('has-photo');
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
      circle.classList.remove('has-photo');
    }
  };

  const _loadAvatar = (uid) => {
    let stored = null;
    try { stored = localStorage.getItem(_avatarKey(uid)); } catch (e) { /* ignore */ }
    _showAvatar(stored);
  };

  // Resize + re-encode an image file to a small JPEG data URL via canvas.
  const _resizeImage = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, AVATAR_MAX_DIM / Math.max(width, height));
        width  = Math.max(1, Math.round(width  * scale));
        height = Math.max(1, Math.round(height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', AVATAR_JPEG_QUALITY));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  const _bindAvatarUpload = (uid) => {
    const input = _el('avatar-file-input');

    _el('avatar-upload-btn').addEventListener('click', () => input.click());

    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.value = ''; // allow re-selecting the same file later
      if (!file) return;

      if (!/^image\/(jpeg|png)$/.test(file.type)) {
        _flash('Please choose a JPG or PNG image.', true);
        return;
      }
      if (file.size > AVATAR_MAX_BYTES) {
        _flash('That image is larger than 5MB.', true);
        return;
      }

      try {
        const dataUrl = await _resizeImage(file);
        try {
          localStorage.setItem(_avatarKey(uid), dataUrl);
        } catch (e) {
          _flash('Photo processed but could not be saved on this device.', true);
          return;
        }
        _showAvatar(dataUrl);
        _flash('Photo updated.');
      } catch (err) {
        _flash(err.message || 'Could not process that image.', true);
      }
    });
  };

  // ── Sub-tabs ─────────────────────────────────────────────────────────────

  const COMING_SOON = {
    goals:         { icon: '🎯', title: 'Health & Goals',  sub: 'Edit your stats and goals here — coming soon.' },
    notifications: { icon: '🔔', title: 'Notifications',   sub: 'Reminders and alerts are coming soon.' },
    progress:      { icon: '📈', title: 'Progress',        sub: 'Track your trends over time — coming soon.' },
    achievements:  { icon: '🏅', title: 'Achievements',    sub: 'Milestones and badges are coming soon.' },
  };

  const _bindSubtabs = () => {
    document.querySelectorAll('.psub-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.psub-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const tab = btn.dataset.ptab;
        if (tab === 'profile') {
          _el('ptab-profile').style.display = 'block';
          _el('ptab-placeholder').style.display = 'none';
        } else {
          _el('ptab-profile').style.display = 'none';
          _el('ptab-placeholder').style.display = 'block';
          const c = COMING_SOON[tab];
          if (c) {
            _el('csoon-icon').textContent  = c.icon;
            _el('csoon-title').textContent = c.title;
            _el('csoon-sub').textContent   = c.sub;
          }
        }
      });
    });
  };

  // ── Save (name + bio) ────────────────────────────────────────────────────

  let _flashTimer = null;
  const _flash = (msg, isError = false) => {
    const el = _el('profile-save-msg');
    el.textContent = msg;
    el.classList.toggle('error', isError);
    el.style.display = 'block';
    clearTimeout(_flashTimer);
    _flashTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
  };

  const _bindSave = (uid) => {
    _el('profile-save-btn').addEventListener('click', async () => {
      const name = _el('profile-name').value.trim();
      const bio  = _el('profile-bio').value.trim();

      if (!name) {
        _flash("Full name can't be empty.", true);
        return;
      }

      const btn = _el('profile-save-btn');
      btn.disabled = true;

      try {
        if (typeof ThanziAuth.updateName === 'function') {
          const result = await ThanziAuth.updateName(name);
          if (!result.success) {
            _flash(result.error || 'Could not update name.', true);
            return;
          }
        }
        try { localStorage.setItem(_bioKey(uid), bio); } catch (e) { /* ignore */ }
        _flash('Profile saved.');
      } catch (err) {
        _flash(err.message || 'Could not save profile.', true);
      } finally {
        btn.disabled = false;
      }
    });
  };

  // ── Public API ───────────────────────────────────────────────────────────

  const init = (user) => {
    _user = user;
    _renderStats(user.$id);
    _renderAccount(user);

    let bio = '';
    try { bio = localStorage.getItem(_bioKey(user.$id)) || ''; } catch (e) { /* ignore */ }
    _el('profile-bio').value = bio;

    _loadAvatar(user.$id);
    _bindAvatarUpload(user.$id);
    _bindSubtabs();
    _bindSave(user.$id);
  };

  // Called every time the Profile nav tab is opened — re-syncs the stat
  // cards in case the nutrition plan changed elsewhere this session.
  const refresh = () => {
    if (_user) _renderStats(_user.$id);
  };

  return { init, refresh };
})();
