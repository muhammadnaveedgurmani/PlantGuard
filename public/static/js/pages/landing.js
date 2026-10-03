// Landing page — value proposition, how-it-works, features, trust/safety,
// tech note, FAQ. No fake stats/testimonials per project constraints.
import { footerHtml, leafArt3d } from '../components/layout.js';

export function renderLanding(app) {
  app.innerHTML = `
  <div class="page-shell">
    <main class="page-main">
      <section class="hero">
        <div class="hero-inner">
          <div class="hero-text">
            <div class="hero-eyebrow"><span class="pulse-dot"></span> AI-Powered Plant Health</div>
            <h1 class="hero-title">Know what's wrong with<br/>your <span class="gradient-text">plant in seconds</span></h1>
            <p class="hero-subtitle">
              Upload a photo of a leaf and get an AI-powered assessment of plant health,
              possible disease, severity, and practical next steps &mdash; plus real weather-based
              risk alerts, a plant-care chat assistant, and a farmer community.
            </p>
            <div class="hero-actions">
              <button class="btn btn-primary" onclick="navigate('#/diagnosis')"><i class="fas fa-camera" aria-hidden="true"></i> Try a Diagnosis</button>
              <button class="btn btn-secondary" onclick="document.getElementById('how-it-works').scrollIntoView({behavior:'smooth'})">How It Works</button>
            </div>
          </div>
          <div class="hero-visual">
            <div class="hero-scene">
              ${leafArt3d()}
              <div class="hero-float-card card-a">
                <div class="fc-title"><i class="fas fa-circle-check" style="color:var(--color-success);" aria-hidden="true"></i> Diagnosis ready</div>
                <div class="fc-sub">38 disease classes &middot; confidence shown</div>
              </div>
              <div class="hero-float-card card-b">
                <div class="fc-title"><i class="fas fa-bolt" style="color:var(--color-accent-600);" aria-hidden="true"></i> No sign-up needed</div>
                <div class="fc-sub">3 steps &middot; free to try</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="section" id="how-it-works">
        <div class="container">
          <h2 class="section-title text-center">How It Works</h2>
          <p class="section-subtitle text-center">Three steps, no account required</p>
          <div class="how-it-works-grid">
            <div class="how-step">
              <div class="how-step-num">1</div>
              <h4>Upload a leaf photo</h4>
              <p class="text-muted" style="font-size:var(--font-size-sm);">Take or upload a clear photo of the affected leaf.</p>
            </div>
            <div class="how-step">
              <div class="how-step-num">2</div>
              <h4>AI analyzes it</h4>
              <p class="text-muted" style="font-size:var(--font-size-sm);">Vision AI identifies the plant, checks for disease, and estimates confidence.</p>
            </div>
            <div class="how-step">
              <div class="how-step-num">3</div>
              <h4>Get guidance</h4>
              <p class="text-muted" style="font-size:var(--font-size-sm);">See symptoms, treatment, prevention, and weather-based risk &mdash; and ask follow-up questions.</p>
            </div>
          </div>
        </div>
      </section>

      <section class="section" style="background:white;">
        <div class="container">
          <h2 class="section-title text-center">What You Get</h2>
          <p class="section-subtitle text-center">Everything needed to act on a diagnosis</p>
          <div class="grid-auto mt-6">
            ${featureCard('fa-magnifying-glass', 'AI Vision Diagnosis', 'Upload a leaf photo and get plant identification, disease detection, severity, and a confidence estimate &mdash; including secondary possibilities when the result is ambiguous.')}
            ${featureCard('fa-comment-dots', 'Scoped AI Assistant', 'Chat with an AI plant-care assistant that can check live weather and your diagnosis history when relevant &mdash; not a general-purpose chatbot.')}
            ${featureCard('fa-cloud-sun', 'Weather Risk Alerts', 'Real forecast data combined with deterministic rules that flag humidity, rain, and heat conditions relevant to your diagnosed disease.')}
            ${featureCard('fa-book', 'Grounded Disease Library', 'Curated, verified reference entries for common diseases, clearly labeled apart from general AI-generated information.')}
            ${featureCard('fa-users', 'Farmer Community', 'Share experiences, ask questions, and discuss with other growers.')}
            ${featureCard('fa-clock-rotate-left', 'Diagnosis History', 'Every scan is saved with search and filters so you can track plant health over time.')}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <h2 class="section-title text-center">Built for Honest Results</h2>
          <div class="trust-grid mt-6">
            ${trustItem('fa-gauge-high', 'Transparent confidence', 'Every diagnosis shows a confidence level and, when relevant, alternative possibilities &mdash; not a false sense of certainty.')}
            ${trustItem('fa-shield-halved', 'Deterministic safety checks', 'Photo quality and AI output are validated with plain, explainable rules before anything is shown to you.')}
            ${trustItem('fa-code-branch', 'Grounded knowledge, clearly labeled', 'Verified reference entries are marked separately from general AI-generated information.')}
            ${trustItem('fa-stopwatch', 'Fair use limits', 'Session-based rate limits keep the service usable and sustainable for everyone.')}
          </div>
        </div>
      </section>

      <section class="section" style="background:white;">
        <div class="container">
          <h2 class="section-title text-center">Built With</h2>
          <p class="section-subtitle text-center">Lightweight, edge-first architecture</p>
          <div class="row justify-center gap-4 wrap mt-6" style="font-size:var(--font-size-sm);color:var(--color-neutral-600);">
            <span><i class="fas fa-bolt" aria-hidden="true"></i> Cloudflare Workers</span>
            <span><i class="fas fa-database" aria-hidden="true"></i> D1 (SQLite)</span>
            <span><i class="fas fa-box-archive" aria-hidden="true"></i> R2 Object Storage</span>
            <span><i class="fas fa-cube" aria-hidden="true"></i> Hono</span>
            <span><i class="fas fa-eye" aria-hidden="true"></i> Vision AI</span>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container" style="max-width:760px;">
          <h2 class="section-title text-center">Frequently Asked Questions</h2>
          <div class="mt-6">
            ${faqItem('Is this a substitute for a professional agronomist?', 'No. PlantGuard provides AI-assisted guidance to help you understand possible issues and next steps. For high-value crops or persistent problems, consult a local agronomist or extension service.')}
            ${faqItem('Do I need to create an account?', 'No. PlantGuard uses an anonymous session so your diagnosis history and chat conversations are private to your browser session, without requiring sign-up.')}
            ${faqItem('How confident should I be in a result?', 'Each diagnosis shows a confidence level (high/medium/low). Low-confidence results are flagged clearly, and alternative possibilities are shown when the AI is uncertain.')}
            ${faqItem('What happens to my uploaded photos?', 'Photos are stored to let you review your diagnosis history and are not shared publicly.')}
          </div>
        </div>
      </section>
    </main>
    ${footerHtml()}
  </div>`;
}

function featureCard(icon, title, desc) {
  return `
  <div class="card feature-card">
    <div class="feature-card-icon"><i class="fas ${icon}" aria-hidden="true"></i></div>
    <h4 class="feature-card-title">${title}</h4>
    <p class="feature-card-description">${desc}</p>
  </div>`;
}

function trustItem(icon, title, desc) {
  return `
  <div class="trust-item">
    <i class="fas ${icon}" aria-hidden="true"></i>
    <div><strong>${title}</strong><p class="text-muted mt-0" style="font-size:var(--font-size-sm);">${desc}</p></div>
  </div>`;
}

function faqItem(q, a) {
  return `
  <details class="faq-item">
    <summary>${q}</summary>
    <p>${a}</p>
  </details>`;
}
