# Thanzi

**Malawi’s first food & fitness tracker** — a mobile-first Progressive Web App (PWA) that helps users log meals, track nutrition, monitor water intake, record exercise, and stay on top of personal health goals.

> Tagline: **Know what you eat**

## ✨ Features

- **Authentication & onboarding**
  - Email/password login and registration
  - Google OAuth sign-in
  - Profile setup for age, sex, weight, height, activity level, and goals
- **Food logging**
  - Quick add with natural-language meal descriptions
  - Search and select single foods
  - Portion controls and meal categories (breakfast/lunch/dinner/snack)
  - Barcode scan entry support
- **Nutrition tracking**
  - Daily calorie ring and macro breakdown (carbs/protein/fat)
  - Macro progress bars against daily targets
  - Meal summaries and day totals
- **Hydration tracking**
  - Quick water add actions (+250ml / +500ml / +750ml)
  - Daily water progress visualization
- **Exercise tracking**
  - Natural-language exercise logging
  - Daily exercise summary (count, duration, calories burned)
- **Progress monitoring**
  - Weight history tracking
  - 7-day calories and water trends
  - BMI, BMR, and TDEE insights
- **Goals & profile**
  - Goal modes: lose, maintain, gain
  - Target-weight support and daily target recalculation
  - Achievement and progress sections
- **Custom food & meal tools**
  - Custom foods library
  - Reusable meal templates
- **PWA experience**
  - Installable app (manifest + icons + screenshots)
  - Offline caching with service worker
  - Push notification handling hooks
  - App shortcuts (Log Food, Ask Thandizo)
- **Theming**
  - Light/dark theme support with persisted preference

## 🧱 Tech Stack

- **Frontend:** HTML, CSS, vanilla JavaScript
- **App model:** Progressive Web App (PWA)
- **Charts:** Chart.js (CDN)
- **Caching:** Service Worker (`sw.js`) with app-shell and dynamic caching strategy
- **Deployment target:** GitHub Pages-style path deployment under `/thanzi/`

## 📁 Project Structure

```text
thanzi/
├── index.html
├── manifest.json
├── sw.js
├── deploy.sh
├── css/
│   ├── style.css
│   ├── log.css
│   ├── progress.css
│   ├── drawer.css
│   ├── custom-foods.css
│   ├── meal-templates.css
│   ├── exercise.css
│   ├── weight.css
│   ├── goals.css
│   ├── recipe.css
│   ├── ai.css
│   ├── settings.css
│   └── diary.css
├── js/
│   ├── app.js
│   ├── auth.js
│   ├── profile.js
│   ├── log.js
│   ├── progress.js
│   ├── goals.js
│   ├── settings.js
│   ├── drawer.js
│   ├── custom-foods.js
│   ├── meal-templates.js
│   ├── exercise.js
│   ├── weight.js
│   ├── ai.js
│   ├── recipe.js
│   ├── scanner.js
│   ├── config.js
│   ├── thanzi-foodSearch.js
│   └── thanzi-nutrition.js
├── icons/
└── screenshots/
```

## 🚀 Getting Started

### Prerequisites

- A modern browser (Chrome, Edge, Firefox, Safari)
- Optional for local serving: Python 3 or Node.js

### 1) Clone the repository

```bash
git clone https://github.com/edisontaimu9-ui/thanzi.git
cd thanzi
```

### 2) Serve locally

Because this is a static PWA, run it through a local HTTP server (not `file://`).

#### Option A — Python

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080/
```

#### Option B — Node (serve)

```bash
npx serve .
```

### 3) Configure environment values

This project includes `js/config.js` and integrations with external APIs/providers (authentication, nutrition data, AI endpoints, etc.).

Set your runtime configuration in `js/config.js` (or your preferred secure config-loading approach) before deploying.

> **Important:** Do not commit secrets to the repository.

## 🧪 Running as a PWA

- Ensure `manifest.json` is reachable.
- Ensure `sw.js` is registered by the app.
- Use HTTPS in production.
- For GitHub Pages path hosting, routes and asset URLs are scoped to `/thanzi/`.

## 📦 Deployment

This repo includes a deployment helper:

```bash
bash deploy.sh "chore: deploy"
```

What it does:

1. Stamps `sw.js` with a fresh build timestamp (`self.__BUILD_TS__`) for cache busting.
2. Commits all current changes.
3. Pushes to the current branch.

This helps ensure users get fresh assets after each deploy.

## 🔔 Notifications & Offline Behavior

- Service worker strategy includes:
  - **Network-first** for core app shell (`html/css/js`) with cache fallback
  - **Cache-first + background refresh** for dynamic/static assets
  - **Network-only** for selected live API domains
- Push event handling is wired for app notifications.

## 🤝 Contributing

Contributions are welcome.

1. Fork the repo
2. Create a feature branch
3. Commit your changes
4. Open a pull request

If you’re adding major functionality, please include:

- UI screenshots/GIFs
- Notes on data model changes
- Any API/config updates required

## 🗺️ Roadmap Ideas

- Expanded local/regional food datasets
- Better offline-first logging queue/sync
- More advanced nutrition insights and coaching
- Enhanced barcode coverage and food matching quality

## 📄 License

No license is currently specified in this repository.

If you want open-source reuse, add a license file (e.g., MIT, Apache-2.0).
